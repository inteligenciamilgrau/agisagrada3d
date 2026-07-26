import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { PALETTE } from '../config.js';
import { clamp, rngPick, rngRange } from '../utils.js';
import { numberTexture } from '../gfx/textures.js';

/**
 * [18] Personagem com braços e pernas articulados.
 * Corpo, cabeça e cabelo viram uma malha só com cores por vértice (1 material
 * por pessoa); apenas os membros ficam separados, porque precisam girar.
 */

const HIP_Y = 0.92;
const THIGH = 0.45;
const SHIN = 0.43;
const SHOULDER_Y = 1.38;
const SHOULDER_X = 0.205;
const UPPER_ARM = 0.32;
const FOREARM = 0.30;

/** Pinta todos os vértices de uma geometria com uma cor. */
function paint(geo, hex) {
  const c = new THREE.Color(hex);
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

function box(w, h, d, x, y, z, hex) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  return paint(g, hex);
}

function sphere(r, x, y, z, hex, sy = 1, sz = 1) {
  const g = new THREE.SphereGeometry(r, 12, 9);
  g.scale(1, sy, sz);
  g.translate(x, y, z);
  return paint(g, hex);
}

export class Human {
  /**
   * @param {object} opts {rng, shirt, pants, skin, hair, scale, number}
   */
  constructor(opts = {}) {
    const rng = opts.rng || Math.random;
    /*
     * Cada pessoa são 10 malhas (tronco + 4 segmentos de braço + 4 de perna +
     * número). Se todas lançarem sombra, o passe de sombra explode: medido em
     * 414 draw calls só de pedestres, contra ~100 do mundo inteiro.
     *
     * Por padrão só o TRONCO lança sombra — a silhueta no chão continua sendo
     * de uma pessoa. O jogador usa `fullShadow` porque está sempre em primeiro
     * plano e é uma entidade só.
     */
    this.fullShadow = opts.fullShadow === true;
    this.shirt = opts.shirt ?? rngPick(rng, PALETTE.shirt);
    this.pants = opts.pants ?? rngPick(rng, PALETTE.pants);
    this.skin = opts.skin ?? rngPick(rng, PALETTE.skin);
    this.hair = opts.hair ?? rngPick(rng, PALETTE.hair);
    const shoe = 0x22252b;

    this.root = new THREE.Group();
    this.pivot = new THREE.Group();          // usado para o bobbing vertical
    this.root.add(this.pivot);

    // um único material por pessoa — as cores vêm dos vértices
    this.material = new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.78, metalness: 0.03,
    });

    /*
     * ------------------------------------------------------------ tronco
     * Alturas ABSOLUTAS, porque o empilhamento aqui é fácil de errar: com
     * offsets relativos o peito subia até 1.58 enquanto a cabeça começava em
     * 1.45, e a camiseta cobria o queixo e a boca.
     *
     *   0.83 ── 1.05   quadril (calça)
     *   1.02 ── 1.30   abdômen (camiseta)
     *   1.22 ── 1.44   peito (camiseta)   <- topo NO ombro, nunca acima
     *   1.40 ── 1.51   pescoço (pele)
     *   1.47 ── 1.77   cabeça (pele)      <- começa acima do peito
     */
    const CHEST_TOP = 1.44;
    const HEAD_Y = 1.62, HEAD_R = 0.125, HEAD_SY = 1.18;

    const bodyParts = [
      box(0.34, 0.22, 0.23, 0, 0.94, 0, this.pants),                // quadril
      box(0.40, 0.28, 0.24, 0, 1.16, 0, this.shirt),                // abdômen
      box(0.44, 0.22, 0.26, 0, CHEST_TOP - 0.11, 0, this.shirt),    // peito
      sphere(0.095, SHOULDER_X, SHOULDER_Y, 0, this.shirt),
      sphere(0.095, -SHOULDER_X, SHOULDER_Y, 0, this.shirt),
      box(0.10, 0.11, 0.10, 0, 1.455, 0, this.skin),                // pescoço
      sphere(HEAD_R, 0, HEAD_Y, 0.006, this.skin, HEAD_SY, 1.04),   // cabeça
    ];
    // cabelo: calota por cima da cabeça
    const hairGeo = new THREE.SphereGeometry(HEAD_R * 1.06, 12, 9, 0, Math.PI * 2, 0, Math.PI * 0.58);
    hairGeo.scale(1, HEAD_SY * 0.96, 1.04);
    hairGeo.translate(0, HEAD_Y + 0.02, 0);
    bodyParts.push(paint(hairGeo, this.hair));

    this.body = new THREE.Mesh(mergeGeometries(bodyParts, false), this.material);
    this.body.castShadow = true;               // [44]
    this.body.receiveShadow = true;
    this.pivot.add(this.body);

    // ------------------------------------------------------------ braços
    this.armL = this._makeArm(1);
    this.armR = this._makeArm(-1);
    this.pivot.add(this.armL.group, this.armR.group);

    // ------------------------------------------------------------ pernas
    this.legL = this._makeLeg(1, shoe);
    this.legR = this._makeLeg(-1, shoe);
    this.pivot.add(this.legL.group, this.legR.group);

    // ------------------------------------------------------------ [55] número nas costas
    if (opts.number != null) {
      this.number = String(opts.number);
      const plane = new THREE.PlaneGeometry(0.30, 0.15);
      const mat = new THREE.MeshStandardMaterial({
        map: numberTexture(this.number), roughness: 0.9, metalness: 0,
      });
      this.numberMesh = new THREE.Mesh(plane, mat);
      this.numberMesh.rotation.y = Math.PI;                 // olha para -Z (costas)
      // centralizado nas costas do peito (que agora vai de 1.22 a 1.44)
      this.numberMesh.position.set(0, 1.33, -0.131);
      this.numberMesh.castShadow = false;
      this.pivot.add(this.numberMesh);
    }

    const s = opts.scale ?? 1;
    this.root.scale.setScalar(s);
    this.height = 1.75 * s;

    this.phase = rngRange(rng, 0, Math.PI * 2);
    this.carrying = false;
    this.armGesture = 0;
  }

  _makeArm(side) {
    const group = new THREE.Group();
    group.position.set(side * SHOULDER_X, SHOULDER_Y, 0);

    const upper = new THREE.Mesh(
      paint(new THREE.BoxGeometry(0.105, UPPER_ARM, 0.105).translate(0, -UPPER_ARM / 2, 0), this.shirt),
      this.material,
    );
    upper.castShadow = this.fullShadow;
    group.add(upper);

    const fore = new THREE.Group();
    fore.position.y = -UPPER_ARM;
    const foreGeos = [
      new THREE.BoxGeometry(0.092, FOREARM, 0.092).translate(0, -FOREARM / 2, 0),
    ];
    paint(foreGeos[0], this.skin);
    const hand = sphere(0.062, 0, -FOREARM - 0.03, 0, this.skin, 0.85, 1);
    const foreMesh = new THREE.Mesh(mergeGeometries([foreGeos[0], hand], false), this.material);
    foreMesh.castShadow = this.fullShadow;
    fore.add(foreMesh);
    group.add(fore);

    return { group, fore };
  }

  _makeLeg(side, shoeColor) {
    const group = new THREE.Group();
    group.position.set(side * 0.105, HIP_Y, 0);

    const thigh = new THREE.Mesh(
      paint(new THREE.BoxGeometry(0.148, THIGH, 0.158).translate(0, -THIGH / 2, 0), this.pants),
      this.material,
    );
    thigh.castShadow = this.fullShadow;
    group.add(thigh);

    const shinGroup = new THREE.Group();
    shinGroup.position.y = -THIGH;
    const shinGeo = new THREE.BoxGeometry(0.128, SHIN, 0.135).translate(0, -SHIN / 2, 0);
    paint(shinGeo, this.pants);
    const footGeo = new THREE.BoxGeometry(0.135, 0.085, 0.27).translate(0, -SHIN - 0.042, 0.055);
    paint(footGeo, shoeColor);
    const shinMesh = new THREE.Mesh(mergeGeometries([shinGeo, footGeo], false), this.material);
    shinMesh.castShadow = this.fullShadow;
    shinGroup.add(shinMesh);
    group.add(shinGroup);

    return { group, shin: shinGroup };
  }

  /**
   * [18] Anima a caminhada. `speed` em m/s; 0 = parado (respiração leve).
   */
  update(dt, speed) {
    const moving = speed > 0.15;
    const cadence = moving ? clamp(speed * 2.35, 2.2, 11) : 1.6;
    this.phase += dt * cadence;

    // passada moderada: acima de ~0.6 rad a pessoa parece estar patinando
    const amp = moving ? clamp(speed / 2.4, 0.26, 1) * 0.55 : 0.0;
    const s = Math.sin(this.phase);
    const c = Math.sin(this.phase + 0.95);

    // pernas
    this.legL.group.rotation.x = s * amp;
    this.legR.group.rotation.x = -s * amp;
    // joelhos dobram só no retorno do passo
    this.legL.shin.rotation.x = Math.max(0, c) * amp * 1.15 + 0.04;
    this.legR.shin.rotation.x = Math.max(0, -c) * amp * 1.15 + 0.04;

    // braços
    if (this.carrying) {
      // [50] segurando o pacote com os dois braços à frente
      this.armL.group.rotation.x = -1.25;
      this.armR.group.rotation.x = -1.25;
      this.armL.group.rotation.z = 0.22;
      this.armR.group.rotation.z = -0.22;
      this.armL.fore.rotation.x = -0.55;
      this.armR.fore.rotation.x = -0.55;
    } else if (this.armGesture > 0) {
      // acenando (usado quando o NPC é alvo da missão)
      const w = Math.sin(this.phase * 3.2) * 0.5;
      this.armL.group.rotation.x = -s * amp * 0.8;
      this.armL.group.rotation.z = 0;
      this.armL.fore.rotation.x = -0.25;
      this.armR.group.rotation.x = -2.5;
      this.armR.group.rotation.z = -0.35 + w * 0.3;
      this.armR.fore.rotation.x = -0.4 + w;
    } else {
      this.armL.group.rotation.x = -s * amp * 0.85;
      this.armR.group.rotation.x = s * amp * 0.85;
      this.armL.group.rotation.z = 0.06;
      this.armR.group.rotation.z = -0.06;
      this.armL.fore.rotation.x = -0.25 - Math.max(0, -s) * amp * 0.4;
      this.armR.fore.rotation.x = -0.25 - Math.max(0, s) * amp * 0.4;
    }

    // balanço do corpo
    this.pivot.position.y = moving ? Math.abs(Math.sin(this.phase)) * 0.038 * amp : 0;
    this.pivot.rotation.z = moving ? Math.sin(this.phase) * 0.035 * amp : 0;
  }

  /** Pose de queda/atropelamento antes de explodir. */
  setPose(kind) {
    if (kind === 'panic') {
      this.armL.group.rotation.x = -2.7;
      this.armR.group.rotation.x = -2.7;
      this.armL.group.rotation.z = 0.5;
      this.armR.group.rotation.z = -0.5;
    }
  }

  get position() { return this.root.position; }

  dispose() {
    // as texturas de número são compartilhadas via cache — quem descarta
    // é o dono do cache, não a pessoa que morreu
    this.root.traverse((o) => {
      if (o.isMesh) o.geometry.dispose();
    });
    if (this.numberMesh) this.numberMesh.material.dispose();
    this.material.dispose();
  }
}
