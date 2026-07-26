import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { HELI } from '../config.js';
import { clamp, damp, angleDelta } from '../utils.js';

/**
 * [43] Helicóptero: fica no heliporto e é pilotável com F.
 * [46] Pousa no topo dos prédios (usa a altura de laje da colisão).
 * [49] Só dá para sair quando está perto do chão.
 */
export class Helicopter {
  constructor(scene, collision) {
    this.col = collision;
    this.root = new THREE.Group();
    this.root.name = 'helicopter';
    scene.add(this.root);

    this._build();

    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.roll = 0;
    this.rotorAngle = 0;
    this.rotorSpin = 0;        // 0..1 (dá partida ao entrar)
    this.piloted = false;
    this.groundY = 0;
  }

  _build() {
    const bodyMat = new THREE.MeshPhysicalMaterial({
      color: 0x1f4f8f, roughness: 0.34, metalness: 0.55,
      clearcoat: 0.8, clearcoatRoughness: 0.12, envMapIntensity: 1.4,
    });
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x22262d, roughness: 0.5, metalness: 0.75 });
    const glassMat = new THREE.MeshStandardMaterial({
      color: 0x14202c, roughness: 0.05, metalness: 0.9, envMapIntensity: 2.4,
      transparent: true, opacity: 0.75,
    });

    // ---------------------------------------------------------- fuselagem
    const shell = [];
    const cabin = new THREE.SphereGeometry(1.5, 22, 16);
    cabin.scale(1.05, 1.0, 1.55);
    cabin.translate(0, 1.85, 0.35);
    shell.push(cabin);
    const belly = new THREE.BoxGeometry(2.3, 0.9, 3.4);
    belly.translate(0, 1.15, 0.1);
    shell.push(belly);
    // cauda
    const boom = new THREE.CylinderGeometry(0.34, 0.22, 4.8, 12);
    boom.rotateX(Math.PI / 2);
    boom.translate(0, 2.1, -3.4);
    shell.push(boom);
    // deriva vertical
    const fin = new THREE.BoxGeometry(0.16, 1.5, 0.95);
    fin.translate(0, 2.7, -5.5);
    shell.push(fin);
    // estabilizador horizontal
    const stab = new THREE.BoxGeometry(2.4, 0.13, 0.7);
    stab.translate(0, 2.2, -4.9);
    shell.push(stab);

    this.bodyMesh = new THREE.Mesh(mergeGeometries(shell, false), bodyMat);
    this.bodyMesh.castShadow = true;               // [44]
    this.bodyMesh.receiveShadow = true;
    this.root.add(this.bodyMesh);

    // ---------------------------------------------------------- vidro
    const canopy = new THREE.SphereGeometry(1.44, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.62);
    canopy.scale(1.02, 1.15, 1.5);
    canopy.rotateX(Math.PI * 0.13);
    canopy.translate(0, 1.9, 0.6);
    this.canopy = new THREE.Mesh(canopy, glassMat);
    this.root.add(this.canopy);

    // ---------------------------------------------------------- patins
    const gear = [];
    for (const sx of [-1, 1]) {
      const skid = new THREE.CylinderGeometry(0.11, 0.11, 4.0, 8);
      skid.rotateX(Math.PI / 2);
      skid.translate(sx * 1.15, 0.12, 0.2);
      gear.push(skid);
      for (const sz of [-1.1, 1.3]) {
        const strut = new THREE.CylinderGeometry(0.08, 0.08, 1.05, 6);
        strut.rotateZ(sx * 0.28);
        strut.translate(sx * 1.05, 0.62, sz);
        gear.push(strut);
      }
    }
    // [63] trilhos de míssil pendurados nos patins
    for (const sx of [-1, 1]) {
      const pilone = new THREE.CylinderGeometry(0.07, 0.07, 0.5, 6);
      pilone.translate(sx * 1.45, 0.72, 0.55);
      gear.push(pilone);
      const casulo = new THREE.CylinderGeometry(0.2, 0.2, 1.5, 10);
      casulo.rotateX(Math.PI / 2);
      casulo.translate(sx * 1.45, 0.46, 0.55);
      gear.push(casulo);
      const bico = new THREE.ConeGeometry(0.2, 0.4, 10);
      bico.rotateX(Math.PI / 2);
      bico.translate(sx * 1.45, 0.46, 1.5);
      gear.push(bico);
    }

    const gearMesh = new THREE.Mesh(mergeGeometries(gear, false), darkMat);
    gearMesh.castShadow = true;
    this.root.add(gearMesh);

    // ---------------------------------------------------------- rotor principal
    this.rotorHub = new THREE.Group();
    this.rotorHub.position.set(0, 3.35, 0.2);
    this.root.add(this.rotorHub);

    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.22, 0.7, 10), darkMat);
    mast.position.y = -0.3;
    this.rotorHub.add(mast);

    const bladeGeo = new THREE.BoxGeometry(11.5, 0.07, 0.42);
    for (let i = 0; i < 4; i++) {
      const blade = new THREE.Mesh(bladeGeo, darkMat);
      blade.rotation.y = (i / 4) * Math.PI * 2;
      blade.castShadow = true;
      this.rotorHub.add(blade);
    }
    // disco translúcido que aparece quando o rotor acelera
    this.rotorDisc = new THREE.Mesh(
      new THREE.CircleGeometry(5.9, 32),
      new THREE.MeshBasicMaterial({
        color: 0xaab4c2, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false,
      }),
    );
    this.rotorDisc.rotation.x = -Math.PI / 2;
    this.rotorHub.add(this.rotorDisc);

    // ---------------------------------------------------------- rotor de cauda
    this.tailHub = new THREE.Group();
    this.tailHub.position.set(0.22, 2.7, -5.5);
    this.root.add(this.tailHub);
    const tailBlade = new THREE.BoxGeometry(0.08, 2.2, 0.24);
    for (let i = 0; i < 2; i++) {
      const b = new THREE.Mesh(tailBlade, darkMat);
      b.rotation.x = (i / 2) * Math.PI;
      this.tailHub.add(b);
    }

    // ---------------------------------------------------------- luzes
    this.beacon = new THREE.Mesh(
      new THREE.SphereGeometry(0.13, 8, 6),
      new THREE.MeshBasicMaterial({ color: 0xff2020, toneMapped: false }),
    );
    this.beacon.position.set(0, 0.72, -1.4);
    this.root.add(this.beacon);

    this.searchlight = new THREE.SpotLight(0xfff4d8, 0, 130, 0.30, 0.5, 1.3);
    this.searchlight.position.set(0, 0.9, 1.4);
    this.searchlight.target.position.set(0, -12, 6);
    this.root.add(this.searchlight, this.searchlight.target);
  }

  placeAt(x, y, z, yaw = 0) {
    this.root.position.set(x, y, z);
    this.yaw = yaw;
    this.root.rotation.y = yaw;
    this.groundY = y;
  }

  /**
   * Altura do solo (ou da laje) logo abaixo — usado para pousar. [46]
   *
   * Antes só olhava para as lajes (`roofHeightAt`) e caía num piso fixo de
   * 0,24 quando não havia prédio. Isso funcionava enquanto o mapa era só a
   * cidade plana; com morro, lago, ponte, estrada da serra e as plataformas
   * do bondinho, pousar fora do asfalto deixava o aparelho boiando (terreno
   * baixo) ou enterrado (terreno alto). Agora vale a maior entre a laje e a
   * superfície caminhável de verdade.
   */
  surfaceBelow() {
    const p = this.root.position;
    const laje = this.col.roofHeightAt(p.x, p.z);          // 0 se não há prédio
    const chao = this.col.groundHeightAt(p.x, p.z, p.y);
    return Math.max(laje, chao == null ? 0.24 : chao);
  }

  get altitude() {
    return this.root.position.y - this.surfaceBelow();
  }

  /** [49] Só sai se estiver quase pousado. */
  get canExit() {
    return this.altitude < HELI.exitMaxHeight;
  }

  get isLanded() {
    return this.altitude <= HELI.landHeight + 0.06;
  }

  /**
   * @param {object} input {forward, strafe, up, down, yawLeft, yawRight}
   */
  update(dt, input, nightFactor = 0) {
    // rotor acelera ao entrar e desacelera ao sair
    const targetSpin = this.piloted ? 1 : (this.isLanded ? 0.08 : 1);
    this.rotorSpin = damp(this.rotorSpin, targetSpin, 1.4, dt);
    this.rotorAngle += dt * HELI.rotorSpeed * this.rotorSpin;
    this.rotorHub.rotation.y = this.rotorAngle;
    this.tailHub.rotation.x = -this.rotorAngle * 2.4;
    // o disco é MeshBasic (não recebe luz), então à noite precisa escurecer
    // na mão — senão vira uma chapa clara flutuando sobre a cidade escura
    this.rotorDisc.material.opacity =
      clamp((this.rotorSpin - 0.55) / 0.45, 0, 1) * 0.22 * (1 - nightFactor * 0.8);

    if (!this.piloted) {
      // parado no heliponto: só o beacon piscando
      this.beacon.visible = Math.sin(performance.now() * 0.006) > 0;
      this.searchlight.intensity = 0;
      this._settleOnGround(dt);
      return;
    }

    this.beacon.visible = Math.sin(performance.now() * 0.009) > 0;

    // ------------------------------------------------ comandos
    const power = clamp(this.rotorSpin, 0, 1);

    // [11] guinada pelo mouse: o nariz busca o rumo da câmera.
    // `desiredYaw` só vem preenchido na câmera externa (na interna o mouse
    // olha pela cabine, e esterçar junto criaria realimentação).
    if (input.desiredYaw != null) {
      const d = angleDelta(this.yaw, input.desiredYaw);
      this.yaw += clamp(d * 2.0, -HELI.yawRate, HELI.yawRate) * dt * power;
    }
    // Q/R continuam como guinada manual
    this.yaw += (input.yawLeft - input.yawRight) * HELI.yawRate * dt * power;

    /*
     * Convenções deste modelo (o nariz é +Z, a cauda é -Z):
     *
     *   rotação em X (pitch) > 0  ->  leva o nariz (+Z) para -Y = BICO PARA BAIXO
     *   rotação em Z (roll)  > 0  ->  levanta a lateral local +X (o lado
     *                                 esquerdo do aparelho) = BANCA PARA A DIREITA
     *
     * Voando para a frente o helicóptero abaixa o bico, então o pitch
     * acompanha `forward` com sinal POSITIVO. O mesmo vale para o roll ao
     * deslocar para a direita.
     */
    const wantPitch = clamp(input.forward * 0.42, -0.42, 0.42);
    const wantRoll = clamp(input.strafe * 0.40, -0.40, 0.40);
    this.pitch = damp(this.pitch, wantPitch, 4.5, dt);
    this.roll = damp(this.roll, wantRoll, 4.5, dt);

    // frente e direita do aparelho. A direita segue a mesma regra do resto do
    // projeto: right = (-fz, fx). Com o nariz em +Z, a direita é -X.
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    const rx = -Math.cos(this.yaw), rz = Math.sin(this.yaw);

    const accel = HELI.tiltAccel * power;
    this.vel.x += (fx * input.forward + rx * input.strafe) * accel * dt;
    this.vel.z += (fz * input.forward + rz * input.strafe) * accel * dt;

    // vertical
    const lift = (input.up - input.down) * HELI.liftAccel * power;
    this.vel.y += lift * dt;
    if (input.up === 0 && input.down === 0) this.vel.y = damp(this.vel.y, 0, 2.2, dt);
    if (power < 0.5) this.vel.y -= 9 * dt * (1 - power);   // sem rotor, cai

    // arrasto
    const drag = Math.exp(-HELI.drag * dt);
    this.vel.x *= drag; this.vel.z *= drag;
    this.vel.y = clamp(this.vel.y, -HELI.maxLift, HELI.maxLift);

    const hs = Math.hypot(this.vel.x, this.vel.z);
    if (hs > HELI.maxSpeed) {
      this.vel.x *= HELI.maxSpeed / hs;
      this.vel.z *= HELI.maxSpeed / hs;
    }

    // ------------------------------------------------ integração + colisão
    const p = this.root.position;
    const yAntes = p.y;
    p.x += this.vel.x * dt;
    p.y += this.vel.y * dt;
    p.z += this.vel.z * dt;

    /*
     * [46] Assenta na laje ANTES de empurrar para fora dos sólidos — mas só
     * se o aparelho já vinha POR CIMA dela.
     *
     * As duas condições são necessárias e por motivos opostos:
     *  - sem a checagem de `yAntes`, voar contra a fachada de um prédio
     *    teleportaria o helicóptero para o telhado;
     *  - sem esta passada, descer em cima de um prédio o expulsava. Descendo
     *    a 16 m/s ele afunda 0,27 m por quadro, e como o pouso deixa só 2 cm
     *    de folga, o quadro seguinte via o aparelho "dentro" da caixa do
     *    prédio e o empurrava para fora do telhado — ele então despencava
     *    até a laje do vizinho. Só aparecia depois que o pouso passou a
     *    encostar de verdade no chão; com a folga antiga de 1,15 m o
     *    afundamento nunca alcançava o topo da caixa.
     */
    const minPouso = this.surfaceBelow() + HELI.landHeight;
    if (p.y < minPouso && yAntes >= minPouso - 0.02) {
      p.y = minPouso;
      if (this.vel.y < 0) this.vel.y = 0;
    }

    // [31] não atravessa prédios: empurra para fora das caixas mais altas que ele
    const before = { x: p.x, z: p.z, y: p.y };
    if (this.col.resolveCircle(p, 3.2)) {
      this.vel.x = (p.x - before.x) * 6;
      this.vel.z = (p.z - before.z) * 6;
    }

    // pouso (já com a posição horizontal resolvida)
    const surf = this.surfaceBelow();
    const minY = surf + HELI.landHeight;
    if (p.y < minY) {
      p.y = minY;
      if (this.vel.y < 0) this.vel.y = 0;
      // atrito ao tocar o solo
      this.vel.x *= 0.86; this.vel.z *= 0.86;
    }
    if (p.y > 420) { p.y = 420; this.vel.y = Math.min(0, this.vel.y); }

    this.root.rotation.set(this.pitch, this.yaw, this.roll, 'YXZ');

    this.searchlight.intensity = nightFactor > 0.4 ? 900 : 0;
  }

  _settleOnGround(dt) {
    const surf = this.surfaceBelow();
    const minY = surf + HELI.landHeight;
    if (this.root.position.y > minY) {
      this.root.position.y = Math.max(minY, this.root.position.y - 6 * dt);
    }
    this.root.rotation.set(0, this.yaw, 0, 'YXZ');
  }

  /** [25] Na visão de cockpit a bolha de vidro escura sai da frente. */
  setInteriorView(on) {
    this.canopy.visible = !on;
  }

  enter() {
    this.piloted = true;
  }

  exit() {
    this.piloted = false;
    this.vel.set(0, 0, 0);
    this.pitch = 0; this.roll = 0;
  }

  /**
   * [63] Boca do trilho de míssil. `lado` alterna entre -1 e 1 para os
   * disparos saírem de um pilone de cada vez, como numa salva de verdade.
   */
  hardpoint(lado, out = new THREE.Vector3()) {
    this.root.updateMatrixWorld();
    out.set(lado * 1.45, 0.46, 1.7);
    return this.root.localToWorld(out);
  }

  /** Ponto de embarque/desembarque ao lado da porta. */
  doorPosition(out = new THREE.Vector3()) {
    const p = this.root.position;
    out.set(p.x + Math.cos(this.yaw) * 2.6, this.surfaceBelow(), p.z - Math.sin(this.yaw) * 2.6);
    return out;
  }
}
