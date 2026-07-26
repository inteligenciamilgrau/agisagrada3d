import * as THREE from 'three';
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
  }

  setMode(mode) {
    if (this.mode === mode) return;
    this.mode = mode;
    if (mode === 'foot') this.wantDistance = CAMERA.defaultZoom;
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
    this.wantDistance = clamp(this.wantDistance + steps * 0.9, CAMERA.minZoom, CAMERA.maxZoom);
  }

  addShake(amount) {
    this.shake = Math.min(1.4, this.shake + amount);
  }

  /**
   * @param {THREE.Vector3} focusPoint alvo que a câmera acompanha
   * @param {object} interior {position: Vector3 mundial, yaw: number} quando dentro do veículo
   */
  update(dt, focusPoint, interior = null) {
    if (this.isInterior && interior) {
      this._updateInterior(dt, interior);
      return;
    }
    if (this.mode === 'fps') { this._updateFPS(dt, focusPoint); return; }

    this.distance = damp(this.distance, this.wantDistance, 9, dt);

    this.focus.copy(focusPoint);
    if (this._first) { this._smoothFocus.copy(this.focus); this._first = false; }
    this._smoothFocus.x = damp(this._smoothFocus.x, this.focus.x, CAMERA.lag, dt);
    this._smoothFocus.y = damp(this._smoothFocus.y, this.focus.y, CAMERA.lag * 0.7, dt);
    this._smoothFocus.z = damp(this._smoothFocus.z, this.focus.z, CAMERA.lag, dt);

    // Direção para onde a câmera olha.
    // pitch negativo = olhando para baixo (câmera acima do alvo), que é o
    // padrão de um jogo em terceira pessoa; pitch positivo olha para cima.
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const dir = new THREE.Vector3(
      -Math.sin(this.yaw) * cp,
      sp,
      -Math.cos(this.yaw) * cp,
    );

    let dist = this.distance;
    /*
     * [11] Olhar para cima encurta o braço da câmera.
     * Sem isto, um pitch alto joga a câmera para trás E para baixo do
     * jogador — ou seja, para dentro do chão. O clamp de piso lá embaixo a
     * devolvia para a superfície e o ângulo pedido evaporava: era por isso
     * que a visão "não subia" por mais que se puxasse o mouse.
     */
    const t = (this.pitch - CAMERA.pitchTuckStart) / (CAMERA.pitchMax - CAMERA.pitchTuckStart);
    dist *= 1 - clamp(t, 0, 1) * CAMERA.pitchTuck;

    // não deixa a câmera entrar dentro de prédio
    const back = dir.clone().negate();
    const hit = this.col.raycast(
      this._smoothFocus.x, this._smoothFocus.y, this._smoothFocus.z,
      back.x, back.y, back.z, dist + 0.6,
    );
    if (hit) dist = Math.max(CAMERA.minZoom * 0.45, hit.t - 0.45);

    this._pos.copy(this._smoothFocus).addScaledVector(back, dist);
    // e nunca abaixo do chão
    const floor = this.col.groundHeightAt(this._pos.x, this._pos.z, this._pos.y) + 0.45;
    const lift = Math.max(0, floor - this._pos.y);
    this._pos.y += lift;

    this.cam.position.copy(this._pos);
    /*
     * A mira sobe o MESMO tanto que o chão empurrou a câmera para cima. Assim
     * a direção do olhar continua sendo exatamente a que o jogador pediu:
     * quando nada empurra (lift = 0) o alvo é o de sempre, e quando o chão
     * levanta a câmera ela passa a olhar por cima do jogador em vez de
     * "endireitar" a vista de volta para a horizontal.
     */
    this._look.copy(this._smoothFocus);
    this._look.y += lift + dist * this.frameLift;
    this.cam.lookAt(this._look);
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
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const dir = new THREE.Vector3(
      -Math.sin(this.yaw) * cp,
      sp,
      -Math.cos(this.yaw) * cp,
    );

    // sem amortecimento de posição: em primeira pessoa qualquer atraso
    // entre o passo e a vista dá enjoo
    this._pos.copy(focusPoint);
    this._pos.y += 0.16;                  // dos ombros para a altura dos olhos
    this.cam.position.copy(this._pos);

    this._look.copy(this._pos).add(dir);
    this.cam.lookAt(this._look);
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
   * a 2/5 do topo da tela (NDC y = +0.2).
   */
  aimRay(origin = new THREE.Vector3(), direction = new THREE.Vector3()) {
    // unproject depende de matrizes atualizadas; o tiro pode ser disparado
    // pelo teclado, fora do momento em que o three atualiza a cena
    this.cam.updateMatrixWorld();
    const ndc = new THREE.Vector3(0, 0.2, 0.5);
    ndc.unproject(this.cam);
    origin.copy(this.cam.position);
    direction.copy(ndc).sub(origin).normalize();
    return { origin, direction };
  }
}
