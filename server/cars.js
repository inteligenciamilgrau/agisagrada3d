/**
 * Carros do multiplayer — autoritativos no servidor.
 *
 * Nascem nas ruas da cidade (mesma grade do cliente), o jogador entra (tecla E
 * perto de um carro livre), dirige com WASD (moveZ = acelerar/ré, moveX =
 * esterço) e sai (E de novo). Colidem com prédios via CollisionWorld e o
 * snapshot carrega posição/yaw/velocidade de cada um + quem está dirigindo.
 */

import { GRID, HALF, CELL, ROAD_H, LANE, STOP_LINE, CAR } from './config.js';
import { makeRng, rngPick, clamp, nodeCoord } from './util.js';

let carUid = 1;

const CORES = [
  0xe53935, 0x1e88e5, 0xfdd835, 0x43a047,
  0x8e24aa, 0xfb8c00, 0x00897b, 0x5d4037,
];

/** Direções cardeais do tráfego: 0=+X, 1=+Z, 2=-X, 3=-Z (igual ao solo). */
const DIRS = [
  { x: 1, z: 0, axis: 'x' },
  { x: 0, z: 1, axis: 'z' },
  { x: -1, z: 0, axis: 'x' },
  { x: 0, z: -1, axis: 'z' },
];

/** Deslocamento lateral de cada sentido: mão direita (igual ao solo). */
const LANE_OFF = [
  { x: 0, z: +LANE },   // 0: +X
  { x: -LANE, z: 0 },   // 1: +Z
  { x: 0, z: -LANE },   // 2: -X
  { x: +LANE, z: 0 },   // 3: -Z
];

/** Ponto da faixa a `dist` do centro do cruzamento, no sentido `dir`. */
function lanePoint(i, j, dir, dist) {
  const d = DIRS[dir], o = LANE_OFF[dir];
  return {
    x: nodeCoord(i) + d.x * dist + o.x,
    z: nodeCoord(j) + d.z * dist + o.z,
  };
}

// ciclo dos semáforos (mesmos tempos do solo: 11 verde / 2.4 amarelo / 1 vermelho)
const GREEN = 11, YELLOW = 2.4, ALL_RED = 1.0;
const CYCLE = 2 * (GREEN + YELLOW + ALL_RED);

/** Sinal do cruzamento (i,j) para o eixo dado — réplica do TrafficSystem. */
function carSignal(i, j, axis, t) {
  if (i < 0 || j < 0 || i >= GRID || j >= GRID) return 'green';
  let tt = (t + ((i + j) % 2) * (CYCLE / 2)) % CYCLE;
  if (axis === 'z') {
    return tt < GREEN ? 'green' : tt < GREEN + YELLOW ? 'yellow' : 'red';
  }
  tt -= GREEN + YELLOW + ALL_RED;
  if (tt < 0) tt += CYCLE;
  return tt < GREEN ? 'green' : tt < GREEN + YELLOW ? 'yellow' : 'red';
}

/**
 * Cria `count` carros nas ruas perto dos cruzamentos, já com estado de
 * tráfego (i/j/dir/s) — os livres CIRCULAM como no modo solo.
 */
export function createCars(world, count) {
  const rng = makeRng(20260725);
  const cars = [];

  // nós da grade (cruzamentos) — as ruas ficam entre os quarteirões
  const nos = [];
  for (let i = 1; i < GRID - 1; i++) {
    for (let j = 1; j < GRID - 1; j++) nos.push([i, j]);
  }
  for (let k = nos.length - 1; k > 0; k--) {
    const m = Math.floor(rng() * (k + 1));
    [nos[k], nos[m]] = [nos[m], nos[k]];
  }

  for (let n = 0; n < count && n < nos.length; n++) {
    const [i, j] = nos[n];
    const cx = i * 64 - HALF, cz = j * 64 - HALF;
    // posição inicial numa faixa do cruzamento (mão direita, igual ao solo)
    const dir = Math.floor(rng() * 4);
    const s = STOP_LINE + 3 + rng() * (CELL - ROAD_H - 2 - STOP_LINE - 3);
    const p = lanePoint(i, j, dir, -s);
    let x = p.x, z = p.z;
    if (world.col.isBlocked(x, z, CAR.radius)) { x = cx; z = cz; }
    const y = world.col.groundHeightAt(x, z);
    cars.push({
      id: carUid++,
      x, y: y + 0.2, z,
      yaw: Math.atan2(DIRS[dir].x, DIRS[dir].z),
      speed: 0,
      playerId: null,        // id do jogador dirigindo (null = livre)
      inp: null,             // input do motorista (moveX, moveZ)
      cor: rngPick(rng, CORES),
      hp: 90,                // vida: 4 tiros de pistola (34) — explode ao zerar
      destroyed: false,      // virou sucata: não dirige nem pode entrar
      // estado do tráfego (igual ao CarSystem do solo)
      i, j, dir,
      s: s > 0 ? s : 20,     // distância até o cruzamento
      state: 'drive',        // 'drive' | 'cross'
      cruise: CAR.npcSpeed * (0.85 + rng() * 0.25),
      crossT: 0, bez: null, nextDir: dir, prevDir: dir, turnSign: 0,
      _rng: makeRng((carUid * 977 + 31) >>> 0),
    });
  }
  return cars;
}

/**
 * Move os carros: os LIVRES circulam pela cidade (IA de tráfego igual ao
 * solo — faixas, semáforos, curvas de Bézier no cruzamento); os dirigidos
 * seguem o input do motorista (aceleração, esterço, colisão, limite).
 */
export function updateCars(world, cars, dt) {
  const t = (cars._trafficTime = (cars._trafficTime || 0) + dt);
  for (const c of cars) {
    if (c.destroyed) continue;
    if (c.playerId == null) {
      c.inp = null;
      _updateTraffic(c, cars, t, dt, world);
      continue;
    }
    const inp = c.inp || { moveX: 0, moveZ: 0 };

    // acelera / freia / ré
    const gas = clamp(inp.moveZ, -1, 1);
    const alvo = gas * CAR.maxSpeed * (c.velMult ?? 1);   // [BOT-VEICULO] velMult 0.5 p/ carro de bot
    const accel = gas !== 0 ? CAR.accel : CAR.brake;
    c.speed += clamp(alvo - c.speed, -accel * dt, accel * dt);

    // esterço proporcional à velocidade
    if (Math.abs(c.speed) > 0.4) {
      const steer = -clamp(inp.moveX, -1, 1) * CAR.steer * Math.min(1, Math.abs(c.speed) / 9);
      c.yaw += steer * dt * (c.speed >= 0 ? 1 : -1);
    }

    // anda
    c.x += Math.sin(c.yaw) * c.speed * dt;
    c.z += Math.cos(c.yaw) * c.speed * dt;

    // colisão com prédios/postes (círculo do carro)
    const pos = { x: c.x, y: c.y, z: c.z };
    world.col.resolveCircle(pos, CAR.radius, CAR.height);
    c.x = pos.x;
    c.z = pos.z;
    c.y = world.col.groundHeightAt(c.x, c.z) + 0.2;

    // limite do mundo
    c.x = clamp(c.x, -2500, 2500);
    c.z = clamp(c.z, -2500, 2500);
  }
}

/** IA de tráfego de um carro livre — réplica matemática pura do CarSystem. */
function _updateTraffic(c, cars, t, dt, world) {
  if (c.state === 'cross') {
    // atravessando o cruzamento por um arco de Bézier
    const b = c.bez;
    c.crossT += (c.speed * dt) / b.len;
    if (c.crossT >= 1) {
      c.state = 'drive';
      c.dir = c.nextDir;
      const d = DIRS[c.dir];
      c.i += d.x; c.j += d.z;
      c.s = CELL - ROAD_H;
      c.prevDir = c.dir;
    } else {
      const t2 = c.crossT, mt = 1 - t2;
      c.x = mt * mt * b.e.x + 2 * mt * t2 * b.c.x + t2 * t2 * b.x2.x;
      c.z = mt * mt * b.e.z + 2 * mt * t2 * b.c.z + t2 * t2 * b.x2.z;
      const dx = 2 * mt * (b.c.x - b.e.x) + 2 * t2 * (b.x2.x - b.c.x);
      const dz = 2 * mt * (b.c.z - b.e.z) + 2 * t2 * (b.x2.z - b.c.z);
      c.yaw = Math.atan2(dx, dz);
      c.y = world.col.groundHeightAt(c.x, c.z) + 0.2;
      return;
    }
  }

  // trecho reto
  const d = DIRS[c.dir];
  const sig = carSignal(c.i, c.j, d.axis, t);
  const distToStop = c.s - STOP_LINE;

  let target = c.cruise;

  // respeita o semáforo (para atrás da faixa de pedestre)
  if (sig !== 'green' && distToStop < CAR.stopDistance) {
    target = sig === 'yellow' && distToStop < 2 && c.speed > 6
      ? c.cruise
      : clamp(distToStop / CAR.stopDistance, 0, 1) * c.cruise;
  }

  // não encosta no carro da frente
  const gap = frontGap(c, cars);
  if (gap < 13) target = Math.min(target, Math.max(0, (gap - 5.2) * 2.4));

  const accel = target > c.speed ? 7.5 : 15;
  c.speed += clamp(target - c.speed, -accel * dt, accel * dt);
  c.speed = Math.max(0, c.speed);

  c.s -= c.speed * dt;

  if (c.s <= ROAD_H) {
    // entra no cruzamento: escolhe reto / direita / esquerda (sem retorno)
    const opts = [];
    for (let nd = 0; nd < 4; nd++) {
      if ((nd + 2) % 4 === c.dir) continue;
      const nn = DIRS[nd];
      const ti = c.i + nn.x, tj = c.j + nn.z;
      if (ti < 0 || ti >= GRID || tj < 0 || tj >= GRID) continue;
      const weight = nd === c.dir ? 5 : 1;
      for (let w = 0; w < weight; w++) opts.push(nd);
    }
    const nd = opts.length ? opts[Math.floor(c._rng() * opts.length)] : (c.dir + 2) % 4;

    const e = lanePoint(c.i, c.j, c.dir, -ROAD_H);
    const x2 = lanePoint(c.i, c.j, nd, ROAD_H);
    const cp = {
      x: nodeCoord(c.i) + (DIRS[c.dir].x !== 0 ? LANE_OFF[nd].x : LANE_OFF[c.dir].x),
      z: nodeCoord(c.j) + (DIRS[c.dir].z !== 0 ? LANE_OFF[nd].z : LANE_OFF[c.dir].z),
    };
    const len = Math.hypot(x2.x - e.x, x2.z - e.z) * 1.24 + 0.01;

    c.bez = { e, c: cp, x2, len };
    c.crossT = 0;
    c.nextDir = nd;
    c.state = 'cross';
    const cross = DIRS[c.dir].x * DIRS[nd].z - DIRS[c.dir].z * DIRS[nd].x;
    c.turnSign = -Math.sign(cross);
    return;
  }

  const p = lanePoint(c.i, c.j, c.dir, -c.s);
  c.x = p.x; c.z = p.z;
  c.yaw = Math.atan2(d.x, d.z);
  c.y = world.col.groundHeightAt(c.x, c.z) + 0.2;
}

/** Distância livre até o veículo à frente (na mesma faixa). */
function frontGap(c, cars) {
  const fx = Math.sin(c.yaw), fz = Math.cos(c.yaw);
  let best = 999;
  for (const o of cars) {
    if (o === c || o.destroyed) continue;
    const dx = o.x - c.x, dz = o.z - c.z;
    const fwd = dx * fx + dz * fz;
    if (fwd <= 0.5 || fwd > 20) continue;
    const lat = Math.abs(dx * fz - dz * fx);
    if (lat > 2.4) continue;
    if (fwd < best) best = fwd;
  }
  return best;
}
