import * as THREE from 'three';
import { GAME, PED, CAR } from '../config.js';

const MAX_BULLETS = 64;
const HIT_R_PED = 0.55;
const HIT_R_CAR = 1.5;

/**
 * [27] Tiro com E ou clique esquerdo.
 * [38] O projétil é visível voando até acertar (não é hitscan).
 * [41] Ricocheteia ao bater em prédio, poste, chão ou montanha.
 */
export class BulletSystem {
  constructor(scene, collision, fx) {
    this.col = collision;
    this.fx = fx;
    this.cooldown = 0;

    // traçante: caixa esticada, emissiva, pega bem no bloom
    const geo = new THREE.BoxGeometry(0.06, 0.06, 1);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffdd88, toneMapped: false });
    this.mesh = new THREE.InstancedMesh(geo, mat, MAX_BULLETS);
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);

    this._off = new THREE.Matrix4().makeScale(0.0001, 0.0001, 0.0001);
    this.bullets = [];
    for (let i = 0; i < MAX_BULLETS; i++) {
      this.bullets.push({
        alive: false,
        p: new THREE.Vector3(),
        v: new THREE.Vector3(),
        life: 0,
        bounces: 0,
      });
      this.mesh.setMatrixAt(i, this._off);
    }
    this.mesh.instanceMatrix.needsUpdate = true;

    this.onHitPed = null;
    this.onHitCar = null;
    /** Inimigo da campanha da AGI Sagrada (arena de fase). */
    this.onHitFoe = null;
    this.targets = { peds: null, cars: null, foes: null };
    /** Veículo pilotado pelo jogador: os tiros saem de dentro dele e não devem acertá-lo. */
    this.ignoreCar = null;

    this._tmp = new THREE.Vector3();
    this._q = new THREE.Quaternion();
    this._m = new THREE.Matrix4();
    this._up = new THREE.Vector3(0, 0, 1);
  }

  setTargets(peds, cars) {
    this.targets.peds = peds;
    this.targets.cars = cars;
  }

  /**
   * Lista de inimigos da fase em andamento (ou null fora de fase).
   * Dentro da arena só existem eles — pessoas e carros da cidade ficam
   * longe demais para o segmento da bala alcançar.
   */
  setFoes(foes) { this.targets.foes = foes; }

  get canFire() { return this.cooldown <= 0; }

  /** [27] Dispara na direção da mira. */
  fire(origin, direction) {
    if (this.cooldown > 0) return false;
    const b = this.bullets.find((x) => !x.alive);
    if (!b) return false;

    this.cooldown = GAME.fireCooldown;
    b.alive = true;
    b.life = 0;
    b.bounces = GAME.bulletBounces;
    // sai um pouco à frente da câmera para não nascer dentro do jogador
    b.p.copy(origin).addScaledVector(direction, 1.2);
    b.v.copy(direction).multiplyScalar(GAME.bulletSpeed);

    this.fx.impact(b.p, direction, { r: 3.0, g: 2.4, b: 1.2 });
    return true;
  }

  update(dt) {
    this.cooldown = Math.max(0, this.cooldown - dt);

    for (let i = 0; i < MAX_BULLETS; i++) {
      const b = this.bullets[i];
      if (!b.alive) continue;

      b.life += dt;
      if (b.life > GAME.bulletLife) { this._kill(i, b); continue; }

      const speed = b.v.length();
      const step = speed * dt;
      const dir = this._tmp.copy(b.v).divideScalar(speed || 1);

      const hit = this._trace(b.p, dir, step);
      if (hit) {
        if (hit.kind === 'foe') {
          if (this.onHitFoe) this.onHitFoe(hit.foe, hit.point);
          this._kill(i, b);
          continue;
        }
        if (hit.kind === 'ped') {
          if (this.onHitPed) this.onHitPed(hit.ped, hit.point);
          this._kill(i, b);
          continue;
        }
        if (hit.kind === 'car') {
          if (this.onHitCar) this.onHitCar(hit.car, hit.point);
          this._kill(i, b);
          continue;
        }

        // ------------------------------------------------ [41] ricochete
        b.p.copy(hit.point).addScaledVector(hit.normal, 0.06);
        this.fx.impact(b.p, hit.normal);

        b.bounces--;
        if (b.bounces < 0) { this._kill(i, b); continue; }

        // reflete e perde energia
        const dot = b.v.dot(hit.normal);
        b.v.addScaledVector(hit.normal, -2 * dot);
        b.v.multiplyScalar(0.62);
        // um pouco de espalhamento, senão o ricochete fica "de bilhar"
        b.v.x += (Math.random() - 0.5) * speed * 0.10;
        b.v.y += (Math.random() - 0.5) * speed * 0.10;
        b.v.z += (Math.random() - 0.5) * speed * 0.10;
        if (b.v.length() < 22) { this._kill(i, b); continue; }
      } else {
        b.p.addScaledVector(b.v, dt);
      }

      // queda leve do projétil
      b.v.y -= 5.5 * dt;
      this._draw(i, b);
    }
  }

  /** Testa o segmento contra inimigos, pessoas, carros, cenário e chão. */
  _trace(from, dir, dist) {
    let best = null;

    // --- inimigos da campanha (arena de fase)
    if (this.targets.foes) {
      for (const foe of this.targets.foes) {
        if (!foe.vivo) continue;
        const c = foe.root.position;
        const t = this._segSphere(
          from, dir, dist, c.x, c.y + foe.alturaAlvo, c.z, foe.raioAcerto,
        );
        if (t !== null && (!best || t < best.t)) best = { t, kind: 'foe', foe };
      }
    }

    // --- pessoas [24][27]
    if (this.targets.peds) {
      for (const ped of this.targets.peds.peds) {
        if (!ped.alive) continue;
        const c = ped.human.root.position;
        const t = this._segSphere(from, dir, dist, c.x, c.y + PED.height * 0.55, c.z, HIT_R_PED);
        if (t !== null && (!best || t < best.t)) {
          best = { t, kind: 'ped', ped };
        }
      }
    }

    // --- carros [26][27]
    if (this.targets.cars) {
      for (const car of this.targets.cars.cars) {
        if (!car.alive || car === this.ignoreCar) continue;
        const c = car.root.position;
        const t = this._segSphere(from, dir, dist, c.x, c.y + CAR.height * 0.6, c.z, HIT_R_CAR);
        if (t !== null && (!best || t < best.t)) {
          best = { t, kind: 'car', car };
        }
      }
    }

    // --- cenário sólido
    const solid = this.col.raycast(from.x, from.y, from.z, dir.x, dir.y, dir.z, dist);
    if (solid && (!best || solid.t < best.t)) {
      best = {
        t: solid.t, kind: 'solid',
        normal: new THREE.Vector3(solid.nx, solid.ny, solid.nz),
      };
    }

    // --- chão
    if (dir.y < 0) {
      const groundY = this.col.groundHeightAt(from.x, from.z, from.y);
      const tg = (groundY - from.y) / dir.y;
      if (tg >= 0 && tg <= dist && (!best || tg < best.t)) {
        best = { t: tg, kind: 'solid', normal: new THREE.Vector3(0, 1, 0) };
      }
    }

    if (!best) return null;
    best.point = new THREE.Vector3(
      from.x + dir.x * best.t,
      from.y + dir.y * best.t,
      from.z + dir.z * best.t,
    );
    if (!best.normal) best.normal = new THREE.Vector3(0, 1, 0);
    return best;
  }

  /** Menor t em que o segmento entra numa esfera, ou null. */
  _segSphere(from, dir, dist, cx, cy, cz, r) {
    const ox = from.x - cx, oy = from.y - cy, oz = from.z - cz;
    const b = ox * dir.x + oy * dir.y + oz * dir.z;
    const c = ox * ox + oy * oy + oz * oz - r * r;
    if (c < 0) return 0;                       // já começou dentro
    const disc = b * b - c;
    if (disc < 0) return null;
    const t = -b - Math.sqrt(disc);
    if (t < 0 || t > dist) return null;
    return t;
  }

  _draw(i, b) {
    const speed = b.v.length() || 1;
    const len = Math.min(4.2, speed * 0.026);
    this._q.setFromUnitVectors(this._up, this._tmp.copy(b.v).divideScalar(speed));
    this._m.compose(b.p, this._q, new THREE.Vector3(1, 1, len));
    this.mesh.setMatrixAt(i, this._m);
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  _kill(i, b) {
    b.alive = false;
    this.mesh.setMatrixAt(i, this._off);
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  reset() {
    for (let i = 0; i < MAX_BULLETS; i++) this._kill(i, this.bullets[i]);
    this.cooldown = 0;
  }
}
