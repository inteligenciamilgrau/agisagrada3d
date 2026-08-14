/** Utilidades puras do servidor (sem THREE). */
import { CELL, HALF, GRID } from './config.js';

export const TAU = Math.PI * 2;
export const smoothstep = (t) => t * t * (3 - 2 * t);
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const dist2D = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz);

/** Menor diferença angular entre dois ângulos (-PI..PI). */
export function angleDelta(a, b) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

/** PRNG determinístico (mulberry32) — mesma seed, mesma cidade do cliente. */
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

/** Coordenada mundial da linha de cruzamento de índice i. */
export const nodeCoord = (i) => i * CELL - HALF;

/** Ponto livre perto de uma coordenada (tentativas até achar). */
export function findFreeSpot(col, x, z, r = 0.5, tries = 12) {
  const rng = makeRng((Math.abs(x) * 131 + Math.abs(z) * 17 + 7) >>> 0);
  // busca em anéis de raio crescente: um ponto sorteado no meio de um
  // quarteirão (prédio de 36 m) só escapa chegando à rua (≤ 32 m)
  const aneis = [3, 8, 16, 28, 44];
  for (const raio of aneis) {
    for (let i = 0; i < tries; i++) {
      const a = rng() * Math.PI * 2;
      const px = x + Math.cos(a) * raio * Math.sqrt(rng());
      const pz = z + Math.sin(a) * raio * Math.sqrt(rng());
      if (!col.isBlocked(px, pz, r) && !col.isInWater(px, pz)) {
        const y = col.groundHeightAt(px, pz);
        return { x: px, y, z: pz };
      }
    }
  }
  // último recurso: o cruzamento de rua mais próximo (a malha de 64 m sempre
  // tem rua aberta); se nem isso existir, nasce no topo do prédio, fora de
  // qualquer colisão — nunca mais dentro de um sólido
  const gi = Math.round((x + HALF) / CELL);
  const gj = Math.round((z + HALF) / CELL);
  for (let d = 0; d <= GRID + 1; d++) {
    for (let i = gi - d; i <= gi + d; i++) {
      for (let j = gj - d; j <= gj + d; j++) {
        if (Math.max(Math.abs(i - gi), Math.abs(j - gj)) !== d) continue;
        const px = i * CELL - HALF, pz = j * CELL - HALF;
        if (!col.isBlocked(px, pz, r) && !col.isInWater(px, pz)) {
          return { x: px, y: col.groundHeightAt(px, pz), z: pz };
        }
      }
    }
  }
  return { x, y: Math.max(col.roofHeightAt(x, z) + 2, col.groundHeightAt(x, z) + 2), z };
}

/** [SPAWN] Verdadeiro se (x,z) tem espaco livre >= r em TODAS as direcoes
 *  (rua/praca: sim; beco estreito ou dentro de construcao: nao). */
export function temEspacoLivre(col, x, z, r = 5, amostras = 12, passo = 1) {
  if (col.isBlocked(x, z, 0.6) || col.isInWater(x, z)) return false;
  for (let a = 0; a < amostras; a++) {
    const ang = (a / amostras) * Math.PI * 2;
    for (let d = passo; d <= r; d += passo) {
      if (col.isBlocked(x + Math.cos(ang) * d, z + Math.sin(ang) * d, 0.6)) return false;
    }
  }
  return true;
}

/** [SPAWN] Ponto de rua/praca (espaco livre) perto de (x,z); fallback: findFreeSpot. */
export function findStreetSpot(col, x, z, r = 5, tries = 24) {
  const rng = makeRng((Math.abs(x) * 131 + Math.abs(z) * 17 + 7) >>> 0);
  for (let i = 0; i < tries; i++) {
    const a = rng() * Math.PI * 2;
    const d = rng() * 34;
    const px = x + Math.cos(a) * d;
    const pz = z + Math.sin(a) * d;
    if (temEspacoLivre(col, px, pz, r)) {
      return { x: px, y: col.groundHeightAt(px, pz), z: pz };
    }
  }
  return findFreeSpot(col, x, z, 0.6);
}


/** [SPAWN] Verdadeiro se (x,z) tem espaco livre >= r em TODAS as direcoes
 *  (rua/praca: sim; beco estreito ou dentro de construcao: nao). */
