import { GRID, CELL, HALF, LANE } from './config.js';

export const TAU = Math.PI * 2;

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, v) => (v - a) / (b - a);
export const smoothstep = (t) => t * t * (3 - 2 * t);

/** Interpolação estável em relação ao framerate. */
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));

/** Menor diferença angular entre dois ângulos (-PI..PI). */
export function angleDelta(a, b) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

export function dampAngle(a, b, lambda, dt) {
  return a + angleDelta(a, b) * (1 - Math.exp(-lambda * dt));
}

/** PRNG determinístico (mulberry32) — mesma seed, mesma cidade. */
export function makeRng(seed = 1337) {
  let t = seed >>> 0;
  return function rng() {
    t = (t + 0x6d2b79f5) | 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

export const rngRange = (rng, a, b) => a + rng() * (b - a);
export const rngInt = (rng, a, b) => Math.floor(a + rng() * (b - a + 1));
export const rngPick = (rng, arr) => arr[Math.floor(rng() * arr.length) % arr.length];

// ------------------------------------------------------------------ malha viária
/** Coordenada mundial da linha de cruzamento de índice i. */
export const nodeCoord = (i) => i * CELL - HALF;

/** Índice de cruzamento mais próximo de uma coordenada. */
export const nearestNodeIndex = (v) => clamp(Math.round((v + HALF) / CELL), 0, GRID - 1);

/** Está dentro dos limites da malha de ruas? */
export const inGrid = (i) => i >= 0 && i < GRID;

/** Distância até o eixo de rua mais próximo em um eixo. */
export function distToRoadAxis(v) {
  const i = nearestNodeIndex(v);
  return Math.abs(v - nodeCoord(i));
}

/**
 * [23] Centro da faixa correta para um veículo, respeitando mão direita.
 * axis 'z' = rua norte-sul (eixo em X);  axis 'x' = rua leste-oeste (eixo em Z).
 * dir = +1 ou -1 (sentido do movimento no eixo de viagem).
 * Regra: com forward=+Z a direita é -X; com forward=+X a direita é +Z.
 */
export function laneOffset(axis, dir) {
  if (axis === 'z') return dir > 0 ? -LANE : +LANE;   // andando em +Z fica em -X
  return dir > 0 ? +LANE : -LANE;                      // andando em +X fica em +Z
}

/** Direções cardeais: 0=+X, 1=+Z, 2=-X, 3=-Z */
export const DIRS = [
  { x: 1, z: 0, axis: 'x', dir: 1 },
  { x: 0, z: 1, axis: 'z', dir: 1 },
  { x: -1, z: 0, axis: 'x', dir: -1 },
  { x: 0, z: -1, axis: 'z', dir: -1 },
];

// ------------------------------------------------------------------ geometria 2D
export function dist2D(ax, az, bx, bz) {
  const dx = ax - bx, dz = az - bz;
  return Math.sqrt(dx * dx + dz * dz);
}

export function dist2Sq(ax, az, bx, bz) {
  const dx = ax - bx, dz = az - bz;
  return dx * dx + dz * dz;
}

/** Formata segundos como m:ss */
export function formatTime(sec) {
  sec = Math.max(0, Math.ceil(sec));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m + ':' + String(s).padStart(2, '0');
}

/** Formata a hora do jogo (float 0..24) como HH:MM */
export function formatClock(hour) {
  const h = Math.floor(hour) % 24;
  const m = Math.floor((hour % 1) * 60);
  return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
}

/** Remove um item de um array sem preservar a ordem (O(1)). */
export function swapRemove(arr, item) {
  const i = arr.indexOf(item);
  if (i < 0) return false;
  arr[i] = arr[arr.length - 1];
  arr.pop();
  return true;
}
