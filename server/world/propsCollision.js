/**
 * Colisão dos props da cidade no servidor (postes + árvores).
 * Mesma seed (777) e MESMA ordem de chamadas do RNG do cliente
 * (src/world/props.js), então os colisores batem 1:1 e o jogador do
 * multiplayer não atravessa postes/árvores (igual ao modo solo).
 */
import { makeRng, rngRange, rngInt } from '../util.js';
import { CELL, ROAD_W, BLOCK_INNER, CURB_H, PROP_OFF } from '../config.js';

const BLOCK_HALF = (CELL - ROAD_W) / 2;      // 23 (igual ao cliente)
const BAND = CELL / 2 - PROP_OFF;            // 22.1

export function buildPropsCollision(col, blocks) {
  const rng = makeRng(777);                  // MESMA seed do cliente
  const lampSpots = [];
  const treeSpots = [];

  for (const b of blocks) {
    // 4 lados do quarteirão (mesma ordem do cliente: x+, x-, z+, z-)
    const edges = [
      { ax: 'x', sign: 1 }, { ax: 'x', sign: -1 },
      { ax: 'z', sign: 1 }, { ax: 'z', sign: -1 },
    ];
    for (const e of edges) {
      for (let k = -1; k <= 1; k++) {
        const t = k * (BLOCK_HALF - 4.5);
        const px = e.ax === 'x' ? b.cx + e.sign * BAND : b.cx + t;
        const pz = e.ax === 'x' ? b.cz + t : b.cz + e.sign * BAND;
        if (k === 0) {
          lampSpots.push({ x: px, z: pz });
        } else if (rng() < 0.72) {
          treeSpots.push({ x: px, z: pz });
        } else {
          rng();   // banco (sem colisão) — consome o RNG na mesma ordem do cliente
        }
      }
    }

    // praças: árvores e arbustos preenchendo o miolo (consome RNG igual ao cliente)
    if (b.type === 'park') {
      const R = BLOCK_INNER / 2 - 1.5;
      const n = rngInt(rng, 9, 15);
      for (let i = 0; i < n; i++) {
        treeSpots.push({ x: b.cx + rngRange(rng, -R, R), z: b.cz + rngRange(rng, -R, R) });
      }
      for (let i = 0; i < 16; i++) { rngRange(rng, -R, R); rngRange(rng, -R, R); }
      for (let i = 0; i < 3; i++) {
        rngRange(rng, -R * 0.7, R * 0.7); rngRange(rng, -R * 0.7, R * 0.7); rngRange(rng, 0, Math.PI * 2);
      }
    }
  }

  // postes de luz — sempre no k === 0 de cada lado (não usam RNG)
  for (const s of lampSpots) col.addCircle(s.x, s.z, 0.28, CURB_H + 7.4, 'lamp');

  // árvores — a escala (raio) sai do MESMO ponto do RNG do cliente:
  // primeiro todos os spots, depois sc/rot/escY/cor por árvore
  for (const s of treeSpots) {
    const sc = rngRange(rng, 0.78, 1.35);
    rngRange(rng, 0, Math.PI * 2);   // rotação (visual)
    rngRange(rng, 0.9, 1.2);         // escala Y (visual)
    rng(); rng(); rng();             // cor (visual)
    col.addCircle(s.x, s.z, 0.42 * sc, CURB_H + 3, 'tree');
  }
}
