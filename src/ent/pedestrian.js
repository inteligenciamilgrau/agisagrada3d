import * as THREE from '../../vendor/three.module.js';
import { GRID, CURB_H, PED, WALK_OFF } from '../config.js';
import { nodeCoord, makeRng, rngRange, rngInt, dist2Sq, swapRemove } from '../utils.js';
import { Human } from './human.js';

/**
 * Distância do eixo da rua até a faixa de caminhada.
 * É o mesmo valor usado para pintar a faixa de pedestre, então as pessoas
 * atravessam exatamente em cima da faixa [21].
 */
const PED_OFF = WALK_OFF;

/**
 * [2] Pessoas andando na cidade.
 * Elas circulam por um grafo de calçadas e só atravessam a rua na faixa,
 * quando o semáforo de pedestre abre [4][21].
 */
const _A = new THREE.Vector3(); // [perf F3-4] pool de vetor: zero alocacao por frame

export class PedestrianSystem {
  constructor(scene, collision, traffic, seed = 31337) {
    this.scene = scene;
    this.col = collision;
    this.traffic = traffic;
    this.rng = makeRng(seed);

    this.nodes = [];
    this.nodeIndex = new Map();
    this.peds = [];
    this.usedNumbers = new Set();

    this.group = new THREE.Group();
    this.group.name = 'pedestrians';
    scene.add(this.group);
  }

  // ------------------------------------------------------------------ grafo
  _key(i, j, sx, sz) { return `${i},${j},${sx},${sz}`; }

  _node(i, j, sx, sz) {
    const k = this._key(i, j, sx, sz);
    if (this.nodeIndex.has(k)) return this.nodeIndex.get(k);
    const idx = this.nodes.length;
    this.nodes.push({
      i, j, sx, sz,
      x: nodeCoord(i) + sx * PED_OFF,
      z: nodeCoord(j) + sz * PED_OFF,
      edges: [],
    });
    this.nodeIndex.set(k, idx);
    return idx;
  }

  _link(a, b, cross, axis) {
    const A = this.nodes[a], B = this.nodes[b];
    const len = Math.hypot(B.x - A.x, B.z - A.z);
    A.edges.push({ to: b, len, cross, axis });
    B.edges.push({ to: a, len, cross, axis });
  }

  buildGraph() {
    // ---- calçadas contornando cada quarteirão
    for (let bi = 0; bi < GRID - 1; bi++) {
      for (let bj = 0; bj < GRID - 1; bj++) {
        const sw = this._node(bi, bj, 1, 1);
        const se = this._node(bi + 1, bj, -1, 1);
        const nw = this._node(bi, bj + 1, 1, -1);
        const ne = this._node(bi + 1, bj + 1, -1, -1);
        this._link(sw, se, false, 'x');
        this._link(nw, ne, false, 'x');
        this._link(sw, nw, false, 'z');
        this._link(se, ne, false, 'z');
      }
    }

    // ---- [21] travessias nas faixas de pedestre
    const has = (i, j, sx, sz) => this.nodeIndex.has(this._key(i, j, sx, sz));
    const get = (i, j, sx, sz) => this.nodeIndex.get(this._key(i, j, sx, sz));

    for (let i = 0; i < GRID; i++) {
      for (let j = 0; j < GRID; j++) {
        // atravessar a rua N-S (anda em X)
        for (const sz of [-1, 1]) {
          if (has(i, j, -1, sz) && has(i, j, 1, sz)) {
            this._link(get(i, j, -1, sz), get(i, j, 1, sz), { i, j }, 'x');
          }
        }
        // atravessar a rua L-O (anda em Z)
        for (const sx of [-1, 1]) {
          if (has(i, j, sx, -1) && has(i, j, sx, 1)) {
            this._link(get(i, j, sx, -1), get(i, j, sx, 1), { i, j }, 'z');
          }
        }
      }
    }
  }

  // ------------------------------------------------------------------ spawn
  _uniqueNumber() {
    let n;
    do {
      n = rngInt(this.rng, 10000, 99999);
    } while (this.usedNumbers.has(n));
    this.usedNumbers.add(n);
    return n;
  }

  /** [45] Nunca nasce dentro de prédio: os nós de calçada já ficam fora deles. */
  _freeNode() {
    for (let tries = 0; tries < 40; tries++) {
      const idx = rngInt(this.rng, 0, this.nodes.length - 1);
      const n = this.nodes[idx];
      if (!this.col.isBlocked(n.x, n.z, PED.radius + 0.2, CURB_H + 0.5)) return idx;
    }
    return rngInt(this.rng, 0, this.nodes.length - 1);
  }

  spawnOne(nearIdx = null) {
    const rng = this.rng;
    const startIdx = nearIdx ?? this._freeNode();
    const start = this.nodes[startIdx];

    const human = new Human({
      rng,
      scale: rngRange(rng, 0.93, 1.08),
      number: this._uniqueNumber(),
    });
    human.root.position.set(start.x, CURB_H, start.z);
    this.group.add(human.root);

    const ped = {
      human,
      node: startIdx,
      next: -1,
      t: 0,
      edge: null,
      speed: rngRange(rng, PED.speed * 0.78, PED.speed * 1.3),
      // desvio dentro da faixa de caminhada, sem encostar em poste nem em prédio
      lateral: rngRange(rng, -0.7, 0.7),
      waiting: false,
      number: human.number,
      hasPackage: false,
      isTarget: false,
      alive: true,
      chat: [],
      mood: rngInt(rng, 0, 3),
    };
    this._chooseEdge(ped);
    this.peds.push(ped);
    return ped;
  }

  spawn(count) {
    this.buildGraph();
    for (let i = 0; i < count; i++) this.spawnOne();
  }

  // ------------------------------------------------------------------ navegação
  _chooseEdge(ped) {
    const node = this.nodes[ped.node];
    if (!node.edges.length) return;

    // evita voltar por onde veio, a não ser que seja a única saída
    const options = node.edges.filter((e) => e.to !== ped.prev);
    const list = options.length ? options : node.edges;
    const e = list[rngInt(this.rng, 0, list.length - 1)];

    // [4] travessia só com sinal de pedestre aberto
    if (e.cross) {
      const sig = this.traffic.pedSignal(e.cross.i, e.cross.j, e.axis);
      if (sig !== 'walk') {
        ped.waiting = true;
        ped.pendingEdge = e;
        return;
      }
    }
    ped.waiting = false;
    ped.pendingEdge = null;
    ped.edge = e;
    ped.next = e.to;
    ped.t = 0;
  }

  update(dt, refX = null, refZ = null) {
    const A = _A;
    const FAR2 = 60 * 60;   // [perf F3-4] LOD animacao: >60 m -> 30 Hz
    for (const ped of this.peds) {
      if (!ped.alive) continue;

      if (ped.waiting) {
        const e = ped.pendingEdge;
        const sig = this.traffic.pedSignal(e.cross.i, e.cross.j, e.axis);
        if (sig === 'walk') {
          ped.waiting = false;
          ped.edge = e;
          ped.next = e.to;
          ped.t = 0;
          ped.pendingEdge = null;
        } else {
          // parado na esquina, olhando o semáforo
          this._anim(ped, dt, 0, refX != null && dist2Sq(ped.human.root.position.x, ped.human.root.position.z, refX, refZ) > FAR2);
          continue;
        }
      }

      if (!ped.edge) { this._chooseEdge(ped); continue; }

      const from = this.nodes[ped.node];
      const to = this.nodes[ped.next];
      // atravessa mais rápido (ninguém passeia no meio da rua)
      const spd = ped.edge.cross ? ped.speed * 1.7 : ped.speed;
      ped.t += (spd / ped.edge.len) * dt;

      if (ped.t >= 1) {
        ped.prev = ped.node;
        ped.node = ped.next;
        ped.t = 0;
        ped.edge = null;
        this._chooseEdge(ped);
        continue;
      }

      // posição na aresta + desvio lateral (para não andarem em fila indiana)
      const dx = to.x - from.x, dz = to.z - from.z;
      const len = ped.edge.len || 1;
      const nx = -dz / len, nz = dx / len;
      // no meio da faixa o desvio some, senão pisam fora da faixa
      const latScale = ped.edge.cross ? 0.35 : 1;
      const px = from.x + dx * ped.t + nx * ped.lateral * latScale;
      const pz = from.z + dz * ped.t + nz * ped.lateral * latScale;

      // ao atravessar, desce o meio-fio e sobe de novo do outro lado
      const py = ped.edge.cross
        ? CURB_H * (1 - Math.sin(Math.PI * ped.t))
        : CURB_H;

      A.set(px, py, pz);
      ped.human.root.position.copy(A);
      ped.human.root.rotation.y = Math.atan2(dx, dz);
      this._anim(ped, dt, spd, refX != null && dist2Sq(px, pz, refX, refZ) > FAR2);
    }
  }

  // ------------------------------------------------------------------ consultas
  _anim(ped, dt, spd, far) {
    if (!far) { ped.human.update(dt, spd); ped.lodAcc = 0; return; }
    ped.lodAcc = (ped.lodAcc || 0) + dt;
    if (ped.lodAcc >= 1 / 30) { ped.human.update(ped.lodAcc, spd); ped.lodAcc = 0; }
  }

  nearest(x, z, maxDist) {
    let best = null, bestD = maxDist * maxDist;
    for (const p of this.peds) {
      if (!p.alive) continue;
      const d = dist2Sq(p.human.root.position.x, p.human.root.position.z, x, z);
      if (d < bestD) { bestD = d; best = p; }
    }
    return best;
  }

  byNumber(num) {
    return this.peds.find((p) => p.alive && String(p.number) === String(num)) || null;
  }

  /** Todas as pessoas dentro de um raio (usado por atropelamento e explosão). */
  within(x, z, r) {
    const out = [];
    const r2 = r * r;
    for (const p of this.peds) {
      if (!p.alive) continue;
      const pos = p.human.root.position;
      if (dist2Sq(pos.x, pos.z, x, z) < r2) out.push(p);
    }
    return out;
  }

  /** [29] Remove a pessoa e repõe outra em um ponto distante. */
  remove(ped, respawn = true) {
    if (!ped.alive) return null;
    ped.alive = false;
    this.group.remove(ped.human.root);
    ped.human.dispose();
    swapRemove(this.peds, ped);
    this.usedNumbers.delete(Number(ped.number));

    if (respawn) return this.spawnOne();
    return null;
  }

  get count() { return this.peds.length; }

  setNight(n) {
    for (const p of this.peds) {
      if (p.alive && p.human) p.human.setNight(n);
    }
  }
}

export { PED_OFF };
