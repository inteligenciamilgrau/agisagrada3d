/**
 * Sala base — lobby, tick de física, broadcast de snapshot.
 * DM e BR herdam daqui e só acrescentam as regras do modo.
 */

import { NET, MODES, CAR, NUM_CARS, HELI, NUM_HELIS, MISSIL, PLAYER } from '../config.js';
import { T, send, lobbyPlayer } from '../protocol.js';
import { stepBody } from '../physics.js';
import { createCars, updateCars } from '../cars.js';
import { createHelis, updateHelis } from '../helis.js';
import { createMissis, updateMissis } from '../missiles.js';
import { WEAPONS } from '../weapons.js';
import { makeRng, findFreeSpot, dist2D } from '../util.js';

let uid = 1000;

export class Room {
  constructor(salaId, manager, modo, cycleModeIni) {
    this.salaId = salaId;
    this.manager = manager;
    this.modo = modo;
    this.cfg = MODES[modo];

    this.players = new Map();   // id -> { client, nick, pronto, host, body, hp, ... }
    this.bots = new Map();      // id -> bot
    this.seq = 0;
    this.state = 'lobby';       // lobby | countdown | playing | ended
    this.countdownT = 0;
    this._cdBcast = 0;          // contador p/ reenviar o lobby 1x/s no countdown
    this.elapsed = 0;
    this.world = null;          // preenchido no startGame
    this.cars = [];             // veiculos do MP (server/cars.js)
    this.helis = [];            // helicopteros do MP (server/helis.js)
    this._lastTick = Date.now();

    this._inputLog = new Map(); // anti-flood: id -> {count, t0}
    // [DIA-NOITE] o SERVIDOR (host) controla a hora do dia — todos os
    // clientes replicam o mesmo céu via snap (o relógio local fica parado)
    // [DIA-NOITE] o clima da sala é definido pelo HOST (quem criou): ciclo,
    // sempre dia ou sempre noite — vindo no HELLO e replicado a todos via snap.
    // Quem entra depois na sala existente NÃO muda (só vale na criação).
    this.hour = 8.5;            // começa de manhã (DAY.startHour do cliente)
    this.cycleMode = 'ciclo';   // 'ciclo' | 'dia' | 'noite'
    if (cycleModeIni === 'ciclo' || cycleModeIni === 'dia' || cycleModeIni === 'noite') {
      this.cycleMode = cycleModeIni;
      if (cycleModeIni === 'dia') this.hour = 12;      // fixedDayHour
      else if (cycleModeIni === 'noite') this.hour = 22;  // fixedNightHour
    }
    this._hourPerSec = 24 / 135.5;   // DAY.duration do cliente (seg por dia)
  }

  canJoin() {
    // vaga é por HUMANO: bots não bloqueiam a entrada (addClient cede um bot
    // se a sala estiver cheia). Contagem incluída no countdown para o amigo
    // que chega com o jogo quase começando conseguir entrar na MESMA sala.
    return (this.state === 'lobby' || this.state === 'countdown') && this.players.size < this.cfg.maxPlayers;
  }

  get totalSlots() { return this.players.size + this.bots.size; }

  /** Jogador humano entra (vindo do WebSocket). */
  addClient(client, nick, cor, token) {
    const id = uid++;
    const p = lobbyPlayer(id, nick, { host: this.players.size === 0 && this.bots.size === 0, cor, token });
    // humano tem prioridade: se a sala está cheia de bots, um bot cede a vaga
    if (this.players.size + this.bots.size >= this.cfg.maxPlayers && this.bots.size > 0) {
      const [bid, bot] = this.bots.entries().next().value;
      this.bots.delete(bid);
      this._bcast(T.BOT_SAIU, { id: bid });
      this._log('bot ' + bot.nick + ' cedeu a vaga para ' + nick);
    }
    p.client = client;
    p.body = null;
    p.hp = 100;
    p.kills = 0;
    p.deaths = 0;
    p.invuln = 0;
    p.arma = 'pistola';
    p.ping = 0;
    client._room = this;
    client._playerId = id;
    this.players.set(id, p);
    this._sendTo(p, T.WELCOME, { id, salaId: this.salaId, modo: this.modo, cfg: this.publicCfg(), host: p.host, cor: p.cor });
    this._bcastLobby();
    this._log('entrou: ' + nick + ' (id ' + id + ')');
    return p;
  }

  /** Bot entra (id negativo para não colidir com humanos). */
  addBot(bot) {
    const id = -(uid++);
    bot.id = id;
    bot.pronto = true;
    bot.host = false;
    bot.hp = 100;
    bot.kills = 0;
    bot.deaths = 0;
    bot.invuln = 0;
    bot.arma = 'pistola';
    this.bots.set(id, bot);
    this._bcastLobby();
  }

  removePlayer(id) {
    const p = this.players.get(id);
    if (p) {
      if (p.client) { p.client._room = null; p.client._playerId = null; }
      this.players.delete(id);
    } else {
      this.bots.delete(id);
    }
    this._bcast(T.PLAYER_LEFT, { id });
    this._log('saiu: id ' + id);
    // sala órfã: sem humanos, os bots não seguram a sala — ela fecha de vez
    if (this.players.size === 0) {
      this.manager.remove(this.salaId);
      this.stop();
    } else if (this.state === 'lobby' || this.state === 'countdown') {
      // transfere host para o primeiro humano restante (também no countdown:
      // se o host sair na contagem, o outro jogador assume o lobby)
      const first = this.players.values().next().value;
      if (first && !first.host) {
        first.host = true;
        this._bcastLobby();
      }
    }
  }

  _vivos() {
    return [...this.players.values()].filter((p) => p.client && p.client.readyState === 1);
  }

  ready(id) {
    const p = this.players.get(id);
    if (!p || this.state !== 'lobby') return;
    p.pronto = !p.pronto;
    // sem host (sala com bots órfãos): o primeiro humano a marcar pronto assume
    if (!this._vivos().some((h) => h.host)) p.host = true;
    // NÃO inicia sozinho: o início é explícito pelo botão INICIAR PARTIDA
    // (T.START), quando todos os humanos estiverem prontos
    this._bcastLobby();
  }

  /** Host inicia (só quando todos os humanos estão prontos). */
  start(id) {
    if (this.state !== 'lobby') return;
    const p = this.players.get(id);
    if (!p || !p.host) return;
    const vivos = this._vivos();
    if (vivos.length === 0) return;

    if (vivos.length > 1 && vivos.some((h) => !h.pronto)) {
      send(p.client, { t: T.ERROR, msg: 'Aguardando todos marcarem PRONTO' });
      return;
    }
    this.state = 'countdown';
    this.countdownT = 3;   // contagem regressiva de 3s (mais agil), 1s a 1s na tela
    this.cdEnd = Date.now() + 3000;   // timestamp ABSOLUTO: o cliente decrementa local
    this._bcastLobby();
    this._log('contagem para iniciar...');
  }

  tick() {
    const now = Date.now();
    if (this._lastTick == null) this._lastTick = now;
    const dt = Math.min(0.1, (now - this._lastTick) / 1000);
    this._lastTick = now;

    if (this.state === 'countdown') {
      this.countdownT -= dt;
      // a contagem na tela "anda": reenvia o lobby 1x/s (sem isso o cliente
      // fica preso em "Partida em 10s…" até o GAME_START)
      this._cdBcast -= dt;
      if (this._cdBcast <= 0) { this._bcastLobby(); this._cdBcast = 1; }
      if (this.countdownT <= 0) this._beginGame();
      return;
    }
    if (this.state !== 'playing') return;

    this.elapsed += dt;
    if (this.cycleMode === 'ciclo') this.hour = (this.hour + dt * this._hourPerSec) % 24;
    this._step(dt);
    this._stepBodies(dt);
    this._stepCars(dt);
    this._stepHelis(dt);
    this._stepMissis(dt);
    this._regenVida(dt);
    this._botLimiteMapa();
    this._broadcastSnapshot();
  }

  /** [DIA-NOITE] host alterna: ciclo -> dia -> noite -> ciclo */
  cycleBy(modo) {
    const ordem = ['ciclo', 'dia', 'noite'];
    if (modo === 'ciclo' || modo === 'dia' || modo === 'noite') {
      this.cycleMode = modo;
    } else {
      const i = (ordem.indexOf(this.cycleMode) + 1) % ordem.length;
      this.cycleMode = ordem[i];
    }
    if (this.cycleMode === 'dia') this.hour = 12;         // fixedDayHour
    else if (this.cycleMode === 'noite') this.hour = 22;  // fixedNightHour
    this._log('host definiu o tempo para: ' + this.cycleMode);
  }

  _beginGame() {
    this.state = 'playing';
    this.seq = 0;
    this.elapsed = 0;
    this._setupWorld();
    this.cars = createCars(this.world, NUM_CARS);
    this.helis = createHelis(this.world, NUM_HELIS);
    this.missis = createMissis();
    this._spawnAll();
    this._bcast(T.GAME_START, {
      modo: this.modo,
      // seed REAL do mundo: cliente e servidor geram a cidade com a mesma
      // seed fixa 777 — todos os jogadores veem o MESMO mapa (e o mesmo
      // lugar dos postes/árvores, que o servidor usa para colidir)
      seed: 777,
      jogadores: this._all().map((p) => ({ id: p.id, nick: p.nick, bot: !!this.bots.get(p.id) })),
    });
    this._log('partida iniciada!');
  }

  // ------------------------------ hooks que DM/BR sobrescrevem
  _setupWorld() {}
  _step(dt) {}

  // [BOT-MAPA] garantia fisica: nenhum bot fica fora do mapa dos predios (+-222)
  _botLimiteMapa() {
    if (this.bots.size === 0) return;
    const LIM = 222;
    for (const b of this.bots.values()) {
      if (!b.body) continue;
      const p = b.body.pos;
      if (Math.abs(p.x) > LIM || Math.abs(p.z) > LIM) {
        const ang = Math.atan2(-p.x, -p.z);
        const rad = LIM * 0.8;
        p.x = Math.cos(ang) * rad;
        p.z = Math.sin(ang) * rad;
        if (b.body.vel) { b.body.vel.x = 0; b.body.vel.z = 0; }
        if (b.inHeli != null) p.y = Math.min(p.y, 55);
      }
    }
  }
  _spawnPoint(p) { return findFreeSpot(this.world.col, 0, 0); }
  _onEnd() {}

  // ------------------------------ utilitários
  _all() {
    return [...this.players.values(), ...this.bots.values()];
  }

  _alive() {
    return this._all().filter((p) => p.hp > 0);
  }

  _spawnAll() {
    for (const p of this._all()) this._spawn(p);
  }

  _spawn(p) {
    const pt = this._spawnPoint(p);
    p.body = {
      pos: { x: pt.x, y: pt.y, z: pt.z },
      vel: { x: 0, y: 0, z: 0 },
      yaw: Math.atan2(-pt.x, -pt.z),
      pitch: 0,
      onGround: true,
      // [BOT-VEL] bot anda na QUARTA PARTE da velocidade do jogador (3.2 vs 12.8 m/s)
      velMult: p.client ? 1 : 0.25,   // [EXPERT] bots MUITO lentos no corpo
    };
    p.hp = 100;
    p.semDano = 0;
    p.invuln = 3;
    p.arma = 'pistola';
    p.inCar = null;
    p.inHeli = null;
    this._sendTo(p, T.SPAWN, { id: p.id, x: pt.x, y: pt.y, z: pt.z, yaw: p.body.yaw });
    if (p.id > 0) {
      this._bcast(T.RESPAWN, { id: p.id, x: pt.x, y: pt.y, z: pt.z, yaw: p.body.yaw, invuln: 3 });
    }
  }

  _applyInput(p, msg) {
    if (!p.body) return;
    if (msg.car != null) this._veiculo(p, msg.car);
    if (msg.heli != null) this._veiculoHeli(p, msg.heli);
    // [BOT-VEL] bot nunca corre: com run=false o teto e walkSpeed 12.8 x 0.25 = 3.2 m/s
    if (!p.client) msg.run = false;
    const inp = {
      moveX: clampNum(msg.moveX, -1, 1),
      moveZ: clampNum(msg.moveZ, -1, 1),
      yaw: msg.yaw ?? p.body.yaw,
      pitch: msg.pitch ?? p.body.pitch,
      run: !!msg.run,
      jump: !!msg.jump,
      // controles do helicóptero (o corpo vira piloto no _stepHelis)
      up: !!msg.up,
      down: !!msg.down,
      heliYaw: clampNum(msg.heliYaw, -1, 1),
      heliDesiredYaw: msg.heliDesiredYaw ?? null,
    };
    p.body.moveX = inp.moveX;
    p.body.moveZ = inp.moveZ;
    // [BOT-HELI] bots também recebem o _inp (o _stepHelis lê up/down/heliYaw
    // do piloto para montar os controles do aparelho)
    p.body._inp = inp;
    if (p.client) {
      // humano: guarda o último input e a INTEGRAÇÃO roda no tick a 30 Hz.
      // Integrar aqui (a 20 Hz, a cadência do input) fazia o jogador andar
      // a 2/3 da velocidade do solo — e dos bots, que integram no tick.
      return;
    }
    const r = stepBody(this.world, p.body, inp, 1 / NET.tickRate);
    if (p.body.onGround) p.body._caiuHeli = false;
    if (r.fallDamage > 0) this._danoQueda(p, r);
  }

  /** Integra a física dos jogadores humanos a 30 Hz com o último input. */
  _stepBodies(dt) {
    for (const p of this.players.values()) {
      if (!p.body || !p.body._inp) continue;
      if (p.inCar != null) continue;   // o carro move o corpo do motorista
      if (p.inHeli != null) continue;  // o helicóptero move o corpo do piloto
      const r = stepBody(this.world, p.body, p.body._inp, dt);
      // [S23-FIX] NaN sanitize: 0/0 ou exp() estourado em alguma GPU/input
      // geraria posicao NaN -> snapshot NaN -> avatar 'explode' no cliente.
      if (!Number.isFinite(p.body.pos.x) || !Number.isFinite(p.body.pos.y) || !Number.isFinite(p.body.pos.z)) {
        p.body.pos.x = this._safeX ?? 0; p.body.pos.y = this._safeY ?? 2; p.body.pos.z = this._safeZ ?? 0;
        p.body.vel = { x: 0, y: 0, z: 0 };
      } else {
        this._safeX = p.body.pos.x; this._safeY = p.body.pos.y; this._safeZ = p.body.pos.z;
      }
      if (p.body.onGround) p.body._caiuHeli = false;
      if (r.fallDamage > 0) this._danoQueda(p, r);
    }
  }

  /** Entra/sai do carro: msg.car = id do carro (entrar) ou 0 (sair). */
  _veiculo(p, alvo) {
    if (!this.cars || this.cars.length === 0) return;
    if (!p.body) return;
    if (p.inCar == null) {
      if (p.inHeli != null) return;   // pilotando: sai do helicóptero antes
      const c = this.cars.find((cc) => cc.id === alvo && cc.playerId == null && !cc.destroyed);
      if (!c) return;
      const d = dist2D(p.body.pos.x, p.body.pos.z, c.x, c.z);
      if (d > CAR.enterRange) return;
      p.inCar = c.id;
      c.playerId = p.id;
      c.inp = { moveX: 0, moveZ: 0 };
      this._bcast(T.CAR_JOIN, { id: p.id, carId: c.id });
    } else {
      this._sairCarro(p);
    }
  }

  _sairCarro(p) {
    const c = this.cars.find((cc) => cc.id === p.inCar);
    if (c) {
      c.playerId = null;
      c.inp = null;
      const pt = findFreeSpot(this.world.col, c.x + 3, c.z + 3, 0.6);
      if (p.body) {
        p.body.pos.x = pt.x;
        p.body.pos.y = pt.y;
        p.body.pos.z = pt.z;
        p.body.vel = { x: 0, y: 0, z: 0 };
      }
    }
    p.inCar = null;
    this._bcast(T.CAR_LEAVE, { id: p.id });
  }

  /** Entra/sai do helicóptero: msg.heli = id do aparelho (entrar) ou 0 (sair). */
  _veiculoHeli(p, alvo) {
    if (!this.helis || this.helis.length === 0) return;
    if (!p.body) return;
    if (p.inHeli == null) {
      if (p.inCar != null) return;   // sem troca direta: sai do carro antes
      const h = this.helis.find((hh) => hh.id === alvo && hh.playerId == null);
      if (!h) return;
      const d = dist2D(p.body.pos.x, p.body.pos.z, h.x, h.z);
      if (d > HELI.enterRange) return;
      p.inHeli = h.id;
      h.playerId = p.id;
      h.inp = { forward: 0, strafe: 0, up: 0, down: 0, yawLeft: 0, yawRight: 0 };
      this._log(p.nick + ' embarcou no helicóptero #' + h.id);
    } else {
      this._sairHeli(p);
    }
  }

  _sairHeli(p) {
    const h = this.helis.find((hh) => hh.id === p.inHeli);
    if (h) {
      if (p.body) {
        // o piloto fica na posição do aparelho (pode estar no ar) e cai
        // com a gravidade normal — nada de teletransporte para o chão
        p.body.pos.x = h.x;
        p.body.pos.y = h.y;
        p.body.pos.z = h.z;
        p.body.vel = { x: 0, y: 0, z: 0 };
        p.body.onGround = false;
        p.body._caiuHeli = true;   // queda do heli: regra própria de dano (só > 100 m morre)
      }
      h.playerId = null;
      h.inp = null;
      h.vel.x = 0; h.vel.z = 0;
      h.vel.y = Math.min(0, h.vel.y);
    }
    p.inHeli = null;
  }

  /** Move os helicópteros pilotados e faz o piloto acompanhar o aparelho. */
  _stepHelis(dt) {
    if (!this.helis || this.helis.length === 0) return;
    for (const h of this.helis) {
      if (h.playerId == null) { h.inp = null; continue; }
      const p = this._all().find((pp) => pp.id === h.playerId);
      // [BOT-VEICULO] heli de bot tambem voa na metade (42 m/s cheio e impossivel mirar)
      h.velMult = p && !p.client ? 0.25 : 1;
      h.inp = p && p.body
        ? {
            forward: clampNum(p.body.moveZ || 0, -1, 1),
            strafe: clampNum(p.body.moveX || 0, -1, 1),
            up: p.body._inp ? (p.body._inp.up ? 1 : 0) : 0,
            down: p.body._inp ? (p.body._inp.down ? 1 : 0) : 0,
            yawLeft: p.body._inp ? (p.body._inp.heliYaw > 0 ? 1 : 0) : 0,
            yawRight: p.body._inp ? (p.body._inp.heliYaw < 0 ? 1 : 0) : 0,
            desiredYaw: p.body._inp ? (p.body._inp.heliDesiredYaw ?? null) : null,
          }
        : { forward: 0, strafe: 0, up: 0, down: 0, yawLeft: 0, yawRight: 0 };
    }
    updateHelis(this.world, this.helis, dt);
    for (const h of this.helis) {
      if (!Number.isFinite(h.x) || !Number.isFinite(h.y) || !Number.isFinite(h.z)) {
        h.x = this._safeX ?? 0; h.y = Math.max(20, this._safeY ?? 20); h.z = this._safeZ ?? 0;
        h.vel = { x: 0, y: 0, z: 0 };
      }
    }
    for (const h of this.helis) {
      if (!Number.isFinite(h.x) || !Number.isFinite(h.y) || !Number.isFinite(h.z)) {
        h.x = this._safeX ?? 0; h.y = Math.max(20, this._safeY ?? 20); h.z = this._safeZ ?? 0;
        h.vel = { x: 0, y: 0, z: 0 };
      }
    }
    for (const p of this._all()) {
      if (p.inHeli != null && p.body) {
        const h = this.helis.find((hh) => hh.id === p.inHeli);
        if (h) {
          p.body.pos.x = h.x;
          p.body.pos.y = h.y;
          p.body.pos.z = h.z;
          p.body.yaw = h.yaw;
          p.body.pitch = 0;
          p.body.onGround = false;
          p.body.vel = { x: 0, y: 0, z: 0 };
        }
      }
    }
  }

  /** Move os carros dirigidos e faz o motorista acompanhar o carro. */
  _stepCars(dt) {
    if (!this.cars || this.cars.length === 0) return;
    for (const c of this.cars) {
      if (c.playerId == null) { c.inp = null; continue; }
      const p = this._all().find((pp) => pp.id === c.playerId);
      c.inp = p && p.body
        ? { moveX: p.body.moveX || 0, moveZ: p.body.moveZ || 0 }
        : { moveX: 0, moveZ: 0 };
      // [BOT-VEICULO] carro de bot tambem anda na metade (senao "passa como raio" a 26 m/s)
      c.velMult = p && !p.client ? 0.35 : 1;
    }
    updateCars(this.world, this.cars, dt);
    for (const c of this.cars) {
      if (!Number.isFinite(c.x) || !Number.isFinite(c.y) || !Number.isFinite(c.z)) {
        c.x = this._safeX ?? 0; c.y = this._safeY ?? 2; c.z = this._safeZ ?? 0;
        c.vel = { x: 0, y: 0, z: 0 };
      }
    }
    for (const c of this.cars) {
      if (!Number.isFinite(c.x) || !Number.isFinite(c.y) || !Number.isFinite(c.z)) {
        c.x = this._safeX ?? 0; c.y = this._safeY ?? 2; c.z = this._safeZ ?? 0;
        c.vel = { x: 0, y: 0, z: 0 };
      }
    }
    for (const p of this._all()) {
      if (p.inCar != null && p.body) {
        const c = this.cars.find((cc) => cc.id === p.inCar);
        if (c) {
          p.body.pos.x = c.x;
          p.body.pos.y = c.y;
          p.body.pos.z = c.z;
          p.body.yaw = c.yaw;
          p.body.pitch = 0;
          p.body.onGround = true;
          p.body.vel = { x: 0, y: 0, z: 0 };
        }
      }
    }
  }

  /** Dano de queda com a regra do helicóptero: caiu do aparelho, só morre
   *  acima de ~100 m (74,8 m/s com a gravidade 28 do MP); abaixo, dano zero. */
  _danoQueda(p, r) {
    if (r.fallDamage <= 0) return;
    let dmg = r.fallDamage;
    const b = p.body;
    if (b && b._caiuHeli) {
      dmg = b.vel.y <= -74.8 ? 100 : 0;
      if (b.onGround) b._caiuHeli = false;
    }
    if (dmg > 0) this._damage(p, null, dmg, 'queda');
  }

  /** Integra os mísseis em voo; na explosão, dano em área + visual p/ todos. */
  _stepMissis(dt) {
    if (!this.missis || this.missis.length === 0) return;
    updateMissis(this.world, this.missis, this._all(), dt, (m) => {
      for (const p of this._all()) {
        if (!p.body || p.hp <= 0) continue;
        const d = Math.hypot(p.body.pos.x - m.x, (p.body.pos.y + 1) - m.y, p.body.pos.z - m.z);
        if (d < MISSIL.raio) {
          let dmg = Math.round(MISSIL.dano * (1 - d / MISSIL.raio));
          if (m.por && this.bots.get(m.por.id)) dmg = Math.round(dmg * 0.5);   // [BOT-HELI] missile de bot da metade
          if (dmg > 0) this._damage(p, m.por, dmg, 'missil');
        }
      }
      this._bcast(T.MISSIL, { id: m.id, x: Math.round(m.x * 10) / 10, y: Math.round(m.y * 10) / 10, z: Math.round(m.z * 10) / 10 });
    });
  }

  /** Regeneração automática (estilo solo): sem levar dano por `regenDelay`
   *  segundos, o humano recupera `regenTime` de vida por segundo até 100.
   *  Bots não regeneram (id negativo). O hp novo sai no snapshot. */
  _regenVida(dt) {
    for (const p of this.players.values()) {
      if (!p.body || p.hp <= 0 || p.hp >= 100) { p.semDano = 0; continue; }
      p.semDano = (p.semDano || 0) + dt;
      if (p.semDano >= PLAYER.regenDelay) {
        p.hp = Math.min(100, p.hp + PLAYER.regenTime * dt);
      }
    }
  }

  _damage(alvo, por, dmg, arma = 'arma') {
    if (!alvo || alvo.hp <= 0) return;
    if (alvo.invuln > 0 && por) return;   // spawn protegido
    alvo.hp = Math.max(0, alvo.hp - dmg);
    alvo.semDano = 0;   // [REGEN] qualquer dano zera o relógio da regeneração
    if (this.bots.has(alvo.id) && typeof alvo.levouDano === 'function') alvo.levouDano(dmg, por);   // [BOT-COVER] IA sabe quem a acertou
    this._bcast(T.DAMAGE, {
      alvo: alvo.id, por: por ? por.id : null, dmg, hp: alvo.hp,
      direcao: por && por.body ? { x: por.body.pos.x, z: por.body.pos.z } : null,
    });
    if (alvo.hp <= 0) this._kill(alvo, por, arma);
  }

  _kill(morto, por, arma) {
    if (morto.inCar != null) this._sairCarro(morto);
    if (morto.inHeli != null) this._sairHeli(morto);
    if (morto.deaths != null) morto.deaths++;
    if (por && por.kills != null && por !== morto) por.kills++;
    this._bcast(T.DEATH, { id: morto.id, por: por ? por.id : null, arma });
    if (por && por !== morto) this._bcast(T.KILL, { id: morto.id, por: por.id, arma });
    this._onKill(morto, por);
  }

  /**
   * Tiro: raycast autoritativo contra jogadores, bots e carros.
   * O mais próximo vence (um carro entre o atirador e o alvo protege o alvo,
   * igual à campanha, onde a bala não atravessa um carro).
   */
  onShoot(p, aim) {
    if (!p.body || p.hp <= 0) return;
    // de helicóptero o E/clique dispara o MÍSSIL de canhão (igual ao solo)
    if (p.inHeli != null) { this._fireMissil(p, aim); return; }
    const W = WEAPONS[p.arma] || WEAPONS.pistola;
    const now = Date.now();
    if (now - (p._lastFire || 0) < W.cooldown * 1000) return;
    p._lastFire = now;
    p._fireVis = now;   // [MP] flag visual: o cliente ergue o braco/arma do avatar

    // origem do tiro: a CÂMERA do cliente (a linha exata da mira — mesmo ponto
    // de onde o tracer/bala saem). Valida que está perto do peito (anti-cheat);
    // fallback: o peito do jogador.
    let ox = p.body.pos.x, oy = p.body.pos.y + 1.5, oz = p.body.pos.z;
    // de helicóptero a câmera fica longe do corpo (3ª pessoa + zoom): o
    // anti-cheat do pé no chão (raio 6/4 m) rejeitaria o tiro legítimo
    const emHeli = p.inHeli != null;
    const tol = emHeli ? 45 : 6;
    if (aim.orig && Math.abs(aim.orig.x - ox) < tol && Math.abs(aim.orig.z - oz) < tol && Math.abs(aim.orig.y - oy) < (emHeli ? 45 : 4)) {
      ox = aim.orig.x; oy = aim.orig.y; oz = aim.orig.z;
    }
    // direção do tiro: com a direção da MIRA do cliente (NDC), usa-se ela
    // EXATA — o dano cai onde o tracer/bala do jogador apontam. Bots e
    // clientes antigos mandam só yaw/pitch: fallback com espalhamento.
    let dx, dy, dz;
    if (aim.dir) {
      const l = Math.hypot(aim.dir.x, aim.dir.y, aim.dir.z) || 1;
      dx = aim.dir.x / l; dy = aim.dir.y / l; dz = aim.dir.z / l;
    } else {
      const spread = W.spread * (Math.random() - 0.5);
      const yaw = aim.yaw + spread, pitch = aim.pitch + spread;
      dx = -Math.sin(yaw) * Math.cos(pitch);
      dy = Math.sin(pitch);
      dz = -Math.cos(yaw) * Math.cos(pitch);
    }

    const hitWorld = this.world.col.raycast(ox, oy, oz, dx, dy, dz, W.range);
    const maxT = hitWorld ? Math.max(0.5, hitWorld.t - 0.3) : W.range;

    let best = null, bestT = Infinity;
    for (const alvo of this._all()) {
      if (alvo === p || !alvo.body || alvo.hp <= 0) continue;
      const rt = rayCapsule(ox, oy, oz, dx, dy, dz, alvo.body.pos);
      if (rt && rt.t < bestT && rt.t < maxT) {
        bestT = rt.t;
        best = { alvo, cabeca: rt.cabeca };
      }
    }
    // carros também tomam tiro (e explodem ao zerar a vida)
    if (this.cars) {
      for (const c of this.cars) {
        if (c.destroyed || c.playerId === p.id) continue;
        const t = raySphere(ox, oy, oz, dx, dy, dz, { x: c.x, y: c.y + 0.8, z: c.z }, 2.0);
        if (t !== null && t < bestT && t < maxT) {
          bestT = t;
          best = { carro: c };
        }
      }
    }
    if (!best) return;
    // balanceamento de dano (pedido): o bot causa só 18% do dano base no
    // player; o player causa 67% no bot (player vs player fica 100%). O
    // antigo danoMult da dificuldade deixava o bot forte demais.
    const atiradorBot = !!this.bots.get(p.id);
    const mult = best.cabeca && W.headshotMult ? W.headshotMult : 1;
    const dmg = (atiradorBot ? W.damage * 0.45 * (p.danoMult ?? 1) : W.damage) * mult;   // [BOT-DANO2] bots dao 55% menos — player tem tempo de revidar
    if (best.carro) this._carDano(best.carro, dmg);
    else this._damage(best.alvo, p, dmg, p.arma);
  }

  /** Míssil de canhão do helicóptero — projétil server-side que explode em área. */
  _fireMissil(p, aim) {
    const now = Date.now();
    if (now - (p._lastMissil || 0) < MISSIL.cooldown * 1000) return;
    p._lastMissil = now;
    const h = this.helis.find((hh) => hh.id === p.inHeli);
    if (!h) return;
    // trilho lateral (hardpoint) alternando os lados, como no solo
    // [solo] o míssil nasce na LINHA DA MIRA do piloto (não no trilho lateral):
    // direção: a MIRA do cliente (exata), fallback para a frente do aparelho
    let dx, dy, dz;
    if (aim.dir) {
      const l = Math.hypot(aim.dir.x, aim.dir.y, aim.dir.z) || 1;
      dx = aim.dir.x / l; dy = aim.dir.y / l; dz = aim.dir.z / l;
    } else {
      const yaw = aim.yaw != null ? aim.yaw : h.yaw;
      const pitch = aim.pitch || 0;
      dx = -Math.sin(yaw) * Math.cos(pitch);
      dy = Math.sin(pitch);
      dz = -Math.cos(yaw) * Math.cos(pitch);
    }
    // alvo teleguiado: o jogador mais próximo da linha de mira (lock do solo)
    // travamento pela LINHA DA MIRA (a camera), nao pela boca: o missil vai
    // para quem esta sob a mira — mesmo alvo que o aim assist do cliente
    // origem na linha da mira (câmera + direção * 6), exatamente como o
    // single (game.js _fireMissile): o míssil aparece no ponto do retículo.
    let dist = 6;
    const ox = (aim.orig && Math.abs(aim.orig.x - h.x) < 80 && Math.abs(aim.orig.z - h.z) < 80 && Math.abs(aim.orig.y - h.y) < 80) ? aim.orig.x : h.x;
    const oy = (aim.orig && Math.abs(aim.orig.x - h.x) < 80 && Math.abs(aim.orig.z - h.z) < 80 && Math.abs(aim.orig.y - h.y) < 80) ? aim.orig.y : h.y;
    const oz = (aim.orig && Math.abs(aim.orig.x - h.x) < 80 && Math.abs(aim.orig.z - h.z) < 80 && Math.abs(aim.orig.y - h.y) < 80) ? aim.orig.z : h.z;
    for (const q of this._all()) {
      if (q.id === p.id || !q.body || q.hp <= 0) continue;
      const vx = q.body.pos.x - ox, vy = q.body.pos.y + 1 - oy, vz = q.body.pos.z - oz;
      const dq = Math.hypot(vx, vy, vz);
      if (dq < 0.01) continue;
      const dot = (vx * dx + vy * dy + vz * dz) / dq;
      if (dot > 0.95 && dq < dist) dist = Math.max(dq - 1.2, 0.8);
    }
    const mx = ox + dx * dist, my = oy + dy * dist, mz = oz + dz * dist;
    const alvoId = null; // [MISSIL RETO] sem perseguicao de jogador - igual ao solo
    const id = (this._missilUid = (this._missilUid || 0) + 1);
    const alvoP = aim.ponto ? { x: aim.ponto.x, y: aim.ponto.y, z: aim.ponto.z } : null;
    this.missis.push({ id, alvoId, alvoP, x: mx, y: my, z: mz, dx, dy, dz, por: p, t: MISSIL.vida });
    this._bcast(T.MISSIL_FIRE, {
      id,
      x: Math.round(mx * 100) / 100, y: Math.round(my * 100) / 100, z: Math.round(mz * 100) / 100,
      dx: Math.round(dx * 100) / 100, dy: Math.round(dy * 100) / 100, dz: Math.round(dz * 100) / 100,
      v: MISSIL.speed, alvo: alvoId,
    });
  }

  /** Carro levou tiro: perde vida e explode ao zerar (expulsa o motorista). */
  _carDano(c, dmg) {
    if (c.destroyed) return;
    c.hp -= dmg;
    if (c.hp > 0) return;
    c.destroyed = true;
    c.hp = 0;
    c.playerId = null;
    c.inp = null;
    c.speed = 0;
    for (const p of this._all()) {
      if (p.inCar === c.id) this._sairCarro(p);
    }
    this._bcast(T.CAR_BOOM, { id: c.id, x: c.x, z: c.z });
  }

  _onKill(morto, por) {}

  _bcastLobby() {
    const humans = [...this.players.values()];
    const vivos = humans.filter((p) => p.client && p.client.readyState === 1);
    if (this.state === 'lobby' && !vivos.some((p) => p.host) && vivos.length > 0) vivos[0].host = true;
    const bots = [...this.bots.values()];
    const todos = [
      ...humans.map((p) => ({ id: p.id, nick: p.nick, pronto: p.pronto, host: p.host, bot: false, ping: p.ping })),
      ...bots.map((b) => ({ id: b.id, nick: b.nick, pronto: true, host: false, bot: true, ping: 0 })),
    ];
    const hostId = (vivos.find((p) => p.host) ?? humans.find((p) => p.host))?.id ?? null;
    const podeIniciar = vivos.length > 0 && (vivos.length === 1 || vivos.every((p) => p.pronto)) && this.state === 'lobby';
    // lista de TODOS os humanos online (outras salas) — é com ela que o
    // jogador vê quem está jogando e pode CHAMAR para a própria sala
    // salaId no payload: o lobby usa para filtrar da lista ONLINE quem já
    // está na MINHA sala (sem isso o amigo da mesma sala aparece com CHAMAR)
    this._bcast(T.LOBBY, { salaId: this.salaId, jogadores: todos, hostId, podeIniciar, state: this.state, countdown: Math.ceil(this.countdownT), countdownEnd: this.state === 'countdown' ? (this.cdEnd || 0) : 0, online: this.manager.online() });
  }

  _sendTo(p, t, data) {
    if (p.client && p.client.readyState === 1) send(p.client, { t, ...data });
  }

  _bcast(t, data) {
    const msg = { t, ...data };
    for (const p of this.players.values()) {
      if (p.client) send(p.client, msg);
    }
  }

  _log(...args) {
    console.log(`[sala ${this.salaId} ${this.modo}]`, ...args);
  }

  publicCfg() {
    return {
      modo: this.modo,
      maxPlayers: this.cfg.maxPlayers,
      tickRate: NET.tickRate,
    };
  }


  _broadcastSnapshot() {
    this.seq++;
    const players = this._all().map((p) => ({
      id: p.id,
      nick: p.nick,
      bot: !!this.bots.get(p.id),
      cor: p.cor ?? 0xe8453c,
      x: p.body ? Math.round(p.body.pos.x*100)/100 : 0,
      y: p.body ? Math.round(p.body.pos.y*100)/100 : 0,
      z: p.body ? Math.round(p.body.pos.z*100)/100 : 0,
      yaw: p.body ? p.body.yaw : 0,
      pitch: p.body ? p.body.pitch : 0,
      hp: Math.round(p.hp ?? 0),
      arma: p.arma || 'pistola',
      kills: p.kills || 0,
      deaths: p.deaths || 0,
      moveX: p.body ? (p.body.moveX||0) : 0,
      moveZ: p.body ? (p.body.moveZ||0) : 0,
      run: p.body ? !!(p.body._inp && p.body._inp.run) : false,
      inCar: p.inCar ?? null,
      inHeli: p.inHeli ?? null,
      fire: (p._fireVis && Date.now() - p._fireVis < 350) ? 1 : 0,
    }));
    const snap = { t: T.SNAPSHOT, seq: this.seq, players };
    snap.restante = Math.max(0, Math.ceil((this.cfg.timeLimit || 0) - this.elapsed));
    snap.hour = Math.round(this.hour * 100) / 100;
    snap.cycleMode = this.cycleMode;
    this._snapExtra(snap);
    snap.cars = this.cars.map((c) => ({
      id: c.id,
      x: Math.round(c.x * 100) / 100,
      y: Math.round(c.y * 100) / 100,
      z: Math.round(c.z * 100) / 100,
      yaw: Math.round(c.yaw * 1000) / 1000,
      speed: Math.round(c.speed * 10) / 10,
      playerId: c.playerId,
      cor: c.cor,
      destroyed: !!c.destroyed,
    }));
    snap.helis = this.helis.map((h) => ({
      id: h.id,
      x: Math.round(h.x * 100) / 100,
      y: Math.round(h.y * 100) / 100,
      z: Math.round(h.z * 100) / 100,
      yaw: Math.round(h.yaw * 1000) / 1000,
      pitch: Math.round(h.pitch * 1000) / 1000,
      roll: Math.round(h.roll * 1000) / 1000,
      speed: Math.round(Math.hypot(h.vel.x, h.vel.z) * 10) / 10,
      playerId: h.playerId,
      fuel: Math.round(h.fuel ?? 100),
      cor: h.cor,
    }));
    this._bcast(T.SNAPSHOT, snap);
  }
  _snapExtra(snap) {}

  stop() {
    this.state = 'ended';
  }
}

function clampNum(v, a, b) {
  if (typeof v !== 'number' || Number.isNaN(v)) return 0;
  return Math.max(a, Math.min(b, v));
}

/** Raycast esfera (hitbox simples do jogador/carro). Retorna t ou null. */
function raySphere(ox, oy, oz, dx, dy, dz, c, r) {
  const lx = ox - c.x, ly = oy - c.y, lz = oz - c.z;
  const b = 2 * (lx * dx + ly * dy + lz * dz);
  const cc = lx * lx + ly * ly + lz * lz - r * r;
  const disc = b * b - 4 * cc;
  if (disc < 0) return null;
  const t = (-b - Math.sqrt(disc)) / 2;
  return t > 0 ? t : null;
}

/**
 * Hitbox humano: cápsula de 3 esferas sobre o chão — pés, tronco e cabeça.
 * Uma esfera única centrada em body.pos (o CHÃO) só cobria os pés, e o tiro
 * no peito passava por cima dela: o alvo só morria mirando na base.
 */
function rayCapsule(ox, oy, oz, dx, dy, dz, pos) {
  const esferas = [[0.35, 0.62], [0.95, 0.80], [1.6, 0.52]];
  let menor = null, cabeca = false;
  for (let i = 0; i < esferas.length; i++) {
    const [h, r] = esferas[i];
    const t = raySphere(ox, oy, oz, dx, dy, dz, { x: pos.x, y: pos.y + h, z: pos.z }, r);
    if (t !== null && (menor === null || t < menor)) { menor = t; cabeca = i === 2; }
  }
  if (menor === null) return null;
  return { t: menor, cabeca };
}
