/**
 * Terreno do servidor — CÓPIA das funções PURAS do cliente (src/world/terrain.js),
 * sem THREE. `terrainHeight` devolve a MESMA altura que o cliente usa, então o
 * chão do servidor bate com o chão que o jogador vê.
 */

import { HALF, PLATOS } from '../config.js';
import { clamp, smoothstep, lerp, makeRng } from '../util.js';

const CITY_R = 240;
const BASE_Y = 0;
const APPROACH_Y = 0.06;

export const LAKE = {
  minX: -168, maxX: 104,
  minZ: 286, maxZ: 438,
  surfaceY: -1.0,
  depth: 7.0,
  fade: 30,
};

export const BRIDGE = {
  x: -32,
  halfW: 7,
  deckY: 5.4,
  arch: 1.5,
  z0: 262, z1: 300, z2: 424, z3: 462,
};

export function bridgeY(z) {
  const B = BRIDGE;
  if (z <= B.z0 || z >= B.z3) return APPROACH_Y;
  if (z < B.z1) return lerp(APPROACH_Y, B.deckY, smoothstep(clamp((z - B.z0) / (B.z1 - B.z0), 0, 1)));
  if (z > B.z2) return lerp(B.deckY, APPROACH_Y, smoothstep(clamp((z - B.z2) / (B.z3 - B.z2), 0, 1)));
  return B.deckY + B.arch * Math.sin(Math.PI * ((z - B.z1) / (B.z2 - B.z1)));
}

export function onBridge(x, z) {
  return Math.abs(x - BRIDGE.x) <= BRIDGE.halfW && z > BRIDGE.z0 && z < BRIDGE.z3;
}

export function lakeMask(x, z) {
  const wob =
    Math.sin(x * 0.042) * 8 +
    Math.cos(z * 0.055) * 6.5 +
    Math.sin((x - z) * 0.026) * 5;
  const fx = Math.min(x - LAKE.minX, LAKE.maxX - x) + wob;
  const fz = Math.min(z - LAKE.minZ, LAKE.maxZ - z) + wob;
  const m = Math.min(fx, fz) / LAKE.fade;
  if (m <= 0) return 0;
  return smoothstep(clamp(m, 0, 1));
}

const hillRng = makeRng(4242);
const HILL_OFF = [hillRng() * 100, hillRng() * 100, hillRng() * 100];

function hills(x, z) {
  return (
    Math.sin((x + HILL_OFF[0]) * 0.0075) * Math.cos((z + HILL_OFF[1]) * 0.0068) * 7.5 +
    Math.sin((x - z + HILL_OFF[2]) * 0.014) * 2.6 +
    Math.cos((x * 0.021) + (z * 0.017)) * 1.4
  );
}

function corridorMask(x, z) {
  const fx = 1 - clamp((Math.abs(x - BRIDGE.x) - 12) / 14, 0, 1);
  const fz = 1 - clamp((z - (BRIDGE.z3 + 40)) / 30, 0, 1);
  const fz0 = clamp((z - (HALF - 30)) / 20, 0, 1);
  return smoothstep(Math.min(fx, fz, fz0));
}

function terrenoNatural(x, z) {
  const d = Math.max(Math.abs(x), Math.abs(z));
  const away = smoothstep(clamp((d - CITY_R) / 80, 0, 1));
  return BASE_Y + away * hills(x, z);
}

function platoMask(p, x, z) {
  const c = Math.cos(p.rot), s = Math.sin(p.rot);
  const dx = x - p.x, dz = z - p.z;
  const lx = dx * c - dz * s, lz = dx * s + dz * c;
  const fx = (p.hx + p.fade - Math.abs(lx)) / p.fade;
  const fz = (p.hz + p.fade - Math.abs(lz)) / p.fade;
  const m = Math.min(fx, fz);
  if (m <= 0) return 0;
  return smoothstep(clamp(m, 0, 1));
}

for (const p of PLATOS) {
  let soma = 0, n = 0;
  const c = Math.cos(p.rot), s = Math.sin(p.rot);
  for (let lx = -p.hx; lx <= p.hx; lx += 4) {
    for (let lz = -p.hz; lz <= p.hz; lz += 4) {
      soma += terrenoNatural(p.x + lx * c + lz * s, p.z - lx * s + lz * c);
      n++;
    }
  }
  p.y = soma / n;
}

export function terrainHeight(x, z) {
  let y = terrenoNatural(x, z);
  for (const p of PLATOS) {
    const m = platoMask(p, x, z);
    if (m > 0) y = lerp(y, p.y, m);
  }
  const corr = corridorMask(x, z);
  if (corr > 0) y = lerp(y, APPROACH_Y, corr);
  const lm = lakeMask(x, z);
  if (lm > 0) y = lerp(y, LAKE.surfaceY - LAKE.depth, lm);
  return y;
}

export { CITY_R };
