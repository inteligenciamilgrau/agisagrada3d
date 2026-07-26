import * as THREE from 'three';
import {
  PLAYER, CAMERA, CAR, HELI, GAME, DAY, CURB_H, QUALITY,
  PRESETS, DEFAULT_PRESET, POPULATIONS, DEFAULT_POPULATION, CABLE,
  RENDER_DISTANCES, DEFAULT_RENDER_DISTANCE,
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
import { IMGBuildings } from './world/imgbuildings.js';
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
import { Keybinds } from './keys.js';
import { KeysScreen } from './ui/keysscreen.js';
import { TouchControls, ehToque } from './ui/touch.js';

// ---- campanha: Bob em Busca da AGI Sagrada
import { carregarCampanha, salvarCampanha, zerarCampanha, proximaFase } from './story/story.js';
import { Dialogue } from './ui/dialogue.js';
import { PlanScreen } from './ui/plan.js';
import { PortalSystem } from './sys/portal.js';
import { StageRunner } from './sys/stage.js';
import { ViewModel } from './ent/viewmodel.js';
import { CityBoss } from './ent/cityboss.js';
import { Canetadas } from './sys/canetadas.js';
import { HomingMissiles } from './sys/homing.js';
import { Fireballs } from './sys/fireballs.js';
import { Drops } from './sys/drops.js';
import { CHEFES } from './ent/foe.js';
import { Audio } from './sys/audio.js';
import { Music } from './sys/music.js';

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
    this._padroesDeCelular();

    /** O aparelho é de toque, e o jogador não mandou o contrário? */
    this.toque = false;

    this.gfx = new Graphics(canvas);
    this.col = new CollisionWorld();
    this.col.terrainFn = terrainHeight;

    this.binds = new Keybinds(this.settings);
    this.input = new Input(canvas, this.binds);

    /*
     * ---- campanha da AGI Sagrada ----
     * `emFase` guarda a fase em andamento (ou null no mundo aberto). É a
     * chave que decide quase tudo: dentro de uma fase o jogador não pode
     * entrar em carro, a missão de entrega para e a cidade não conta.
     */
    this.campanha = carregarCampanha();
    this.emFase = null;
    this.voltaMundo = null;      // para onde devolver o jogador ao sair
    this.dialogue = new Dialogue();
    this.plan = new PlanScreen(this.campanha);
    this.audio = new Audio();
    this.music = new Music(this.audio);
    this.dialogue.onLetra = () => this.audio.blip();

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

    await step('erguendo o Estúdio e o Labs IMG...', () => {
      this.imgBuildings = new IMGBuildings(this.gfx.scene, this.col);
      this.imgBuildings.build(this.city);
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
      this.bullets.onHitFoe = (foe, ponto) => this._acertarFoe(foe, ponto);

      // [63] mísseis: mesmo alvo, mesma consequência, arma diferente
      this.missiles = new MissileSystem(this.gfx.scene, this.col, this.fx);
      this.missiles.setTargets(this.peds, this.cars);
      this.missiles.onHitPed = (ped) => this._killPed(ped, true);
      this.missiles.onHitCar = (car) => this._killCar(car, true);

      this.player = new Player(this.gfx.scene, this.col);
      this.camera = new GameCamera(this.gfx.camera, this.col);

      // [36] barulho do pulo e peso da aterrissagem
      this.player.onPulo = () => this.audio.pulo();
      this.player.onPousar = (forca) => {
        this.audio.aterrissar(forca);
        if (forca > 0.6) this.camera.addShake(forca * 0.3);
      };

      this.mission = new MissionSystem(this.gfx.scene, this.peds);   // [5][6][7]
      this.hud = new HUD();
      this.minimap = new Minimap($('minimap'), this.city, $('compass-n'));  // [10]
      this.phone = new Phone(this.peds);                                    // [56]
      this.keys = new KeysScreen(this.binds);        // tela de config de teclas
      this.touch = new TouchControls(this.input);    // analógico e botões na tela

      this._wireUI();
      this._applySettings();
    });

    // ---- campanha: arenas e portais.
    // Vem por último porque o portal precisa do mundo de colisão pronto
    // para descobrir a altura do chão em cada marco.
    await step('marcando os portais da AGI Sagrada...', () => {
      this.portais = new PortalSystem(this.gfx.scene, this.col, this.campanha);
      // a arma na tela (só aparece dentro das fases)
      this.viewmodel = new ViewModel(this.gfx.camera, this.gfx.scene);
      // decretos voadores do Trunfo colossal
      this.canetadas = new Canetadas(this.gfx.scene, this.fx);
      // bolas de fogo: o tiro dos inimigos, proporcional a cada um
      this.bolas = new Fireballs(this.gfx.scene, this.fx);
      // itens que caem de quem você derruba
      this.drops = new Drops(this.gfx.scene, this.fx);
      // arma pesada de recarga longa: trava no alvo e persegue
      this.teleguiado = new HomingMissiles(this.gfx.scene, this.fx, 11);
      this.teleguiado.onAcerto = (foe, ponto) => this._acertarFoe(foe, ponto, 120, true);

      /*
       * O runner vem ANTES de qualquer callback que fale com ele.
       * As dependências entram pelo construtor em vez de serem
       * penduradas depois — assim é impossível repetir a inversão de
       * ordem que quebrava o boot aqui.
       */
      this.stage = new StageRunner({
        scene: this.gfx.scene,
        dialogue: this.dialogue,
        fx: this.fx,
        onFim: (fase) => this._vencerFase(fase),
        onChefeAberto: (fase) => this._soltarChefeNaCidade(fase),
        onBola: (dono, b) => this._inimigoAtira(dono, b),
        // chefão caiu: o que já estava no ar cai junto
        onLimparTiros: () => { this.bolas.limpar(); this.canetadas.limpar(); },
      });

      // míssil é a única arma que arranha o colosso
      this.missiles.setFoes(null);
      this.missiles.onHitFoe = (foe, ponto) => this._acertarFoe(foe, ponto, 55, true);

      // bicada do Loro: dano de verdade, um pouco maior que o do tiro
      this.player.loro.onAcerto = (foe) => {
        this._acertarFoe(foe, null, 22);
        this.audio.companheiro();
        this.hud.toast('LORO!', 'good');
      };
      // ferrão do Saci-Bot: teleporta e crava, então bate mais forte
      this.player.saci.onAcerto = (foe) => {
        this._acertarFoe(foe, null, 30);
        this.audio.companheiro();
        this.hud.toast('SACI-BOT!', 'good');
      };
      this._atualizarCompanheiros();
    });
  }

  /**
   * Estreando num celular: começa leve.
   *
   * MÉDIA com a cidade movimentada é o padrão certo num PC e é um
   * slideshow num aparelho de bolso — e quem abre o jogo no ônibus não
   * vai adivinhar que precisa entrar nas opções antes de julgar. Só vale
   * na PRIMEIRA vez: escolha feita é escolha respeitada.
   */
  _padroesDeCelular() {
    if (!this.settings.novo || !ehToque()) return;
    this.settings.set('presetIndex', 0);            // BAIXA
    this.settings.set('populationIndex', 0);        // POUCA
    this.settings.set('renderDistanceIndex', 0);    // CURTA
  }

  /** Aplica as preferências salvas na interface e no mundo. */
  _applySettings() {
    this.presetIndex = this.settings.get('presetIndex');
    this.applyPreset(this.presetIndex);
    this.applyRenderDistance(this.settings.get('renderDistanceIndex'));
    this.applyVolume(this.settings.get('volEfeitos'), this.settings.get('volMusica'));
    this.applyPopulation(this.settings.get('populationIndex'));  // [61]
    this.setDayNight(this.settings.get('cycleMode'));         // [13]
    this.applyToque(this.settings.get('toque'));
    $('timer-enabled').checked = this.settings.get('timerEnabled');   // [8]
  }

  /**
   * Liga ou desliga os controles na tela.
   *
   * @param {'auto'|'on'|'off'} modo
   */
  applyToque(modo) {
    const m = ['auto', 'on', 'off'].includes(modo) ? modo : 'auto';
    this.settings.set('toque', m);
    this.toque = m === 'on' || (m === 'auto' && ehToque());

    for (const btn of document.querySelectorAll('#toque-group .choice')) {
      btn.classList.toggle('active', btn.dataset.toque === m);
    }
    if (this.touch) this.touch.ativar(this.toque);
    this._atualizarRotulos();

    // com o dedo não há ponteiro para prender [15]
    if (this.toque) this.input.releaseLock();
  }

  /**
   * Reescreve toda dica que cita uma tecla.
   *
   * São textos espalhados pelo HTML — a fala da cutscene, o painel do
   * helicóptero, o medidor do míssil, o rodapé do celular. Ficavam
   * cravados em F, X e C, o que virou mentira duas vezes: quando o
   * jogador remapeia, e quando ele está num celular, onde não existe
   * tecla nenhuma. Um lugar só reescreve todos.
   */
  _atualizarRotulos() {
    const t = (id) => this._tecla(id);

    $('dlg-hint').innerHTML = this.toque
      ? 'toque na tela para continuar'
      : `${t('pular')} continuar · ${t('acao')} pular a cena`;

    $('mg-label').innerHTML = `MÍSSIL ${t('missil')}`;
    $('heli-arm-key').innerHTML = this.toque ? 'ATIRAR' : `${this.binds.rotulo('atirar')} / clique`;
    $('plan-close').textContent = this.toque ? 'FECHAR' : `FECHAR (${this.binds.rotulo('acao')})`;
    $('phone-tip').textContent = this.toque
      ? 'toque fora do aparelho para fechar'
      : `${this.binds.rotulo('celular')} ou ESC para fechar`;
  }

  _wireUI() {
    // ---------------------------------------------------- [15] pointer lock
    /*
     * [48] Soltar o ponteiro leva ao MENU, não a uma tela de pausa.
     *
     * O ESC do navegador libera o cursor sozinho — não dá para
     * interceptar. Então esse é o mesmo evento do "pausar": em vez de
     * uma tela intermediária dizendo PAUSADO, cai direto na abertura,
     * que já tem VOLTAR AO JOGO, as opções e o Plano à mão. Uma tela a
     * menos no caminho de quem só queria mexer numa configuração.
     */
    this.input.onLockChange = (locked) => {
      if (!locked && this.state === 'playing' && !this.phone.open) {
        this.toTitle();
      }
    };

    this.canvas.addEventListener('mousedown', () => {
      if (this.toque) return;               // no celular não há ponteiro para prender
      if (this.state === 'playing' && !this.phone.open) this.input.requestLock();
    });

    // ---------------------------------------------------- ações (teclado e toque)
    /*
     * Chega AÇÃO, não tecla: 'acao', 'atirar', 'pular'. Quem traduziu foi
     * o `Keybinds` — e é por isso que o mesmo bloco atende o teclado
     * remapeado e os botões da tela sem uma linha a mais.
     */
    this.input.onAcao = (a) => {
      if (a === 'menu') {
        // ESC é do MENU, sempre. A cutscene tem teclas próprias
        // (Espaço avança, F pula) para nunca disputar com a pausa.
        if (this.keys.aberto) { this.keys.fechar(); return; }
        if (this._opcoesAbertas) { this._abrirOpcoes(false); return; }
        if (this.plan.aberto) { this.plan.fechar(); return; }
        if (this.phone.open) { this.phone.close(); return; }
        if (this.state === 'playing') this.toTitle();
        // [62] no menu principal com partida em andamento, ESC volta para ela
        else if (this.state === 'title' && this.hasGame) this.resumeFromTitle();
        return;
      }
      if (this.state !== 'playing') return;

      /*
       * ---- teclas da cutscene ----
       * Espaço avança (e revela a linha inteira no primeiro toque),
       * F pula a cena toda.
       *
       * O `return` no fim é o que deixa reaproveitar o F: durante a
       * fala ele pula o diálogo e a função sai ali mesmo, então nunca
       * chega no F de entrar em veículo ou em fase. Uma tecla, dois
       * papéis, sem ambiguidade — porque os dois contextos jamais
       * coexistem.
       *
       * ESC fica FORA disso de propósito: ele já é a pausa do jogo, e
       * disputar a mesma tecla faria o jogador pausar quando quisesse
       * pular — ou pular quando quisesse pausar.
       */
      if (this.dialogue.ativo) {
        if (a === 'pular') this.dialogue.avancar();
        else if (a === 'acao') this.dialogue.pular();
        return;
      }

      if (a === 'plano') { this.plan.alternar(); return; }    // o Plano da AGI
      // com o Plano aberto, a tecla de ação fecha também: é a que a mão já
      // está usando para tudo (entrar em fase, pular fala), então fechar com
      // ela é o reflexo — e nada mais responde enquanto o quadro está na tela
      if (this.plan.aberto) {
        if (a === 'acao') this.plan.fechar();
        return;
      }

      if (a === 'celular') { this.phone.toggle(); return; }   // [56]
      if (this.phone.open) return;

      // a ação entra na fase quando há portal por perto; senão é o veículo [9]
      if (a === 'acao' && this.mode === 'foot') {
        if (this.emFase) { this._sairDaFase(false); return; }
        const p = this.portais && this.portais.disponivel;
        if (p) { this._entrarNaFase(p.fase); return; }
      }
      if (a === 'acao') this._toggleVehicle();                // [9][43]
      if (a === 'visao') this._toggleView();                  // [25]
      if (a === 'atirar') this._shoot();                      // [27]
      if (a === 'tempo') this._toggleTimer();                 // [8]
      if (a === 'graficos') this.cyclePreset();               // qualidade gráfica
      if (a === 'luz') this.cycleDayNight();                  // [13] iluminação
      if (a === 'gente') this.cyclePopulation();              // [61] movimento na cidade
      if (a === 'missil') this._dispararTeleguiado();         // míssil teleguiado
      if (a === 'som') this.toggleMudo();                     // mudo geral
      if (a === 'alcance') this.cycleRenderDistance();        // alcance de renderização
      if (a === 'deus') this.toggleGod();                     // [60] modo Deus
    };

    // ---------------------------------------------------- cutscene no toque
    /*
     * Sem teclado, a fala avança tocando em QUALQUER lugar da tela — e o
     * botão de pular fica num canto, longe do polegar que avança, para
     * ninguém queimar a cena sem querer.
     */
    $('dialogue').addEventListener('pointerdown', () => {
      if (this.toque && this.dialogue.ativo) this.dialogue.avancar();
    });
    $('dlg-skip').addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      if (this.dialogue.ativo) this.dialogue.pular();
    });

    // ---------------------------------------------------- [13] seletor da abertura
    for (const btn of document.querySelectorAll('#cycle-group .choice')) {
      btn.addEventListener('click', () => this.setDayNight(btn.dataset.cycle));
    }

    // ---------------------------------------------------- [61] movimento na cidade
    // sliders de volume: efeitos e música em canais separados
    $('vol-efeitos').addEventListener('input', (e) => {
      this.audio.acordar();
      this.applyVolume(Number(e.target.value), null);
    });
    $('vol-musica').addEventListener('input', (e) => {
      this.audio.acordar();
      this.applyVolume(null, Number(e.target.value));
    });

    for (const btn of document.querySelectorAll('#pop-group .choice')) {
      btn.addEventListener('click', () => this.applyPopulation(Number(btn.dataset.pop)));
    }

    /*
     * Qualidade, alcance e controles de toque também viram botão.
     *
     * As teclas G e L continuam valendo, mas no celular não existe
     * teclado: um ajuste que só se alcança por atalho é um ajuste que
     * metade dos jogadores nunca vai ter.
     */
    for (const btn of document.querySelectorAll('#qual-group .choice')) {
      btn.addEventListener('click', () => this.applyPreset(Number(btn.dataset.qual)));
    }
    for (const btn of document.querySelectorAll('#dist-group .choice')) {
      btn.addEventListener('click', () => this.applyRenderDistance(Number(btn.dataset.dist)));
    }
    for (const btn of document.querySelectorAll('#toque-group .choice')) {
      btn.addEventListener('click', () => this.applyToque(btn.dataset.toque));
    }

    // ---------------------------------------------------- [8] limite de tempo
    $('timer-enabled').addEventListener('change', (e) => {
      this.settings.set('timerEnabled', e.target.checked);
    });

    // ---------------------------------------------------- restaurar padrões
    $('reset-cfg').addEventListener('click', () => {
      this.settings.reset();
      // as teclas fazem parte do "padrão": deixá-las de fora daria um
      // reset pela metade, com o jogo dizendo que voltou ao normal e o
      // pulo ainda no lugar errado
      this.binds.reset();
      this._applySettings();
      this.keys.render();
    });

    // ---------------------------------------------------- telas do menu
    $('open-options').addEventListener('click', () => this._abrirOpcoes(true));
    $('options-close').addEventListener('click', () => this._abrirOpcoes(false));
    $('open-keys').addEventListener('click', () => this.keys.abrir());
    // trocou uma tecla: as dicas do HUD mudam junto, na hora
    this.keys.onMudou = () => this._atualizarRotulos();

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
      this.audio.item(true);
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
      this.hud.toast(`+${ev.points} PONTOS`, 'pts');
      this.audio.item(true);          // [7] +10 pontos
      this.phone.push(ev.ped.number, 'Chegou! Muito obrigado 🙏');
      if (this.mission.carrier) {
        this.phone.push(this.mission.carrier.number, 'Ei! Tenho outro pacote aqui pra você.');
      }
    };

    // ---------------------------------------------------- botões das telas
    /*
     * O mesmo botão faz duas coisas, e o TEXTO dele diz qual: com
     * partida em andamento ele vira COMEÇAR DE NOVO e zera o Plano;
     * sem partida é só INICIAR JOGO e o progresso salvo continua.
     */
    $('start-btn').addEventListener('click', () => {
      this.audio.acordar();
      this.start(this.hasGame);
    });
    $('restart-btn').addEventListener('click', () => this.restart());   // [40]
    $('resume-title-btn').addEventListener('click', () => this.resumeFromTitle());   // [62]
  }

  /** Abre ou fecha a tela de opções (a de teclas se cuida sozinha). */
  _abrirOpcoes(on) {
    this._opcoesAbertas = !!on;
    $('options-screen').classList.toggle('hidden', !on);
  }

  // ==================================================================
  //  estados de jogo
  // ==================================================================
  /**
   * @param {boolean} zerar  apaga o Plano da AGI e recomeça a campanha
   *
   * Só o botão que DIZ "começar de novo" zera. O "INICIAR JOGO" de
   * quem volta no dia seguinte não pode apagar nada: no boot ainda não
   * existe partida em andamento, o botão nasce com esse texto, e quem
   * clicou ali queria jogar — não recomeçar do zero.
   */
  start(zerar = false) {
    if (zerar) this._zerarCampanha();
    this.timerEnabled = $('timer-enabled').checked;           // [8]
    this.timeLeft = GAME.totalTime;
    this.score = 0;
    this.deliveries = 0;
    this.hearts = PLAYER.maxHearts;                           // [33]
    this.invuln = 0;
    this.semDano = 0;
    this.elapsed = 0;
    this.mode = 'foot';
    this.god = false;
    this.cableCabin = null;
    this.hud.setGod(false);

    // uma partida nova não pode começar dentro de uma arena: se o jogador
    // morreu no meio de uma fase, o mundo tem que voltar a ser a cidade.
    // O PROGRESSO da campanha não se perde aqui — ele mora no localStorage
    // e só zera de propósito; morrer não apaga as peças conquistadas.
    this.dialogue.cancelar();
    this.plan.fechar();
    if (this.emFase) this._sairDaFase(false);
    this._atualizarCompanheiros();   // o Saci reflete o Plano nesta partida

    this._resetEntities();

    $('title-screen').classList.add('hidden');
    $('over-screen').classList.add('hidden');
    this._abrirOpcoes(false);
    this.keys.fechar();
    this.hud.show(true);
    this.hud.reset();
    this.hud.setHearts(this.hearts);
    this.hud.setTimer(this.timeLeft, this.timerEnabled);

    // o tema surf é o hino do canal: toca na cidade, entre desafios
    this.music.tocar('saopaulo');
    this.state = 'playing';
    this.hasGame = true;
    this.input.enabled = true;
    if (this.toque) this._telaCheia();
    else this.input.requestLock();                            // [15]
  }

  /**
   * Tela cheia e, se der, travada na horizontal.
   *
   * No celular a barra do navegador come 15% da tela e reaparece a cada
   * arrasto para baixo — bem no meio de uma virada de câmera. Os dois
   * pedidos podem ser negados (iOS não trava orientação), e negados eles
   * são: o jogo continua igual, só menos confortável.
   */
  _telaCheia() {
    try {
      const el = document.documentElement;
      if (!document.fullscreenElement && el.requestFullscreen) {
        el.requestFullscreen({ navigationUI: 'hide' })
          .then(() => screen.orientation?.lock?.('landscape').catch(() => {}))
          .catch(() => {});
      }
    } catch { /* sem tela cheia: segue o jogo */ }
  }

  /**
   * [40] "JOGAR NOVAMENTE" depois de um fim de jogo.
   *
   * NÃO zera a campanha: morrer numa fase não pode custar as peças que
   * já foram conquistadas em todas as outras. Quem quiser recomeçar do
   * zero usa COMEÇAR DE NOVO no menu, que avisa o que faz.
   */
  restart() { this.start(false); }

  /**
   * [62] Volta ao menu principal SEM jogar a partida fora. O mundo continua de pé
   * do jeito que estava; quem quiser retomar usa o botão "voltar ao jogo" (ou
   * ESC). Só `start()` reinicia de verdade.
   */
  toTitle() {
    this.music.tocar('abertura');
    this.state = 'title';
    this.input.enabled = false;
    this.input.releaseLock();
    this.hud.show(false);
    $('over-screen').classList.add('hidden');
    $('title-screen').classList.remove('hidden');
    // o botão de retomar só aparece quando há mesmo uma partida atrás da tela
    $('resume-title-btn').classList.toggle('hidden', !this.hasGame);
    $('start-btn').textContent = this.hasGame ? 'COMEÇAR DE NOVO' : 'INICIAR JOGO';
    // avisa que o botão apaga o Plano — decisão destrutiva não pode surpreender
    $('start-warn').classList.toggle('hidden', !this.hasGame);
    // a dica "clique em INICIAR JOGO" não faz sentido com a partida rolando
    if (this.hasGame) $('loading-note').textContent = '';
  }

  /** [62] Retoma a partida que ficou parada atrás da tela de título. */
  resumeFromTitle() {
    if (!this.hasGame) return;
    $('title-screen').classList.add('hidden');
    this._abrirOpcoes(false);
    this.keys.fechar();
    this.hud.show(true);
    this.state = 'playing';
    this.input.enabled = true;
    if (!this.toque) this.input.requestLock();
    /*
     * Devolve a trilha de onde o jogador parou. Sem isto ele voltava
     * para o meio de uma luta de chefão ouvindo a música de abertura,
     * que o menu tinha posto no lugar.
     */
    this.music.tocar(this.emFase ? 'boss' : 'saopaulo');
  }

  gameOver(reason, win = false) {
    /*
     * Cancela a fala pendente ANTES de tudo. Sem isto, morrer no meio da
     * cutscene de vitória deixava a caixa de diálogo por cima da tela de
     * fim de jogo, com um callback de roteiro esperando um Espaço que
     * não ia chegar — travado, do ponto de vista de quem joga.
     */
    this.dialogue.cancelar();
    this.canetadas.limpar();
    this.bolas.limpar();
    this.music.tocar(win ? 'festa' : 'gameover');
    this.audio.calarZumbido();
    if (!win) this.audio.derrota();                             // [35]
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
    this.audio.calarMotor();
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
    const p = PRESETS[index] || PRESETS[DEFAULT_PRESET];
    index = PRESETS.indexOf(p);
    this.presetIndex = index;
    this.settings.set('presetIndex', index);

    for (const btn of document.querySelectorAll('#qual-group .choice')) {
      btn.classList.toggle('active', Number(btn.dataset.qual) === index);
    }

    this.gfx.applyPreset(p, this.gfx.scene);
    this.sky.setShadowQuality(p.shadowMapSize, p.shadowRadius);
    this.sky.envUpdateInterval = p.envUpdate;
    this.props.setMaxLights(p.dynamicLights);

    this._aplicarNevoa();
    this.hud.setPreset(p.label);
  }

  // ==================================================================
  //  distância de renderização (tecla L)
  // ==================================================================
  /**
   * A névoa sai do MAIS APERTADO entre o perfil gráfico e a distância de
   * renderização.
   *
   * Os dois mexem no mesmo número por motivos diferentes — o perfil
   * fecha a névoa para aliviar a placa, a distância fecha porque o
   * jogador pediu. Deixar um sobrescrever o outro faria o último a ser
   * aplicado ganhar, e trocar de perfil desfaria a escolha de alcance
   * (foi o que já aconteceu entre perfil e população, e virou ajuste
   * separado por isso).
   */
  _aplicarNevoa() {
    const p = PRESETS[this.presetIndex] || PRESETS[DEFAULT_PRESET];
    const d = RENDER_DISTANCES[this.distIndex] ?? RENDER_DISTANCES[DEFAULT_RENDER_DISTANCE];
    QUALITY.fogFar = Math.min(p.fogFar, d.dist * 0.88);
    QUALITY.fogNear = Math.min(d.fogNear, QUALITY.fogFar * 0.55);
  }

  applyRenderDistance(index) {
    // um índice inválido (save antigo, preferência ausente) cai no padrão
    // em vez de quebrar a inicialização — mesma regra do `settings.js`
    const base = Number.isInteger(index) ? index : DEFAULT_RENDER_DISTANCE;
    const i = (base % RENDER_DISTANCES.length + RENDER_DISTANCES.length) % RENDER_DISTANCES.length;
    const d = RENDER_DISTANCES[i];
    this.distIndex = i;

    this.gfx.setFar(d.dist);
    this.sky.setRenderDistance(d.dist);      // domo, estrelas e lua encolhem junto
    this._aplicarNevoa();

    for (const btn of document.querySelectorAll('#dist-group .choice')) {
      btn.classList.toggle('active', Number(btn.dataset.dist) === i);
    }

    this.settings.set('renderDistanceIndex', i);
    if (this.hud) this.hud.toast('ALCANCE: ' + d.label, 'time');
  }

  /**
   * Volume, em dois canais independentes.
   *
   * @param {number} efeitos 0..100 (ou null para não mexer)
   * @param {number} musica  0..100 (ou null para não mexer)
   */
  applyVolume(efeitos, musica) {
    const lim = (v) => Math.max(0, Math.min(100, Math.round(v)));
    if (Number.isFinite(efeitos)) {
      this.volEfeitos = lim(efeitos);
      this.audio.setGanho(this.volEfeitos / 100);
      this.settings.set('volEfeitos', this.volEfeitos);
      const el = $('vol-efeitos'), lb = $('vol-efeitos-val');
      if (el) el.value = this.volEfeitos;
      if (lb) lb.textContent = this.volEfeitos;
    }
    if (Number.isFinite(musica)) {
      this.volMusica = lim(musica);
      this.audio.setGanhoMusica(this.volMusica / 100);
      this.settings.set('volMusica', this.volMusica);
      const el = $('vol-musica'), lb = $('vol-musica-val');
      if (el) el.value = this.volMusica;
      if (lb) lb.textContent = this.volMusica;
    }
  }

  /**
   * [O] Mudo: zera os dois e devolve o que estava antes.
   *
   * Guardar os valores para restaurar é o que separa "mudo" de
   * "abaixei tudo": quem silencia para atender alguém quer o mesmo
   * equilíbrio de volta depois, não recomeçar dos sliders.
   */
  toggleMudo() {
    if (this.volEfeitos > 0 || this.volMusica > 0) {
      this._volAntes = { e: this.volEfeitos, m: this.volMusica };
      this.applyVolume(0, 0);
      this.hud.toast('SOM: MUDO', 'time');
    } else {
      const v = this._volAntes || { e: 55, m: 45 };
      this.applyVolume(v.e, v.m);
      this.hud.toast('SOM LIGADO', 'time');
    }
  }
  cycleRenderDistance() {
    this.applyRenderDistance((this.distIndex ?? DEFAULT_RENDER_DISTANCE) + 1);
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
      this.audio.tiro();
      if (this.viewmodel) this.viewmodel.darCoice();
      this._companheiroAtaca();
    }
  }

  /**
   * O par Loro / Saci-Bot, decidido pelos PÉS.
   *
   *   atirar NO AR   -> o Loro mergulha ("Repetição Infinita": ele
   *                     repete o golpe que acabou de ver)
   *   atirar NO CHÃO -> o Saci-Bot some num redemoinho e reaparece
   *                     atrás do inimigo
   *
   * Uma tecla, dois golpes. Amarrar no pulo é o que transforma os dois
   * em coisa que se aprende a usar, em vez de automatismo que resolve a
   * luta sozinho — e dá ao pulo uma função ofensiva, que ele não tinha.
   */
  _companheiroAtaca() {
    if (!this.emFase || this.mode !== 'foot' || this.god) return;

    const noAr = !this.player.grounded;
    const ajudante = noAr ? this.player.loro : this.player.saci;
    if (!ajudante) return;

    /*
     * Quando o ajudante não pode agir, DIGA. Antes isto era um `return`
     * mudo, e do lado de cá da tela "recarregando" e "quebrado" são a
     * mesma coisa: o jogador atira, nada acontece, e ele conclui que o
     * golpe não existe.
     */
    if (!ajudante.ativo) {
      if (!noAr) this._avisoUmaVez('saciTravado', 'SACI-BOT: derrote o Ilon para desbloquear');
      return;
    }
    if (!ajudante.podeAtacar) {
      this._avisoUmaVez(noAr ? 'loroRec' : 'saciRec',
        noAr ? 'LORO RECARREGANDO' : 'SACI-BOT RECARREGANDO');
      return;
    }

    // inimigo vivo mais próximo do jogador
    const p = this.player.position;
    let alvo = null, melhor = Infinity;
    for (const f of this.stage.foes) {
      if (!f.vivo) continue;
      const d = f.root.position.distanceToSquared(p);
      if (d < melhor) { melhor = d; alvo = f; }
    }
    // 26 m de alcance: mais longe que isso, o mergulho vira uma viagem
    if (alvo && melhor < 26 * 26) ajudante.atacar(alvo);
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
      this.audio.missil();
    }
  }

  /** [24][27] Pessoa explode. */
  _killPed(ped, byBullet) {
    if (!ped || !ped.alive) return;
    const p = ped.human.root.position;
    this.fx.explode(new THREE.Vector3(p.x, p.y + 0.9, p.z), 1.0);
    this.audio.explosao(1);
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
    this.audio.explosao(2);
    this.camera.addShake(byBullet ? 0.4 : 0.7);
    this.cars.remove(car, true);                              // [29] repõe outro
    this.addTime(GAME.killTimeBonus, '+5s');                  // [32]
    this.hud.hitMarker();
  }

  addTime(sec, label) {
    this.timeLeft = Math.min(GAME.totalTime * 2, this.timeLeft + sec);
    if (label) this.hud.toast(label, 'time');
  }

  // ==================================================================
  //  campanha — Bob em Busca da AGI Sagrada
  // ==================================================================

  /**
   * Liga os companheiros que a campanha já conquistou.
   *
   * O Saci-Bot é a conquista da Guilda dos Roboticistas, montada com os
   * blueprints do Optimus roubados na Gigafábrica. Ele existe a partir
   * da peça INVESTIMENTO e some se a campanha for zerada — a conquista
   * tem que ser visível no jogo, senão derrotar o Ilon não muda nada
   * além de um ✔ numa tela.
   */
  _atualizarCompanheiros() {
    const temSaci = !!this.campanha.conquistas.investimento;
    if (temSaci) this.player.saci.ligar();
    else this.player.saci.desligar();
  }

  /**
   * Um inimigo atirou: nasce a bola de fogo, do tamanho dele.
   *
   * A mira aponta para onde o jogador ESTÁ, não para onde estará: é
   * projétil burro de propósito. A bola é lenta e visível justamente
   * para dar tempo de sair da frente — prever o movimento tiraria a
   * única defesa que ela oferece.
   */
  _inimigoAtira(dono, b) {
    const alvo = this.mode === 'heli' ? this.heli.root.position : this.player.position;
    const p = dono.root.position;
    const boca = (dono.alturaAlvo || 1);

    const dir = new THREE.Vector3(alvo.x, alvo.y + 1.0, alvo.z)
      .sub(new THREE.Vector3(p.x, p.y + boca, p.z))
      .normalize();
    // nasce fora do corpo de quem atirou, senão explode nele mesmo
    const origem = new THREE.Vector3(p.x, p.y + boca, p.z)
      .addScaledVector(dir, (b.raio || 0.6) + (dono.raioAcerto || 1) + 0.6);

    if (this.bolas.disparar(origem, dir, {
      raio: b.raio, vel: b.vel, dano: 1,
      cor: b.cor ?? (dono.porte ? 0xff7a1a : 0xff4d4d),
    })) this.audio.tiro();
  }

  /** Pegou um item: cura, ou recarrega o teleguiado no caso da GPU. */
  _pegarItem(it) {
    const d = it.def;
    if (d.recarrega) {
      this.teleguiado.recarga = 0;
      this.hud.toast(d.nome + ' — MÍSSIL PRONTO', 'good');
    } else {
      const antes = this.hearts;
      this.hearts = Math.min(PLAYER.maxHearts, this.hearts + d.cura);
      this.hud.setHearts(this.hearts);
      const ganho = this.hearts - antes;
      this.hud.toast(d.nome + (ganho > 0 ? ' +' + ganho + ' ❤' : ''), 'good');
      this.semDano = 0;
    }
    this.audio.item(true);
  }

  /**
   * Zera o Plano da AGI: peças, fases vencidas e o save do navegador.
   *
   * MUTA o objeto no lugar em vez de trocá-lo. O \`PortalSystem\` e a
   * tela do Plano guardaram a REFERÊNCIA dele lá na construção do
   * mundo; substituir por um objeto novo deixaria os dois apontando
   * para o estado velho, e os portais continuariam verdes.
   */
  _zerarCampanha() {
    for (const k of Object.keys(this.campanha.conquistas)) this.campanha.conquistas[k] = false;
    for (const k of Object.keys(this.campanha.fasesVencidas)) delete this.campanha.fasesVencidas[k];
    for (const k of Object.keys(this.campanha.moedas)) delete this.campanha.moedas[k];
    this.campanha.faseAtual = null;
    zerarCampanha();
    this.plan.recentes.clear();
    this._atualizarCompanheiros();     // o Saci-Bot volta a ficar trancado
  }

  /** Aviso que não repete em rajada: um por tipo a cada 2,5 s. */
  _avisoUmaVez(chave, texto) {
    this._avisos = this._avisos || {};
    if (this.elapsed - (this._avisos[chave] || -9) < 2.5) return;
    this._avisos[chave] = this.elapsed;
    this.hud.toast(texto, 'bad');
  }

  /**
   * A trava do míssil teleguiado.
   *
   * Procura o inimigo mais alinhado com a mira e desenha o quadro de
   * trava EM CIMA DELE na tela, projetando a posição 3D. O quadro fica
   * onde o alvo está, e não no centro, porque é ele que responde a
   * pergunta que o jogador faz antes de apertar: "vai nesse mesmo?".
   */
  _atualizarTrava() {
    const el = this._elTrava || (this._elTrava = $('lock-on'));
    const gauge = this._elGauge || (this._elGauge = $('missile-gauge'));
    const fill = this._elFill || (this._elFill = $('mg-fill'));

    // o medidor só aparece em fase: fora dela não há o que travar
    const emLuta = !!(this.emFase && this.stage.ativo);
    gauge.classList.toggle('hidden', !emLuta);
    if (emLuta) {
      const c = this.teleguiado.carga;
      fill.style.width = (c * 100).toFixed(0) + '%';
      fill.classList.toggle('full', c >= 1);
    }

    if (!emLuta || this.plan.aberto || this.dialogue.ativo) {
      this.alvoTravado = null;
      el.classList.add('hidden');
      return;
    }

    const { origin, direction } = this.camera.aimRay(this._aimOrigin, this._aimDir);
    const alvo = this.teleguiado.procurarAlvo(origin, direction, this.stage.foes);
    this.alvoTravado = alvo;

    if (!alvo) { el.classList.add('hidden'); return; }

    // projeta o ponto de mira do inimigo para coordenadas de tela
    this._tmpV.set(
      alvo.root.position.x,
      alvo.root.position.y + (alvo.alturaAlvo || 1),
      alvo.root.position.z,
    ).project(this.gfx.camera);

    // atrás da câmera: não desenha (a projeção espelha e o quadro salta)
    if (this._tmpV.z > 1) { el.classList.add('hidden'); return; }

    el.style.left = ((this._tmpV.x * 0.5 + 0.5) * window.innerWidth) + 'px';
    el.style.top = ((-this._tmpV.y * 0.5 + 0.5) * window.innerHeight) + 'px';
    el.classList.remove('hidden');
    el.classList.toggle('ready', this.teleguiado.pronto);
    $('lock-label').textContent = this.teleguiado.pronto ? 'TRAVADO' : 'RECARREGANDO';
  }

  /** [X] Dispara o teleguiado no alvo travado. */
  _dispararTeleguiado() {
    if (!this.emFase || !this.stage.ativo) return;
    if (!this.teleguiado.pronto) { this.hud.toast('MÍSSIL RECARREGANDO', 'bad'); return; }
    if (!this.alvoTravado) { this.hud.toast('SEM ALVO — APONTE A MIRA', 'bad'); return; }

    const { origin, direction } = this.camera.aimRay(this._aimOrigin, this._aimDir);
    if (this.teleguiado.disparar(origin, direction, this.alvoTravado)) {
      this.audio.missil();
      this.hud.recoil();
      this.camera.addShake(0.3);
      if (this.viewmodel) this.viewmodel.darCoice();
    }
  }

  /**
   * O som de quem está chegando: zumbido dos drones e patinha dos robôs.
   *
   * Serve de AVISO. Numa cidade aberta o inimigo vem de trás de um
   * prédio e o jogador não tem como olhar para os quatro lados ao mesmo
   * tempo — ouvir o enxame engrossar, ou o tec-tec no asfalto, é o que
   * dá a chance de virar antes de tomar.
   *
   * O zumbido é UM som para o bando todo, modulado pela proximidade do
   * mais perto; a patinha sai por inimigo que anda, com trava no
   * `Audio` para o conjunto não virar chiado.
   */
  _ambienteInimigos(dt) {
    if (!this.emFase || !this.stage.ativo) { this.audio.calarZumbido(); return; }

    const p = this._focus;
    let voadoresPerto = 0, maisPerto = Infinity;
    this._passoT = (this._passoT || 0) - dt;
    const andando = [];

    for (const f of this.stage.foes) {
      if (!f.vivo) continue;
      const d = Math.hypot(f.root.position.x - p.x, f.root.position.z - p.z);
      if (d > 90) continue;
      if (f.ficha && f.ficha.voa) { voadoresPerto++; maisPerto = Math.min(maisPerto, d); }
      else if (d < 55) andando.push(d);
    }

    // 0 longe, 1 em cima: 40 m é onde o zumbido começa a incomodar
    const perto = maisPerto === Infinity ? 0 : Math.max(0, 1 - maisPerto / 40);
    this.audio.zumbido(perto, voadoresPerto);

    if (andando.length && this._passoT <= 0) {
      const d = Math.min(...andando);
      // quanto mais perto e mais numerosos, mais miúdo o intervalo
      this._passoT = Math.max(0.16, 0.5 - andando.length * 0.04) * (0.8 + Math.random() * 0.4);
      this.audio.patinha(Math.max(0, 1 - d / 55));
    }
  }

  /**
   * Bússola da batalha: com o combate longe, diz a distância.
   *
   * Numa fase a céu aberto o jogador pode estar de costas para a briga,
   * atrás de um prédio ou num morro. Sem uma referência ele fica
   * procurando — foi o que aconteceu na Gigafábrica antes de o portal
   * ser corrigido. O aviso só aparece quando REALMENTE está longe; de
   * perto ele seria ruído sobre a luta.
   */
  _bussolaDaBatalha() {
    if (!this.emFase || this.colosso) return;      // o colosso tem aviso próprio
    const L = this.emFase.local;
    if (!L) return;
    const vivos = this.stage.foes.filter((f) => f.vivo);
    if (!vivos.length) return;

    const d = Math.hypot(this._focus.x - L.x, this._focus.z - L.z);
    if (d > 70) this.hud.setPrompt(`A BATALHA ESTÁ A ${Math.round(d)} m — ${this.emFase.portal.label}`);
  }

  /** Quanto falta o colosso andar, no painel do helicóptero. */
  _avisoColosso() {
    const c = this.colosso;
    if (!c || !c.vivo) return;
    if (c.noAlto) {
      this.hud.setPrompt('ELE SE AGARROU NO CRISTO — ACABA COM ISSO');
    } else if (c.destino) {
      this.hud.setPrompt(`TRUNFO A ${Math.round(c.faltam)} m DO LABS IMG · MÍSSEIS: E ou clique`);
    }
  }

  /**
   * Acerto em inimigo da fase.
   *
   * @param {boolean} deMissil  o colosso só se importa com míssil
   */
  _acertarFoe(foe, ponto, dano = 12, deMissil = false) {
    if (!this.stage || !this.stage.ativo || !foe || !foe.vivo) return;

    /*
     * Casca de gigante não se fura com pistola. Avisar é parte do
     * design: sem o aviso o jogador acha que está com bug, atirando num
     * alvo enorme e sem ver número nenhum descer.
     */
    if (foe.ficha && foe.ficha.colossal && !deMissil) {
      if (!this._avisoBalaT || this.elapsed - this._avisoBalaT > 2.5) {
        this._avisoBalaT = this.elapsed;
        this.hud.toast('BALA NÃO ARRANHA ELE — USE OS MÍSSEIS', 'bad');
      }
      return;
    }

    const morreu = this.stage.acertar(foe, ponto, dano, deMissil);
    this.hud.hitMarker();
    this.audio.acerto();
    if (morreu) {
      this.camera.addShake(foe.chefe ? 0.5 : 0.25);
      this.audio.explosao(foe.chefe ? 3 : 1);
      this.audio.abateu();
      /*
       * Chefão SEMPRE larga alguma coisa; capanga larga às vezes.
       * Sem drop a vida só anda para baixo e a fase vira um orçamento
       * fixo de corações; com ele, lutar bem paga.
       */
      this.drops.talvezSoltar(foe.root.position, foe.chefe ? 1 : 0.22);
      this.mission.score += foe.ficha.pontos || 5;
    }
  }

  /**
   * Entra numa fase: teleporta o jogador para a arena e começa o roteiro.
   *
   * O jogador some da cidade e reaparece na arena, que fica longe demais
   * para ser vista de lá. Guardamos de onde ele saiu para devolvê-lo no
   * mesmo lugar — sair de uma fase e cair no meio do mapa seria perder
   * a viagem que ele acabou de fazer até o portal.
   */
  /**
   * Entra numa fase. TODAS acontecem na cidade: os inimigos saem do
   * marco que o chefão ocupou — a ponte, o museu, o largo do
   * pelourinho — e a briga corre a céu aberto, com trânsito, pedestres,
   * carro e helicóptero ao alcance.
   *
   * O jogador não é teleportado: ele já está no portal, que fica no
   * próprio marco. A única exceção é o colosso, que exige helicóptero.
   */
  _entrarNaFase(fase) {
    if (this.emFase) return;

    const p = this.player.position;
    this.voltaMundo = { x: p.x, y: p.y, z: p.z };
    this.emFase = fase;
    this.campanha.faseAtual = fase.key;

    const ficha = CHEFES[fase.bossRush ? fase.bossRush[0] : fase.boss];
    if (ficha && ficha.porte === 'colossal') this._embarcarNoHeli();

    this.portais.visivel = false;
    this.mission.marker.visible = false;
    this.stage.iniciar(fase);
    this.audio.fase();
    /*
     * A marcha imperial entra JUNTO com a fase, não quando o chefão
     * aparece. O aviso vale mais cedo: o jogador ouve a música do mal e
     * já sabe que a cidade virou campo de batalha, antes do primeiro
     * capanga sair do marco.
     */
    this.music.tocar('boss');

    /*
     * Peça entregue ao CHEGAR, não ao vencer. É o caso do GALPÃO: na
     * história ele não é fase, é o mutirão que a comunidade já fez.
     */
    if (fase.rewardOnEnter) {
      this.plan.conquistar(fase.rewardOnEnter);
      salvarCampanha(this.campanha);
    }
  }

  /** Coloca o jogador no helicóptero (fase de colosso). */
  _embarcarNoHeli() {
    if (this.mode === 'heli') return;
    const hp = this.landmarks.heliport;
    if (this.mode === 'car') this._exitCar();
    if (this.mode === 'cable') this._leaveCable();
    this.heli.placeAt(hp.x, hp.y + HELI.landHeight, hp.z, 0);
    this.player.teleport(hp.x, hp.z, hp.y);
    this._enterHeli();
  }

  /**
   * Põe o chefão na cidade, saindo do marco daquela fase.
   *
   * Quem MARCHA (só o Trunfo colossal) nasce longe e caminha para o
   * Labs IMG: a distância vira o relógio da fase, e se ele chegar,
   * acabou. Os outros nascem no próprio marco — a boca da ponte, o vão
   * do museu, o largo do pelourinho — e partem para cima do jogador.
   */
  _soltarChefeNaCidade(fase) {
    const chave = fase.bossRush ? fase.bossRush[this.stage.chefeIdx] : fase.boss;
    const ficha = CHEFES[chave];
    if (!ficha) { this.stage.estado = 'vitoria'; this.stage.pausa = 0.8; return; }

    const marco = fase.local || { x: 0, z: 0 };
    /*
     * Quem marcha nasce no PÉ DO CORCOVADO, não do outro lado do mapa.
     * Dá o arco inteiro num lugar só: ele desce do morro, atravessa a
     * cidade até o laboratório e, encurralado, corre de volta para se
     * agarrar no Cristo. Nascer longe do Corcovado fazia a fuga final
     * virar uma travessia de mapa inteiro.
     */
    const inicio = ficha.marcha ? { x: -560, z: -330 } : marco;
    const destino = { x: 0, z: 0 };

    const chefe = new CityBoss(this.gfx.scene, this.col, ficha, inicio, destino);
    this.colosso = chefe;

    chefe.onPisada = (pos, forca) => {
      this.camera.addShake(forca);
      this.audio.passo(forca * 2);
      this.fx.impact(new THREE.Vector3(pos.x, pos.y + 0.4, pos.z), new THREE.Vector3(0, 1, 0));
    };
    chefe.onMorreu = () => this.canetadas.limpar();
    chefe.onCanetada = (origem, alvo) => {
      if (this.canetadas.disparar(origem, alvo)) this.audio.canetada();
    };
    chefe.onTrepar = () => {
      this.hud.toast('ELE ESTÁ SUBINDO O CORCOVADO!', 'bad');
    };
    chefe.onChegou = () => {
      this.hud.toast('O TRUNFO PISOU NO LABS IMG', 'bad');
      this.gameOver('O Trunfo alcançou o Labs IMG. A AGI não nasceu hoje.');
    };

    this.stage.adotarChefe(chefe);
    // colosso só cai de míssil; os outros aceitam bala também
    this.missiles.setFoes(this.stage.foes);
    this.bullets.setFoes(this.stage.foes);
  }

  /** Sai da fase (por vitória ou desistência) e volta para a cidade. */
  _sairDaFase(venceu) {
    if (!this.emFase) return;

    this.stage.abandonar();
    if (this.colosso) { this.colosso.remover(); this.colosso = null; }
    this.canetadas.limpar();
    this.bolas.limpar();
    this.drops.limpar();
    this.teleguiado.limpar();
    this.missiles.setFoes(null);
    this.bullets.setFoes(null);

    this.emFase = null;
    this.player.inimigos = null;
    this.campanha.faseAtual = null;
    this.portais.visivel = true;
    this.hud.setPrompt(null);
    this.audio.calarZumbido();
    if (this.state === 'playing') this.music.tocar('saopaulo');
    if (!venceu) this.hud.toast('FASE ABANDONADA', 'bad');
  }

  /** Fim de fase com vitória: guarda a peça do Plano e volta para o mapa. */
  _vencerFase(fase) {
    this.campanha.fasesVencidas[fase.key] = true;
    this.audio.conquista();
    this.plan.conquistar(fase.reward);
    salvarCampanha(this.campanha);
    this._atualizarCompanheiros();   // o Saci-Bot entra ao vencer o Ilon

    this._sairDaFase(true);
    this.hud.toast('FASE CONCLUÍDA', 'good');
    this.audio.vitoria();
    this.music.fanfarra();
    this.music.tocar('vitoria');
    this.mission.score += 100;

    // abre o Plano na hora: é o momento em que a peça nova entra, e ver
    // o quadro encher é a recompensa que amarra a campanha inteira
    this.plan.abrir();
  }

  /** [34] Jogador atropelado perde um coração. */
  /**
   * Um coração de volta a cada `regenTime`, depois de `regenDelay` sem
   * apanhar. É o que permite errar sem recomeçar a fase inteira — mas
   * como o relógio zera a cada dano, no meio da briga ele nunca completa.
   */
  _regenerar(dt) {
    if (this.hearts <= 0 || this.hearts >= PLAYER.maxHearts) { this.semDano = 0; return; }
    this.semDano = (this.semDano || 0) + dt;
    if (this.semDano < PLAYER.regenDelay + PLAYER.regenTime) return;
    this.semDano = PLAYER.regenDelay;      // recomeça a contar já do limiar
    this.hearts++;
    this.hud.setHearts(this.hearts);
    this.hud.toast('+1 ❤', 'good');
    this.audio.item(true);
  }

  _damagePlayer(reason) {
    this.audio.dano();
    if (this.invuln > 0) return;
    this.invuln = PLAYER.invulnTime;
    this.semDano = 0;                    // zera o relógio da regeneração
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
      // fim de jogo: mundo congelado, cena continua desenhada
      this.sky.setPaused(true);
    }

    /*
     * Os controles na tela somem quando não há o que controlar: menu,
     * celular, Plano, cutscene ou fim de jogo. Fica num lugar só, no
     * laço de cima, pelo mesmo motivo do som contínuo — quem aparece
     * sozinho precisa de alguém que rode SEMPRE para sumir.
     */
    if (this.touch) {
      this.touch.atualizar({
        jogando: this.state === 'playing',
        modal: this.phone.open || this.plan.aberto || this.dialogue.ativo,
        modo: this.mode,
        emFase: !!this.emFase,
        deus: this.god,
      });
    }

    this._somContinuo();
    this.input.endFrame();
  }

  /**
   * Motor e zumbido dos drones: os sons que NÃO acabam sozinhos.
   *
   * Fica aqui, no laço de cima, e não dentro de _updatePlaying — foi
   * exatamente esse o bug do motor: ao pausar, o laço de jogo parava
   * de rodar e o som congelava tocando para sempre, porque ninguém
   * mais mandava ele abaixar. Todo som sustentado precisa de alguém
   * que o silencie quando o jogo sai do ar, e esse alguém tem que
   * rodar SEMPRE, não só enquanto se joga.
   */
  _somContinuo() {
    if (!this.audio) return;
    const jogando = this.state === 'playing' && !this.phone.open
      && !this.plan.aberto && !this.dialogue.ativo;

    const frac = jogando && this.playerCar
      ? Math.min(1, Math.abs(this.playerCar.speed) / CAR.maxSpeed) : 0;
    const noCarro = jogando && this.mode === 'car';

    this.audio.motor(frac, noCarro);

    /*
     * Hélice: só no helicóptero. A "carga" vem da velocidade vertical
     * — subir puxa o rotor e o som fecha; descendo ele alivia. É o que
     * dá peso ao comando sem precisar de instrumento na tela.
     */
    const noHeli = jogando && this.mode === 'heli';
    const carga = noHeli ? Math.min(1, Math.abs(this.heli.vel.y) / 12) : 0;
    this.audio.helice(noHeli, carga);

    if (!jogando) this.audio.calarZumbido();
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
    this._regenerar(dt);
    this.sky.setPaused(false);
    this.dialogue.update(dt);

    /*
     * Durante cutscene ou com o Plano aberto o mundo continua rodando
     * (a cidade vive, o céu anda), mas o jogador não comanda nada. É o
     * mesmo bloqueio que o celular já usava — só que agora com três
     * motivos possíveis.
     */
    const emCena = this.dialogue.ativo || this.plan.aberto;

    // ------------------------------------------------ olhar e zoom
    if (!this.phone.open && !emCena) {
      const m = this.input.consumeMouse();
      this.camera.look(m.dx, m.dy);                           // [11]
      this.camera.zoom(this.input.consumeWheel());            // [12]
      // o clique que captura o ponteiro não deve virar tiro
      const clicked = this.input.consumeClick();
      if (clicked && this.input.locked) this._shoot();        // [27]
      /*
       * No toque, o botão de atirar é SEGURADO, não tocado uma vez por
       * disparo: metralhar a dedadas não é jogo, é tendinite. A cadência
       * continua sendo a da arma — `_shoot` respeita o `canFire`.
       */
      if (this.input.toque.atirar) this._shoot();
    } else {
      this.input.consumeMouse();
      this.input.consumeWheel();
      this.input.consumeClick();
    }

    const blocked = this.phone.open || emCena;

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

    // ------------------------------------------------ campanha
    this._updateCampanha(dt);
    if (this.viewmodel) this.viewmodel.update(dt, this.player.speed || 0);
    this.music.update();
    this.teleguiado.update(dt);
    this._atualizarTrava();
    this._ambienteInimigos(dt);

    // ------------------------------------------------ interações
    this._checkVehicleImpacts(dt);
    this._checkPlayerHit();
    // dentro de uma fase a entrega da cidade não faz sentido: o jogador
    // está a 1,5 km dali, e o marcador ficaria apontando para o nada
    if (!this.emFase) this._updateMission(dt);
    this._updateTimer(dt);

    // ------------------------------------------------ câmera
    this.camera.update(dt, this._focus, this._interiorTransform());

    // ------------------------------------------------ HUD
    this._updateHUD(dt);
  }

  /**
   * Campanha: portais no mundo aberto e o andamento da fase na cidade.
   *
   * Os dois nunca rodam ao mesmo tempo — ou o jogador está procurando
   * um portal, ou está no meio de uma fase.
   */
  _updateCampanha(dt) {
    if (!this.portais) return;

    if (!this.emFase) {
      // só marca portal com o jogador a pé ou de carro; voando alto o
      // prompt piscaria de longe sem que ele possa entrar
      this.portais.update(dt, this._focus);
      return;
    }

    // os companheiros escolhem alvo sozinhos: precisam da lista da fase
    this.player.inimigos = this.stage.foes;

    /*
     * Contra o colosso o alvo é o HELICÓPTERO, não o corpo do jogador —
     * ele está lá dentro, e o boneco fica escondido. Mirar no corpo
     * faria o gigante perseguir uma posição congelada no heliporto.
     */
    const alvo = this.mode === 'heli' ? this.heli.root.position : this.player.position;
    const dano = this.stage.update(dt, alvo, this.col);

    /*
     * As canetadas continuam VOANDO durante a cutscene, mas não
     * machucam — mesma regra dos capangas.
     *
     * Este era um buraco de verdade: o dano dos inimigos eu já tinha
     * zerado dentro do `StageRunner`, mas os decretos rodam por fora
     * dele. Resultado: você derrubava o Trunfo, entrava o diálogo de
     * vitória, e os papéis que já estavam no ar te matavam com a tela
     * presa no texto, sem poder desviar.
     */
    const danoPapel = this.canetadas.update(dt, alvo);
    if (danoPapel > 0 && this.invuln <= 0 && !this.god && !this.dialogue.ativo) {
      this._damagePlayer('Atingido por uma canetada do Trunfo');
    }

    // bolas de fogo: mesma regra de imunidade durante a cutscene
    const raioAlvo = this.mode === 'heli' ? 2.6 : 1.0;
    const danoBola = this.bolas.update(dt, alvo, raioAlvo, this.col);
    if (danoBola > 0 && this.invuln <= 0 && !this.god && !this.dialogue.ativo) {
      this._damagePlayer('Atingido por uma bola de fogo');
    }

    // itens caídos: coleta por proximidade
    const pego = this.drops.update(dt, this.player.position, this.col);
    if (pego) this._pegarItem(pego);
    this.missiles.setFoes(this.stage.foes);
    this.bullets.setFoes(this.stage.foes);
    this._avisoColosso();
    this._bussolaDaBatalha();

    if (dano > 0 && this.invuln <= 0 && !this.god) {
      this._damagePlayer('Derrotado pelos capangas das Big Techs');
    }

    // fase encerrada por morte do jogador: o `gameOver` já cuidou
    if (this.state !== 'playing') this._sairDaFase(false);
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
      // no toque os botões ▲ e ▼ escrevem nos mesmos comandos [43]
      up: this.input.jumping ? 1 : 0,
      down: (this.input.descer || this.input.boosting) ? 1 : 0,
      yawLeft: this.input.segurando('heliEsq') ? 1 : 0,
      yawRight: this.input.segurando('heliDir') ? 1 : 0,
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
      // [campanha] os portais aparecem no radar, com a próxima fase em destaque
      portais: this.emFase || !this.portais ? null : this.portais.marcadores(proximaFase(this.campanha)),
    }, { peds: this.peds, cars: this.cars });

    // ---- dicas contextuais [9][43]
    if (!this.phone.open) this._updatePrompt();

    // ---- mira só faz sentido quando dá para atirar
    this.hud.setCrosshairVisible(true);
    this._updateAimFeedback();
  }

  /**
   * O selo da tecla (ou do botão) de uma ação, pronto para o HUD.
   *
   * A dica tem que dizer o que ESTE jogador vai apertar: quem trocou o F
   * de lugar não pode ler "F" na tela, e quem está no celular não tem
   * tecla nenhuma para apertar — tem um botão redondo escrito AÇÃO.
   */
  _tecla(id) {
    if (this.toque) return `<kbd>${BOTOES_TOQUE[id] || '?'}</kbd>`;
    return `<kbd>${this.binds.rotulo(id)}</kbd>`;
  }

  _updatePrompt() {
    const acao = this._tecla('acao');
    const visao = this._tecla('visao');
    // voando, os botões de pular e correr viram subir e descer, e é
    // assim que eles aparecem escritos na tela
    const sobe = this.toque ? '<kbd>▲</kbd>' : this._tecla('pular');
    const desce = this.toque ? '<kbd>▼</kbd>' : this._tecla('correr');

    if (this.mode === 'foot') {
      if (this.god) {
        this.hud.setPrompt(`MODO DEUS · ${sobe} subir · ${desce} descer`
          + (this.toque ? '' : ` · ${this._tecla('turbo')} turbo · ${this._tecla('deus')} sair`));
        return;
      }
      const p = this.player.position;
      const dHeli = dist2D(p.x, p.z, this.heli.root.position.x, this.heli.root.position.z);
      if (dHeli < 6.5) {
        this.hud.setPrompt(`${acao} pilotar o helicóptero`);
        return;
      }
      if (this.landmarks.cabinAtPlatform(p.x, p.z, p.y)) {      // [54]
        this.hud.setPrompt(`${acao} entrar no bondinho`);
        return;
      }
      const car = this.cars.nearest(p.x, p.z, GAME.vehicleRange + CAR.length * 0.5);
      if (car) {
        this.hud.setPrompt(`${acao} entrar no carro`);
        return;
      }
      this.hud.setPrompt(null);
    } else if (this.mode === 'cable') {                         // [54]
      this.hud.setPrompt(this.landmarks.cabinDocked(this.cableCabin)
        ? `${acao} descer na estação`
        : 'A caminho da próxima estação...');
    } else if (this.mode === 'car') {
      this.hud.setPrompt(`${acao} sair &nbsp;·&nbsp; ${visao} visão interna`);
    } else {
      this.hud.setPrompt(this.heli.canExit
        ? `${acao} descer &nbsp;·&nbsp; ${visao} visão interna`
        : `${desce} descer &nbsp;·&nbsp; ${sobe} subir`);
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

/** Como cada ação se chama na tela de toque, para as dicas do HUD. */
const BOTOES_TOQUE = {
  acao: 'AÇÃO', atirar: 'ATIRAR', pular: 'PULAR', correr: '▼', visao: '👁',
  missil: '🚀', plano: '📋', celular: '📱',
};

const EMPTY_INPUT = {
  axes: { forward: 0, strafe: 0 },
  running: false,
  descer: false,
  boosting: false,
  jumping: false,
  down: () => false,
  segurando: () => false,
};
