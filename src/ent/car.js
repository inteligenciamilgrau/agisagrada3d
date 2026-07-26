import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GRID, CELL, ROAD_H, LANE, CAR, PALETTE, STOP_LINE } from '../config.js';
import {
  nodeCoord, makeRng, rngPick, rngInt, rngRange, DIRS, clamp, dampAngle, dist2Sq, swapRemove,
} from '../utils.js';

/**
 * [23] Deslocamento lateral de cada sentido: mão direita.
 * indo para +X fica em +Z; indo para +Z fica em -X; e assim por diante.
 */
const LANE_OFF = [
  { x: 0, z: +LANE },   // 0: +X
  { x: -LANE, z: 0 },   // 1: +Z
  { x: 0, z: -LANE },   // 2: -X
  { x: +LANE, z: 0 },   // 3: -Z
];

const WHEEL_R = 0.34;
const WHEEL_POS = [
  [+0.86, +1.42], [-0.86, +1.42],      // dianteiras (esterçam)
  [+0.86, -1.42], [-0.86, -1.42],
];

// ------------------------------------------------------------------ geometria
let sharedWheelGeo = null;
function wheelGeometry() {
  if (sharedWheelGeo) return sharedWheelGeo;
  const tire = new THREE.CylinderGeometry(WHEEL_R, WHEEL_R, 0.24, 18);
  tire.rotateZ(Math.PI / 2);
  const rim = new THREE.CylinderGeometry(WHEEL_R * 0.58, WHEEL_R * 0.58, 0.26, 14);
  rim.rotateZ(Math.PI / 2);

  const paintGeo = (g, hex) => {
    const c = new THREE.Color(hex);
    const n = g.attributes.position.count;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    return g;
  };
  paintGeo(tire, 0x14161a);
  paintGeo(rim, 0x9aa0a8);
  sharedWheelGeo = mergeGeometries([tire, rim], false);
  return sharedWheelGeo;
}

function buildBodyGeometry() {
  const parts = [];
  const L = CAR.length, W = CAR.width;

  // massa principal + saia inferior
  parts.push(new THREE.BoxGeometry(W, 0.56, L).translate(0, 0.60, 0));
  parts.push(new THREE.BoxGeometry(W - 0.13, 0.30, L - 0.25).translate(0, 0.33, 0));
  // capô e porta-malas
  parts.push(new THREE.BoxGeometry(W - 0.14, 0.24, 1.30).translate(0, 0.98, L / 2 - 0.75));
  parts.push(new THREE.BoxGeometry(W - 0.14, 0.24, 1.05).translate(0, 0.98, -L / 2 + 0.62));
  // teto e colunas da cabine
  parts.push(new THREE.BoxGeometry(W - 0.30, 0.10, 1.95).translate(0, 1.44, -0.08));
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      parts.push(new THREE.BoxGeometry(0.11, 0.46, 0.13)
        .translate(sx * (W / 2 - 0.20), 1.16, -0.08 + sz * 0.94));
    }
  }
  // para-choques
  parts.push(new THREE.BoxGeometry(W + 0.05, 0.28, 0.22).translate(0, 0.55, L / 2 + 0.02));
  parts.push(new THREE.BoxGeometry(W + 0.05, 0.28, 0.22).translate(0, 0.55, -L / 2 - 0.02));
  // retrovisores
  for (const sx of [-1, 1]) {
    parts.push(new THREE.BoxGeometry(0.22, 0.12, 0.10)
      .translate(sx * (W / 2 + 0.10), 1.12, 0.80));
  }
  // caixas de roda
  for (const [wx, wz] of WHEEL_POS) {
    parts.push(new THREE.BoxGeometry(0.16, 0.30, 0.92)
      .translate(wx * 1.02, 0.62, wz));
  }
  return mergeGeometries(parts, false);
}

function buildGlassGeometry() {
  const parts = [];
  const W = CAR.width;
  // "estufa" de vidro entre as colunas
  parts.push(new THREE.BoxGeometry(W - 0.34, 0.44, 1.98).translate(0, 1.17, -0.08));
  // para-brisa inclinado
  const wind = new THREE.BoxGeometry(W - 0.36, 0.52, 0.09);
  wind.rotateX(-0.62);
  wind.translate(0, 1.18, 0.95);
  parts.push(wind);
  const rear = new THREE.BoxGeometry(W - 0.36, 0.48, 0.09);
  rear.rotateX(0.55);
  rear.translate(0, 1.18, -1.08);
  parts.push(rear);
  return mergeGeometries(parts, false);
}

function buildLightsGeometry() {
  // MeshBasic + cores por vértice: as lanternas se acendem sozinhas e o bloom pega
  const parts = [];
  const W = CAR.width, L = CAR.length;
  const paint = (g, r, gr, b) => {
    const n = g.attributes.position.count;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { arr[i * 3] = r; arr[i * 3 + 1] = gr; arr[i * 3 + 2] = b; }
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    return g;
  };
  // valores acima de 1 são HDR de propósito (é o que o bloom captura),
  // mas contidos: mais que isso e o farol vira uma bola branca à noite
  for (const sx of [-1, 1]) {
    parts.push(paint(new THREE.BoxGeometry(0.42, 0.17, 0.09)
      .translate(sx * (W / 2 - 0.34), 0.83, L / 2 + 0.06), 1.85, 1.75, 1.5));
    parts.push(paint(new THREE.BoxGeometry(0.40, 0.15, 0.09)
      .translate(sx * (W / 2 - 0.34), 0.85, -L / 2 - 0.06), 1.5, 0.11, 0.07));
  }
  return mergeGeometries(parts, false);
}

let bodyGeo = null, glassGeo = null, lightsGeo = null;

// ------------------------------------------------------------------ carro
export class Car {
  constructor(color, rng) {
    if (!bodyGeo) { bodyGeo = buildBodyGeometry(); glassGeo = buildGlassGeometry(); lightsGeo = buildLightsGeometry(); }

    this.root = new THREE.Group();

    // pintura automotiva com verniz — é o que dá o brilho "de showroom"
    this.paint = new THREE.MeshPhysicalMaterial({
      color, roughness: 0.30, metalness: 0.55,
      clearcoat: 0.9, clearcoatRoughness: 0.08,
      envMapIntensity: 1.5,
    });
    this.body = new THREE.Mesh(bodyGeo, this.paint);
    this.body.castShadow = true;                     // [44]
    this.body.receiveShadow = true;
    this.root.add(this.body);

    this.glassMat = new THREE.MeshStandardMaterial({
      color: 0x0d1116, roughness: 0.06, metalness: 0.92, envMapIntensity: 2.2,
    });
    this.glass = new THREE.Mesh(glassGeo, this.glassMat);
    this.glass.castShadow = false;
    this.root.add(this.glass);

    this.lightMat = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
    this.lightMat.color.setScalar(0.22);             // apagados de dia
    this.lights = new THREE.Mesh(lightsGeo, this.lightMat);
    this.root.add(this.lights);

    // as 4 rodas em uma InstancedMesh: 1 draw call, com esterço e giro por roda
    this.wheelMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, metalness: 0.25 });
    this.wheels = new THREE.InstancedMesh(wheelGeometry(), this.wheelMat, 4);
    this.wheels.castShadow = true;
    this.wheels.frustumCulled = false;
    this.root.add(this.wheels);
    this._wheelSpin = 0;
    this._steer = 0;
    this._updateWheels();

    this.speed = 0;
    this.yaw = 0;
    this.alive = true;
    this.isPlayer = false;
    this.interior = null;
    this.headlights = null;
  }

  _updateWheels() {
    const m = new THREE.Matrix4();
    const t = new THREE.Matrix4();
    for (let i = 0; i < 4; i++) {
      const [wx, wz] = WHEEL_POS[i];
      m.makeTranslation(wx, WHEEL_R, wz);
      if (i < 2) m.multiply(t.makeRotationY(this._steer));
      m.multiply(t.makeRotationX(this._wheelSpin));
      this.wheels.setMatrixAt(i, m);
    }
    this.wheels.instanceMatrix.needsUpdate = true;
  }

  syncTransform() {
    this.root.rotation.y = this.yaw;
  }

  /**
   * [17] O vidro é escuro e espelhado — ótimo visto de fora, mas de dentro
   * ele tapa completamente a visão. Na câmera interna ele some.
   */
  setInteriorView(on) {
    this.glass.visible = !on;
  }

  spinWheels(dt) {
    this._wheelSpin += (this.speed / WHEEL_R) * dt;
    this._updateWheels();
  }

  /** [17] Interior montado só quando o jogador entra (economiza draw calls). */
  buildInterior() {
    if (this.interior) return;
    // visto de dentro, a lataria precisa das duas faces, senão a cabine
    // fica "aberta" pelo backface culling
    this.paint.side = THREE.DoubleSide;
    const parts = [];
    const W = CAR.width;
    // painel
    parts.push(new THREE.BoxGeometry(W - 0.36, 0.30, 0.42).translate(0, 1.00, 0.66));
    // console central
    parts.push(new THREE.BoxGeometry(0.30, 0.24, 1.00).translate(0, 0.80, 0.05));
    // bancos
    for (const sx of [-1, 1]) {
      parts.push(new THREE.BoxGeometry(0.48, 0.14, 0.50).translate(sx * 0.40, 0.76, -0.15));
      parts.push(new THREE.BoxGeometry(0.48, 0.56, 0.14).translate(sx * 0.40, 1.06, -0.42));
    }
    const mat = new THREE.MeshStandardMaterial({ color: 0x23262c, roughness: 0.86, metalness: 0.05 });
    this.interior = new THREE.Mesh(mergeGeometries(parts, false), mat);
    this.root.add(this.interior);

    // volante (lado esquerdo)
    const wheel = new THREE.Mesh(
      new THREE.TorusGeometry(0.17, 0.028, 8, 20),
      new THREE.MeshStandardMaterial({ color: 0x15171b, roughness: 0.6 }),
    );
    wheel.rotation.x = -1.15;
    wheel.position.set(-0.40, 1.05, 0.52);
    this.root.add(wheel);
    this.steeringWheel = wheel;
  }

  /** [13] Faróis de verdade para quem está dirigindo à noite. */
  enableHeadlights(scene) {
    if (this.headlights) return;
    this.headlights = [];
    for (const sx of [-1, 1]) {
      const s = new THREE.SpotLight(0xfff0d8, 0, 62, 0.52, 0.42, 1.4);
      s.position.set(sx * 0.6, 0.85, CAR.length / 2);
      s.target.position.set(sx * 0.9, -0.6, CAR.length / 2 + 22);
      this.root.add(s, s.target);
      this.headlights.push(s);
    }
  }

  setLightsOn(on, night) {
    this.lightMat.color.setScalar(on ? 1 : 0.22);
    if (this.headlights) {
      for (const s of this.headlights) s.intensity = on && night ? 260 : 0;
    }
  }

  dispose(scene) {
    this.root.parent?.remove(this.root);
    this.paint.dispose();
    this.glassMat.dispose();
    this.lightMat.dispose();
    this.wheelMat.dispose();
    if (this.interior) this.interior.geometry.dispose();
  }
}

// ------------------------------------------------------------------ sistema
export class CarSystem {
  constructor(scene, collision, traffic, seed = 8081) {
    this.scene = scene;
    this.col = collision;
    this.traffic = traffic;
    this.rng = makeRng(seed);
    this.cars = [];

    this.group = new THREE.Group();
    this.group.name = 'cars';
    scene.add(this.group);
  }

  // ---------------------------------------------------------------- posições
  /** Ponto da faixa a `dist` do centro do cruzamento, no sentido `dir`. */
  static lanePoint(i, j, dir, dist) {
    const d = DIRS[dir], o = LANE_OFF[dir];
    return {
      x: nodeCoord(i) + d.x * dist + o.x,
      z: nodeCoord(j) + d.z * dist + o.z,
    };
  }

  spawn(count) {
    for (let k = 0; k < count; k++) this.spawnOne();
  }

  spawnOne() {
    const rng = this.rng;
    let i, j, dir, s, tries = 0;

    do {
      dir = rngInt(rng, 0, 3);
      const d = DIRS[dir];
      // nó de destino precisa existir na grade
      i = rngInt(rng, d.x > 0 ? 1 : 0, d.x < 0 ? GRID - 2 : GRID - 1);
      j = rngInt(rng, d.z > 0 ? 1 : 0, d.z < 0 ? GRID - 2 : GRID - 1);
      // nunca nasce em cima da faixa de pedestre nem dentro do cruzamento
      s = rngRange(rng, STOP_LINE + 3, CELL - ROAD_H - 2);
      tries++;
    } while (tries < 30 && this._occupied(i, j, dir, s));

    const car = new Car(rngPick(rng, PALETTE.car), rng);
    car.i = i; car.j = j; car.dir = dir; car.s = s;
    car.state = 'drive';
    car.speed = CAR.npcSpeed * rngRange(rng, 0.85, 1.1);
    car.cruise = car.speed;

    const p = CarSystem.lanePoint(i, j, dir, -s);
    car.root.position.set(p.x, 0, p.z);      // rodas apoiadas no asfalto (y = 0)
    car.yaw = Math.atan2(DIRS[dir].x, DIRS[dir].z);
    car.syncTransform();

    this.group.add(car.root);
    this.cars.push(car);
    return car;
  }

  _occupied(i, j, dir, s) {
    for (const c of this.cars) {
      if (c.isPlayer || c.state === 'parked') continue;
      if (c.i === i && c.j === j && c.dir === dir && Math.abs(c.s - s) < 12) return true;
    }
    return false;
  }

  // ---------------------------------------------------------------- IA
  update(dt, playerCar) {
    for (const car of this.cars) {
      if (!car.alive || car.isPlayer || car.state === 'parked') continue;
      this._updateAI(car, dt);
    }
    // acende/apaga faróis conforme a noite
    for (const car of this.cars) {
      if (car.isPlayer) continue;
      car.setLightsOn(this.nightOn, this.nightOn);
    }
  }

  setNight(night) { this.nightOn = night > 0.35; }

  _updateAI(car, dt) {
    if (car.state === 'cross') {
      // atravessando o cruzamento por um arco
      const b = car.bez;
      car.crossT += (car.speed * dt) / b.len;
      if (car.crossT >= 1) {
        car.state = 'drive';
        car.dir = car.nextDir;
        const d = DIRS[car.dir];
        car.i += d.x; car.j += d.z;
        car.s = CELL - ROAD_H;
        car.prevDir = car.dir;
      } else {
        const t = car.crossT;
        const mt = 1 - t;
        const px = mt * mt * b.e.x + 2 * mt * t * b.c.x + t * t * b.x2.x;
        const pz = mt * mt * b.e.z + 2 * mt * t * b.c.z + t * t * b.x2.z;
        // derivada da Bézier = direção de apontamento
        const dx = 2 * mt * (b.c.x - b.e.x) + 2 * t * (b.x2.x - b.c.x);
        const dz = 2 * mt * (b.c.z - b.e.z) + 2 * t * (b.x2.z - b.c.z);
        car.root.position.x = px;
        car.root.position.z = pz;
        car.yaw = Math.atan2(dx, dz);
        car.syncTransform();
        car.spinWheels(dt);
        car._steer = clamp(car.turnSign * 0.5, -0.5, 0.5);
        return;
      }
    }

    // ------------------------------------------------ trecho reto
    const d = DIRS[car.dir];
    const axis = d.axis;
    const sig = this.traffic.carSignal(car.i, car.j, axis);
    // [21] para atrás da faixa de pedestre, não em cima dela
    const distToStop = car.s - STOP_LINE;

    let target = car.cruise;

    // [4] respeita o semáforo
    if (sig !== 'green') {
      if (distToStop < CAR.stopDistance) {
        target = sig === 'yellow' && distToStop < 2 && car.speed > 6
          ? car.cruise                                   // já entrou, completa a travessia
          : clamp(distToStop / CAR.stopDistance, 0, 1) * car.cruise;
      }
    }

    // não encosta no carro da frente
    const gap = this._frontGap(car);
    if (gap < 13) target = Math.min(target, Math.max(0, (gap - 5.2) * 2.4));

    const accel = target > car.speed ? 7.5 : 15;
    car.speed += clamp(target - car.speed, -accel * dt, accel * dt);
    car.speed = Math.max(0, car.speed);

    car.s -= car.speed * dt;
    car._steer *= 0.85;

    if (car.s <= ROAD_H) {
      // entra no cruzamento: escolhe reto / direita / esquerda (sem retorno)
      const opts = [];
      for (let nd = 0; nd < 4; nd++) {
        if ((nd + 2) % 4 === car.dir) continue;                 // proibido dar meia-volta
        const nn = DIRS[nd];
        const ti = car.i + nn.x, tj = car.j + nn.z;
        if (ti < 0 || ti >= GRID || tj < 0 || tj >= GRID) continue;
        // seguir reto é bem mais provável que virar
        const weight = nd === car.dir ? 5 : 1;
        for (let w = 0; w < weight; w++) opts.push(nd);
      }
      const nd = opts.length ? opts[rngInt(this.rng, 0, opts.length - 1)] : (car.dir + 2) % 4;

      const e = CarSystem.lanePoint(car.i, car.j, car.dir, -ROAD_H);
      const x2 = CarSystem.lanePoint(car.i, car.j, nd, ROAD_H);
      const c = {
        x: nodeCoord(car.i) + (DIRS[car.dir].x !== 0 ? LANE_OFF[nd].x : LANE_OFF[car.dir].x),
        z: nodeCoord(car.j) + (DIRS[car.dir].z !== 0 ? LANE_OFF[nd].z : LANE_OFF[car.dir].z),
      };
      const len = Math.hypot(x2.x - e.x, x2.z - e.z) * 1.24 + 0.01;

      car.bez = { e, c, x2, len };
      car.crossT = 0;
      car.nextDir = nd;
      car.state = 'cross';
      // sinal do esterço para as rodas dianteiras virarem no arco
      const cross = DIRS[car.dir].x * DIRS[nd].z - DIRS[car.dir].z * DIRS[nd].x;
      car.turnSign = -Math.sign(cross);
      return;
    }

    const p = CarSystem.lanePoint(car.i, car.j, car.dir, -car.s);
    car.root.position.x = p.x;
    car.root.position.z = p.z;
    car.yaw = Math.atan2(d.x, d.z);
    car.syncTransform();
    car.spinWheels(dt);
  }

  /** Distância livre até o veículo à frente (inclui o carro do jogador). */
  _frontGap(car) {
    const fx = Math.sin(car.yaw), fz = Math.cos(car.yaw);
    const px = car.root.position.x, pz = car.root.position.z;
    let best = 999;
    for (const o of this.cars) {
      if (o === car || !o.alive) continue;
      const dx = o.root.position.x - px, dz = o.root.position.z - pz;
      const fwd = dx * fx + dz * fz;
      if (fwd <= 0.5 || fwd > 20) continue;
      const lat = Math.abs(dx * fz - dz * fx);
      if (lat > 2.4) continue;
      if (fwd < best) best = fwd;
    }
    return best;
  }

  // ---------------------------------------------------------------- utilidades
  nearest(x, z, maxDist) {
    let best = null, bestD = maxDist * maxDist;
    for (const c of this.cars) {
      if (!c.alive || c.isPlayer) continue;
      const d = dist2Sq(c.root.position.x, c.root.position.z, x, z);
      if (d < bestD) { bestD = d; best = c; }
    }
    return best;
  }

  within(x, z, r) {
    const out = [];
    const r2 = r * r;
    for (const c of this.cars) {
      if (!c.alive) continue;
      if (dist2Sq(c.root.position.x, c.root.position.z, x, z) < r2) out.push(c);
    }
    return out;
  }

  /** [29] Explodiu -> some daqui e nasce outro em outro ponto. */
  remove(car, respawn = true) {
    if (!car.alive) return null;
    car.alive = false;
    car.dispose();
    swapRemove(this.cars, car);
    if (respawn) return this.spawnOne();
    return null;
  }

  /** O jogador assume o carro: ele sai da rota da IA. */
  takeOver(car) {
    car.isPlayer = true;
    car.state = 'player';
    car.buildInterior();
    car.enableHeadlights(this.scene);
  }

  release(car) {
    car.isPlayer = false;
    car.state = 'parked';
    car.speed = 0;
  }
}

export { LANE_OFF };
