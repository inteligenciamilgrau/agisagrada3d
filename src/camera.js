import * as THREE from '../vendor/three.module.js';
import { CAMERA } from './config.js';
import { clamp, damp, dampAngle } from './utils.js';

/**
 * [14] Câmera em terceira pessoa.
 * [12] Zoom no scroll do mouse.
 * [17][25] Visão interna do carro e do helicóptero (padrão é externa — [47]).
 */
export class GameCamera {
  constructor(camera, collision) {
    this.cam = camera;
    this.col = collision;

    this.yaw = 0;
    this.pitch = -0.22;
    this.distance = CAMERA.defaultZoom;
    this.wantDistance = CAMERA.defaultZoom;
    this.mode = 'foot';

    this.focus = new THREE.Vector3();
    this._smoothFocus = new THREE.Vector3();
    this._pos = new THREE.Vector3();
    this._look = new THREE.Vector3();
    this._first = true;
    this._interiorBase = 0;
    this.frameLift = 0;

    this.shake = 0;

    // [FPS] coice e zoom de mira estilo COD Mobile
    this.ads = 0;               // 0..1, quão fechado está o zoom de mira
    this._adsQuero = false;
    this._recoilP = 0;          // coice acumulado na inclinação (rad)
    this._recoilY = 0;          // coice acumulado na deriva lateral (rad)
    this._zoomScroll = CAMERA.defaultZoom;   // zoom do scroll, restaurado ao soltar a mira
  }

  setMode(mode) {
    if (this.mode === mode) return;
    this.mode = mode;
    if (mode === 'foot') {
      this.wantDistance = CAMERA.defaultZoom;
      this._zoomScroll = CAMERA.defaultZoom;
    }
    else if (mode === 'car-out') this.wantDistance = CAMERA.carZoom;
    else if (mode === 'heli-out') this.wantDistance = CAMERA.heliZoom;
    else if (mode === 'cable-out') this.wantDistance = CAMERA.cableZoom;   // [54]
    /*
     * Fração da distância que o ponto de mira sobe em relação ao veículo.
     * Olhando um pouco ACIMA do helicóptero, ele desce no enquadramento e
     * libera o miolo da tela para o caminho à frente — voando, é justamente
     * ali que o jogador precisa enxergar.
     */
    this.frameLift = mode === 'heli-out' ? CAMERA.heliFrameLift : 0;
    this._first = true;
  }

  get isInterior() { return this.mode === 'car-in' || this.mode === 'heli-in'; }

  /** Primeira pessoa: usada dentro das fases da campanha. */
  get isFPS() { return this.mode === 'fps'; }
  get isAds() { return this.ads > 0.05; }   // [ADS] estado do zoom (usado pelo HUD p/ classes .center/.ads)

  /** [11] Movimento do mouse gira a visão. */
  look(dx, dy) {
    this.yaw -= dx * CAMERA.sensitivity;
    this.pitch -= dy * CAMERA.sensitivity;
    this.pitch = clamp(this.pitch, CAMERA.pitchMin, CAMERA.pitchMax);
    this.yaw = ((this.yaw + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
  }

  /** [12] Scroll aproxima/afasta. */
  zoom(steps) {
    if (!steps || this.isInterior) return;
    this._zoomScroll = clamp(this._zoomScroll + steps * 0.9, CAMERA.minZoom, CAMERA.maxZoom);
    if (!this._adsQuero) this.wantDistance = this._zoomScroll;
  }

  // ------------------------------------------------------------ [FPS] ADS
  /** Liga/desliga o zoom de mira (ADS) — segurar o tiro. */
  setAds(on, fovAlvo = CAMERA.adsFov) {
    this._adsQuero = !!on;
    this._adsFov = fovAlvo;
  }

  /**
   * [FPS] Inclinação (pitch) do FOCO da mira no mundo, em radianos.
   *
   * Não é o pitch da câmera: a mira fica 2/5 do topo da tela, então o foco
   * está sempre um pouco ACIMA do centro da visão. Soma o coice da arma
   * (`_recoilP`) — assim a cabeça do personagem sobe junto a cada tiro.
   * O jogo passa isto para `human.lookPitch` e a cabeça obedece.
   */
  get aimPitch() {
    return this.pitch + this._recoilP;
  }

  /**
   * [FPS] Ângulo horizontal do foco da mira, em radianos (positivo = lado
   * direito da tela). O corpo do personagem já gira com o yaw da câmera;
   * este valor só vira a CABEÇA um tico na direção da mira, como num FPS.
   */
  get aimYaw() {
    return 0;
  }

  /**
   * [FPS] Direção horizontal REAL para onde a câmera aponta (centro
   * da tela), incluindo o deslocamento do ombro — é para onde o W
   * anda, para o boneco andar em linha reta em vez de na diagonal.
   */
  get viewYaw() {
    const dx = this._look.x - this._pos.x;
    const dz = this._look.z - this._pos.z;
    return Math.atan2(-dx, -dz);
  }

  /**
   * [FPS] Coice leve: a mira sobe um tico e deriva; relaxa sozinho.
   *
   * O coice entra como um OFFSET sobre o olhar do jogador: ele continua
   * mexendo a câmera com o mouse normalmente enquanto atira, e o recuo
   * se soma por cima — puxar para baixo anula o coice, que é o
   * "controlar o recuo" dos FPS.
   */
  addRecoil() {
    if (this.ads > 0.5) return;   // [FIXO] no ADS a mira fica fixa; o coice fica so na arma
    this._recoilP += CAMERA.recoilPitch * (0.8 + Math.random() * 0.45);
    this._recoilY += (Math.random() - 0.5) * 2 * CAMERA.recoilYaw;
  }

  addShake(amount) {
    this.shake = Math.min(1.4, this.shake + amount);
  }

  /**
   * @param {THREE.Vector3} focusPoint alvo que a câmera acompanha
   * @param {object} interior {position: Vector3 mundial, yaw: number} quando dentro do veículo
   */
  update(dt, focusPoint, interior = null) {
    // ---- [FPS] ADS: suaviza o zoom de mira e o FOV (só a pé; dentro de
    // veículo o enquadramento já é do modo, e o zoom ficaria estranho)
    const queroAds = this._adsQuero && (this.mode === 'foot' || this.mode === 'fps') ? 1 : 0;
    this.ads = damp(this.ads, queroAds, CAMERA.adsSpeed, Math.min(dt, 0.05));   // [CODM-FIX] clamp: sem salto de FOV/posicao em FPS baixo (frame snap)

    const fov = CAMERA.fov + (this._adsFov - CAMERA.fov) * this.ads;
    if (Math.abs(this.cam.fov - fov) > 0.01) {
      this.cam.fov = fov;
      this.cam.updateProjectionMatrix();
    }

    // ---- [FPS] o coice relaxa sozinho; em disparo contínuo ele empina
    const rec = Math.exp(-CAMERA.recoilRecover * dt);
    this._recoilP *= rec;
    this._recoilY *= rec;

    if (this.isInterior && interior) {
      this._updateInterior(dt, interior);
      return;
    }
    if (this.mode === 'fps') { this._updateFPS(dt, focusPoint); return; }

    /*
     * Olhar EFETIVO = olhar do jogador (mouse) + coice da arma.
     * O coice é um offset que relaxa sozinho: puxar o mouse para baixo
     * anula o recuo — o controle de FPS — e a câmera segue livre para
     * reposicionar a mira em cima do inimigo durante a rajada.
     */
    const yaw = this.yaw + this._recoilY;
    const pitch = clamp(this.pitch + this._recoilP, CAMERA.pitchMin, CAMERA.pitchMax);

    // ---- [FPS] a distância é SÓ do scroll; o ADS não puxa a câmera
    // (puxar gira a visão pelo ombro e a mira "anda" — o tiro sairia
    // fora do alvo). O zoom de mira agora é só o FOV, que não mexe na mira.
    if (this.mode === 'foot') {
      this.wantDistance = this._zoomScroll;
    }

    this.distance = damp(this.distance, this.wantDistance, 9, dt);

    this.focus.copy(focusPoint);
    if (this._first) { this._smoothFocus.copy(this.focus); this._first = false; }
    this._smoothFocus.x = damp(this._smoothFocus.x, this.focus.x, CAMERA.lag, dt);
    this._smoothFocus.y = damp(this._smoothFocus.y, this.focus.y, CAMERA.lag * 0.7, dt);
    this._smoothFocus.z = damp(this._smoothFocus.z, this.focus.z, CAMERA.lag, dt);

    // Direção para onde a câmera olha.
    // pitch negativo = olhando para baixo (câmera acima do alvo), que é o
    // padrão de um jogo em terceira pessoa; pitch positivo olha para cima.
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    const dir = new THREE.Vector3(
      -Math.sin(yaw) * cp,
      sp,
      -Math.cos(yaw) * cp,
    );

    let dist = this.distance;
    /*
     * [11] Olhar para cima encurta o braço da câmera.
     * Sem isto, um pitch alto joga a câmera para trás E para baixo do
     * jogador — ou seja, para dentro do chão. O clamp de piso lá embaixo a
     * devolvia para a superfície e o ângulo pedido evaporava: era por isso
     * que a visão "não subia" por mais que se puxasse o mouse.
     */
    const t = (pitch - CAMERA.pitchTuckStart) / (CAMERA.pitchMax - CAMERA.pitchTuckStart);
    dist *= 1 - clamp(t, 0, 1) * CAMERA.pitchTuck;

    // não deixa a câmera entrar dentro de prédio
    const back = dir.clone().negate();

    /*
     * [Ombro] Over-the-shoulder a pé, estilo COD Mobile: a câmera desloca
     * para o lado DIREITO do Bob — o lado da pistola — e o braço com a
     * arma fica visível no canto da tela em vez de escondido atrás do
     * corpo. O deslocamento entra na ORIGEM do raycast: a colisão protege
     * também a trajetória lateral, e a câmera não afunda numa parede ao
     * passar perto de um prédio.
     */
    // [CODM-ADS] No ADS o offset de ombro é anulado suavemente pelo mesmo
    // fator `this.ads` que controla o FOV — câmera e zoom transitam em sincronia.
    // Hip-fire: ombro = shoulderX (jogador à esquerda, arma visível).
    // ADS:      ombro → 0 (câmera centraliza, mira fica exatamente no centro).
    const ombroBase = this.mode === 'foot' ? CAMERA.shoulderX : (this.mode === 'heli-out' ? CAMERA.heliShoulderX : 0);
    const ombro = ombroBase;   // [CALIBRACAO] ombro fixo no ADS: a camera nao desliza, a mira permanece no alvo
    const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
    const baseX = this._smoothFocus.x + right.x * ombro;
    const baseZ = this._smoothFocus.z + right.z * ombro;

    const hit = this.col.raycast(
      baseX, this._smoothFocus.y, baseZ,
      back.x, back.y, back.z, dist + 0.6,
    );
    if (hit) dist = Math.max(CAMERA.minZoom * 0.45, hit.t - 0.45);

    // [ADS-ZOOM] Dolly over-the-shoulder: a camera desliza PARA FRENTE ao
    // longo da linha de visada (_look e relativo a _pos => o forward NAO
    // muda). O centro da tela permanece no mesmo ponto do mundo: a mira
    // fica fixa no alvo enquanto o FOV fecha 62 -> 45. Zoom estilo COD.
    dist *= 1 - CAMERA.adsDolly * this.ads;

    this._pos.copy(this._smoothFocus).addScaledVector(back, dist).addScaledVector(right, ombro);
    // e nunca abaixo do chão
    const floor = this.col.groundHeightAt(this._pos.x, this._pos.z, this._pos.y) + 0.45;
    const lift = Math.max(0, floor - this._pos.y);
    this._pos.y += lift;

    this.cam.position.copy(this._pos);

    // ===== [CODM-FPP] ADS 1a pessoa: blend TPP -> FPP =====
    // [FIX-TREMOR] SEM ancora: a camera do ADS olha SEMPRE na direcao do tiro (yaw/pitch).
    // O dolly suave p/ o olho faz o zoom sem girar o mundo — sem flick/tremido ao arrastar.
    const adsAmt = this.ads;
    if (adsAmt > 0.001) {
      // [FIX-TREMOR] SEM ANCORA DE MIRA: a camera do ADS olha SEMPRE na direcao do tiro (yaw/pitch).
      // O dolly suave TPP->FPP (lerp p/ o olho) faz o zoom sem girar nem oscilar o mundo:
      // nada de flick nem tremido ao segurar/arrastar o botao de fogo (Solo, MP e BR).
      const olhos = new THREE.Vector3(
        this._smoothFocus.x + dir.x * CAMERA.adsEyeForward,
        this._smoothFocus.y + CAMERA.adsEyeHeight,
        this._smoothFocus.z + dir.z * CAMERA.adsEyeForward,
      );
      this.cam.position.lerpVectors(this.cam.position, olhos, adsAmt);
    }
    this._look.copy(this.cam.position).addScaledVector(dir, 40);   // [CALIBRACAO] centro da tela = linha de tiro (yaw/pitch do jogador)
    this._look.y += lift + dist * this.frameLift;   // [CALIBRACAO] removido ads*1.5: a mira nao sobe no ADS
    this.cam.lookAt(this._look);

    // [S23-FIX] se a posicao/olhar da camera virar NaN (driver RDNA2 corrompe 1 frame),
    // todos os vertices explodem na tela (flicks verdes). Detecta e restaura o ultimo valor bom.
    if (!Number.isFinite(this.cam.position.x) || !Number.isFinite(this.cam.position.y) || !Number.isFinite(this.cam.position.z)) {
      this.cam.position.copy(this._smoothFocus);
      this._first = true;
    }

    this._applyShake(dt);
  }

  /**
   * Primeira pessoa — dentro das fases da campanha.
   *
   * Na arena a terceira pessoa não serve: o espaço é fechado, a câmera
   * bate na parede atrás do jogador e é empurrada para cima da nuca
   * dele, tapando justamente a mira. Em primeira pessoa o problema não
   * existe — a mira fica limpa e o cenário aparece inteiro, que é o
   * jeito certo de atirar num interior.
   */
  _updateFPS(dt, focusPoint) {
    // mesmo olhar efetivo da terceira pessoa: jogador + coice
    const yaw = this.yaw + this._recoilY;
    const pitch = clamp(this.pitch + this._recoilP, CAMERA.pitchMin, CAMERA.pitchMax);
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    const dir = new THREE.Vector3(
      -Math.sin(yaw) * cp,
      sp,
      -Math.cos(yaw) * cp,
    );

    // sem amortecimento de posição: em primeira pessoa qualquer atraso
    // entre o passo e a vista dá enjoo
    this._pos.copy(focusPoint);
    this._pos.y += 0.16;                  // dos ombros para a altura dos olhos
    this.cam.position.copy(this._pos);

    this._look.copy(this._pos).add(dir);
    this.cam.lookAt(this._look);
    // [S23-FIX] anti-NaN
    if (!Number.isFinite(this.cam.position.x) || !Number.isFinite(this.cam.position.y) || !Number.isFinite(this.cam.position.z)) {
      this.cam.position.copy(this._pos).setY(Math.max(0, this._pos.y));
    }
    this._applyShake(dt);
  }

  /** [17] Dentro do carro / [25] cockpit do helicóptero. */
  _updateInterior(dt, interior) {
    this.cam.position.copy(interior.position);

    // o olhar é livre, mas ancorado à orientação do veículo: girar o mouse
    // vira a cabeça dentro da cabine, e há um limite para não olhar "através" do banco
    const rel = clamp(dampAngle(0, this.yaw - this._interiorBase, 999, dt), -2.3, 2.3);
    const yaw = interior.yaw + rel;
    const pitch = clamp(this.pitch, CAMERA.pitchMinInterior, CAMERA.pitchMaxInterior);

    const look = new THREE.Vector3(
      interior.position.x + Math.sin(yaw) * Math.cos(pitch) * 10,
      interior.position.y + Math.sin(pitch) * 10,
      interior.position.z + Math.cos(yaw) * Math.cos(pitch) * 10,
    );
    this.cam.lookAt(look);
    if (interior.roll) this.cam.rotateZ(-interior.roll * 0.5);
    this._applyShake(dt);
  }

  /** Define a referência de "olhando para a frente" ao entrar no veículo. */
  setInteriorBase(yaw) {
    this._interiorBase = yaw;
  }

  _applyShake(dt) {
    if (this.shake <= 0.001) return;
    const s = this.shake;
    this.cam.position.x += (Math.random() - 0.5) * s * 0.5;
    this.cam.position.y += (Math.random() - 0.5) * s * 0.5;
    this.cam.position.z += (Math.random() - 0.5) * s * 0.5;
    this.shake = Math.max(0, this.shake - dt * 2.4);
  }

  /**
   * [37][42] Raio de tiro que passa exatamente pela mira, posicionada
   * a 62% da largura (NDC x = +0.24) e 2/5 do topo (NDC y = +0.2) — o
   * mesmo deslocamento da mira no celular, estilo COD Mobile.
   */
  aimRay(origin = new THREE.Vector3(), direction = new THREE.Vector3(), ndcX = 0, ndcY = 0) {
    // unproject depende de matrizes atualizadas; o tiro pode ser disparado
    // pelo teclado, fora do momento em que o three atualiza a cena
    this.cam.updateMatrixWorld();
    /*
     * [FPS] A mira fica SEMPRE no CENTRO da tela (0.5, 0.5) — hip-fire e
     * ADS. Ao mirar, a câmera apenas APROXIMA (dolly) + fecha o FOV; a
     * linha de visada NAO muda, entao o tiro sai exatamente no retículo.
     */
    const ndc = new THREE.Vector3(ndcX, ndcY, 0.5);
    ndc.unproject(this.cam);
    origin.copy(this.cam.position);
    direction.copy(ndc).sub(origin).normalize();
    return { origin, direction };
  }
}
