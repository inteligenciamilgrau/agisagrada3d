import * as THREE from 'three';
import {
  PLAYER, CAMERA, CAR, HELI, GAME, DAY, CURB_H, QUALITY,
  PRESETS, DEFAULT_PRESET, POPULATIONS, DEFAULT_POPULATION, CABLE,
} from './config.js';
import { clamp, damp, dampAngle, dist2D, formatTime, angleDelta } from './utils.js';

import { Graphics } from './gfx/renderer.js';
import { SkySystem } from './gfx/sky.js';
import { CollisionWorld } from './world/collision.js';
import { Terrain, terrainHeight } from './world/terrain.js';
import { City } from './world/city.js';
import { Props } from './world/props.js';
import { Landmarks } from './world/landmarks.js';
import { BrazilLandmarks } from './world/brasil.js';
import { TrafficSystem } from './sys/traffic.js';
import { PedestrianSystem } from './ent/pedestrian.js';
import { CarSystem } from './ent/car.js';
import { Helicopter } from './ent/helicopter.js';
import { Player } from './player.js';
import { GameCamera } from './camera.js';
import { Input } from './input.js';
import { FX } from './sys/fx.js';
import { BulletSystem } from './sys/bullets.js';
import { MissileSystem } from './sys/missiles.js';
import { MissionSystem } from './sys/mission.js';
import { HUD } from './ui/hud.js';
import { Minimap } from './ui/minimap.js';
import { Phone } from './ui/phone.js';
import { Settings } from './settings.js';

const $ = (id) => document.getElementById(id);

export class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.state = 'title';          // title | playing | paused | over
    this.mode = 'foot';            // foot | car | heli | cable
    this.elapsed = 0;
    /** [60] Modo Deus (tecla M): voo livre, sem gravidade, colisão nem dano. */
    this.god = false;
    /** [62] Há uma partida em andamento por trás da tela de título? */
    this.hasGame = false;
    this.cableCabin = null;        // [54] cabine em que o jogador está

    // preferências salvas: precisam existir antes da construção do mundo,
    // que já nasce com a quantidade de NPCs do perfil escolhido
    this.settings = new Settings();

    this.gfx = new Graphics(canvas);
    this.col = new CollisionWorld();
    this.col.terrainFn = terrainHeight;

    this.input = new Input(canvas);
    this._tmpV = new THREE.Vector3();
    this._focus = new THREE.Vector3();
    this._aimOrigin = new THREE.Vector3();
    this._aimDir = new THREE.Vector3();
  }

  // ==================================================================
  //  construção do mundo
  // ==================================================================
  async build(onProgress = () => {}) {
    const step = async (label, fn) => {
      onProgress(label);
      await new Promise((r) => setTimeout(r, 0));   // deixa a UI respirar
      fn();
    };

    await step('gerando terreno...', () => {
      this.terrain = new Terrain(this.gfx.scene, this.col);
      this.terrain.build();                                  // [52]
    });

    await step('traçando ruas e calçadas...', () => {
      this.city = new City(this.gfx.scene, this.col);
      this.city.build();                                     // [1][16][19][20][21]
    });

    await step('instalando semáforos...', () => {
      this.traffic = new TrafficSystem(this.gfx.scene, this.col);
      this.traffic.build();                                  // [4]
    });

    await step('plantando árvores e postes...', () => {
      this.props = new Props(this.gfx.scene, this.col);
      this.props.build(this.city);                           // [16][22]
    });

    await step('erguendo o Cristo Redentor...', () => {
      this.landmarks = new Landmarks(this.gfx.scene, this.col);
      this.landmarks.build(this.city);                       // [43][53][54]
    });

    await step('trazendo Floripa, Curitiba e Salvador...', () => {
      this.brasil = new BrazilLandmarks(this.gfx.scene, this.col);
      this.brasil.build();                                   // [57][58][59]
    });

    await step('acendendo o céu...', () => {
      this.sky = new SkySystem(this.gfx);                     // [13][44]
    });

    // já nasce com a quantidade escolhida, para não criar e descartar [61]
    const popSalva = POPULATIONS[this.settings.get('populationIndex')]
      || POPULATIONS[DEFAULT_POPULATION];

    await step('trazendo os moradores...', () => {
      this.peds = new PedestrianSystem(this.gfx.scene, this.col, this.traffic);
      this.peds.spawn(popSalva.peds);                        // [2][18][55]
    });

    await step('liberando o trânsito...', () => {
      this.cars = new CarSystem(this.gfx.scene, this.col, this.traffic);
      this.cars.spawn(popSalva.cars);                        // [3][23]
    });

    await step('preparando o helicóptero...', () => {
      this.heli = new Helicopter(this.gfx.scene, this.col);  // [43]
      const hp = this.landmarks.heliport;
      this.heli.placeAt(hp.x, hp.y + HELI.landHeight, hp.z, 0);
    });

    await step('finalizando...', () => {
      this.fx = new FX(this.gfx.scene);
      this.bullets = new BulletSystem(this.gfx.scene, this.col, this.fx);
      this.bullets.setTargets(this.peds, this.cars);
      this.bullets.onHitPed = (ped) => this._killPed(ped, true);
      this.bullets.onHitCar = (car) => this._killCar(car, true);

      // [63] mísseis: mesmo alvo, mesma consequência, arma diferente
      this.missiles = new MissileSystem(this.gfx.scene, this.col, this.fx);
      this.missiles.setTargets(this.peds, this.cars);
      this.missiles.onHitPed = (ped) => this._killPed(ped, true);
      this.missiles.onHitCar = (car) => this._killCar(car, true);

      this.player = new Player(this.gfx.scene, this.col);
      this.camera = new GameCamera(this.gfx.camera, this.col);

      this.mission = new MissionSystem(this.gfx.scene, this.peds);   // [5][6][7]
      this.hud = new HUD();
      this.minimap = new Minimap($('minimap'), this.city, $('compass-n'));  // [10]
      this.phone = new Phone(this.peds);                                    // [56]

      this._wireUI();
      this._applySettings();
    });
  }

  /** Aplica as preferências salvas na interface e no mundo. */
  _applySettings() {
    this.presetIndex = this.settings.get('presetIndex');
    this.applyPreset(this.presetIndex);
    this.applyPopulation(this.settings.get('populationIndex'));  // [61]
    this.setDayNight(this.settings.get('cycleMode'));         // [13]
    $('timer-enabled').checked = this.settings.get('timerEnabled');   // [8]
  }

  _wireUI() {
    // ---------------------------------------------------- [15] pointer lock
    this.input.onLockChange = (locked) => {
      if (!locked && this.state === 'playing' && !this.phone.open) {
        this.pause();                                        // [48] ESC pausa
      }
    };

    this.canvas.addEventListener('mousedown', () => {
      if (this.state === 'playing' && !this.phone.open) this.input.requestLock();
    });

    // ---------------------------------------------------- teclas de ação
    this.input.onKey = (code) => {
      if (code === 'Escape') {
        if (this.phone.open) { this.phone.close(); return; }
        if (this.state === 'playing') this.pause();
        else if (this.state === 'paused') this.resume();
        // [62] no menu principal com partida em andamento, ESC volta para ela
        else if (this.state === 'title' && this.hasGame) this.resumeFromTitle();
        return;
      }
      if (this.state !== 'playing') return;

      if (code === 'KeyC') { this.phone.toggle(); return; }   // [56]
      if (this.phone.open) return;

      if (code === 'KeyF') this._toggleVehicle();             // [9][43]
      if (code === 'KeyV') this._toggleView();                // [25]
      if (code === 'KeyE') this._shoot();                     // [27]
      if (code === 'KeyT') this._toggleTimer();               // [8]
      if (code === 'KeyG') this.cyclePreset();                // qualidade gráfica
      if (code === 'KeyN') this.cycleDayNight();              // [13] iluminação
      if (code === 'KeyP') this.cyclePopulation();            // [61] movimento na cidade
      if (code === 'KeyM') this.toggleGod();                  // [60] modo Deus
    };

    // ---------------------------------------------------- [13] seletor da abertura
    for (const btn of document.querySelectorAll('#cycle-group .choice')) {
      btn.addEventListener('click', () => this.setDayNight(btn.dataset.cycle));
    }

    // ---------------------------------------------------- [61] movimento na cidade
    for (const btn of document.querySelectorAll('#pop-group .choice')) {
      btn.addEventListener('click', () => this.applyPopulation(Number(btn.dataset.pop)));
    }

    // ---------------------------------------------------- [8] limite de tempo
    $('timer-enabled').addEventListener('change', (e) => {
      this.settings.set('timerEnabled', e.target.checked);
    });

    // ---------------------------------------------------- restaurar padrões
    $('reset-cfg').addEventListener('click', () => {
      this.settings.reset();
      this._applySettings();
    });

    // ---------------------------------------------------- celular
    this.phone.getContext = () => ({
      player: this.player.position,
      pickupNumber: this.mission.pickupNumber,
      deliverNumber: this.mission.deliverNumber,
    });
    this.phone.onOpenChange = (open) => {
      if (open) this.input.releaseLock();
      else if (this.state === 'playing') this.input.requestLock();
    };

    // ---------------------------------------------------- missão
    this.mission.onPickup = (ev) => {
      this.player.setCarrying(true);                          // [50]
      this.hud.setCarrying(true);
      this.hud.toast('PACOTE COLETADO', 'good');
      this.phone.push(ev.ped.number, 'Valeu! Entrega pro contato marcado no mapa. 📦');
      if (this.mission.receiver) {
        this.phone.push(this.mission.receiver.number, 'Oi! Soube que você tem algo pra mim. Tô te esperando!');
      }
    };
    this.mission.onDeliver = (ev) => {
      // pontos e contagem vivem no MissionSystem; aqui só o efeito colateral
      this.player.setCarrying(false);
      this.hud.setCarrying(false);
      this.addTime(ev.timeBonus, '+30s');                     // [7] +30 segundos
      this.hud.toast(`+${ev.points} PONTOS`, 'pts');          // [7] +10 pontos
      this.phone.push(ev.ped.number, 'Chegou! Muito obrigado 🙏');
      if (this.mission.carrier) {
        this.phone.push(this.mission.carrier.number, 'Ei! Tenho outro pacote aqui pra você.');
      }
    };

    // ---------------------------------------------------- botões das telas
    $('start-btn').addEventListener('click', () => this.start());
    $('restart-btn').addEventListener('click', () => this.restart());   // [40]
    $('resume-btn').addEventListener('click', () => this.resume());
    $('quit-btn').addEventListener('click', () => this.toTitle());
    $('resume-title-btn').addEventListener('click', () => this.resumeFromTitle());   // [62]
  }

  // ==================================================================
  //  estados de jogo
  // ==================================================================
  start() {
    this.timerEnabled = $('timer-enabled').checked;           // [8]
    this.timeLeft = GAME.totalTime;
    this.score = 0;
    this.deliveries = 0;
    this.hearts = PLAYER.maxHearts;                           // [33]
    this.invuln = 0;
    this.elapsed = 0;
    this.mode = 'foot';
    this.god = false;
    this.cableCabin = null;
    this.hud.setGod(false);

    this._resetEntities();

    $('title-screen').classList.add('hidden');
    $('over-screen').classList.add('hidden');
    $('pause-screen').classList.add('hidden');
    this.hud.show(true);
    this.hud.reset();
    this.hud.setHearts(this.hearts);
    this.hud.setTimer(this.timeLeft, this.timerEnabled);

    this.state = 'playing';
    this.hasGame = true;
    this.input.enabled = true;
    this.input.requestLock();                                 // [15]
  }

  restart() { this.start(); }                                 // [40]

  /**
   * [62] Volta ao menu principal SEM jogar a partida fora. O mundo continua de pé
   * do jeito que estava; quem quiser retomar usa o botão "voltar ao jogo" (ou
   * ESC). Só `start()` reinicia de verdade.
   */
  toTitle() {
    this.state = 'title';
    this.input.enabled = false;
    this.input.releaseLock();
    this.hud.show(false);
    $('pause-screen').classList.add('hidden');
    $('over-screen').classList.add('hidden');
    $('title-screen').classList.remove('hidden');
    // o botão de retomar só aparece quando há mesmo uma partida atrás da tela
    $('resume-title-btn').classList.toggle('hidden', !this.hasGame);
    $('start-btn').textContent = this.hasGame ? 'COMEÇAR DE NOVO' : 'INICIAR JOGO';
    // a dica "clique em INICIAR JOGO" não faz sentido com a partida rolando
    if (this.hasGame) $('loading-note').textContent = '';
  }

  /** [62] Retoma a partida que ficou parada atrás da tela de título. */
  resumeFromTitle() {
    if (!this.hasGame) return;
    $('title-screen').classList.add('hidden');
    this.hud.show(true);
    this.state = 'playing';
    this.input.enabled = true;
    this.input.requestLock();
  }

  pause() {                                                   // [48]
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.input.releaseLock();
    $('pause-screen').classList.remove('hidden');
  }

  resume() {
    if (this.state !== 'paused') return;
    this.state = 'playing';
    $('pause-screen').classList.add('hidden');
    this.input.requestLock();
  }

  gameOver(reason, win = false) {                             // [35]
    if (this.state === 'over') return;
    this.state = 'over';
    this.hasGame = false;            // acabou: não há mais para onde voltar
    this.input.releaseLock();
    this.hud.show(false);

    $('over-title').textContent = win ? 'MISSÃO CUMPRIDA' : 'FIM DE JOGO';
    $('over-title').classList.toggle('win', win);
    $('over-reason').textContent = reason;
    $('over-score').textContent = this.score;
    $('over-deliveries').textContent = this.deliveries;
    $('over-time').textContent = formatTime(this.elapsed);
    $('over-screen').classList.remove('hidden');
  }

  _resetEntities() {
    // pessoas e carros voltam ao estado inicial, na quantidade escolhida [61]
    const pop = POPULATIONS[this.populationIndex ?? DEFAULT_POPULATION];

    while (this.peds.peds.length) this.peds.remove(this.peds.peds[0], false);
    this.peds.usedNumbers.clear();
    for (let i = 0; i < pop.peds; i++) this.peds.spawnOne();

    while (this.cars.cars.length) this.cars.remove(this.cars.cars[0], false);
    this.cars.spawn(pop.cars);

    const hp = this.landmarks.heliport;
    this.heli.exit();
    this.heli.placeAt(hp.x, hp.y + HELI.landHeight, hp.z, 0);

    this.bullets.reset();
    this.bullets.setTargets(this.peds, this.cars);
    this.missiles.reset();                                    // [63]
    this.missiles.setTargets(this.peds, this.cars);
    this.phone.reset();
    this.mission.start();                                     // [5]

    this.playerCar = null;
    this.player.setVisible(true);
    this.player.setCarrying(false);

    const spawn = this._findPlayerSpawn();                    // [45]
    this.player.teleport(spawn.x, spawn.z);
    this.player.vy = 0;

    this.camera.setMode('foot');
    this.camera.yaw = 0;
    this.camera.pitch = -0.2;
    this.camera.wantDistance = CAMERA.defaultZoom;

    // [13] reiniciar não pode desfazer "sempre dia" / "sempre noite"
    if (this.sky.cycleFrozen) this.sky.setCycleMode(this.sky.cycleMode);
    else this.sky.setHour(DAY.startHour);
  }

  /** [45] Nasce numa calçada livre, nunca dentro de prédio. */
  _findPlayerSpawn() {
    const nodes = this.peds.nodes;
    let best = null, bestD = Infinity;
    for (const n of nodes) {
      if (this.col.isBlocked(n.x, n.z, PLAYER.radius + 0.6, CURB_H + 0.5)) continue;
      const d = n.x * n.x + n.z * n.z;
      if (d < bestD) { bestD = d; best = n; }
    }
    return best || { x: 0, z: 0 };
  }

  // ==================================================================
  //  veículos
  // ==================================================================
  _toggleVehicle() {                                          // [9][43][54]
    if (this.mode === 'foot') {
      const p = this.player.position;

      // helicóptero tem prioridade se estiver bem perto
      const dHeli = dist2D(p.x, p.z, this.heli.root.position.x, this.heli.root.position.z);
      if (dHeli < 6.5) { this._enterHeli(); return; }

      // [54] cabine do bondinho parada na plataforma
      const cabin = this.landmarks.cabinAtPlatform(p.x, p.z, p.y);
      if (cabin) { this._boardCable(cabin); return; }

      const car = this.cars.nearest(p.x, p.z, GAME.vehicleRange + CAR.length * 0.5);
      if (car) this._enterCar(car);
      return;
    }

    if (this.mode === 'car') { this._exitCar(); return; }

    // [54] só desce do bondinho quando a cabine está parada na estação
    if (this.mode === 'cable') {
      if (!this.landmarks.cabinDocked(this.cableCabin)) {
        this.hud.toast('ESPERE A ESTAÇÃO', 'bad');
        return;
      }
      this._leaveCable();
      return;
    }

    // [49] só sai do helicóptero perto do chão
    if (this.mode === 'heli') {
      if (!this.heli.canExit) {
        this.hud.toast('DESÇA PARA SAIR', 'bad');
        return;
      }
      this._exitHeli();
    }
  }

  _enterCar(car) {
    this.cars.takeOver(car);
    this.playerCar = car;
    this.mode = 'car';
    this.player.setVisible(false);
    this.camera.setMode('car-out');                           // [47] padrão terceira pessoa
    // [11] a câmera nasce atrás do carro: como o volante segue o mouse, entrar
    // olhando para outro lado faria o carro dar um tranco para acertar o rumo
    this.camera.yaw = car.yaw + Math.PI;
    this.camera.setInteriorBase(this.camera.yaw);
    car.setInteriorView(false);
    // os tiros saem de dentro do carro: ele não pode ser o próprio alvo
    this.bullets.ignoreCar = car;
    this.hud.showSpeedo(true);                                // [28]
    this.hud.setPrompt(null);
  }

  _exitCar() {
    const car = this.playerCar;
    car.setInteriorView(false);
    this.bullets.ignoreCar = null;
    this.cars.release(car);
    // desce ao lado do carro, num ponto livre
    const side = new THREE.Vector3(Math.cos(car.yaw), 0, -Math.sin(car.yaw)).multiplyScalar(2.2);
    let x = car.root.position.x + side.x, z = car.root.position.z + side.z;
    if (this.col.isBlocked(x, z, PLAYER.radius + 0.2, CURB_H)) {
      x = car.root.position.x - side.x;
      z = car.root.position.z - side.z;
    }
    this.player.teleport(x, z);
    this.player.setVisible(true);
    this.playerCar = null;
    this.mode = 'foot';
    this.camera.setMode('foot');
    this.hud.showSpeedo(false);
  }

  _enterHeli() {
    this.heli.enter();
    this.mode = 'heli';
    this.player.setVisible(false);
    this.camera.setMode('heli-out');                          // [47]
    // mesma ideia do carro: a câmera começa alinhada com o nariz
    this.camera.yaw = this.heli.yaw + Math.PI;
    this.camera.setInteriorBase(this.camera.yaw);
    this.heli.setInteriorView(false);
    this.hud.showHeliPanel(true);
    this.hud.setPrompt(null);
  }

  _exitHeli() {
    this.heli.exit();
    this.heli.setInteriorView(false);
    const door = this.heli.doorPosition(this._tmpV);
    // [46] se pousou numa laje, o jogador desce em cima dela
    const surf = this.heli.surfaceBelow();
    this.player.teleport(door.x, door.z, surf);
    this.player.setVisible(true);
    this.mode = 'foot';
    this.camera.setMode('foot');
    this.hud.showHeliPanel(false);
  }

  /**
   * [54] Embarca no bondinho. O jogador continua VISÍVEL, de pé dentro da
   * cabine: é o que dá a sensação de estar viajando nela, e a faixa de vidro
   * existe justamente para isso.
   */
  _boardCable(cabin) {
    this.cableCabin = cabin;
    cabin.passenger = true;
    // não faz esperar a parada inteira só porque acabou de entrar
    cabin.dwell = Math.min(cabin.dwell, CABLE.boardDwell);
    this.mode = 'cable';
    this.player.setVisible(true);
    this.camera.setMode('cable-out');
    this.hud.setPrompt(null);
    this.hud.toast('BONDINHO', 'good');
  }

  _leaveCable() {
    const cabin = this.cableCabin;
    const saida = this.landmarks.cabinExit(cabin, this._tmpV);
    cabin.passenger = false;
    // dá um tempo de porta aberta para o passageiro sair antes de partir
    cabin.dwell = Math.max(cabin.dwell, 2.5);
    this.cableCabin = null;
    this.mode = 'foot';
    this.player.teleport(saida.x, saida.z, saida.y);
    this.player.setVisible(true);
    this.camera.setMode('foot');
  }

  _toggleView() {                                             // [25]
    if (this.mode === 'car') {
      const next = this.camera.mode === 'car-out' ? 'car-in' : 'car-out';   // [17]
      this.camera.setMode(next);
      this.camera.setInteriorBase(this.camera.yaw);
      if (this.playerCar) this.playerCar.setInteriorView(next === 'car-in');
    } else if (this.mode === 'heli') {
      const next = this.camera.mode === 'heli-out' ? 'heli-in' : 'heli-out';
      this.camera.setMode(next);
      this.camera.setInteriorBase(this.camera.yaw);
      this.heli.setInteriorView(next === 'heli-in');
    }
  }

  _toggleTimer() {                                            // [8]
    this.timerEnabled = !this.timerEnabled;
    // mantém a caixa da abertura e a preferência salva em sincronia
    this.settings.set('timerEnabled', this.timerEnabled);
    $('timer-enabled').checked = this.timerEnabled;
    this.hud.toast(this.timerEnabled ? 'TEMPO ATIVADO' : 'TEMPO DESATIVADO', 'time');
  }

  // ==================================================================
  //  [13] iluminação: ciclo, sempre dia ou sempre noite
  // ==================================================================
  /** Define o modo, sincroniza os botões da abertura e memoriza a escolha. */
  setDayNight(mode) {
    this.sky.setCycleMode(mode);
    this.settings.set('cycleMode', mode);
    for (const btn of document.querySelectorAll('#cycle-group .choice')) {
      btn.classList.toggle('active', btn.dataset.cycle === mode);
    }
    // acende ou apaga a cidade na hora, sem esperar o próximo quadro
    const n = this.sky.nightFactor;
    this.city.setNight(n);
    this.props.update(0, n, this._focus);
    this.cars.setNight(n);
  }

  /** Tecla N: percorre ciclo -> sempre dia -> sempre noite. */
  cycleDayNight() {
    const ordem = ['ciclo', 'dia', 'noite'];
    const i = (ordem.indexOf(this.sky.cycleMode) + 1) % ordem.length;
    this.setDayNight(ordem[i]);
    const nomes = { ciclo: 'CICLO DIA/NOITE', dia: 'SEMPRE DIA', noite: 'SEMPRE NOITE' };
    this.hud.toast(nomes[ordem[i]], 'time');
  }

  // ==================================================================
  //  qualidade gráfica (tecla G)
  // ==================================================================
  /** Passa para o próximo perfil: BAIXA -> MÉDIA -> ALTA -> BAIXA. */
  cyclePreset() {
    this.presetIndex = (this.presetIndex + 1) % PRESETS.length;
    this.applyPreset(this.presetIndex);
    const p = PRESETS[this.presetIndex];
    this.hud.toast('GRÁFICOS: ' + p.label, 'time');
  }

  /**
   * Aplica um perfil. Envolve recriar passes e recompilar shaders, então
   * roda só quando o jogador troca — nunca dentro do laço.
   */
  applyPreset(index) {
    const p = PRESETS[index];
    this.presetIndex = index;
    this.settings.set('presetIndex', index);

    this.gfx.applyPreset(p, this.gfx.scene);
    this.sky.setShadowQuality(p.shadowMapSize, p.shadowRadius);
    this.sky.envUpdateInterval = p.envUpdate;
    this.props.setMaxLights(p.dynamicLights);

    // a névoa fecha um pouco nos perfis baixos: menos geometria distante
    QUALITY.fogFar = p.fogFar;

    this.hud.setPreset(p.label);
  }

  // ==================================================================
  //  [61] movimento na cidade: quanta gente e quantos carros (tecla P)
  // ==================================================================
  /**
   * Quanta gente e quantos carros existem. É um ajuste SEPARADO do perfil
   * gráfico: dá para ter a cidade cheia com a sombra desligada, ou vazia com
   * tudo ligado. A escolha fica salva no navegador.
   */
  applyPopulation(index) {
    const p = POPULATIONS[index] || POPULATIONS[DEFAULT_POPULATION];
    this.populationIndex = POPULATIONS.indexOf(p);
    this.settings.set('populationIndex', this.populationIndex);

    for (const btn of document.querySelectorAll('#pop-group .choice')) {
      btn.classList.toggle('active', Number(btn.dataset.pop) === this.populationIndex);
    }

    this._resizeCrowd(this.peds, p.peds, () => this.peds.spawnOne());
    this._resizeCrowd(this.cars, p.cars, () => this.cars.spawnOne());
    this.bullets.setTargets(this.peds, this.cars);
    this.missiles.setTargets(this.peds, this.cars);           // [63]
    this.mission.validate();
  }

  /** [61] Tecla P: POUCA -> NORMAL -> MOVIMENTADA -> CIDADE CHEIA. */
  cyclePopulation() {
    this.applyPopulation((this.populationIndex + 1) % POPULATIONS.length);
    const p = POPULATIONS[this.populationIndex];
    this.hud.toast(`CIDADE: ${p.label} · ${p.peds} pessoas, ${p.cars} carros`, 'time');
  }

  // ==================================================================
  //  [60] modo Deus (tecla M)
  // ==================================================================
  /**
   * Voo livre pelo mapa. Só vale a pé: dentro de um veículo o jogador já voa
   * ou dirige, e o corpo dele nem está na cena.
   */
  toggleGod() {
    if (this.mode !== 'foot') {
      this.hud.toast('SAIA DO VEÍCULO PRIMEIRO', 'bad');
      return;
    }
    this.god = !this.god;
    this.player.vy = 0;
    this.hud.setGod(this.god);
    this.hud.toast(this.god ? 'MODO DEUS LIGADO' : 'MODO DEUS DESLIGADO',
      this.god ? 'good' : 'time');
  }

  /** Ajusta a população de um sistema para `target`, criando ou removendo. */
  _resizeCrowd(system, target, spawn) {
    const list = system.peds || system.cars;
    while (list.length > target) {
      // nunca remove quem faz parte da missão nem o carro do jogador
      const victim = list.find((e) => e !== this.playerCar
        && !e.hasPackage && !e.isTarget);
      if (!victim) break;
      system.remove(victim, false);
    }
    while (list.length < target) spawn();
  }

  // ==================================================================
  //  combate
  // ==================================================================
  _shoot() {                                                  // [27]
    if (this.mode === 'heli') { this._fireMissile(); return; }  // [63]

    if (!this.bullets.canFire) return;
    const { origin, direction } = this.camera.aimRay(this._aimOrigin, this._aimDir);
    if (this.bullets.fire(origin, direction)) {               // [37][38][41]
      this.hud.recoil();
      this.camera.addShake(0.16);
    }
  }

  /**
   * [63] Salva de mísseis do helicóptero.
   *
   * O míssil não sai da câmera, e sim do trilho embaixo do aparelho — sair de
   * trás dele, como faz a bala, ficaria estranho na visão externa. Para que
   * ele ainda acerte onde a mira aponta, o alvo é resolvido ANTES: traça-se o
   * raio da mira, pega-se o ponto em que ele encosta (ou 500 m à frente, se
   * não encostar em nada) e o míssil é apontado do trilho para lá.
   */
  _fireMissile() {
    if (!this.missiles.canFire) return;
    const { origin, direction } = this.camera.aimRay(this._aimOrigin, this._aimDir);

    const hit = this.bullets._trace(origin, direction, 500);
    const alvo = hit
      ? hit.point.clone()
      : origin.clone().addScaledVector(direction, 500);

    this._missileSide = -(this._missileSide || 1);
    const boca = this.heli.hardpoint(this._missileSide, this._tmpV);
    const rumo = alvo.sub(boca).normalize();

    if (this.missiles.fire(boca, rumo)) {
      this.hud.recoil();
      this.camera.addShake(0.22);
    }
  }

  /** [24][27] Pessoa explode. */
  _killPed(ped, byBullet) {
    if (!ped || !ped.alive) return;
    const p = ped.human.root.position;
    this.fx.explode(new THREE.Vector3(p.x, p.y + 0.9, p.z), 1.0);
    this.camera.addShake(byBullet ? 0.3 : 0.5);
    this.peds.remove(ped, true);                              // [29] repõe outra
    this.addTime(GAME.killTimeBonus, '+5s');                  // [32]
    this.hud.hitMarker();
    this.mission.validate();
  }

  /** [26][27] Carro explode. */
  _killCar(car, byBullet) {
    if (!car || !car.alive) return;
    if (car === this.playerCar) return;
    const p = car.root.position;
    this.fx.explode(new THREE.Vector3(p.x, p.y + 0.8, p.z), 1.9);
    this.camera.addShake(byBullet ? 0.4 : 0.7);
    this.cars.remove(car, true);                              // [29] repõe outro
    this.addTime(GAME.killTimeBonus, '+5s');                  // [32]
    this.hud.hitMarker();
  }

  addTime(sec, label) {
    this.timeLeft = Math.min(GAME.totalTime * 2, this.timeLeft + sec);
    if (label) this.hud.toast(label, 'time');
  }

  /** [34] Jogador atropelado perde um coração. */
  _damagePlayer(reason) {
    if (this.invuln > 0) return;
    this.invuln = PLAYER.invulnTime;
    this.hearts--;                                            // [34]
    this.hud.setHearts(Math.max(0, this.hearts));
    this.hud.damageFlash();
    this.camera.addShake(0.8);

    if (this.hearts <= 0) {                                   // [35]
      this.fx.explode(this.player.position.clone().setY(this.player.position.y + 0.9), 1.4);
      this.player.setVisible(false);
      this.gameOver('Você ficou sem corações. ' + reason);
    } else {
      this.hud.toast('-1 ❤', 'bad');
    }
  }

  // ==================================================================
  //  loop
  // ==================================================================
  update(dt) {
    this.hud.tickFPS(dt);
    if (this.state === 'playing') this._updatePlaying(dt);
    else if (this.state === 'title') this._updateTitle(dt);
    else {
      // pausado ou fim de jogo: mundo congelado, cena continua desenhada
      this.sky.setPaused(true);
    }
    this.input.endFrame();
  }

  /** [39] Tela de abertura com a cidade viva girando ao fundo. */
  _updateTitle(dt) {
    this._titleT = (this._titleT || 0.6) + dt * 0.045;
    const r = 330, h = 150;
    this.gfx.camera.position.set(
      Math.cos(this._titleT) * r,
      h + Math.sin(this._titleT * 0.7) * 30,
      Math.sin(this._titleT) * r,
    );
    this.gfx.camera.lookAt(0, 30, 0);
    this._focus.set(0, 0, 0);

    const night = this.sky.nightFactor;
    this.sky.setPaused(false);
    this.sky.update(dt, this._focus);
    this.city.setNight(night);
    this.props.update(dt, night, this._focus);
    this.landmarks.update(dt, night);
    this.terrain.update(dt);
    this.traffic.update(dt, night);
    this.peds.update(dt);
    this.cars.setNight(night);
    this.cars.update(dt, null);
    this.heli.update(dt, this._heliInput(true), night);
    this.fx.update(dt);
  }

  _updatePlaying(dt) {
    this.elapsed += dt;
    this.invuln = Math.max(0, this.invuln - dt);
    this.sky.setPaused(false);

    // ------------------------------------------------ olhar e zoom
    if (!this.phone.open) {
      const m = this.input.consumeMouse();
      this.camera.look(m.dx, m.dy);                           // [11]
      this.camera.zoom(this.input.consumeWheel());            // [12]
      // o clique que captura o ponteiro não deve virar tiro
      const clicked = this.input.consumeClick();
      if (clicked && this.input.locked) this._shoot();        // [27]
    } else {
      this.input.consumeMouse();
      this.input.consumeWheel();
      this.input.consumeClick();
    }

    const blocked = this.phone.open;

    // ------------------------------------------------ jogador / veículos
    if (this.mode === 'foot') {
      const inp = blocked ? EMPTY_INPUT : this.input;
      if (this.god) this.player.updateFly(dt, inp, this.camera.yaw);
      else this.player.update(dt, inp, this.camera.yaw);
      this.player.focusPoint(this._focus);
    } else if (this.mode === 'cable') {
      // [54] o corpo olha para onde a câmera aponta; a POSIÇÃO é acertada
      // depois que a cabine anda, mais abaixo
      this.player.yaw = dampAngle(this.player.yaw, this.camera.yaw + Math.PI, PLAYER.turnSmooth, dt);
      this.player.human.update(dt, 0);
    } else if (this.mode === 'car') {
      this._updatePlayerCar(dt, blocked);
      const p = this.playerCar.root.position;
      this._focus.set(p.x, p.y + 1.5, p.z);
      this.player.human.update(dt, 0);
    } else {
      this._updateHeliControls(dt, blocked);
      const p = this.heli.root.position;
      this._focus.set(p.x, p.y + 1.2, p.z);
    }

    // ------------------------------------------------ mundo
    const night = this.sky.nightFactor;
    this.sky.update(dt, this._focus);                         // [13]
    this.city.setNight(night);                                // [20] janelas acesas
    this.props.update(dt, night, this._focus);                // [22]
    this.landmarks.update(dt, night);                         // [53][54]
    this.brasil.update(dt, night);                            // [57][58][59]

    /*
     * [54] A cabine acabou de se mover: o passageiro acompanha no MESMO
     * quadro. Fazer isso lá em cima, junto do resto do jogador, deixaria ele
     * um quadro atrás e a cabine pareceria escorregar por baixo dos pés.
     */
    if (this.mode === 'cable' && this.cableCabin) {
      this.landmarks.cabinSeat(this.cableCabin, this._tmpV);
      this.player.teleport(this._tmpV.x, this._tmpV.z, this._tmpV.y);
      this.player.human.root.rotation.y = this.player.yaw;
      this.player.focusPoint(this._focus);
    }
    this.terrain.update(dt);
    this.traffic.update(dt, night);                           // [4]
    this.peds.update(dt);                                     // [2]
    this.cars.setNight(night);
    this.cars.update(dt, this.playerCar);                     // [3]
    this.heli.update(dt, this._heliInput(blocked), night);    // [43]

    this.bullets.update(dt);                                  // [38][41]
    this.missiles.update(dt);                                 // [63]
    this.fx.update(dt);

    // ------------------------------------------------ interações
    this._checkVehicleImpacts(dt);
    this._checkPlayerHit();
    this._updateMission(dt);
    this._updateTimer(dt);

    // ------------------------------------------------ câmera
    this.camera.update(dt, this._focus, this._interiorTransform());

    // ------------------------------------------------ HUD
    this._updateHUD(dt);
  }

  // ------------------------------------------------------------------ carro do jogador
  _updatePlayerCar(dt, blocked) {
    const car = this.playerCar;
    const ax = blocked ? { forward: 0, strafe: 0 } : this.input.axes;

    // aceleração / freio / ré
    if (ax.forward > 0) {
      car.speed += CAR.playerAccel * ax.forward * dt;
    } else if (ax.forward < 0) {
      car.speed -= (car.speed > 0.5 ? CAR.playerBrake : CAR.playerAccel * 0.55) * dt;
    } else {
      car.speed *= Math.exp(-CAR.drag * dt);
    }
    car.speed = clamp(car.speed, -CAR.reverseSpeed, CAR.maxSpeed);   // [28] até 120 km/h

    /*
     * [11] Direção pelo mouse: o carro busca o rumo para onde a câmera aponta.
     * A/D continuam valendo como ajuste fino.
     *
     * Só vale na câmera externa. Na visão interna o mouse serve para olhar
     * dentro da cabine — se ele também esterçasse, olhar para o lado viraria
     * o carro e o carro viraria o olhar, num laço sem fim.
     */
    const externa = this.camera.mode !== 'car-in';
    let steer = -ax.strafe;                            // manual: D vira à direita
    if (externa) {
      const alvo = this.camera.yaw + Math.PI;          // rumo = frente da câmera
      steer += clamp(angleDelta(car.yaw, alvo) * 1.8, -1, 1);
    }
    steer = clamp(steer, -1, 1);

    // esterço proporcional à velocidade (parado não vira)
    const grip = clamp(Math.abs(car.speed) / 7, 0, 1);
    car._steer = damp(car._steer, steer * 0.52, 9, dt);
    car.yaw += steer * CAR.steerRate * grip * dt;

    const fx = Math.sin(car.yaw), fz = Math.cos(car.yaw);
    const p = car.root.position;
    p.x += fx * car.speed * dt;
    p.z += fz * car.speed * dt;

    // [31] bate em prédio/poste/árvore: o carro para
    const hitX = p.x, hitZ = p.z;
    if (this.col.resolveCircle(p, 1.75)) {
      const impact = Math.abs(car.speed);
      if (impact > 9) {
        this.camera.addShake(clamp(impact / 26, 0, 0.7));
        this.fx.impact(
          new THREE.Vector3(hitX, p.y + 0.7, hitZ),
          new THREE.Vector3(-fx, 0.3, -fz),
        );
      }
      car.speed *= -0.16;
    }

    // acompanha o piso (rua, calçada, ponte — [52])
    const g = this.col.groundHeightAt(p.x, p.z, p.y);
    p.y = damp(p.y, g, 11, dt);

    car.syncTransform();
    car.spinWheels(dt);                 // já reposiciona as rodas (esterço + giro)
    car.setLightsOn(true, this.sky.nightFactor > 0.35);
  }

  _heliInput(blocked) {
    if (this.mode !== 'heli' || blocked) {
      return { forward: 0, strafe: 0, up: 0, down: 0, yawLeft: 0, yawRight: 0 };
    }
    const ax = this.input.axes;
    return {
      forward: ax.forward,
      strafe: ax.strafe,
      up: this.input.down('Space') ? 1 : 0,
      down: (this.input.down('ShiftLeft') || this.input.down('ControlLeft')) ? 1 : 0,
      yawLeft: this.input.down('KeyQ') ? 1 : 0,
      yawRight: this.input.down('KeyR') ? 1 : 0,
      // [11] na câmera externa o nariz segue o mouse; na interna, não
      desiredYaw: this.camera.mode === 'heli-in' ? null : this.camera.yaw + Math.PI,
    };
  }

  _updateHeliControls(dt, blocked) {
    // o helicóptero é atualizado no bloco de mundo; aqui só a poeira do pouso
    if (!blocked && this.heli.altitude < 3 && this.heli.piloted && Math.random() < 0.35) {
      const p = this.heli.root.position;
      this.fx.dust(new THREE.Vector3(p.x, this.heli.surfaceBelow(), p.z), 2, 3.4);
    }
  }

  /** Posição da câmera quando a visão é interna. [17][25] */
  _interiorTransform() {
    if (this.mode === 'car' && this.camera.mode === 'car-in' && this.playerCar) {
      const car = this.playerCar;
      car.root.updateMatrixWorld();
      // altura dos olhos do motorista, à frente do banco e atrás do painel
      const v = this._tmpV.set(-0.38, 1.30, 0.10);
      car.root.localToWorld(v);
      return { position: v, yaw: car.yaw, roll: 0 };
    }
    if (this.mode === 'heli' && this.camera.mode === 'heli-in') {
      this.heli.root.updateMatrixWorld();
      const v = this._tmpV.set(0, 2.0, 1.05);
      this.heli.root.localToWorld(v);
      return { position: v, yaw: this.heli.yaw, roll: this.heli.roll };
    }
    return null;
  }

  // ------------------------------------------------------------------ colisões de jogo
  _checkVehicleImpacts() {
    if (this.mode !== 'car' || !this.playerCar) return;
    const car = this.playerCar;
    const p = car.root.position;
    const speed = Math.abs(car.speed);

    // [24] atropelamento: a pessoa explode
    if (speed > 3.5) {
      for (const ped of this.peds.within(p.x, p.z, 2.6)) {
        ped.human.setPose('panic');
        this._killPed(ped, false);
        car.speed *= 0.82;
        this.hud.toast('ATROPELOU!', 'bad');
      }
    }

    // [26] bateu em outro carro: o outro explode
    for (const other of this.cars.within(p.x, p.z, 3.6)) {
      if (other === car) continue;
      const rel = Math.abs(car.speed - other.speed);
      if (speed > 5 || rel > 6) {
        this._killCar(other, false);
        car.speed *= 0.45;
        this.hud.toast('BATIDA!', 'bad');
      }
    }
  }

  /** [34] A pé, ser atropelado custa um coração. */
  _checkPlayerHit() {
    if (this.mode !== 'foot' || this.invuln > 0 || this.hearts <= 0) return;
    const p = this.player.position;
    for (const car of this.cars.within(p.x, p.z, 2.4)) {
      if (Math.abs(car.speed) < 3) continue;
      const dy = Math.abs(car.root.position.y - p.y);
      if (dy > 3) continue;
      this._damagePlayer('Atropelado na rua.');
      this.camera.addShake(1.0);
      return;
    }
  }

  _updateMission(dt) {
    // [51] voando: a coleta/entrega vale de mais longe. O modo Deus e o
    // bondinho contam como voo pelo mesmo motivo — o alvo está lá embaixo.
    const flying = this.mode === 'heli' || this.mode === 'cable' || this.god;
    const pos = this.mode === 'car' ? this.playerCar.root.position
      : this.mode === 'heli' ? this.heli.root.position
      : this.player.position;

    const ev = this.mission.update(dt, pos, flying);
    this.score = this.mission.score;
    this.deliveries = this.mission.deliveries;

    const target = this.mission.target;
    const dist = ev && ev.distance != null
      ? ev.distance
      : (target && target.alive ? dist2D(pos.x, pos.z, target.human.root.position.x, target.human.root.position.z) : null);

    const collect = this.mission.state === 'collect';
    this.hud.setObjective(
      collect ? 'collect' : 'deliver',
      collect
        ? `Encontre o cidadão #${target ? target.number : '???'}`
        : `Entregue ao cidadão #${target ? target.number : '???'}`,
      dist,
    );
  }

  _updateTimer(dt) {
    if (!this.timerEnabled) {                                  // [8] pode ser desativado
      this.hud.setTimer(0, false);
      return;
    }
    this.timeLeft -= dt;
    this.hud.setTimer(this.timeLeft, true);
    if (this.timeLeft <= 0) {
      this.timeLeft = 0;
      this.gameOver('O tempo acabou.');
    }
  }

  // ------------------------------------------------------------------ HUD
  _updateHUD(dt) {
    this.hud.setScore(this.score);
    this.hud.setDeliveries(this.deliveries);
    this.hud.setClock(this.sky.clockText, this.sky.isNight);   // [13]

    // ---- [28] velocímetro
    if (this.mode === 'car' && this.playerCar) {
      this.hud.setSpeed(this.playerCar.speed, dt);
    } else if (this.mode === 'heli') {
      const v = this.heli.vel;
      this.hud.setHeli(
        this.heli.altitude,
        Math.hypot(v.x, v.z) * 3.6,
        !this.heli.canExit,                                    // [49]
      );
    }

    // ---- [10] minimapa girando com o jogador
    const view = this.mode === 'car'
      ? { x: this.playerCar.root.position.x, z: this.playerCar.root.position.z, yaw: this.playerCar.yaw }
      : this.mode === 'heli'
        ? { x: this.heli.root.position.x, z: this.heli.root.position.z, yaw: this.heli.yaw }
        : { x: this.player.position.x, z: this.player.position.z, yaw: this.player.yaw };

    const tPos = this.mission.targetPosition;
    this.minimap.draw(dt, view, {
      pickup: this.mission.state === 'collect' && tPos ? tPos : null,
      deliver: this.mission.state === 'deliver' && tPos ? tPos : null,
      heli: this.mode === 'foot' ? this.heli.root.position : null,
    }, { peds: this.peds, cars: this.cars });

    // ---- dicas contextuais [9][43]
    if (!this.phone.open) this._updatePrompt();

    // ---- mira só faz sentido quando dá para atirar
    this.hud.setCrosshairVisible(true);
    this._updateAimFeedback();
  }

  _updatePrompt() {
    if (this.mode === 'foot') {
      if (this.god) {
        this.hud.setPrompt('MODO DEUS · <kbd>Espaço</kbd> subir · <kbd>Shift</kbd> descer'
          + ' · <kbd>Ctrl</kbd> turbo · <kbd>M</kbd> sair');
        return;
      }
      const p = this.player.position;
      const dHeli = dist2D(p.x, p.z, this.heli.root.position.x, this.heli.root.position.z);
      if (dHeli < 6.5) {
        this.hud.setPrompt('<kbd>F</kbd> pilotar o helicóptero');
        return;
      }
      if (this.landmarks.cabinAtPlatform(p.x, p.z, p.y)) {      // [54]
        this.hud.setPrompt('<kbd>F</kbd> entrar no bondinho');
        return;
      }
      const car = this.cars.nearest(p.x, p.z, GAME.vehicleRange + CAR.length * 0.5);
      if (car) {
        this.hud.setPrompt('<kbd>F</kbd> entrar no carro');
        return;
      }
      this.hud.setPrompt(null);
    } else if (this.mode === 'cable') {                         // [54]
      this.hud.setPrompt(this.landmarks.cabinDocked(this.cableCabin)
        ? '<kbd>F</kbd> descer na estação'
        : 'A caminho da próxima estação...');
    } else if (this.mode === 'car') {
      this.hud.setPrompt('<kbd>F</kbd> sair &nbsp;·&nbsp; <kbd>V</kbd> visão interna');
    } else {
      this.hud.setPrompt(this.heli.canExit
        ? '<kbd>F</kbd> descer &nbsp;·&nbsp; <kbd>V</kbd> visão interna'
        : '<kbd>Shift</kbd> descer &nbsp;·&nbsp; <kbd>Espaço</kbd> subir');
    }
  }

  /** [37] Realça a mira quando ela está sobre uma pessoa ou carro. */
  _updateAimFeedback() {
    const { origin, direction } = this.camera.aimRay(this._aimOrigin, this._aimDir);
    const hit = this.bullets._trace(origin, direction, 220);
    this.hud.setOnTarget(!!hit && (hit.kind === 'ped' || hit.kind === 'car'));
  }

  render() {
    this.gfx.render();
  }
}

const EMPTY_INPUT = {
  axes: { forward: 0, strafe: 0 },
  running: false,
  boosting: false,
  jumping: false,
  down: () => false,
};
