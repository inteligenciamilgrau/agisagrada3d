import * as THREE from 'three';
import { PLAYER, CURB_H } from './config.js';
import { clamp, damp, dampAngle, makeRng } from './utils.js';
import { Human } from './ent/human.js';

/**
 * [14] Jogador em terceira pessoa. [11] WASD relativo à câmera,
 * [30] Shift corre, [36] espaço pula, [31] colide com prédios/postes/árvores.
 */
export class Player {
  constructor(scene, collision) {
    this.col = collision;

    const rng = makeRng(2024);
    this.human = new Human({
      rng,
      shirt: 0x1d6fd0,          // uniforme de entregador
      pants: 0x2a2f38,
      scale: 1.02,
      fullShadow: true,         // o jogador está sempre em primeiro plano
    });
    this.human.root.name = 'player';
    scene.add(this.human.root);

    this.pos = new THREE.Vector3(0, CURB_H, 0);
    this.vy = 0;
    this.yaw = 0;
    this.speed = 0;
    this.grounded = true;
    this.inWater = false;
    this.visible = true;

    // [50] pacote que aparece nas mãos
    this.pack = this._makePackage();
    this.pack.visible = false;
    this.human.pivot.add(this.pack);

    this._move = new THREE.Vector3();
  }

  _makePackage() {
    const g = new THREE.Group();
    const box = new THREE.Mesh(
      new THREE.BoxGeometry(0.34, 0.28, 0.30),
      new THREE.MeshStandardMaterial({ color: 0xc08a4a, roughness: 0.9, metalness: 0.02 }),
    );
    box.castShadow = true;
    g.add(box);
    // fita adesiva cruzada
    const tapeMat = new THREE.MeshStandardMaterial({ color: 0xe8dcc0, roughness: 0.7 });
    const t1 = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.06, 0.02), tapeMat);
    t1.position.z = 0.152;
    g.add(t1);
    const t2 = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.30, 0.02), tapeMat);
    t2.position.z = 0.152;
    g.add(t2);
    const t3 = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.06, 0.02), tapeMat);
    t3.position.y = 0.142; t3.rotation.x = Math.PI / 2;
    g.add(t3);

    g.position.set(0, 1.16, 0.36);      // à frente do peito, entre as mãos
    return g;
  }

  setCarrying(on) {
    this.human.carrying = on;
    this.pack.visible = on;
  }

  setVisible(v) {
    this.visible = v;
    this.human.root.visible = v;
  }

  teleport(x, z, y = null) {
    this.pos.set(x, y ?? this.col.groundHeightAt(x, z), z);
    this.vy = 0;
    this.human.root.position.copy(this.pos);
  }

  /** Altura do piso sob o jogador (calçada, ponte, laje de prédio ou água). */
  _floorAt(x, z) {
    // a altura atual desempata plataformas empilhadas (estrada em espiral)
    let g = this.col.groundHeightAt(x, z, this.pos.y);
    // [46] permite andar em laje quando desce de helicóptero
    const roof = this.col.roofHeightAt(x, z);
    if (roof > g && this.pos.y >= roof - 0.35) g = roof;
    return g;
  }

  update(dt, input, camYaw, frozen = false) {
    if (frozen) {
      this.human.update(dt, 0);
      return;
    }

    // ------------------------------------------------ direção relativa à câmera
    const fx = -Math.sin(camYaw), fz = -Math.cos(camYaw);
    const rx = -fz, rz = fx;

    const ax = input.axes;
    let dx = fx * ax.forward + rx * ax.strafe;
    let dz = fz * ax.forward + rz * ax.strafe;
    const mag = Math.hypot(dx, dz);
    if (mag > 0.001) { dx /= mag; dz /= mag; }

    this.inWater = this.col.isInWater(this.pos.x, this.pos.z);

    // [30] Shift corre
    let maxSpeed = input.running ? PLAYER.runSpeed : PLAYER.walkSpeed;
    if (this.inWater) maxSpeed *= 0.45;

    const wanted = mag > 0.001 ? maxSpeed : 0;
    this.speed = damp(this.speed, wanted, PLAYER.accel / Math.max(1, maxSpeed), dt);

    /*
     * [11][14] O MOUSE define para onde o jogador olha, não o movimento.
     * O corpo acompanha a câmera mesmo parado, então WASD vira deslocamento
     * relativo: A e D andam de lado sem virar as costas, e o tiro sai sempre
     * na direção em que o personagem está encarando.
     *
     * A frente da câmera no chão é (-sin, -cos) e o personagem olha para +Z,
     * logo a rotação do corpo é o yaw da câmera + PI.
     */
    this.yaw = dampAngle(this.yaw, camYaw + Math.PI, PLAYER.turnSmooth, dt);
    if (mag > 0.001) this._move.set(dx, 0, dz);

    // ------------------------------------------------ [36] pulo e gravidade
    if (this.grounded && input.jumping && !this.inWater) {
      this.vy = PLAYER.jumpSpeed;
      this.grounded = false;
    }
    this.vy -= PLAYER.gravity * dt;

    // ------------------------------------------------ integra e resolve colisão
    if (this.speed > 0.01 && mag > 0.001) {
      this.pos.x += this._move.x * this.speed * dt;
      this.pos.z += this._move.z * this.speed * dt;
    }
    this.pos.y += this.vy * dt;

    // [31] prédios, postes, árvores e guarda-corpos empurram o jogador
    this.col.resolveCircle(this.pos, PLAYER.radius);

    const floor = this._floorAt(this.pos.x, this.pos.z);
    if (this.pos.y <= floor) {
      this.pos.y = floor;
      this.vy = 0;
      this.grounded = true;
    } else {
      this.grounded = false;
    }

    // ------------------------------------------------ malha
    this.human.root.position.copy(this.pos);
    this.human.root.rotation.y = this.yaw;
    this.human.update(dt, this.grounded ? this.speed : this.speed * 0.35);

    // afunda um pouco na água
    if (this.inWater) this.human.root.position.y -= 0.12;
  }

  /**
   * [60] MODO DEUS: voo livre pelo mapa.
   *
   * É o mesmo corpo do jogador — só a integração muda: sem gravidade, sem
   * colisão e sem pulo. Os controles copiam os do helicóptero de propósito
   * (`Espaço` sobe, `Shift` desce), porque é o que a mão já sabe fazer.
   *
   * O único limite que sobra é o chão: voar POR DENTRO do terreno deixaria a
   * câmera dentro da rocha, sem referência nenhuma de para onde voltar.
   */
  updateFly(dt, input, camYaw) {
    const fx = -Math.sin(camYaw), fz = -Math.cos(camYaw);
    const rx = -fz, rz = fx;

    const ax = input.axes;
    let dx = fx * ax.forward + rx * ax.strafe;
    let dz = fz * ax.forward + rz * ax.strafe;
    const mag = Math.hypot(dx, dz);
    if (mag > 0.001) { dx /= mag; dz /= mag; }

    const turbo = input.boosting ? PLAYER.flyBoost : 1;
    const wanted = mag > 0.001 ? PLAYER.flySpeed * turbo : 0;
    this.speed = damp(this.speed, wanted, 8, dt);
    if (mag > 0.001) this._move.set(dx, 0, dz);

    this.pos.x += this._move.x * this.speed * dt;
    this.pos.z += this._move.z * this.speed * dt;

    const sobe = (input.jumping ? 1 : 0) - (input.running ? 1 : 0);
    this.vy = damp(this.vy, sobe * PLAYER.flyUpSpeed * turbo, 8, dt);
    this.pos.y += this.vy * dt;

    const floor = this._floorAt(this.pos.x, this.pos.z);
    if (this.pos.y < floor) { this.pos.y = floor; this.vy = Math.max(0, this.vy); }
    if (this.pos.y > 430) { this.pos.y = 430; this.vy = Math.min(0, this.vy); }

    this.yaw = dampAngle(this.yaw, camYaw + Math.PI, PLAYER.turnSmooth, dt);
    this.grounded = false;
    this.inWater = false;

    this.human.root.position.copy(this.pos);
    this.human.root.rotation.y = this.yaw;
    this.human.update(dt, 0);              // pernas paradas: está flutuando
  }

  /** Ponto que a câmera acompanha (altura dos ombros). */
  focusPoint(out = new THREE.Vector3()) {
    return out.set(this.pos.x, this.pos.y + 1.48, this.pos.z);
  }

  get position() { return this.pos; }
}
