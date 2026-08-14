/**
 * Sala BATTLE ROYALE — zona encolhendo, loot, queda de avião, último vivo.
 * O mapa é o MESMO da cidade (a CollisionWorld do cliente regenerada aqui).
 */

import { Room } from './room.js';
import { T, send } from '../protocol.js';
import { buildWorld } from '../world/world.js';
import { WEAPONS, rollLoot } from '../weapons.js';
import { makeRng, rngRange, rngInt, dist2D, findFreeSpot, findStreetSpot, clamp } from '../util.js';
import { MODES } from '../config.js';

export class BRRoom extends Room {
  constructor(salaId, manager, cycle) {
    super(salaId, manager, 'br', cycle);
    this.world = buildWorld();
    this.rng = makeRng(Date.now() & 0xffffffff);
    this.zone = { x: 0, z: 0, r: 210, proxX: 0, proxZ: 0, proxR: 150, tempo: 45 };
    this.zoneStep = 0;
    this.zoneDps = MODES.br.zoneDpsBase;
    this.loot = [];            // {id,x,z,tipo,arma?}
    this.lootId = 1;
    this.supplyDrops = [];     // caixas raras
    this._lootSpawned = false;
    this.respawnQueue = new Map();   // [BOT-RESPAWN] bots mortos voltam em 8-12s
  }

  canJoin() {
    // mesma regra do DM: aceita no lobby E no countdown (o amigo convidado
    // pode entrar na sala com a contagem já rolando)
    return (this.state === 'lobby' || this.state === 'countdown') && this.players.size < this.cfg.maxPlayers;
  }

  _beginGame() {
    // sem avião: todo mundo nasce espalhado pelo mapa, já no chão, e a
    // zona encolhe no ritmo normal (o super chama _spawnAll)
    super._beginGame();
  }

  _setupWorld() {
    this._spawnLoot();
  }

  _spawnLoot() {
    // 60 pontos de loot espalhados pela cidade (+ arredores)
    const cfg = MODES.br;
    const spots = [];
    const rng = makeRng(20260725);
    for (let i = 0; i < 60; i++) {
      const x = rngRange(rng, -210, 210);
      const z = rngRange(rng, -210, 210);
      if (this.world.col.isBlocked(x, z, 0.8)) continue;
      spots.push({ x, z, y: this.world.col.groundHeightAt(x, z) });
    }
    for (const s of spots) {
      const n = rngInt(rng, 1, cfg.lootPerSpawn);
      for (let k = 0; k < n; k++) {
        const item = rollLoot(rng);
        this.loot.push({
          id: this.lootId++,
          x: s.x + rngRange(rng, -1.5, 1.5),
          y: s.y + 0.4,
          z: s.z + rngRange(rng, -1.5, 1.5),
          tipo: item.tipo,
          arma: item.arma,
          qtd: item.qtd,
          hp: item.hp,
        });
      }
    }
    this._bcast(T.LOOT_LIST, { itens: this.loot });
  }

  _spawnPoint(p) {
    // [SPAWN-REGRA] Só nasce em rua/praça (espaço livre >= 5m): nunca dentro de
    // construções nem em becos. findStreetSpot valida e tenta de novo perto.
    const r = this.zone.r * 0.6;
    const a = this.rng() * Math.PI * 2;
    const x = this.zone.x + Math.cos(a) * r * this.rng();
    const z = this.zone.z + Math.sin(a) * r * this.rng();
    const pt = findStreetSpot(this.world.col, x, z, 5, 24);
    return pt;
  }

  _step(dt) {

    // [BOT-RESPAWN] bots mortos renascem (cidade nunca esvazia)
    for (const [id, t] of [...this.respawnQueue]) {
      const novo = t - dt;
      if (novo <= 0) {
        this.respawnQueue.delete(id);
        const b = this.bots.get(id);
        if (b) this._spawn(b);
      } else this.respawnQueue.set(id, novo);
    }

    // zona
    this._stepZone(dt);
    // dano da zona: todo mundo no chão toma (sem avião, sem exceção)
    for (const p of this._all()) {
      if (!p.body || p.hp <= 0) continue;
      const d = dist2D(p.body.pos.x, p.body.pos.z, this.zone.x, this.zone.z);
      if (d > this.zone.r) {
        this._damage(p, null, this.zoneDps * dt, 'zona');
      }
    }

    // respawns (não há no BR — mortos ficam mortos)
    // bots pensam
    for (const b of this.bots.values()) {
      if (b.think) b.think(dt, this);
      if (b.body && b.invuln > 0) b.invuln -= dt;
    }
    // humanos: inputs chegam via websocket
    for (const p of this.players.values()) {
      if (p.invuln > 0) p.invuln -= dt;
    }

    // vencedor
    const vivos = this._alive();
    if (vivos.length === 1 && this.totalSlots > 1) {
      this._endGame(vivos[0]);
    }

    // [FIM POR TEMPO] 5 min: vence quem tiver mais kills
    if (this.elapsed >= this.cfg.timeLimit) {
      const best = [...this._all()].sort((a, b) => b.kills - a.kills)[0];
      if (best) this._endGame(best);
    }
  }

  _stepZone(dt) {
    const cfg = MODES.br;
    this.zone.tempo -= dt;
    if (this.zone.tempo <= 0 && this.zoneStep < cfg.zoneSteps) {
      this.zoneStep++;
      // novo raio = fração do anterior
      const shrink = [1.0, 0.72, 0.5, 0.32, 0.18, 0.08][Math.min(this.zoneStep, 5)];
      this.zone.proxR = Math.max(cfg.zoneFinalR, this.zone.r * shrink);
      // centro novo: puxa para um ponto aleatório dentro da zona atual
      const a = this.rng() * Math.PI * 2;
      const d = this.zone.r * 0.3;
      this.zone.proxX = clamp(this.zone.x + Math.cos(a) * d, -220, 220);
      this.zone.proxZ = clamp(this.zone.z + Math.sin(a) * d, -220, 220);
      this.zone.tempo = cfg.zoneStepTime;
      this.zoneDps = cfg.zoneDpsBase + this.zoneStep * 2.5;
      this._bcast(T.ZONE, {
        x: this.zone.x, z: this.zone.z, r: this.zone.r,
        proxX: this.zone.proxX, proxZ: this.zone.proxZ, proxR: this.zone.proxR,
        tempo: this.zone.tempo, dps: this.zoneDps,
      });
    }
    // a zona atual desliza suavemente até a próxima
    if (this.zoneStep > 0) {
      const step = dt / 6;   // 6s de transição
      this.zone.x += (this.zone.proxX - this.zone.x) * step;
      this.zone.z += (this.zone.proxZ - this.zone.z) * step;
      this.zone.r += (this.zone.proxR - this.zone.r) * step;
    }
  }

  _onKill(morto, por) {

    // [BOT-RESPAWN] bot morreu: volta em 8-12s
    if (this.bots.get(morto.id)) this.respawnQueue.set(morto.id, 4 + Math.random() * 3);   // [BOT-RESPAWN] 4-7s — partida nunca esvazia

    // morto no BR: solta o loot que carregava (itens caem no chão)
    const drop = [
      { id: this.lootId++, x: morto.body.pos.x, y: morto.body.pos.y + 0.4, z: morto.body.pos.z, tipo: 'arma', arma: morto.arma || 'pistola' },
    ];
    if (morto._medkits) {
      drop.push({ id: this.lootId++, x: morto.body.pos.x + 0.5, y: morto.body.pos.y + 0.4, z: morto.body.pos.z, tipo: 'cura', hp: 50 });
    }
    this.loot.push(...drop);
    this._bcast(T.LOOT_LIST, { itens: this.loot });
  }

  _endGame(vencedor) {
    this.state = 'ended';
    this._bcast(T.WINNER, { id: vencedor.id, nick: vencedor.nick, kills: vencedor.kills || 0 });
    this._log('BR encerrado — vencedor: ' + vencedor.nick);
    // [REVIEW-30S] sala fica viva 35s apos o fim: os players continuam na cena
    // (snapshots rodando) para o cliente exibir a revisão da partida por 30s
    setTimeout(() => {
      this.manager.remove(this.salaId);
      this.stop();
    }, 35_000);
  }

  /** Pegar loot próximo. */
  pickup(p) {
    if (!p.body) return;
    for (let i = 0; i < this.loot.length; i++) {
      const it = this.loot[i];
      const d = dist2D(p.body.pos.x, p.body.pos.z, it.x, it.z);
      if (d < 3.0) {
        this.loot.splice(i, 1);
        this._bcast(T.LOOT_TAKEN, { id: it.id, porId: p.id });
        if (it.tipo === 'arma') p.arma = it.arma;
        else if (it.tipo === 'cura') {
          p.hp = Math.min(100, p.hp + (it.hp || 50));
          p._medkits = (p._medkits || 0) + 1;
        } else if (it.tipo === 'armadura') {
          p.hp = Math.min(100, p.hp + (it.hp || 50));
        }
        return { item: it };
      }
    }
    return null;
  }

  _snapExtra(snap) {
    snap.zone = { x: this.zone.x, z: this.zone.z, r: this.zone.r, tempo: Math.max(0, this.zone.tempo) };
    snap.loot = this.loot.length;
    snap.vivos = this._alive().length;
  }

}
