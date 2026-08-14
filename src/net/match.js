/**
 * Match — partida multiplayer no cliente.
 * Renderiza os avatares (Human) na cena já construída pelo jogo single,
 * controla a câmera própria, envia input autoritativo e aplica snapshots.
 */
import { SnapshotBuffer } from './snapshot.js';
import { RemotePlayer } from './remotePlayer.js';
import { predictBody } from './predict.js';
import { aimAssist } from '../util/aim.js';
import { criarKillfeed } from '../ui/killfeed.js';
import { criarScoreboard } from '../ui/scoreboard.js';
import { criarBrHud } from '../ui/brHud.js';
import { criarNetStatus } from '../ui/netStatus.js';
import { criarPausa } from '../ui/pause.js';
import { Car } from '../ent/car.js';
import { Helicopter } from '../ent/helicopter.js';
import * as THREE from '../../vendor/three.module.js';
import { T } from './protocol.js';
import { CAMERA, HELI } from '../config.js';
import { clamp, damp, dampAngle, angleDelta } from '../utils.js';

const INPUT_HZ = 30;   // 1 input por tick do servidor (30 Hz): degraus menores na fisica

// espelho de server/config.js CAR — a predição do carro dirigido usa a MESMA
// física do servidor (aceleração/esterço/colisão), senão o carro tremia ao
// andar (position.set direto do snap = teleporte a cada pacote com latência)
const CAR_MP = { radius: 2.1, height: 1.6, maxSpeed: 26, accel: 14, brake: 34, steer: 1.9 };

export class Match {
  constructor(game, net, info) {
    this.game = game;
    this.net = net;
    this.modo = info.modo;
    this.meuId = info.meuId;
    this.nick = info.nick;

    this.snapBuf = new SnapshotBuffer();
    this._jumpEdge = false;   // borda do pulo para a predicao local
    this.avatares = new Map();   // id -> RemotePlayer
    this.nicks = new Map();      // id -> nick

    this.killfeed = criarKillfeed();
    this.scoreboard = criarScoreboard();
    const _btnPlacar = document.getElementById('mp-placar');
    if (_btnPlacar) _btnPlacar.addEventListener('click', () => this.scoreboard.alternar());
    this._pausaBtn = document.getElementById('mp-pausa');
    this.brHud = criarBrHud();
    this.netStatus = criarNetStatus();

    // reusa a câmera do pipeline (composer) — renderizar com câmera própria
    // fora do composer deixava a tela do MP só com o céu laranja
    this.camera = this.game.gfx.camera;
    this.camera.rotation.order = 'YXZ';

    // input local
    this.inp = { mx: 0, mz: 0, run: false, jump: false, fire: false, ads: false, up: false, down: false };
    this._kSet = new Set();   // teclas pressionadas (base do movimento)
    this.yaw = Math.PI;
    this.pitch = -0.22;
    // câmera de ombro (terceira pessoa), igual à do single
    this._camDist = CAMERA.defaultZoom;
    this._camFocus = new THREE.Vector3();
    this._camSmooth = new THREE.Vector3();   // foco amortecido — mesmo lag do solo
    this._camFirst = true;
    this._camLook = new THREE.Vector3();
    this._sendAcc = 0;
    this._pingAcc = 0;
    this._seq = 0;

    this._hp = 100;
    this._dmgDir = null;   // ultimo dano sofrido: {x,z,t} posicao do atirador
    this._arma = 'pistola';
    this._morto = false;
    this._respawnT = 0;         // contagem do respawn no DM (aviso do servidor)
    this._rodando = false;
    this._raf = null;
    this._revNick = "";
    this._revId = null;
    this._saiu = false;         // [FIX] guard de reentrância do sair()
    this._ult = 0;
    this._pausado = false;      // pausa única (mesma tela/menus do solo)
    this._zona = null;          // {x,z,r} da zona do BR (minimapa)
    this._anelZona = null;      // anel 3D no chao marcando o limite da zona
    this._clockAcc = 0;
    this._dist = CAMERA.defaultZoom;   // zoom da câmera (faltava init: NaN)

    // veiculos do MP (carros autoritativos vindos do servidor)
    this.carrosMp = new Map();   // id -> { mesh: Car, x, y, z, playerId }
    this._emCarro = false;
    this._toggleCar = false;     // E/mp-acao: entra no carro OU no helicoptero
    // helicopteros do MP (5 espalhados pelo mapa, autoritativos do servidor)
    this.helisMp = new Map();    // id -> { mesh: Helicopter, x, y, z, vel, playerId }
    this._emHeli = false;
    this._meuHeliId = null;
    this._meuCarroId = null;
    this._visaoInt = false;   // [solo] tecla V: câmera externa <-> cockpit
    this._visaoMesh = null;   // mesh com interior aberto (para resetar ao sair)
    this._ultNoite = null;    // [solo] último nightFactor aplicado na cidade
    this._heliYaw = 0;           // Q/R: girar o aparelho no ar
    this._carSteer = 0;          // [carro] ◀ ▶ do toque: esterça o carro (moveX)
    this._fpp = 0;               // [CODM] transição ombro -> 1ª pessoa ao atirar
    this._fppAdsAntes = null;    // [CODM] último estado do retículo 1ª pessoa
    this.missisVis = [];   // foguetes dos mísseis de canhão (visuais)
    this._fireBtn = false;   // gatilho do botão ATIRAR do toque (segurar = rajada)
    this._ads = false;         // [PC] botão DIREITO segurado = MIRA (ADS) sem atirar
    // true em telas de toque (mobile): o PC usa mouse e a câmera não vira no ADS
    this._isTouch = typeof window !== 'undefined' &&
      ('ontouchstart' in window || (navigator.maxTouchPoints || 0) > 0);

    // [FPS] ADS e coice da câmera, iguais ao solo (o camera.update do single
    // não roda no MP — o estado é replicado aqui)
    this._adsAmt = 0;        // 0..1, quão fechado está o zoom de mira
    this._recoilP = 0;       // coice acumulado na inclinação (rad)
    this._recoilY = 0;       // coice acumulado na deriva lateral (rad)
    this._shake = 0;         // tremida do tiro
    // [FPS] vetores temporários reutilizados — sem new Vector3 por frame
    // (alocação/GC derrubava o FPS no MP, que já roda 8 avatares extras)
    this._vNdc = new THREE.Vector3(0.24, 0.2, 0.5);
    this._vDir = new THREE.Vector3();
    this._vBack = new THREE.Vector3();
    this._vRight = new THREE.Vector3();
    this._vT0 = new THREE.Vector3();
    this._vT1 = new THREE.Vector3();
    this._vT2 = new THREE.Vector3();
    this._vPM = new THREE.Vector3();   // ponto onde a mira aponta (missil guiado do servidor)
    this._animF = 0;         // contador p/ LOD de animação (avatares distantes)

    this._ligarListeners();
  }

  // ------------------------------------------------------------- setup
  iniciar() {
    // para o laço do single player ANTES de qualquer coisa: sem isto a câmera
    // do título (orbital) e a do multiplayer brigavam pelo mesmo canvas
    if (window.__pararLoopSingle) window.__pararLoopSingle();
    // sem arma na tela: em terceira pessoa a pistola aparece na MÃO do Bob,
    // que fica visível na frente da câmera com o papagaio voando ao lado
    if (this.game && this.game.viewmodel) {
      this._viewmodelAntes = this.game.viewmodel.visible;
      this.game.viewmodel.visible = false;
    }
    // esconde o transito e pedestres do single — no MP os carros vêm do servidor
    if (this.game && this.game.cars) this.game.cars.group.visible = false;
    if (this.game && this.game.peds) this.game.peds.group.visible = false;
    // o helicoptero do single tambem some — no MP os aparelhos vem do servidor
    if (this.game && this.game.heli) this.game.heli.root.visible = false;
    if (this.game && this.game.imgBuildings) this.game.imgBuildings.esconderParaMp(this.game.col);
    if (this.game && this.game.minimap) this.game.minimap.setModoMp(true);   // [MP-MAPA] minimapa limpo/barato no MP

    // esconde a tela de abertura do single
    const ab = document.getElementById('title-screen');
    if (ab) ab.classList.add('hidden');

    // MESMO HUD do modo solo no MP: corações (vida), minimapa, relógio, FPS,
    // mira, dicas e avisos — some só o que não faz sentido (objetivo de
    // missão e a fileira de pontos/tempo/entregas)
    const hud = document.getElementById('hud');
    if (hud) hud.classList.remove('hidden');
    this._prepararHudSolo();

    const hudMp = document.getElementById('mp-hud');
    if (hudMp) hudMp.classList.remove('hidden');
    document.body.classList.add('mp-ativo');
    const ns = document.getElementById('net-status');
    if (ns) ns.classList.remove('hidden');
    this.netStatus.setEstado('conectando');
    if (this.modo === 'br') this.brHud.mostrar();
    const joy = document.getElementById('mp-joy');
    if (joy) joy.classList.toggle('hidden', !(this.game && this.game.toque));
    const look = document.getElementById('mp-look');
    if (look) look.classList.toggle('hidden', !(this.game && this.game.toque));
    const pad = document.getElementById("mp-pad");
    if (pad) pad.classList.toggle("hidden", !(this.game && this.game.toque));
    const tSolo = document.getElementById("touch");
    if (this.game && this.game.toque && this.game._telaCheia) this.game._telaCheia();
    if (this.game) this.game._mp = true;
    // botão de pausa na tela (só no toque; no PC é ESC/Pause)
    if (this._pausaBtn) {
      this._pausaBtn.classList.toggle('hidden', !(this.game && this.game.toque));
      this._pausaBtnHandler = () => this._togglePausa();
      this._pausaBtn.addEventListener('click', this._pausaBtnHandler);
    }
    const _placarBtn = document.getElementById('mp-placar');
    if (_placarBtn) _placarBtn.classList.toggle('hidden', !(this.game && this.game.toque));

    // pausa única — os MESMOS menus de OPÇÕES e CONTROLES do modo solo
    this.pausa = criarPausa();
    this.pausa.ligar({
      retomar: () => this._retomar(),
      opcoes: () => { if (this.game) this.game._abrirOpcoes(true); },
      controles: () => { if (this.game && this.game.keys) this.game.keys.abrir(); },
      sair: () => { this.pausa.esconder(); this.sair(); },
    });
    // [Android] botão voltar da barra de navegação abre/fecha a pausa
    this._ligarBack();

    // feedback local das balas (dano é do servidor): faísca vermelha ao
    // acertar um avatar, laranja num carro — guarda os callbacks do solo
    if (this.game && this.game.bullets) {
      const bul = this.game.bullets;
      this._bulletsAntes = {
        onHitFoe: bul.onHitFoe, onHitCar: bul.onHitCar, onHitPed: bul.onHitPed,
      };
      this._up = new THREE.Vector3(0, 1, 0);
      bul.onHitFoe = (foe, ponto) => this.game.fx.impact(ponto, this._up, { r: 3.2, g: 0.5, b: 0.4 });
      bul.onHitCar = (car, ponto) => this.game.fx.impact(ponto, this._up, { r: 3.2, g: 1.8, b: 0.5 });
      bul.onHitPed = null;
    }

    // avatares para os jogadores conhecidos
    for (const [id, info] of this.nicks) this._garantirAvatar(id, info);

    this._rodando = true;
    this._ult = performance.now();
    this._loop(this._ult);
  }

  _ligarListeners() {
    this._kd = (e) => {
      if (e.repeat) return;   // [FIX] auto-repeat do teclado NAO acumula no inp (bug: player nao parava)
      if (e.code === 'Escape' || e.code === 'Pause') { this._togglePausa(); return; }
      const k = e.key.toLowerCase();
      this._kSet.add(k);
      this._recalcInp();
      if (k === 'shift') { this.inp.run = true; this.inp.down = true; }
      if (k === ' ') { this.inp.jump = true; this.inp.up = true; e.preventDefault(); }
      if (k === 'tab') { e.preventDefault(); this.scoreboard.alternar(); }
      if (k === 'e') this._toggleCar = true;
      if (k === 'v') this._alternarVisao();
      if (k === 'n') this._pedirCycle();   // [DIA-NOITE] só o host controla
      if (k === 'q') { this._heliYaw = 1; this._carSteer = 1; }
      if (k === 'r') { this._heliYaw = -1; this._carSteer = -1; }
      this._norm();
    };
    this._ku = (e) => {
      const k = e.key.toLowerCase();
      this._kSet.delete(k);
      this._recalcInp();
      if (k === 'shift') { this.inp.run = false; this.inp.down = false; }
      if (k === ' ') { this.inp.jump = false; this.inp.up = false; }
      if (k === 'q' || k === 'r') { this._heliYaw = 0; this._carSteer = 0; }
      this._norm();
    };

    // mouse: mover = olhar (pointer lock) ou arrastar; clique = atirar.
    // Toques NÃO atiram: no celular o gatilho é só o botão ATIRAR (igual ao solo)
    this._pd = (e) => {
      if (e.pointerType === 'touch') return;
      if (this._pausado) return;   // menu aberto: cliques são do painel
      this._dragX = e.clientX; this._dragY = e.clientY;
      this._dragOn = true;
      if (e.button === 2) { this._ads = true; return; }   // [PC] DIREITO = apenas MIRA (arma erguida), sem atirar
      this._fire = true;
      try { document.body.requestPointerLock?.(); } catch {}
    };
    this._pu = () => { this._dragOn = false; this._fire = false; this._ads = false; };
    this._cm = (e) => e.preventDefault();   // [PC] clique direito sem menu do navegador
    this._pm = (e) => {
      if (document.pointerLockElement) {
        this.yaw -= e.movementX * 0.0045;   // [FPS] mouse ~2x mais agil
        this.pitch -= e.movementY * 0.0045;
      } else if (this._dragOn) {
        const dx = e.clientX - this._dragX, dy = e.clientY - this._dragY;
        this._dragX = e.clientX; this._dragY = e.clientY;
        this.yaw -= dx * 0.007;   // [FPS] arrasto ~1.75x mais agil
        this.pitch -= dy * 0.007;
      }
      this._clampAim();
    };
    // scroll do mouse aproxima/afasta a câmera (fora do carro)
    this._zw = (e) => {
      if (this._emCarro || this._emHeli) return;
      if (this._pausado) return;   // rolar o menu não mexe no zoom
      this._dist = clamp(this._dist - e.deltaY * 0.004, CAMERA.minZoom, CAMERA.maxZoom);
    };

    // touch: joystick esquerdo + olhar/atirar à direita
    this._tjs = null;
    this._joy = document.getElementById('mp-joy');
    this._lookEl = document.getElementById('mp-look');

    this._touchStart = (e) => {
      // pausa/opções abertas: o toque é do MENU — sem preventDefault, o
      // scroll nativo das opções funciona (antes a página não rolava)
      if (this._pausado) return;
      for (const t of e.changedTouches) {
        // toque em botão/menu: deixa o clique sintético acontecer (☰, pausa,
        // placar...) — o preventDefault aqui matava os clicks no mobile
        if (t.target.closest('button, .btn, [data-acao], [data-segura]')) continue;
        const x = t.clientX, y = t.clientY;
        const jr = this._joy ? this._joy.getBoundingClientRect() : null;
        if (jr && x >= jr.left && x <= jr.right && y >= jr.top && y <= jr.bottom) {
          // toque no joystick
          this._tjs = { id: t.identifier, cx: jr.left + jr.width / 2, cy: jr.top + jr.height / 2 };
          this._joyTouch = { id: t.identifier, x, y };
          e.preventDefault();
        } else {
          // área de olhar: arrastar gira a câmera (tap curto NÃO atira —
          // o gatilho é só o botão ATIRAR, igual ao modo solo)
          if (!this._lt) this._lt = { id: t.identifier, x, y, t0: performance.now(), drag: false };
          e.preventDefault();
        }
      }
    };
    this._touchMove = (e) => {
      if (this._pausado) return;   // pausa: o dedo é do menu, não do jogo
      for (const t of e.changedTouches) {
        if (this._lt && t.identifier === this._lt.id) {
          const dx = t.clientX - this._lt.x, dy = t.clientY - this._lt.y;
          if (!this._lt.drag && Math.hypot(dx, dy) > 10) this._lt.drag = true;
          if (this._lt.drag) {
            this.yaw -= dx * 0.005;
            this.pitch -= dy * 0.005;
            this._lt.x = t.clientX; this._lt.y = t.clientY;
            this._clampAim();
          }
          e.preventDefault();
        } else if (this._joyTouch && t.identifier === this._joyTouch.id) {
          const jr = this._joy.getBoundingClientRect();
          const cx = jr.left + jr.width / 2, cy = jr.top + jr.height / 2;
          let dx = t.clientX - cx, dy = t.clientY - cy;
          const d = Math.hypot(dx, dy), R = jr.width / 2 - 12;
          if (d > R) { dx = dx / d * R; dy = dy / d * R; }
          this.inp.mx = dx / R;
          this.inp.mz = -dy / R;
          const knob = this._joy.querySelector('.knob');
          if (knob) knob.style.transform = `translate(${dx}px, ${dy}px)`;
          e.preventDefault();
        }
      }
    };
    this._touchEnd = (e) => {
      for (const t of e.changedTouches) {
        if (this._lt && t.identifier === this._lt.id) {
          this._lt = null;
        }
        if (this._joyTouch && t.identifier === this._joyTouch.id) {
          this._joyTouch = null;
          this.inp.mx = 0; this.inp.mz = 0;
          const knob = this._joy?.querySelector('.knob');
          if (knob) knob.style.transform = 'translate(0,0)';
        }
      }
    };

    // botões de ação do toque (ATIRAR/PULAR/AÇÃO/CORRER) — mesmo padrão do solo
    this._mpBtns = [];
    const ligaBtn = (id, down, up) => {
      const el = document.getElementById(id);
      if (!el) return;
      const d = (ev) => { ev.preventDefault(); ev.stopPropagation(); down(); el.classList.add('press'); };
      const u = (ev) => { ev.preventDefault(); ev.stopPropagation(); if (up) up(); el.classList.remove('press'); };
      el.addEventListener('touchstart', d, { passive: false });
      el.addEventListener('touchend', u, { passive: false });
      el.addEventListener('touchcancel', u, { passive: false });
      el.addEventListener('mousedown', d);
      el.addEventListener('mouseup', u);
      el.addEventListener('mouseleave', u);
      this._mpBtns.push({ el, d, u });
    };
    ligaBtn('mp-atirar', () => { this._fireBtn = true; }, () => { this._fireBtn = false; });
    ligaBtn('mp-pular', () => { this.inp.jump = true; this.inp.up = true; }, () => { this.inp.jump = false; this.inp.up = false; });
    ligaBtn('mp-acao', () => { this._toggleCar = true; });
    ligaBtn('mp-correr', () => { this.inp.run = true; }, () => { this.inp.run = false; });
    // [heli] botão ▼ dedicado para descer (o PULAR vira ▲ para subir)
    ligaBtn('mp-descer', () => { this.inp.run = true; this.inp.down = true; }, () => { this.inp.run = false; this.inp.down = false; });
    // [heli] botões ◀ ▶ giram o aparelho no ar (alternativa ao olhar)
    ligaBtn('mp-girar-esq', () => { this._heliYaw = 1; this._carSteer = 1; }, () => { this._heliYaw = 0; this._carSteer = 0; });
    ligaBtn('mp-girar-dir', () => { this._heliYaw = -1; this._carSteer = -1; }, () => { this._heliYaw = 0; this._carSteer = 0; });
    // [COD Mobile] o botão ATIRAR também é o analógico de mira, igual ao
    // solo: o dedo FIRME atira em rajada; DESLIZANDO, a câmera gira e a
    // mira acompanha o arrasto — dá para segurar o recuo sem largar o
    // gatilho (só toque; no PC o olhar já é o mouse)
    this._mpMira = null;
    const miraEl = document.getElementById('mp-atirar');
    if (miraEl) {
      const m = { el: miraEl, down: null, move: null, up: null };
      let ancora = null, pend = { x: 0, y: 0 };
      m.down = (ev) => {
        if (ev.pointerType !== 'touch') return;
        ancora = { x: ev.clientX, y: ev.clientY };
        pend = { x: 0, y: 0 };
        try { miraEl.setPointerCapture(ev.pointerId); } catch {}
      };
      m.move = (ev) => {
        if (!ancora) return;
        pend.x += ev.clientX - ancora.x;
        pend.y += ev.clientY - ancora.y;
        ancora = { x: ev.clientX, y: ev.clientY };
        // micro-tremor do polegar parado não mexe na mira; passou disso,
        // o dedo deslizando gira a câmera (a mira acompanha o arrasto)
        if (Math.hypot(pend.x, pend.y) < 3) return;
        this.yaw -= pend.x * 0.005;
        this.pitch -= pend.y * 0.005;
        this._clampAim();
        pend = { x: 0, y: 0 };
      };
      m.up = () => { ancora = null; pend = { x: 0, y: 0 }; };
      miraEl.addEventListener('pointerdown', m.down);
      miraEl.addEventListener('pointermove', m.move);
      miraEl.addEventListener('pointerup', m.up);
      miraEl.addEventListener('pointercancel', m.up);
      this._mpMira = m;
    }
    window.addEventListener('keydown', this._kd);
    window.addEventListener('keyup', this._ku);
    window.addEventListener('pointerdown', this._pd);
    window.addEventListener('pointerup', this._pu);
    window.addEventListener('contextmenu', this._cm);
    window.addEventListener('pointermove', this._pm);
    window.addEventListener('wheel', this._zw, { passive: true });
    document.addEventListener('touchstart', this._touchStart, { passive: false });
    document.addEventListener('touchmove', this._touchMove, { passive: false });
    document.addEventListener('touchend', this._touchEnd, { passive: false });
    // gatilho nunca fica "preso" ao perder o foco (alt-tab) ou sair do
    // pointer lock — o solo faz o mesmo no input.js (blur + pointerlockchange)
    this._blur = () => { this._dragOn = false; this._fire = false; this._fireBtn = false; this._ads = false; this._limparTeclas(); };
    this._lockChg = () => {
      if (!document.pointerLockElement) { this._dragOn = false; this._fire = false; this._ads = false; }
    };
    window.addEventListener('blur', this._blur);
    document.addEventListener('pointerlockchange', this._lockChg);
  }

  _norm() {
    const d = Math.hypot(this.inp.mx, this.inp.mz);
    if (d > 1) { this.inp.mx /= d; this.inp.mz /= d; }
  }

  // [FIX] recalcula mx/mz a partir do Set de teclas: keyup engolido (perda de
  // foco / ALT+TAB / pointer lock) nunca deixa o player andando sozinho
  _recalcInp() {
    const s = this._kSet;
    this.inp.mx = (s.has('d') || s.has('arrowright') ? 1 : 0) - (s.has('a') || s.has('arrowleft') ? 1 : 0);
    this.inp.mz = (s.has('w') || s.has('arrowup') ? 1 : 0) - (s.has('s') || s.has('arrowdown') ? 1 : 0);
    this._norm();
  }

  _limparTeclas() {
    if (this._kSet) this._kSet.clear();
    this.inp.mx = 0; this.inp.mz = 0;
    this.inp.run = false; this.inp.down = false;
    this.inp.jump = false; this.inp.up = false;
  }

  _clampAim() {
    this.pitch = Math.max(CAMERA.pitchMin, Math.min(CAMERA.pitchMax, this.pitch));
  }

  // ------------------------------------------------------- rede (msg)
  tratar(msg) {
    switch (msg.t) {
      case T.SNAPSHOT:
        this._snap(msg);
        break;
      case T.KILL:
      case T.DEATH: {
        const morto = this._nick(msg.id);
        // morte por zona/queda chega sem `por` — o servidor manda a causa na `arma`
        const por = msg.por != null ? this._nick(msg.por) : (msg.arma || 'zona');
        if (msg.t === T.KILL) this.killfeed.add(morto, por, msg.arma, msg.id === this.meuId);
        if (msg.id === this.meuId) this._morreu(por);
        break;
      }
      case T.DAMAGE:
        // resposta IMEDIATA ao dano: os corações descem na hora exata do
        // hit (o snapshot também traria, mas com atraso/em saltos)
        if (msg.alvo === this.meuId) {
          this._hp = msg.hp;
          this._atualizarHud();
          if (msg.direcao) this._dmgDir = { x: msg.direcao.x, z: msg.direcao.z, t: performance.now() };
        } else if (msg.por === this.meuId) {
          this._hitmarker();   // [HITMARKER] sinal de acerto ao atingir player/bot
        }
        break;
      case T.RESPAWN:
        // o servidor manda DOIS respawns para o morto: o AVISO {id, t} (tempo
        // até renascer) e o REAL {id, x, y, z} (bcast do _spawn, para todos).
        // O aviso só liga a contagem; o real é o que devolve o jogador ao jogo
        if (msg.id !== this.meuId) break;
        if (msg.x != null) this._revive();
        else this._contagemRespawn(msg.t);
        break;
      case T.WINNER:
        this._vencedor(msg);
        break;
      case T.LOOT_LIST:
        if (this.brHud) this.brHud.atualizar({ loot: (msg.itens || []).length }, this.meuId, null);
        break;
      case T.SPAWN:
        // respawn confirmado SÓ para o próprio jogador: segurança extra caso
        // o bcast do RESPAWN se perca (sem isto ficava preso na tela de morte)
        if (msg.id === this.meuId) this._revive();
        break;

      case T.PLAYER_LEFT:
      case T.BOT_SAIU:
        this._removerAvatar(msg.id);
        break;
      case T.CAR_BOOM:
        this._explodirCarro(msg);
        break;
      case T.MISSIL_FIRE:
        this._missilFire(msg);
        break;
      case T.MISSIL:
        this._explodirMissil(msg);
        break;
      case T.CHAT:
        break;
      default:
        break;
    }
  }

  /** [DIA-NOITE] tecla N: só o HOST controla o tempo da partida */
  _pedirCycle(modo) {
    if (this.net && this.net.host) {
      this.net.enviar(modo ? { t: T.CYCLE, mode: modo } : { t: T.CYCLE });
      if (this.game && this.game.hud) {
        const nomes = { ciclo: 'CICLO DIA/NOITE', dia: 'SEMPRE DIA', noite: 'SEMPRE NOITE' };
        this.game.hud.toast('🌗 HOST — ' + (nomes[modo] || 'alternando dia/noite'), 'time');
      }
    } else if (this.game && this.game.hud) {
      this.game.hud.toast('⏰ Só o host controla o dia/noite', 'aviso');
    }
  }

  _snap(msg) {
    this.snapBuf.push(msg);
    this._snapHour = msg.hour;         // [DIA-NOITE] hora controlada pelo host
    this._snapCycle = msg.cycleMode;
    // registra nicks e garante avatares (cor da roupa sincronizada)
    for (const p of msg.players || []) {
      if (p.nick) this.nicks.set(p.id, { nick: p.nick, bot: p.bot, cor: p.cor });
      this._garantirAvatar(p.id);
    }
    // HUD do jogador local
    const eu = (msg.players || []).find((p) => p.id === this.meuId);
    if (eu) {
      this._hp = eu.hp ?? this._hp;
      this._arma = eu.arma || this._arma;
      this._atualizarHud();
    }
    // timer da partida (5 min)
    if (msg.restante != null) this._atualizarTempoPartida(msg.restante);
    // scoreboard
    this.scoreboard.atualizar((msg.players || []).map((p) => ({ ...p, local: p.id === this.meuId })));
    // BR
    if (this.modo === 'br') {
      if (msg.zone) {
        this._zona = { x: msg.zone.x, z: msg.zone.z, r: msg.zone.r };
        this._atualizarAnelZona(msg.zone);
      }
      const pos = this.snapBuf.ultimo() && eu ? { x: eu.x, z: eu.z } : null;
      this.brHud.atualizar(msg, this.meuId, pos);
    }
    // carros + helicopteros + estado do veiculo do jogador local
    if (msg.cars) this._aplicarCarros(msg.cars);
    if (msg.helis) this._aplicarHelis(msg.helis);
    if (eu) {
      this._emCarro = eu.inCar != null;
      this._emHeli = eu.inHeli != null;
      this._meuHeliId = eu.inHeli ?? null;
      this._meuCarroId = eu.inCar ?? null;
      if (this._visaoMesh && !this._emCarro && !this._emHeli) {
        this._visaoMesh.setInteriorView(false);
        this._visaoMesh = null;
        this._visaoInt = false;
      }
    }
  }

  _garantirAvatar(id) {
    if (this.avatares.has(id)) return;
    const info = this.nicks.get(id) || { nick: '?', bot: false };
    // o jogador local também ganha avatar: o Bob com arma e o papagaio
    // voando — a câmera de ombro mostra o corpo dele em terceira pessoa
    const rp = new RemotePlayer(this.game.gfx.scene, { id, ...info }, { local: id === this.meuId });
    this.avatares.set(id, rp);
  }

  _removerAvatar(id) {
    const rp = this.avatares.get(id);
    if (rp) { rp.remover(); this.avatares.delete(id); }
    this.nicks.delete(id);
  }

  _nick(id) {
    return this.nicks.get(id)?.nick || '?';
  }

  // ------------------------------------------------------------ loop
  _loop(now) {
    if (!this._rodando) return;
    this._raf = requestAnimationFrame((t) => this._loop(t));
    const dt = Math.min(0.05, Math.max(0.0001, (now - this._ult) / 1000));
    this._ult = now;

    if (!this._pausado) this._update(dt);
    this.game.gfx.render();   // pipeline completo (composer): sem isto só o céu aparecia
  }

  _update(dt) {
    if (this._pausado) return;   // pausa: congela o cliente (não envia input)




    // HUD do solo vivo no MP: FPS e relógio (o laço do single está parado)
    if (this.game && this.game.hud) {
      this.game.hud.tickFPS(dt);
      this._clockAcc += dt;
      if (this._clockAcc >= 1) {
        this._clockAcc = 0;
        const d = new Date();
        const h = d.getHours();
        this.game.hud.setClock(
          String(h).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'),
          h >= 19 || h < 6,
        );
      }
    }
    // contagem de respawn no overlay (DM): o aviso {id,t} liga o cronômetro e
    // o respawn REAL (com x/y/z) é o que esconde a tela de morte
    if (this._morto && this._respawnT > 0) {
      this._respawnT -= dt;
      const ov = document.getElementById('mp-overlay');
      if (ov) {
        const s = Math.max(0, Math.ceil(this._respawnT));
        ov.querySelector('.ov-sub').textContent = s > 0 ? `RESPAWN em ${s}s` : 'RENASCENDO…';
      }
    }
    // interpola avatares
    // [PREDICAO LOCAL] o corpo anda na hora com o input, como no modo solo —
    // sem esperar o snapshot voltar do servidor (era o que causava o
    // "tremelique" no MP). A fisica local replica o servidor
    // (src/net/predict.js); o snapshot volta so para RECONCILIAR
    // divergencias reais (RemotePlayer.update).
    const rpPred = this.avatares.get(this.meuId);
    if (rpPred && rpPred.vivo && !this._emCarro && !this._emHeli) {
      rpPred._predicted = true;
      const jEdge = this.inp.jump && !this._jumpEdge;
      this._jumpEdge = !!this.inp.jump;
      if (jEdge) rpPred.human._jumpT = 0.22;   // [ANIM] impulso do pulo no avatar local
      predictBody(rpPred, {
        moveX: this.inp.mx,
        moveZ: this.inp.mz,
        yaw: this.yaw,
        run: !!this.inp.run,
        jump: jEdge,
      }, dt, this.game.col);
    } else if (rpPred) {
      rpPred._predicted = false;
    }

    this._animF++;
    for (const [id, rp] of this.avatares) {
      // [REDE-FLUIDEZ] local: snap mais recente (a predição local já
      // compensa o atraso); remotos: ler() com delay fixo de 120ms.
      const d = rp.local ? this.snapBuf.ultimoLer(id) : this.snapBuf.ler(id, performance.now(), { semExtra: rp.bot });
      if (!d) continue;
      rp.aplicar(d);
      // o avatar local gira com o mouse na hora (a posição continua vindo
      // do servidor) — sem isto a câmera parece "travada" pela latência
      if (rp.local) { rp.yaw = this.yaw; rp.pitch = this.pitch; }
      // morte: o corpo explode como no solo (vale para bots e jogadores)
      if (!rp.vivo && !rp._explodiu) {
        rp._explodiu = true;
        if (this.game && this.game.fx) {
          this.game.fx.explode(new THREE.Vector3(rp.x, rp.y + 0.9, rp.z), 0.32);   // [FPS] explosão dos bots ~55% menor
          if (this.game.audio) this.game.audio.explosao(0.4);
        }
      } else if (rp.vivo) {
        rp._explodiu = false;
      }
      // velocidades do MP/BR (12.8/29 — DOBRADAS vs solo 6.4/14.5)
      const vel = rp.local
        ? Math.hypot(rp._vx || 0, rp._vz || 0)   // predicao: pernas acompanham o corpo
        : Math.hypot(d.moveX || 0, d.moveZ || 0) * (d.run ? 29 : 12.8);
      // [FPS] LOD de animação: avatar longe anima a cada 3º frame (a posição
      // continua seguindo a 60fps; só os passos/asa ficam em câmera lenta)
      const distCam = rp.local ? 0 : Math.hypot(rp.x - this.camera.position.x, rp.z - this.camera.position.z);
      rp._loroSkip = !rp.local && distCam > 45;   // papagaio longe some da cena
      // fase por id: cada avatar longe anima em frames diferentes (em vez de
      // todos no mesmo, o que "pulava" a animação em rajada)
      // caindo (ex.: saiu do heli no ar): pose de queda enquanto desce
      // pose de queda SÓ em queda alta (prédio/heli > 5 m): o pulo do solo
      // (~1,8 m no MP) continua com a animação antiga
      // [46] o "chão" da pose de queda considera o telhado dos prédios:
      // em pé na laje não pode parecer que está caindo
      const pisoAt = Math.max(
        this.game.col.groundHeightAt(rp.x, rp.z, rp.y),
        this.game.col.roofHeightAt(rp.x, rp.z),
      );
      rp.human.falling = rp.vivo && (rp.y - pisoAt) > 5;
      rp.update(dt, vel, rp.local || distCam < 28 || (this._animF + id) % 3 === 0,
        rp.vivo && (rp.y - pisoAt) > 0.6,   // [ANIM] no ar? (pulo/queda)
        !!(d.run));   // [ANIM] correndo de verdade (tronco inclina só correndo)
      // corpo do próprio jogador visível a pé; dentro do carro ele some
      if (rp.local) rp.human.root.visible = rp.vivo && !this._emCarro && !this._emHeli && this._fpp < 0.45;   // [CODM-FPP] corpo some na 1a pessoa
    }
    // câmera de ombro em terceira pessoa, igual à do single: o mouse gira
    // o olhar na hora (sem a latência do servidor) e a câmera se posiciona
    // atrás e à direita do Bob, que fica visível com a arma na mão
    const eu = this.snapBuf.ultimoLer(this.meuId);
    const foc = this._camFocus;
    // o foco segue o CORPO VISUAL do Bob (posição suavizada pelo damp), não o
    // snap cru — o alvo da câmera fica contínuo mesmo com jitter de rede
    const rpLoc = this.avatares.get(this.meuId);
    // de helicoptero a camera enquadra o aparelho (não o corpo do piloto)
    if (this._emHeli && this._meuHeliId != null) {
      const hl = this.helisMp.get(this._meuHeliId);
      if (hl) foc.set(hl.x, hl.y + 1.2, hl.z);   // [MIRA HELI] foco vertical igual ao solo (game.js:2086 p.y+1.2)
      else if (rpLoc) foc.set(rpLoc.x, rpLoc.y + 1.62, rpLoc.z);
    } else if (this._emCarro && this._meuCarroId != null) {
      // [CARRO-FIX] foco segue o CARRO predito (física local), não o snap cru —
      // sem isto a câmera tremia junto com o teleporte do position.set
      const cr = this.carrosMp.get(this._meuCarroId);
      if (cr) foc.set(cr.x, cr.y + 1.2, cr.z);
      else if (rpLoc) foc.set(rpLoc.x, rpLoc.y + 1.62, rpLoc.z);
    } else if (rpLoc) foc.set(rpLoc.x, rpLoc.y + 1.62, rpLoc.z);
    // [Bug2-fix] foco na altura dos olhos (+1.62) em vez dos ombros (+1.48):
    // Bob desce no enquadramento e a visão à frente fica desobstruída.
    else if (eu) foc.set(eu.x, eu.y + 1.62, eu.z);
    else foc.set(0, 2, 0);
    // [câmera] amortecimento do foco IGUAL ao do modo solo (camera.js lag):
    // sem este suavizador a câmera do MP acompanhava o jogador SEM atraso e
    // o enquadramento ficava "colado" — o Bob parecia mais próximo que no solo
    if (this._camFirst) { this._camSmooth.copy(foc); this._camFirst = false; }
    this._camSmooth.x = damp(this._camSmooth.x, foc.x, CAMERA.lag, dt);
    this._camSmooth.y = damp(this._camSmooth.y, foc.y, CAMERA.lag * 0.7, dt);
    this._camSmooth.z = damp(this._camSmooth.z, foc.z, CAMERA.lag, dt);
    foc.copy(this._camSmooth);

    // [noite] o loop do SOLO fica parado durante o MP — o céu não avançava;
    // aqui replicamos o update do céu + luzes da cidade (igual ao solo)
    if (this.game && this.game.sky) {
      // [DIA-NOITE] céu controlado pelo HOST (servidor): a hora vem no snap
      const sky = this.game.sky;
      if (this._snapHour != null) {
        sky.setPaused(true);   // relógio local parado — segue o host
        if (this._snapCycle && sky.cycleMode !== this._snapCycle) {
          sky.cycleMode = this._snapCycle;
          if (this._snapCycle === 'dia') sky.setHour(12);
          else if (this._snapCycle === 'noite') sky.setHour(22);
        }
        let d = this._snapHour - sky.hour;
        while (d > 12) d -= 24;
        while (d < -12) d += 24;
        if (Math.abs(d) > 0.05) sky.setHour(sky.hour + d * Math.min(1, 3 * dt));
      } else {
        sky.setPaused(false);
      }
      sky.update(dt, foc);
      const night = this.game.sky.nightFactor;
      if (night !== this._ultNoite) {
        this._ultNoite = night;
        if (this.game.city) this.game.city.setNight(night);
        if (this.game.cars) this.game.cars.setNight(night);
        if (this.game.player) this.game.player.human.setNight(night);
        if (this.game.peds) this.game.peds.setNight(night);
        for (const rp of this.avatares.values()) rp.human.setNight(night);
      }
      // [iluminacao/animacoes] o resto do mundo tambem fica parado no MP:
      // replicar os updates que o SOLO faz por frame (lampadas dos postes,
      // teleferico/marcos, luzes do Brasil, agua e semaforos) — sem isso as
      // lampadas nem acendiam a noite no multiplayer
      if (this.game.props) this.game.props.update(dt, night, foc);
      if (this.game.landmarks) this.game.landmarks.update(dt, night);
      if (this.game.brasil) this.game.brasil.update(dt, night);
      if (this.game.terrain) this.game.terrain.update(dt);
      if (this.game.traffic) this.game.traffic.update(dt, night);
    }

    const noCarro = this._emCarro;
    const noHeli = this._emHeli;
    const noVeic = noCarro || noHeli;
    // [Bug1-fix] ao entrar em 1ª pessoa (_fpp 0→1) o offset lateral anula
    // suavemente — câmera desliza para o centro sem o salto diagonal que
    // fazia o alvo escapar da mira ao pressionar o botão de disparo.
    const ombroBase = noHeli ? CAMERA.heliShoulderX : (noCarro ? 0 : CAMERA.shoulderX);   // [MIRA HELI] heli = heliShoulderX (igual solo camera.js:224)
    const ombro = ombroBase;   // [CALIBRACAO MP] ombro FIXO igual ao solo: a camera nao entra no personagem ao atirar
    // direção da MIRA: raio que passa pela ponta dela (NDC 0.24/0.2 — o MESMO
    // aimRay do solo). yaw/pitch puro aponta para o CENTRO da tela, e a mira
    // fica deslocada no ombro: a bala errava tudo que se apontava.
    // [TIRO-FINAL] o bloco do tiro foi movido para DEPOIS da câmera final do frame.
    // ---- [FPS] ADS, coice e tremida replicados do camera.update do SOLO
    // (o GameCamera não roda no MP — a câmera aqui é a THREE pura)
    const aimando = !!(this._fire || this._fireBtn || this._ads) && !noHeli && !noCarro;   // [FPS] sem ADS em veiculo
    this._adsAmt = damp(this._adsAmt, aimando ? 1 : 0, CAMERA.adsSpeed, dt);

    // [CODM] ao atirar a pé: câmera desliza para 1ª pessoa (braço + arma na tela)
    this._fpp = damp(this._fpp, aimando ? 1 : 0, 9, dt);
    const fpp = this._fpp;
    if (this.game && this.game.viewmodel) {
      const vm = this.game.viewmodel;
      vm.visible = this._fpp > 0.2;   // [CODM-FIX] arma 3D na 1a pessoa: aparece cedo no canto e sobe — sem pop no centro
      if (vm.visible) {
        vm.setAds(true);
        vm.setTransicao(fpp); vm.update(dt, this.inp && this.inp.run ? 6 : 0);
      }
    }
    if (this.game && this.game.hud) {
      const fppAds = fpp > 0.5;
      if (fppAds !== this._fppAdsAntes) {
        this._fppAdsAntes = fppAds;
        this.game.hud.setAds(fppAds);
        this.game.hud.setCrosshairCenter(fppAds);
      }
      this.game.hud.setCrosshairVisible(fpp < 0.6);   // [CODM-FPP] retícula 2D some na 1a pessoa
    }
    const fovA = CAMERA.fov + ((this._ads ? CAMERA.adsFovPc : CAMERA.adsFov) - CAMERA.fov) * this._adsAmt;   // [PC] direito = mira 2x; esquerdo/mobile = tiro ADS leve
    if (Math.abs(this.camera.fov - fovA) > 0.01) {
      this.camera.fov = fovA;
      this.camera.updateProjectionMatrix();
    }
    // o coice relaxa sozinho; em disparo contínuo ele empina
    const recA = Math.exp(-CAMERA.recoilRecover * dt);
    this._recoilP *= recA;
    this._recoilY *= recA;
    // olhar EFETIVO = olhar do jogador + coice (puxar o mouse anula o recuo)
    const yawE = this.yaw + this._recoilY;
    const pitchE = clamp(this.pitch + this._recoilP, CAMERA.pitchMin, CAMERA.pitchMax);
    this._camDist = damp(
      this._camDist,
      noCarro ? CAMERA.carZoom : noHeli ? CAMERA.heliZoom : this._dist,
      9, dt,
    );
    let dist = this._camDist;
    // olhar para cima encurta o braço: sem isto a câmera mergulha no chão
    const t = (pitchE - CAMERA.pitchTuckStart) / (CAMERA.pitchMax - CAMERA.pitchTuckStart);
    dist *= 1 - clamp(t, 0, 1) * CAMERA.pitchTuck;
    const cp = Math.cos(pitchE), sp = Math.sin(pitchE);
    const dir = this._vDir.set(-Math.sin(yawE) * cp, sp, -Math.cos(yawE) * cp);
    const back = this._vBack.copy(dir).negate();
    const right = this._vRight.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const col = this.game.col;
    // não deixa a câmera entrar dentro de prédio
    if (col) {
      const hit = col.raycast(
        foc.x + right.x * ombro, foc.y, foc.z + right.z * ombro,
        back.x, back.y, back.z, dist + 0.6,
      );
      if (hit) dist = Math.max(CAMERA.minZoom * 0.45, hit.t - 0.45);
    }
    this.camera.position.copy(foc).addScaledVector(back, dist).addScaledVector(right, ombro);
    // e nunca abaixo do chão (a mira sobe junto com o empurrão)
    let lift = 0;
    if (col) {
      const floor = col.groundHeightAt(this.camera.position.x, this.camera.position.z, this.camera.position.y) + 0.45;
      lift = Math.max(0, floor - this.camera.position.y);
      this.camera.position.y += lift;
    }
    if (aimando && this._isTouch) {
      // [ADS] a câmera vira um tico para o lado da mira (offsets do NDC
      // 0.24/0.2 com o FOV atual) — o alvo NÃO escorrega para o centro
      // quando o zoom fecha: a mira fica onde está e apenas aproxima.
      const halfW = Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2) * this.camera.aspect;
      const halfH = Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2);
      const ay = 0;   // [FIXO] mira sempre no centro exato
      const ap = 0;
      const ye = yawE + ay, pe = pitchE + ap;
      const cpe = Math.cos(pe);
      this._camLook.set(
        foc.x - Math.sin(ye) * cpe * 12,
        foc.y + Math.sin(pe) * 12,
        foc.z - Math.cos(ye) * cpe * 12,
      );
    } else {
      // [FIX-PADRAO] enquadramento IGUAL ao solo no TPP/hip-fire: olhar para a
      // FRENTE (pos+dir*40) - jogador a ESQUERDA da tela, crosshair a direita
      // do ombro (o copy(foc) centralizava o player e o tiro saia do corpo)
      this._camLook.copy(this.camera.position).addScaledVector(dir, 40);
    }
    this._camLook.y += lift + (noHeli ? dist * CAMERA.heliFrameLift : 0);   // [MIRA HELI] frameLift igual ao solo (camera.js:266)
    this.camera.lookAt(this._camLook);

    // [CODM-FPP] 1a pessoa: câmera para os olhos (dolly TPP->FPP) olhando SEMPRE na direção do tiro
    if (fpp > 0.001 && !noVeic) {
      // [FIX-TREMOR] SEM ANCORA DE MIRA: a camera do ADS olha SEMPRE na direcao do tiro (yaw/pitch).
      // O dolly suave TPP->FPP faz o zoom sem girar nem oscilar o mundo (sem flick nem tremido).
      const olhos = new THREE.Vector3(foc.x + dir.x * CAMERA.adsEyeForward, foc.y + CAMERA.adsEyeHeight, foc.z + dir.z * CAMERA.adsEyeForward);
      this.camera.position.lerpVectors(this.camera.position, olhos, fpp);
      this._camLook.copy(this.camera.position).addScaledVector(dir, 40);
      this._camLook.y += lift;
      this.camera.lookAt(this._camLook);
    }

    // [solo] visão INTERNA (cockpit) do heli/carro — tecla V, igual ao single:
    // câmera na cabine olhando para onde o piloto olha (yaw/pitch)
    if (this._visaoInt && (this._emHeli || this._emCarro)) {
      this.camera.position.copy(foc);
      const cpi = Math.cos(pitchE);
      this._camLook.set(
        foc.x + Math.sin(yawE) * cpi * 10,
        foc.y + Math.sin(pitchE) * 10,
        foc.z + Math.cos(yawE) * cpi * 10,
      );
      this.camera.lookAt(this._camLook);
    }

    // [CODM] em 1ª pessoa: câmera na CABEÇA olhando na direção da mira
    // ================= [TIRO-FINAL] =================
    // Tudo do TIRO roda AQUI, DEPOIS da câmera final do frame (FPP/ADS/FOV já
    // aplicados). Antes o raio era calculado no início do update com a câmera
    // do frame ANTERIOR (posição do ombro, FOV aberto, sem 1ª pessoa) e a bala
    // saía FORA do eixo da mira — "a mira nascia à esquerda e puxava a tela
    // para baixo, perdendo o alvo de vista".
    this.camera.updateMatrixWorld();
    this._vNdc.set(0, 0, 0.5);   // [FIXO] tiro sempre no centro exato da tela
    this._vNdc.unproject(this.camera);
    this._fireDir = this._vNdc.sub(this.camera.position).normalize();

    // [AIM ASSIST] magnetismo de mira: inimigo perto da linha de tiro e o tiro
    // desvia para o centro dele (cone ~6,3°) — acertar players/bots fica justo.
    if (this.avatares && this.avatares.size > 1) {
      const alvosA = [];
      for (const [id, rp] of this.avatares) {
        if (id !== this.meuId && rp.vivo) alvosA.push({ x: rp.x, y: rp.y + 0.95, z: rp.z });
      }
      const aA = aimAssist(
        this.camera.position.x, this.camera.position.y, this.camera.position.z,
        this._fireDir.x, this._fireDir.y, this._fireDir.z,
        alvosA, 140, 0.05,   // [FIX] magnetismo sutil (cone ~2,9 graus): o tiro NAO desvia para o lado - a bala sai reta onde o red dot aponta
      );
      if (aA) this._fireDir.set(aA.x, aA.y, aA.z);
    }

    // ponto onde a mira aponta no mundo — o servidor guia o missil ate aqui
    if (noHeli && (this._fire || this._fireBtn || this._dragOn) && this.game && this.game.col) {
      const cP = this.camera.position;
      const hT = this.game.col.raycast(cP.x, cP.y, cP.z, this._fireDir.x, this._fireDir.y, this._fireDir.z, 500);
      if (hT) this._vPM.set(cP.x + this._fireDir.x * hT.t, cP.y + this._fireDir.y * hT.t, cP.z + this._fireDir.z * hT.t);
      else this._vPM.copy(cP).addScaledVector(this._fireDir, 500);
    }

    // [tiro] tracer local — dano é autoritativo do servidor (feedback igual ao solo).
    // NO HELI a arma é o MÍSSIL (servidor dispara): não pode sair bala de pistola.
    if (!noHeli && (this._fire || this._fireBtn) && foc) {
      const agoraT = performance.now();
      if (agoraT - (this._lastTiroT || 0) > 130) {
        this._lastTiroT = agoraT;
        const rpLoc = this.avatares.get(this.meuId);
        if (rpLoc) rpLoc.setAiming(true);
        const dxT = this._fireDir.x, dyT = this._fireDir.y, dzT = this._fireDir.z;
        // a bala/tracer VISUAL nascem à FRENTE do peito do Bob, na linha EXATA
        // da mira (câmera→NDC): o dano do servidor não muda — ele valida com a
        // origem da câmera (fpx/fpy/fpz) e esta MESMA direção. Sem o deslocamento,
        // o traço começava atrás do ombro da câmera e o tiro parecia sair de trás
        // do corpo do jogador.
        const oT = this._vT0.copy(this.camera.position);
        const tIni = Math.max(0, (foc.x - oT.x) * dxT + (foc.y - oT.y) * dyT + (foc.z - oT.z) * dzT - 0.2);
        oT.addScaledVector(this._fireDir, tIni);
        const colT = this.game.col;
        const fimT = this._vT1;
        if (colT) {
          const hitT = colT.raycast(oT.x, oT.y, oT.z, dxT, dyT, dzT, 160);
          if (hitT) fimT.set(oT.x + dxT * hitT.t, oT.y + dyT * hitT.t, oT.z + dzT * hitT.t);
          else fimT.copy(oT).addScaledVector(this._fireDir, 160);
        } else {
          fimT.copy(oT).addScaledVector(this._fireDir, 160);
        }
        // [TIRO INVISIVEL] sem tracer/raio: so a marca de acerto (marcarImpacto abaixo)
        this.game.bullets?.fire(oT, this._vT2.set(dxT, dyT, dzT));
        if (this.game && this.game.range) this.game.range.marcarImpacto(oT, this._vT2, this.game.col, this.camera);
        if (this.game && this.game.audio) this.game.audio.tiro();
        // [FPS] coice/tremida da camera REMOVIDO nos modos online (DM/BR):
        // o recuo tremia a mira e atrapalhava em rede lenta (lag).
        // O SOLO (game.js) mantem o recuo normal.
      }
    }
    // [TIRO INVISIVEL] sem tracer — a bala do BulletSystem tambem e invisivel (mesh oculto)
    if (!(this._fire || this._fireBtn)) {
      const rpLoc2 = this.avatares.get(this.meuId);
      if (rpLoc2) rpLoc2.setAiming(aimando);   // [PC] pose da arma: atirar (esquerdo/mobile) ou mirar (direito)
    }
    // balas e partículas do SOLO rodando no MP: sem isto o projétil não
    // avança nem cria faísca ao bater (e explosão nenhuma anima)
    this._sincronizarAlvosBala();
    if (this.game && this.game.bullets) this.game.bullets.update(dt);
    if (this.game && this.game.fx) this.game.fx.update(dt);
    this._updateAimFeedback();   // mira vermelha sobre inimigos (como o solo)
    // [debug] campo de tiro (?range=1): marcador verde = centro óptico da tela
    if (this.game && this.game.range) {
      this.game.range.update(this.camera, this.game.col, 'MP ' + (fpp > 0.5 ? 'FPP' : 'TPP') + (aimando ? ' ATIRANDO' : ''));
    }
    // ================ fim [TIRO-FINAL] ================

    // [FPS] tremida do tiro (mesma _applyShake do solo)
    if (this._shake > 0.001) {
      const s = this._shake;
      this.camera.position.x += (Math.random() - 0.5) * s * 0.5;
      this.camera.position.y += (Math.random() - 0.5) * s * 0.5;
      this.camera.position.z += (Math.random() - 0.5) * s * 0.5;
      this._shake = Math.max(0, this._shake - dt * 2.4);
    }

    // helicopteros: predição local do pilotado + interpolação dos remotos
    const night = this.game && this.game.sky ? this.game.sky.nightFactor : 0;
    const pilotoLocal = this._emHeli && this._meuHeliId != null;
    for (const hl of this.helisMp.values()) {
      if (pilotoLocal && hl.id === this._meuHeliId) {
        // predição local (mesma física do servidor): o aparelho responde NA HORA
        this._predizerHeli(hl, dt);
        // reconciliação: só adota o snap se a divergência for real (empurrão/teleporte)
        if (hl.alvo && Math.hypot(hl.x - hl.alvo.x, hl.z - hl.alvo.z) > 10) {
          hl.x = hl.alvo.x; hl.y = hl.alvo.y; hl.z = hl.alvo.z;
          hl.velx = 0; hl.vely = 0; hl.velz = 0;
        }
        hl.mesh.yaw = hl.yaw;
        hl.mesh.pitch = hl.pitch;
        hl.mesh.roll = hl.roll;
      } else if (hl.alvo) {
        // [REDE-FLUIDEZ] remoto/livre: correção com velocidade limitada (máx
        // 90 m/s) — o damp(λ=8) antigo "voava" com erro grande (8×15m = 120m/s
        // no 1º frame = teleporte suave). Agora o limite é fixo: salto de 15m
        // leva ~0,17s para alcançar, sem pulo.
        const dxh = hl.alvo.x - hl.x, dzh = hl.alvo.z - hl.z;
        const errh = Math.hypot(dxh, dzh);
        if (errh > 0.0001) {
          const k = Math.min(1, (90 * dt) / errh);
          hl.x += dxh * k;
          hl.z += dzh * k;
        }
        hl.y = damp(hl.y, hl.alvo.y, 8, dt);
        hl.mesh.yaw = dampAngle(hl.mesh.yaw, hl.alvo.yaw, 8, dt);
        hl.mesh.pitch = damp(hl.mesh.pitch, hl.alvo.pitch, 8, dt);
        hl.mesh.roll = damp(hl.mesh.roll, hl.alvo.roll, 8, dt);
      }
      hl.mesh.root.position.set(hl.x, hl.y, hl.z);
      hl.mesh.root.rotation.set(hl.mesh.pitch, hl.mesh.yaw, hl.mesh.roll, 'YXZ');
      hl.mesh.mpUpdate(dt, night);
    }
    this._atualizarHeliHud();

    // carros: predição local do dirigido + interpolação dos remotos (mesmo padrão
    // do heli) — sem isso o carro tremia/teleportava porque o mesh recebia
    // position.set direto de cada snap (~100-170ms de latência)
    const pilotoCarro = this._emCarro && this._meuCarroId != null;
    for (const [cid, cr] of this.carrosMp) {
      if (pilotoCarro && cid === this._meuCarroId) {
        // predição local (mesma física do servidor): o carro responde NA HORA
        this._predizerCarro(cr, dt);
        // reconciliação: só adota o snap se a divergência for real (empurrão/teleporte)
        if (cr.alvo && Math.hypot(cr.x - cr.alvo.x, cr.z - cr.alvo.z) > 10) {
          cr.x = cr.alvo.x; cr.y = cr.alvo.y; cr.z = cr.alvo.z;
          cr.speed = 0;
        }
        cr.mesh.speed = cr.speed;
      } else if (cr.alvo) {
        // [REDE-FLUIDEZ] remoto/livre: correção com velocidade limitada (máx
        // 55 m/s) — sem o "voo" do damp(λ=8) antigo com erro grande.
        const dxc = cr.alvo.x - cr.x, dzc = cr.alvo.z - cr.z;
        const errc = Math.hypot(dxc, dzc);
        if (errc > 0.0001) {
          const k = Math.min(1, (55 * dt) / errc);
          cr.x += dxc * k;
          cr.z += dzc * k;
        }
        cr.y = damp(cr.y, cr.alvo.y, 8, dt);
        cr.yaw = dampAngle(cr.yaw, cr.alvo.yaw, 8, dt);
        cr.mesh.speed = cr.snapSpeed || 0;
      }
      cr.mesh.root.position.set(cr.x, cr.y, cr.z);
      cr.mesh.yaw = cr.yaw;
      cr.mesh.syncTransform();
    }

    // envia input a INPUT_HZ
    this._sendAcc += dt;
    if (this._sendAcc >= 1 / INPUT_HZ) {
      this._sendAcc = 0;
      const alvoV = this._toggleCar ? this._alvoVeiculo() : null;
      this.net.input({
        yaw: this.yaw,
        pitch: this.pitch,
        moveX: this._emCarro ? clamp(this.inp.mx + this._carSteer, -1, 1) : this.inp.mx,
        moveZ: this.inp.mz,
        run: this.inp.run,
        jump: this.inp.jump,
        fire: !!(this._fire || this._dragOn || this._fireBtn),
        ads: !!(this._fire || this._dragOn || this._fireBtn),
        // direção da MIRA (NDC) — o servidor valida o dano na MESMA linha do
        // tracer/bala do cliente; sem isto ele atira pelo yaw/pitch (centro)
        fdx: this._fireDir ? this._fireDir.x : 0,
        fdy: this._fireDir ? this._fireDir.y : 0,
        fdz: this._fireDir ? this._fireDir.z : 0,
        fpx: this.camera.position.x,
        fpy: this.camera.position.y,
        fpz: this.camera.position.z,
        fx: this._emHeli && (this._fire || this._fireBtn || this._dragOn) ? this._vPM.x : null,
        fy: this._emHeli && (this._fire || this._fireBtn || this._dragOn) ? this._vPM.y : null,
        fz: this._emHeli && (this._fire || this._fireBtn || this._dragOn) ? this._vPM.z : null,
        car: alvoV ? alvoV.car : null,
        heli: alvoV ? alvoV.heli : null,
        up: this._emHeli ? (this.inp.up ? 1 : 0) : 0,
        down: this._emHeli ? (this.inp.down ? 1 : 0) : 0,
        heliYaw: this._emHeli ? this._heliYaw : 0,
        heliDesiredYaw: this._emHeli ? (this.yaw + Math.PI) : null,
      });
      this._toggleCar = false;
      // segurar o mouse mantém o gatilho aceso (rajada + ADS contínuos,
      // como no solo); soltar zera tudo no pointerup
      this._fire = this._dragOn;
      this.inp.jump = false;
    }
    // dicas no MESMO lugar do HUD do solo: carros e helicopteros
    if (this._emCarro) this._setHint('E — sair do carro');
    else if (this._emHeli) {
      const hl = this.helisMp.get(this._meuHeliId);
      const alt = hl ? Math.max(0, hl.y - hl.mesh.surfaceBelow()) : 99;
      this._setHint(alt > HELI.exitMaxHeight ? '▼ DESÇA para sair do helicóptero' : 'E — descer do helicóptero');
    } else {
      const alvo = this._alvoVeiculo();
      if (alvo) this._setHint(alvo.car != null ? 'E — entrar no carro' : 'E — pilotar o helicóptero');
      else this._setHint(null);
    }
    // minimapa do solo no MP: posição do jogador + círculo da zona no BR.
    // O yaw segue o MESMO do solo (player.yaw = câmera + PI + bodyTurn) —
    // passar o yaw da câmera direto deixava o radar de cabeça para baixo.
    if (eu && this.game && this.game.minimap) {
      const marks = { pickup: null, deliver: null, heli: null, helis: [], portais: null, players: [] };
      // TODOS os helicópteros no radar (blip 🚁) — o que tem piloto fica em destaque
      for (const hl of this.helisMp.values()) {
        if (hl && hl.x != null) marks.helis.push({ x: hl.x, z: hl.z, playerId: hl.playerId });
      }
      // helicóptero no radar: o meu (se estiver pilotando) ou o livre mais próximo
      if (this._emHeli && this._meuHeliId != null) {
        const hl = this.helisMp.get(this._meuHeliId);
        if (hl) marks.heli = { x: hl.x, z: hl.z };
      } else {
        const alvoH = this._alvoVeiculo();
        if (alvoH && alvoH.heli != null) {
          const hl = this.helisMp.get(alvoH.heli);
          if (hl) marks.heli = { x: hl.x, z: hl.z };
        }
      }
      if (this.modo === 'br' && this._zona) marks.zone = this._zona;
      for (const [id, rp] of this.avatares) {
        if (id === this.meuId || !rp || !rp.root) continue;
        marks.players.push({ x: rp.root.position.x, z: rp.root.position.z, yaw: rp.yaw });
      }
      this.game.minimap.draw(dt, { x: eu.x, z: eu.z, yaw: this.yaw + Math.PI + CAMERA.bodyTurn }, marks, null);
      this._atualizarIndicadorDano(eu);
    }
    // rodas dos carros
    // foguetes dos mísseis de canhão em voo (visuais — o dano é do servidor)
    this._updateMissisVis(dt);
    for (const cr of this.carrosMp.values()) cr.mesh.spinWheels(dt);
    // ping a cada 2s
    this._pingAcc += dt;
    if (this._pingAcc >= 2) {
      this._pingAcc = 0;
      this.net.ping(performance.now());
      this.netStatus.setPing(this.net.rtt);
      this.netStatus.setEstado(this.net.estado);
    }
  }

  // ------------------------------------------------------------ HUD
  _atualizarHud() {
    // barra de vida amarela do MP (0-100) — os corações do solo ficam ocultos
    const hp = Math.max(0, Math.min(100, Math.round(this._hp)));
    const fill = document.getElementById('mp-hp-fill');
    if (fill) {
      fill.style.width = hp + '%';
      fill.classList.toggle('crit', hp <= 30);   // perto de morrer pisca
    }
    const val = document.getElementById('mp-hp-val');
    if (val) val.textContent = String(hp);
  }

  /** [BR] Anel 3D no chao mostrando o limite da zona que encolhe. */
  _atualizarAnelZona(z) {
    if (!this.game || !this.game.gfx || !this.game.col) return;
    if (!this._anelZona) {
      const N = 72;
      const pts = new Float32Array(N * 3);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pts, 3));
      const mat = new THREE.LineBasicMaterial({ color: 0xff5a3c, transparent: true, opacity: 0.95 });
      this._anelZona = new THREE.LineLoop(geo, mat);
      this._anelZona.frustumCulled = false;
      this.game.gfx.scene.add(this._anelZona);
      this._anelPts = pts;
      this._anelN = N;
    }
    const N = this._anelN, pts = this._anelPts;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2;
      const px = z.x + Math.cos(a) * z.r;
      const pz = z.z + Math.sin(a) * z.r;
      const y = this.game.col.groundHeightAt(px, pz, 999) + 0.8;
      pts[i * 3] = px; pts[i * 3 + 1] = y; pts[i * 3 + 2] = pz;
    }
    this._anelZona.geometry.attributes.position.needsUpdate = true;
  }

  /** Sinal de acerto: X branco piscando no centro da tela. */
  _atualizarTempoPartida(restante) {
    const el = document.getElementById('mp-tempo');
    if (!el) return;
    el.classList.remove('hidden');
    const min = Math.floor(restante / 60);
    const seg = restante % 60;
    el.textContent = min + ':' + String(seg).padStart(2, '0');
    el.classList.toggle('urgente', restante <= 60);
  }

  _hitmarker() {
    const hm = document.getElementById('hitmarker');
    if (!hm) return;
    hm.classList.remove('show');
    void hm.offsetWidth;   // reinicia a animação mesmo com acertos em sequência
    hm.classList.add('show');
  }

  _atualizarIndicadorDano(eu) {
    const el = document.getElementById('dmg-ind');
    if (!el) return;
    if (!this._dmgDir || !eu) { el.style.opacity = '0'; return; }
    const idade = (performance.now() - this._dmgDir.t) / 1000;
    if (idade > 2) { el.style.opacity = '0'; return; }
    // vetor DE ONDE veio o dano: jogador -> atirador (msg.direcao = posicao do atirador)
    let dx = eu.x - this._dmgDir.x, dz = eu.z - this._dmgDir.z;
    const l = Math.hypot(dx, dz) || 1;
    dx /= l; dz /= l;
    // projeta no espaco da tela (mesma base do minimapa: yaw da camera)
    const yawV = this.yaw + Math.PI + CAMERA.bodyTurn;
    const c = Math.cos(yawV), s = Math.sin(yawV);
    const sx = -dx * c + dz * s;
    const sy = -dx * s - dz * c;
    const ang = Math.atan2(sx, -sy);
    el.style.transform = 'translate(-50%,-50%) rotate(' + ang + 'rad)';
    el.style.opacity = String(Math.max(0.2, 1 - idade / 2));
  }

  _morreu(por) {
    if (this._morto) return;
    this._morto = true;
    this._hp = 0;
    this._atualizarHud();   // [REGEN] a barra zera na hora da morte
    // morto cai do helicóptero (o servidor já removeu o jogador do aparelho)
    this._emHeli = false;
    this._meuHeliId = null;
    this._respawnT = 0;
    // morto não atira: zera o gatilho — o pointerup pode cair fora da janela
    // com o overlay aberto e deixar o mouse "preso" até o respawn
    this._dragOn = false; this._fire = false; this._fireBtn = false;
    const rp = this.avatares.get(this.meuId);
    if (rp) rp.vivo = false;   // corpo e papagaio somem da cena
    const ov = document.getElementById('mp-overlay');
    if (ov) {
      ov.classList.remove('hidden');
      ov.className = 'mp-overlay morte';
      ov.querySelector('.ov-titulo').textContent = 'VOCÊ MORREU';
      ov.querySelector('.ov-sub').textContent = por ? `Eliminado por ${por}` : 'Você foi eliminado';
      // [respawn] DM: o botão principal volta para a partida NA HORA (pede ao
      // servidor, que renasce sem esperar o timer); o secundário sai. BR não
      // tem respawn — só o de sair. A contagem de 2s continua de fundo
      const btn = ov.querySelector('.mp-btn');
      const btnSair = ov.querySelector('.mp-btn-sair');
      if (this.modo !== 'br') {
        btn.style.display = '';
        btn.textContent = 'VOLTAR PARA A PARTIDA';
        btn.onclick = () => this.net.enviar({ t: T.RESPAWN_NOW });
      } else {
        btn.style.display = 'none';
      }
      if (btnSair) {
        btnSair.classList.remove('hidden');
        btnSair.onclick = () => { ov.classList.add('hidden'); this.sair(); };
      }
    }
    if (this.brHud) this.brHud.esconder();
  }

  /** Aviso do servidor no DM: {id, t} = segundos até renascer. */
  _contagemRespawn(t) {
    if (!this._morto) return;
    this._respawnT = Math.max(0, t || 3);
    const ov = document.getElementById('mp-overlay');
    if (ov) ov.querySelector('.ov-sub').textContent = `RESPAWN em ${Math.ceil(this._respawnT)}s`;
  }

  _revive() {
    this._morto = false;
    this._respawnT = 0;
    this._hp = 100;
    this._atualizarHud();   // [REGEN] a barra volta cheia no respawn
    // câmera cola no novo spawn: sem o reset o foco amortecido "voava" do
    // ponto da morte até o respawn (atravessando prédios por ~0,5s)
    this._camFirst = true;
    const rp = this.avatares.get(this.meuId);
    if (rp) rp.vivo = true;
    const ov = document.getElementById('mp-overlay');
    if (ov) ov.classList.add('hidden');
    if (this.modo === 'br') this.brHud.mostrar();
  }

  _vencedor(msg) {
    if (!this._rodando) return;   // [FIX] partida fantasma: o match já saiu — ignora
    // fim de partida: para a contagem de respawn (nada de sobrescrever o texto)
    this._respawnT = 0;
    this._fire = false;
    this._dragOn = false;
    this._fireBtn = false;

    // [REVIEW-30S] fim de partida: a cena continua viva por 30s (servidor mantém a sala
    // 35s enviando snapshots) — o jogador fica parado olhando os players ao redor,
    // com um banner no topo mostrando o vencedor e o contador. Só depois mostra o overlay.
    this._revId = msg.id;
    this._revNick = msg.nick || 'Alguém';
    this._mostrarFim();
  }

  _mostrarFim() {
    const ov = document.getElementById('mp-overlay');
    if (!ov) return;
    ov.classList.remove('hidden');
    const venceu = this._revId === this.meuId;
    ov.className = 'mp-overlay ' + (venceu ? 'vitoria' : '');
    ov.querySelector('.ov-titulo').textContent = venceu ? 'VITÓRIA! 🏆' : 'FIM DE PARTIDA';
    ov.querySelector('.ov-sub').textContent = venceu ? 'Você é o último de pé!' : `${this._revNick || 'Alguém'} venceu`;
    ov.querySelector('.ov-kills').textContent = 'Partida encerrada — obrigado por jogar!';
    const btnSair = ov.querySelector('.mp-btn-sair');
    if (btnSair) btnSair.classList.add('hidden');
    const btn = ov.querySelector('.mp-btn');
    btn.style.display = '';
    btn.textContent = 'VOLTAR AO MENU';
    btn.onclick = () => {
      ov.classList.add('hidden');
      this.sair();
    };
  }

  /** Predição local do heli pilotado — replica EXATAMENTE a física do
   * servidor (server/helis.js updateHelis) para o aparelho responder na hora
   * do input, sem esperar o snapshot (era o que causava a "travada" ao voar). */
  _predizerHeli(hl, dt) {
    const inp = {
      forward: clamp(this.inp.mz || 0, -1, 1),
      strafe: clamp(this.inp.mx || 0, -1, 1),
      up: this.inp.up ? 1 : 0,
      down: this.inp.down ? 1 : 0,
      yawLeft: this._heliYaw > 0 ? 1 : 0,
      yawRight: this._heliYaw < 0 ? 1 : 0,
      desiredYaw: this.yaw + Math.PI,   // igual ao heliDesiredYaw enviado
    };
    // guinada manual (Q/R) + nariz segue a câmera
    hl.yaw += (inp.yawLeft - inp.yawRight) * HELI.yawRate * dt;
    const d = angleDelta(hl.yaw, inp.desiredYaw);
    hl.yaw += clamp(d * 2.0, -HELI.yawRate, HELI.yawRate) * dt;
    // inclinação visual (mesmo amortecimento do servidor)
    hl.pitch = damp(hl.pitch, clamp(inp.forward * 0.42, -0.42, 0.42), 4.5, dt);
    hl.roll = damp(hl.roll, clamp(inp.strafe * 0.40, -0.40, 0.40), 4.5, dt);
    // forças de translação (frente = nariz +Z — convenção do modelo)
    const fx = Math.sin(hl.yaw), fz = Math.cos(hl.yaw);
    const rx = -Math.cos(hl.yaw), rz = Math.sin(hl.yaw);
    hl.velx += (fx * inp.forward + rx * inp.strafe) * HELI.tiltAccel * dt;
    hl.velz += (fz * inp.forward + rz * inp.strafe) * HELI.tiltAccel * dt;
    hl.vely += (inp.up - inp.down) * HELI.liftAccel * dt;
    if (inp.up === 0 && inp.down === 0) hl.vely = damp(hl.vely, 0, 2.2, dt);
    // arrasto e limites
    const drag = Math.exp(-HELI.drag * dt);
    hl.velx *= drag; hl.velz *= drag;
    hl.vely = clamp(hl.vely, -HELI.maxLift, HELI.maxLift);
    const hs = Math.hypot(hl.velx, hl.velz);
    if (hs > HELI.maxSpeed) { hl.velx *= HELI.maxSpeed / hs; hl.velz *= HELI.maxSpeed / hs; }
    // integração
    const yAntes = hl.y;
    hl.x += hl.velx * dt;
    hl.y += hl.vely * dt;
    hl.z += hl.velz * dt;
    // não desce abaixo da superfície
    const col = this.game.col;
    const surf = col.groundHeightAt(hl.x, hl.z, hl.y);
    const minY = surf + HELI.landHeight;
    if (hl.y < minY && yAntes >= minY - 0.02) { hl.y = minY; if (hl.vely < 0) hl.vely = 0; }
    // não atravessa prédios/marcos (empurra para fora, igual ao servidor)
    const before = { x: hl.x, z: hl.z };
    const pos = { x: hl.x, y: hl.y, z: hl.z };
    if (col.resolveCircle(pos, 2.0)) {
      hl.x = pos.x; hl.z = pos.z;
      hl.velx = (hl.x - before.x) * 6;
      hl.velz = (hl.z - before.z) * 6;
    }
    // teto de voo e limites do mundo
    if (hl.y > 150) { hl.y = 150; hl.vely = Math.min(0, hl.vely); }
    hl.x = clamp(hl.x, -2600, 2600);
    hl.z = clamp(hl.z, -2600, 2600);
  }

  /** Predição local do carro dirigido — replica EXATAMENTE a física do servidor
   *  (server/cars.js updateCars): aceleração, esterço, colisão e solo. O mesh é
   *  posicionado no _update; o snap volta só para reconciliar divergências reais. */
  _predizerCarro(cr, dt) {
    const inp = {
      moveX: clamp(this.inp.mx + this._carSteer, -1, 1),
      moveZ: clamp(this.inp.mz || 0, -1, 1),
    };
    // acelera / freia / ré (mesmas constantes do servidor)
    const gas = clamp(inp.moveZ, -1, 1);
    const alvo = gas * CAR_MP.maxSpeed;
    const accel = gas !== 0 ? CAR_MP.accel : CAR_MP.brake;
    cr.speed += clamp(alvo - cr.speed, -accel * dt, accel * dt);
    // esterço proporcional à velocidade
    if (Math.abs(cr.speed) > 0.4) {
      const steer = -clamp(inp.moveX, -1, 1) * CAR_MP.steer * Math.min(1, Math.abs(cr.speed) / 9);
      cr.yaw += steer * dt * (cr.speed >= 0 ? 1 : -1);
    }
    // anda
    cr.x += Math.sin(cr.yaw) * cr.speed * dt;
    cr.z += Math.cos(cr.yaw) * cr.speed * dt;
    // colisão com prédios/postes (círculo do carro) e solo
    const pos = { x: cr.x, y: cr.y, z: cr.z };
    if (this.game.col.resolveCircle(pos, CAR_MP.radius, CAR_MP.height)) {
      cr.x = pos.x; cr.z = pos.z;
    }
    cr.y = this.game.col.groundHeightAt(cr.x, cr.z) + 0.2;
    // limite do mundo
    cr.x = clamp(cr.x, -2500, 2500);
    cr.z = clamp(cr.z, -2500, 2500);
  }

  // ------------------------------------------------------------ veiculos
  _aplicarCarros(lista) {
    for (const c of lista) {
      // carro explodiu no servidor: some da cena de vez
      if (c.destroyed) {
        const velho = this.carrosMp.get(c.id);
        if (velho) {
          velho.mesh.dispose(this.game.gfx.scene);
          this.carrosMp.delete(c.id);
        }
        continue;
      }
      let cr = this.carrosMp.get(c.id);
      if (!cr) {
        const mesh = new Car(c.cor || 0xe53935, Math.random);
        mesh.root.traverse(o => { if (o.isMesh || o.isSprite) o.frustumCulled = false; });   // [INVISIVEL-FIX]
        this.game.gfx.scene.add(mesh.root);
        cr = { mesh, x: c.x, y: c.y, z: c.z, yaw: c.yaw || 0, speed: c.speed || 0, playerId: null, alvo: null };
        // primeiro snap: posiciona direto (ainda nao ha historico p/ interpolar)
        cr.mesh.root.position.set(c.x, c.y, c.z);
        cr.mesh.yaw = cr.yaw;
        cr.mesh.syncTransform();
        this.carrosMp.set(c.id, cr);
      }
      cr.playerId = c.playerId;
      cr.snapSpeed = c.speed;
      // [CARRO-FIX] alvo do servidor (snap autoritativo) — o MESH é posicionado
      // no _update com predição local (dirigido) ou interpolação suave (remoto),
      // nunca position.set direto (era o que fazia o carro tremer/teleportar).
      cr.alvo = { x: c.x, y: c.y, z: c.z, yaw: c.yaw || 0 };
    }
  }

  /** Helicópteros do MP: meshes autoritativos vindos do servidor. */
  _aplicarHelis(lista) {
    for (const h of lista) {
      let hl = this.helisMp.get(h.id);
      if (!hl) {
        const mesh = new Helicopter(this.game.gfx.scene, this.game.col, h.cor || 0x1f4f8f);
        hl = {
          id: h.id, mesh,
          x: h.x, y: h.y, z: h.z,
          velx: 0, vely: 0, velz: 0,
          yaw: h.yaw || 0, pitch: h.pitch || 0, roll: h.roll || 0,
          vel: 0, playerId: null, alvo: null,
        };
        this.helisMp.set(h.id, hl);
      }
      // alvo do servidor (snap autoritativo) — o MESH é posicionado no _update
      // com predição local (piloto) ou interpolação suave (remoto), nunca teleporte.
      hl.alvo = { x: h.x, y: h.y, z: h.z, yaw: h.yaw || 0, pitch: h.pitch || 0, roll: h.roll || 0 };
      hl.vel = h.speed || 0;
      hl.playerId = h.playerId;
      hl.fuel = h.fuel ?? 100;
      hl.mesh.piloted = h.playerId != null && (h.fuel ?? 100) > 0;
    }
  }

  /** Carro destruído no servidor: explosão grande + some da cena. */
  _explodirCarro(msg) {
    const cr = this.carrosMp.get(msg.id);
    if (!cr) return;
    const p = new THREE.Vector3(cr.x, cr.y + 0.6, cr.z);
    if (this.game && this.game.fx) {
      this.game.fx.explode(p, 1.8);
      if (this.game.audio) this.game.audio.explosao(1.8);
    }
    cr.mesh.dispose(this.game.gfx.scene);
    this.carrosMp.delete(msg.id);
  }

  /** Míssil disparado por um helicóptero: cria o foguete visual. */
  _missilFire(msg) {
    if (!this.game || !this.game.gfx) return;
    const dir = new THREE.Vector3(msg.dx, msg.dy, msg.dz).normalize();
    const grupo = new THREE.Group();
    const corpo = new THREE.Mesh(
      new THREE.CylinderGeometry(0.09, 0.12, 0.7, 6),
      new THREE.MeshBasicMaterial({ color: 0xffdd66 })
    );
    corpo.rotation.x = Math.PI / 2;   // cilindro ao longo de Z
    const ponta = new THREE.Mesh(
      new THREE.ConeGeometry(0.12, 0.3, 6),
      new THREE.MeshBasicMaterial({ color: 0xff8844 })
    );
    ponta.rotation.x = Math.PI / 2;   // cone apontando +Z (sentido do voo)
    ponta.position.z = 0.5;
    grupo.add(corpo, ponta);
    // orienta o foguete na direção do voo (lookAt alinha o +Z local)
    if (dir.lengthSq() > 0.0001) {
      const eixos = new THREE.Matrix4().lookAt(new THREE.Vector3(0, 0, 0), dir, new THREE.Vector3(0, 1, 0));
      grupo.quaternion.setFromRotationMatrix(eixos);
    }
    grupo.position.set(msg.x, msg.y, msg.z);
    this.game.gfx.scene.add(grupo);
    this.missisVis.push({ id: msg.id, grupo, dx: msg.dx, dy: msg.dy, dz: msg.dz, v: msg.v || 55, vida: 6, alvo: msg.alvo ?? null });
  }

  /** Explosão do míssil (confirmada pelo servidor): fx + remove o foguete. */
  _explodirMissil(msg) {
    if (this.game && this.game.fx) {
      this.game.fx.explode(new THREE.Vector3(msg.x, msg.y, msg.z), 2.4);
      if (this.game.audio) this.game.audio.explosao(2.2);
    }
    for (let i = this.missisVis.length - 1; i >= 0; i--) {
      if (this.missisVis[i].id !== msg.id) continue;
      const mv = this.missisVis[i];
      mv.grupo.traverse((o) => { if (o.material) o.material.dispose(); });
      this.game.gfx.scene.remove(mv.grupo);
      this.missisVis.splice(i, 1);
      return;
    }
  }

  /** Move os foguetes visuais; expira sozinho se a explosão não chegar. */
  _updateMissisVis(dt) {
    for (let i = this.missisVis.length - 1; i >= 0; i--) {
      const mv = this.missisVis[i];
      // homing visual: curva para o avatar do alvo (espelha o teleguiado do servidor)
      if (mv.alvo != null) {
        const rp = this.avatares.get(mv.alvo);
        if (rp && rp.vivo !== false) {
          const tx = rp.x - mv.grupo.position.x, ty = rp.y + 1 - mv.grupo.position.y, tz = rp.z - mv.grupo.position.z;
          const tl = Math.hypot(tx, ty, tz);
          if (tl > 0.5) {
            const k = Math.min(1, 2.5 * dt);
            mv.dx += ((tx / tl) - mv.dx) * k;
            mv.dy += ((ty / tl) - mv.dy) * k;
            mv.dz += ((tz / tl) - mv.dz) * k;
            const nl = Math.hypot(mv.dx, mv.dy, mv.dz) || 1;
            mv.dx /= nl; mv.dy /= nl; mv.dz /= nl;
            mv.grupo.quaternion.setFromRotationMatrix(
              new THREE.Matrix4().lookAt(new THREE.Vector3(0, 0, 0), new THREE.Vector3(mv.dx, mv.dy, mv.dz), new THREE.Vector3(0, 1, 0))
            );
          }
        }
      }
      mv.vida -= dt;
      mv.grupo.position.x += mv.dx * mv.v * dt;
      mv.grupo.position.y += mv.dy * mv.v * dt;
      mv.grupo.position.z += mv.dz * mv.v * dt;
      if (mv.vida <= 0) {
        if (this.game && this.game.fx) {
          this.game.fx.explode(new THREE.Vector3(mv.grupo.position.x, mv.grupo.position.y, mv.grupo.position.z), 1.6);
        }
        mv.grupo.traverse((o) => { if (o.material) o.material.dispose(); });
        this.game.gfx.scene.remove(mv.grupo);
        this.missisVis.splice(i, 1);
      }
    }
  }

  /** Alvos locais das balas (avatares e carros) — o dano é do servidor;
   *  aqui é só o feedback visual (faísca no corpo/carro), igual ao solo. */
  _updateAimFeedback() {
    // [perf] metade dos traces: o realce da mira 1 frame atrasado é invisível
    this._aimTick = (this._aimTick || 0) + 1;
    if (this._aimTick & 1) return;
    if (!this.game || !this.game.hud || !this.game.bullets) return;
    const ndc = this._aimNdc || new THREE.Vector3(0, 0, 0.5);   // [FIXO] centro da tela
    this._aimNdc = ndc;
    this.camera.updateMatrixWorld();
    const dir = ndc.clone().unproject(this.camera).sub(this.camera.position).normalize();
    const hit = this.game.bullets._trace(this.camera.position, dir, 220);
    // mesma lógica do SOLO: a mira fica VERMELHA sobre inimigos e carros
    this.game.hud.setOnTarget(!!hit && (hit.kind === 'foe' || hit.kind === 'car'));
  }

  _sincronizarAlvosBala() {
    const bul = this.game && this.game.bullets;
    if (!bul) return;
    const foes = [];
    for (const rp of this.avatares.values()) {
      if (!rp._alvo) rp._alvo = { vivo: true, root: rp.root, alturaAlvo: 1.15, raioAcerto: 0.55 };
      rp._alvo.vivo = rp.vivo;
      foes.push(rp._alvo);
    }
    bul.targets.foes = foes.length ? foes : null;
    const euAlvo = this.avatares.get(this.meuId)?._alvo || null;
    bul.ignoreFoe = euAlvo;   // a própria bala não acerta o próprio Bob
    const cars = [];
    let meuCarro = null;
    for (const cr of this.carrosMp.values()) {
      if (!cr._alvo) cr._alvo = { alive: true, root: cr.mesh.root };
      cr._alvo.alive = true;
      cars.push(cr._alvo);
      if (cr.playerId === this.meuId) meuCarro = cr._alvo;
    }
    bul.targets.cars = cars.length ? { cars } : null;
    bul.ignoreCar = meuCarro;   // bala não acerta o próprio carro (sai de dentro dele)
    // bala nasce no PEITO do Bob, que está na lista de avatares (foes) —
    // sem isto o _segSphere devolve t=0 e o tiro se auto-acerta
    bul.ignoreFoe = this.avatares.get(this.meuId)?._alvo || null;
  }

  /** Carro/helicóptero livre mais próximo — {car, heli} ou null. 0 = sair. */
  _alvoVeiculo() {
    if (this._emCarro) return { car: 0, heli: null };
    if (this._emHeli) return { car: null, heli: 0 };
    const snap = this.snapBuf.ultimo();
    const eu = snap && snap.players ? snap.players.find((p) => p.id === this.meuId) : null;
    if (!eu) return null;
    let best = null, bestD = Infinity;
    for (const [id, cr] of this.carrosMp) {
      if (cr.playerId != null) continue;
      const dx = cr.x - eu.x, dz = cr.z - eu.z;
      const d = dx * dx + dz * dz;
      if (d < bestD) { bestD = d; best = { tipo: 'carro', id }; }
    }
    for (const [id, hl] of this.helisMp) {
      if (hl.playerId != null) continue;
      const dx = hl.x - eu.x, dz = hl.z - eu.z;
      const d = dx * dx + dz * dz;
      if (d < bestD) { bestD = d; best = { tipo: 'heli', id }; }
    }
    if (!best) return null;
    const range = best.tipo === 'carro' ? 4.5 : HELI.enterRange;
    if (bestD > range * range) return null;
    return best.tipo === 'carro' ? { car: best.id, heli: null } : { car: null, heli: best.id };
  }

  /** Painel ALT/VEL do helicóptero quando o jogador está pilotando. */
  _atualizarHeliHud() {
    // botões do toque: no heli o PULAR vira ▲ (subir) e aparece o ▼ (descer)
    const emCarro = this._emCarro;
    const padEl = document.getElementById('mp-pad');
    if (padEl) padEl.classList.toggle('em-carro', emCarro);
    const pularEl = document.getElementById('mp-pular');
    if (pularEl) {
      pularEl.textContent = this._emHeli ? '▲' : 'PULAR';
      pularEl.classList.toggle('hidden', emCarro);   // [carro] so acao/tiro/analogico/direcionais
    }
    const descerEl = document.getElementById('mp-descer');
    if (descerEl) descerEl.classList.toggle('hidden', !this._emHeli);
    const correrEl = document.getElementById('mp-correr');
    if (correrEl) correrEl.classList.toggle('hidden', this._emHeli || emCarro);
    const giroEsqEl = document.getElementById('mp-girar-esq');
    if (giroEsqEl) giroEsqEl.classList.toggle('hidden', !emCarro);   // [MIRA HELI] direcionais somem no heli (igual solo touch.js:91)
    const giroDirEl = document.getElementById('mp-girar-dir');
    if (giroDirEl) giroDirEl.classList.toggle('hidden', !emCarro);

    const panel = document.getElementById('heli-panel');
    if (!panel) return;
    if (!this._emHeli || this._meuHeliId == null) {
      panel.classList.add('hidden');
      return;
    }
    const hl = this.helisMp.get(this._meuHeliId);
    panel.classList.remove('hidden');
    if (!hl) return;
    const alt = Math.max(0, hl.y - hl.mesh.surfaceBelow());
    const elAlt = document.getElementById('heli-alt');
    const elSpd = document.getElementById('heli-spd');
    if (elAlt) elAlt.textContent = String(Math.round(alt));
    if (elSpd) elSpd.textContent = String(Math.round((hl.vel || 0) * 3.6));
    // gasolina do aparelho (verde -> amarelo -> vermelho)
    const elFuel = document.getElementById('heli-fuel');
    if (elFuel) {
      const f = Math.round(hl.fuel ?? 100);
      elFuel.textContent = f + '%';
      elFuel.style.color = f > 40 ? '#7CFC00' : f > 15 ? '#FFD24D' : '#FF5555';
    }
    // aviso de "desça para sair" só quando está alto demais
    const warn = document.getElementById('heli-warn');
    if (warn) warn.style.display = alt > HELI.exitMaxHeight ? '' : 'none';
  }

  /** Dica contextual no MESMO lugar do HUD do solo. */
  _setHint(texto) {
    if (this.game && this.game.hud) this.game.hud.setPrompt(texto);
  }

  fimPartida(msg) {
    this._vencedor(msg);
  }

  // ------------------------------------------------------------ pausa
  /** Pausa única — mesma tela e os mesmos menus de OPÇÕES/CONTROLES do solo. */
  _alternarVisao() {
    // [solo] tecla V: câmera externa <-> interna (cockpit), como no single
    if (this._emHeli && this._meuHeliId != null) {
      this._visaoInt = !this._visaoInt;
      const hl = this.helisMp.get(this._meuHeliId);
      const mesh = hl && hl.mesh;
      if (mesh && mesh.setInteriorView) mesh.setInteriorView(this._visaoInt);
      this._visaoMesh = this._visaoInt ? mesh : null;
    } else if (this._emCarro && this._meuCarroId != null) {
      this._visaoInt = !this._visaoInt;
      const c = this.carrosMp.get(this._meuCarroId);
      const mesh = c && c.mesh;
      if (mesh && mesh.setInteriorView) mesh.setInteriorView(this._visaoInt);
      this._visaoMesh = this._visaoInt ? mesh : null;
    }
  }

  _togglePausa() {
    // telas abertas fecham antes da pausa (mesma ordem do modo solo)
    const opcoes = document.getElementById('options-screen');
    if (opcoes && !opcoes.classList.contains('hidden')) {
      if (this.game) this.game._abrirOpcoes(false);
      return;
    }
    if (this.game && this.game.keys && this.game.keys.aberto) {
      this.game.keys.fechar();
      return;
    }
    const sb = document.getElementById('scoreboard');
    if (sb && !sb.classList.contains('hidden')) { this.scoreboard.alternar(); return; }
    const ov = document.getElementById('mp-overlay');
    if (ov && !ov.classList.contains('hidden')) return;   // morte/vitória tem fluxo próprio
    if (this._pausado) this._retomar();
    else this._pausar();
  }

  _pausar() {
    if (this._pausado) return;
    this._pausado = true;
    this._setHint(null);
    // dedos soltos: nada de andar/atirar sozinho ao retomar
    this._lt = null;
    this._joyTouch = null;
    this.inp.mx = 0; this.inp.mz = 0; this.inp.run = false; this.inp.up = false; this.inp.down = false;
    this._fireBtn = false; this._fire = false; this._dragOn = false;
    if (this.pausa) this.pausa.mostrar();
  }

  _retomar() {
    if (!this._pausado) return;
    this._pausado = false;
    if (this.pausa) this.pausa.esconder();
  }

  /** Mostra o HUD do single no MP: corações = vida, minimapa, relógio, FPS. */
  _prepararHudSolo() {
    const obj = document.getElementById('objective');
    if (obj) obj.classList.add('hidden');
    const sr = document.querySelector('#topleft .stat-row');
    if (sr) sr.style.display = 'none';
    for (const id of ['speedo', 'heli-panel', 'carrying', 'lock-on', 'missile-gauge']) {
      const el = document.getElementById(id);
      if (el) el.classList.add('hidden');
    }
    const barra = document.getElementById('mp-vida');
    if (barra) barra.classList.remove('hidden');
    const hearts = document.getElementById('hearts');
    if (hearts) hearts.style.display = 'none';   // corações do solo ocultos no MP
    const armaEl = document.getElementById('mp-arma');
    if (armaEl) armaEl.classList.add('hidden');
    if (this.game && this.game.hud) {
      this.game.hud.setHearts(6);
      this.game.hud.setPrompt(null);
    }
  }

  /** Devolve o HUD do solo ao estado de menu ao sair do MP. */
  _restaurarHudSolo() {
    const obj = document.getElementById('objective');
    if (obj) obj.classList.remove('hidden');
    const sr = document.querySelector('#topleft .stat-row');
    if (sr) sr.style.display = '';
    const barra = document.getElementById('mp-vida');
    if (barra) barra.classList.add('hidden');
    const hearts = document.getElementById('hearts');
    if (hearts) hearts.style.display = '';
  }

  /** [Android] botão voltar da barra de navegação = pausa (sentinela no history). */
  _ligarBack() {
    this._backHandler = () => {
      if (!this._rodando) return;
      try { history.pushState(null, ''); } catch {}
      this._togglePausa();
    };
    window.addEventListener('popstate', this._backHandler);
    try { history.pushState(null, ''); } catch {}
  }
  // ------------------------------------------------------------ sair
  sair() {
    if (this._saiu) return;   // [FIX] idempotente: sairMultiplayer() reentrante não repete a limpeza
    this._saiu = true;
    if (this.game) this.game._mp = false;
    if (this.game && this.game.imgBuildings) this.game.imgBuildings.restaurarDoMp(this.game.col);
    if (this.game && this.game.minimap) this.game.minimap.setModoMp(false);   // [MP-MAPA] devolve o minimapa do solo
    this._rodando = false;
    if (this._raf) cancelAnimationFrame(this._raf);
    window.removeEventListener('keydown', this._kd);
    window.removeEventListener('keyup', this._ku);
    window.removeEventListener('pointerdown', this._pd);
    window.removeEventListener('pointerup', this._pu);
    window.removeEventListener('contextmenu', this._cm);
    window.removeEventListener('pointermove', this._pm);
    window.removeEventListener('wheel', this._zw);
    document.removeEventListener('touchstart', this._touchStart);
    document.removeEventListener('touchmove', this._touchMove);
    document.removeEventListener('touchend', this._touchEnd);
    window.removeEventListener('blur', this._blur);
    document.removeEventListener('pointerlockchange', this._lockChg);
    for (const rp of this.avatares.values()) rp.remover();
    this.avatares.clear();
    // remove os carros do MP e devolve o transito do single
    for (const cr of this.carrosMp.values()) cr.mesh.dispose(this.game.gfx.scene);
    this.carrosMp.clear();
    // remove os helicopteros do MP (e o painel de ALT/VEL)
    for (const hl of this.helisMp.values()) this.game.gfx.scene.remove(hl.mesh.root);
    this.helisMp.clear();
    this._emHeli = false;
    this._meuHeliId = null;
    this._heliYaw = 0;
    const heliPanel = document.getElementById('heli-panel');
    if (heliPanel) heliPanel.classList.add('hidden');
    if (this._tracer) { this.game.gfx.scene.remove(this._tracer); this._tracer.geometry.dispose(); this._tracer.material.dispose(); this._tracer = null; }
    if (this._anelZona) { this.game.gfx.scene.remove(this._anelZona); this._anelZona.geometry.dispose(); this._anelZona.material.dispose(); this._anelZona = null; }
    // devolve as balas do single: alvos do trânsito e callbacks originais
    if (this.game && this.game.bullets) {
      const bul = this.game.bullets;
      bul.setTargets(this.game.peds, this.game.cars);
      bul.setFoes(null);
      bul.ignoreCar = null;
      bul.ignoreFoe = null;
      if (this._bulletsAntes) {
        bul.onHitFoe = this._bulletsAntes.onHitFoe;
        bul.onHitCar = this._bulletsAntes.onHitCar;
        bul.onHitPed = this._bulletsAntes.onHitPed;
        this._bulletsAntes = null;
      }
    }
    if (this.game && this.game.cars) this.game.cars.group.visible = true;
    if (this.game && this.game.peds) this.game.peds.group.visible = true;
    if (this.game && this.game.heli) this.game.heli.root.visible = true;
    // pausa: desliga handlers do MP e devolve o comando ao modo solo
    if (this._backHandler) { window.removeEventListener('popstate', this._backHandler); this._backHandler = null; }
    if (this.pausa) {
      this.pausa.esconder();
      if (this.game && this.game._ligarPausaSolo) this.game._ligarPausaSolo();
    }
    if (this._pausaBtn && this._pausaBtnHandler) {
      this._pausaBtn.removeEventListener('click', this._pausaBtnHandler);
      this._pausaBtn.classList.add('hidden');
    }
    this._restaurarHudSolo();
    const hud = document.getElementById('hud');
    if (hud) hud.classList.add('hidden');
    this._setHint(null);
    const hudMp = document.getElementById('mp-hud');
    if (hudMp) hudMp.classList.add('hidden');
    document.body.classList.remove('mp-ativo');
    const joy = document.getElementById('mp-joy');
    if (joy) joy.classList.add('hidden');
    const look = document.getElementById('mp-look');
    if (look) look.classList.add('hidden');
    for (const b of this._mpBtns) {
      b.el.removeEventListener("touchstart", b.d);
      b.el.removeEventListener("touchend", b.u);
      b.el.removeEventListener("touchcancel", b.u);
      b.el.removeEventListener("mousedown", b.d);
      b.el.removeEventListener("mouseup", b.u);
      b.el.removeEventListener("mouseleave", b.u);
    }
    this._mpBtns = [];
    if (this._mpMira && this._mpMira.el) {
      const m = this._mpMira;
      m.el.removeEventListener('pointerdown', m.down);
      m.el.removeEventListener('pointermove', m.move);
      m.el.removeEventListener('pointerup', m.up);
      m.el.removeEventListener('pointercancel', m.up);
      this._mpMira = null;
    }
    const pad = document.getElementById("mp-pad");
    if (pad) pad.classList.add("hidden");
    const ov = document.getElementById('mp-overlay');
    if (ov) ov.classList.add('hidden');
    const ab = document.getElementById('title-screen');
    if (ab) ab.classList.remove('hidden');
    // devolve o laço e a câmera ao single player (tela de abertura girando)
    if (window.__retomarLoopSingle) window.__retomarLoopSingle();
    // restaura a arma de tela ao estado que estava ANTES do MP (no solo em
    // terceira pessoa ela fica escondida — forçar true deixava uma pistola
    // flutuando atrás do Bob na câmera)
    if (this.game && this.game.viewmodel) {
      this.game.viewmodel.visible = this._viewmodelAntes ?? false;
    }
    this.camera.rotation.order = 'XYZ';
    this.killfeed.limpar();

    // [FIX] encerra a sessão MP completa: o multiplayer.js fecha o WebSocket e anula
    // match/net — sem partida fantasma processando snapshots nem mostrando o vencedor
    // por cima do modo solo.
    window.dispatchEvent(new Event('mp-sair'));
  }
}
