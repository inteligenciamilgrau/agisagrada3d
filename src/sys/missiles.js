import * as THREE from 'three';
import { MISSILE, PED, CAR } from '../config.js';

const MAX = 10;

/**
 * [63] Mísseis do helicóptero — substituem o tiro de pistola [27] enquanto o
 * jogador está voando.
 *
 * Diferenças que importam em relação à bala:
 *
 *   - o projétil é um MODELO, não um traçante. Sai devagar, acelera e deixa
 *     rastro de fumaça: dá para ver para onde foi e corrigir a mira;
 *   - explode em ÁREA. Do alto, acertar um carro em movimento com um ponto
 *     seria frustrante; o raio de dano resolve isso sem tirar a pontaria;
 *   - não ricocheteia. Míssil que quica não existe, e o ricochete [41]
 *     continua sendo coisa da bala.
 *
 * O pool é pequeno e cada míssil é uma malha própria (não instanciada): são
 * poucos ao mesmo tempo e assim a ogiva, as aletas e a chama do motor podem
 * ser modeladas de verdade.
 */
export class MissileSystem {
  constructor(scene, collision, fx) {
    this.scene = scene;
    this.col = collision;
    this.fx = fx;
    this.cooldown = 0;

    this.onHitPed = null;
    this.onHitCar = null;
    this.targets = { peds: null, cars: null, foes: null };
    /** Inimigo da campanha atingido por míssil (direto ou pelo raio). */
    this.onHitFoe = null;

    const modelo = this._buildModel();
    this.list = [];
    for (let i = 0; i < MAX; i++) {
      const mesh = modelo.clone(true);
      mesh.visible = false;
      scene.add(mesh);
      this.list.push({
        alive: false, mesh,
        p: new THREE.Vector3(), v: new THREE.Vector3(),
        life: 0, speed: 0, fumaca: 0,
        chama: mesh.getObjectByName('chama'),
      });
    }

    this._tmp = new THREE.Vector3();
    this._q = new THREE.Quaternion();
    this._eixo = new THREE.Vector3(0, 0, 1);
  }

  _buildModel() {
    const g = new THREE.Group();
    const corpoMat = new THREE.MeshStandardMaterial({
      color: 0x3c4148, roughness: 0.45, metalness: 0.75,
    });
    const ogivaMat = new THREE.MeshStandardMaterial({
      color: 0xb8412f, roughness: 0.5, metalness: 0.3,
    });

    const corpo = new THREE.Mesh(new THREE.CylinderGeometry(0.135, 0.135, 1.5, 12), corpoMat);
    corpo.rotation.x = Math.PI / 2;
    g.add(corpo);

    const ogiva = new THREE.Mesh(new THREE.ConeGeometry(0.135, 0.5, 12), ogivaMat);
    ogiva.rotation.x = Math.PI / 2;
    ogiva.position.z = 1.0;
    g.add(ogiva);

    // faixa de identificação
    const faixa = new THREE.Mesh(new THREE.CylinderGeometry(0.142, 0.142, 0.12, 12), ogivaMat);
    faixa.rotation.x = Math.PI / 2;
    faixa.position.z = 0.45;
    g.add(faixa);

    // aletas traseiras
    for (let i = 0; i < 4; i++) {
      const aleta = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.035, 0.34), corpoMat);
      aleta.rotation.z = (i / 4) * Math.PI * 2;
      aleta.position.z = -0.58;
      g.add(aleta);
    }

    // chama do motor: cone emissivo que pulsa (fora do tone mapping, pega bloom)
    const chama = new THREE.Mesh(
      new THREE.ConeGeometry(0.17, 1.2, 10),
      new THREE.MeshBasicMaterial({ color: 0xffc25a, toneMapped: false, transparent: true, opacity: 0.9 }),
    );
    chama.name = 'chama';
    chama.rotation.x = -Math.PI / 2;
    chama.position.z = -1.35;
    g.add(chama);

    return g;
  }

  setTargets(peds, cars) {
    this.targets.peds = peds;
    this.targets.cars = cars;
  }

  /**
   * Inimigos da fase em andamento.
   *
   * Existe para o chefão colossal: um boneco de 55 m não é pedestre nem
   * carro, e é o único alvo da fase a céu aberto que o míssil precisa
   * acertar.
   */
  setFoes(foes) { this.targets.foes = foes; }

  get canFire() { return this.cooldown <= 0; }

  /** Dispara do ponto `origin` na direção `direction`. */
  fire(origin, direction) {
    if (this.cooldown > 0) return false;
    const m = this.list.find((x) => !x.alive);
    if (!m) return false;

    this.cooldown = MISSILE.cooldown;
    m.alive = true;
    m.life = 0;
    m.fumaca = 0;
    m.speed = MISSILE.speed;
    m.p.copy(origin);
    m.v.copy(direction).normalize().multiplyScalar(MISSILE.speed);
    m.mesh.visible = true;
    this._orienta(m);

    // sopro da saída do trilho
    this.fx.impact(m.p, direction, { r: 3.0, g: 1.9, b: 0.7 });
    return true;
  }

  update(dt) {
    this.cooldown = Math.max(0, this.cooldown - dt);

    for (const m of this.list) {
      if (!m.alive) continue;

      m.life += dt;
      if (m.life > MISSILE.life) { this._apaga(m); continue; }

      // o motor acelera até a velocidade máxima
      m.speed = Math.min(MISSILE.maxSpeed, m.speed + MISSILE.accel * dt);
      const dir = this._tmp.copy(m.v).normalize();
      m.v.copy(dir).multiplyScalar(m.speed);

      const passo = m.speed * dt;
      const hit = this._trace(m.p, dir, passo);
      if (hit) {
        this._detona(m, hit.point);
        continue;
      }

      m.p.addScaledVector(m.v, dt);

      // rastro: intervalo por DISTÂNCIA, não por quadro — senão o rastro fica
      // ralo quando o míssil está rápido e denso quando está lento
      m.fumaca += passo;
      while (m.fumaca > 2.2) {
        m.fumaca -= 2.2;
        this.fx.trail(m.p.x - dir.x * 1.3, m.p.y - dir.y * 1.3, m.p.z - dir.z * 1.3);
      }

      m.mesh.position.copy(m.p);
      this._orienta(m);
      if (m.chama) {
        const k = 0.75 + Math.random() * 0.5;
        m.chama.scale.set(k, 0.8 + Math.random() * 0.5, k);
      }
    }
  }

  _orienta(m) {
    this._q.setFromUnitVectors(this._eixo, this._tmp.copy(m.v).normalize());
    m.mesh.quaternion.copy(this._q);
    m.mesh.position.copy(m.p);
  }

  /** Igual ao da bala, mas sem se importar com QUEM foi atingido: explode. */
  _trace(from, dir, dist) {
    let best = null;

    const alvo = (lista, campo, raio, extra) => {
      if (!lista) return;
      for (const e of lista) {
        if (!e.alive) continue;
        const c = extra(e);
        const t = this._segEsfera(from, dir, dist, c.x, c.y, c.z, raio);
        if (t !== null && (!best || t < best.t)) best = { t, kind: campo, alvo: e };
      }
    };
    // inimigos da campanha primeiro: o colosso é o alvo grande da cena
    if (this.targets.foes) {
      for (const f of this.targets.foes) {
        if (!f.vivo) continue;
        const cc = f.root.position;
        const t = this._segEsfera(from, dir, dist,
          cc.x, cc.y + (f.alturaAlvo || 1), cc.z, f.raioAcerto || 1.5);
        if (t !== null && (!best || t < best.t)) best = { t, kind: 'foe', alvo: f };
      }
    }
    alvo(this.targets.peds?.peds, 'ped', 0.7,
      (p) => ({ x: p.human.root.position.x, y: p.human.root.position.y + PED.height * 0.55, z: p.human.root.position.z }));
    alvo(this.targets.cars?.cars, 'car', 1.7,
      (c) => ({ x: c.root.position.x, y: c.root.position.y + CAR.height * 0.6, z: c.root.position.z }));

    const solido = this.col.raycast(from.x, from.y, from.z, dir.x, dir.y, dir.z, dist);
    if (solido && (!best || solido.t < best.t)) best = { t: solido.t, kind: 'solid' };

    if (dir.y < 0) {
      const chao = this.col.groundHeightAt(from.x, from.z, from.y);
      const tg = (chao - from.y) / dir.y;
      if (tg >= 0 && tg <= dist && (!best || tg < best.t)) best = { t: tg, kind: 'solid' };
    }

    if (!best) return null;
    best.point = new THREE.Vector3(
      from.x + dir.x * best.t, from.y + dir.y * best.t, from.z + dir.z * best.t,
    );
    return best;
  }

  _segEsfera(from, dir, dist, cx, cy, cz, r) {
    const ox = from.x - cx, oy = from.y - cy, oz = from.z - cz;
    const b = ox * dir.x + oy * dir.y + oz * dir.z;
    const c = ox * ox + oy * oy + oz * oz - r * r;
    if (c < 0) return 0;
    const disc = b * b - c;
    if (disc < 0) return null;
    const t = -b - Math.sqrt(disc);
    if (t < 0 || t > dist) return null;
    return t;
  }

  /**
   * Explosão com dano em área.
   *
   * As listas são COPIADAS antes de percorrer: o callback remove a vítima e
   * já repõe outra no lugar [29], e o sistema usa troca-com-o-último para
   * remover — iterar direto pularia elementos e poderia atingir quem acabou
   * de nascer.
   */
  _detona(m, ponto) {
    this.fx.explode(ponto, MISSILE.blastFx);
    this._apaga(m);

    /*
     * Inimigos da campanha entram pelo RAIO, não só pelo acerto direto.
     * No chefão colossal isso é o que torna a luta justa: acertar em
     * cheio um alvo de 55 m que anda enquanto você voa seria pedir
     * demais — a explosão perto do corpo já conta.
     */
    if (this.targets.foes && this.onHitFoe) {
      for (const f of this.targets.foes.slice()) {
        if (!f.vivo) continue;
        const c = f.root.position;
        const alvoY = c.y + (f.alturaAlvo || 1);
        const d = Math.hypot(c.x - ponto.x, alvoY - ponto.y, c.z - ponto.z);
        if (d > (f.raioAcerto || 1.5) + MISSILE.blastCar) continue;
        this.onHitFoe(f, ponto);
      }
    }

    const peds = this.targets.peds ? this.targets.peds.peds.slice() : [];
    for (const ped of peds) {
      if (!ped.alive) continue;
      const p = ped.human.root.position;
      if (p.distanceTo(ponto) > MISSILE.blastPed) continue;
      if (this.onHitPed) this.onHitPed(ped, ponto);
    }

    const cars = this.targets.cars ? this.targets.cars.cars.slice() : [];
    for (const car of cars) {
      if (!car.alive) continue;
      if (car.root.position.distanceTo(ponto) > MISSILE.blastCar) continue;
      if (this.onHitCar) this.onHitCar(car, ponto);
    }
  }

  _apaga(m) {
    m.alive = false;
    m.mesh.visible = false;
  }

  reset() {
    for (const m of this.list) this._apaga(m);
    this.cooldown = 0;
  }
}
