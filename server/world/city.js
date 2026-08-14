/**
 * Cidade do servidor — CÓPIA da lógica de COLISÃO do cliente (src/world/city.js),
 * sem THREE. Mesma seed (20260725), mesmo PRNG mulberry32, mesmos lotes e
 * alturas: os `addBox` dos prédios e `addPlatform` das calçadas batem 1:1 com
 * o que o jogador vê no navegador.
 */

import { GRID, CELL, HALF, ROAD_W, CURB, CURB_H, BLOCK_INNER } from '../config.js';
import { nodeCoord, makeRng, rngRange, rngInt, rngPick } from '../util.js';

export function buildCity(col) {
  const rng = makeRng(20260725);   // MESMA seed do cliente
  const blocks = [];
  const parkBlocks = [];

  // ------------------------------------------------------------ layout
  for (let i = 0; i < GRID - 1; i++) {
    for (let j = 0; j < GRID - 1; j++) {
      const cx = nodeCoord(i) + CELL / 2;
      const cz = nodeCoord(j) + CELL / 2;
      const d = Math.max(Math.abs(cx), Math.abs(cz)) / HALF;
      let type = 'urban';
      if (rng() < 0.11) type = 'park';
      const block = { i, j, cx, cz, type, density: 1 - d };
      blocks.push(block);
      if (type === 'park') parkBlocks.push(block);
    }
  }

  // heliporto no quarteirão (2,4)
  const helipadBlock = blocks.find((b) => b.i === 2 && b.j === 4) || blocks[0];
  helipadBlock.type = 'heliport';

  const reservar = (i, j, tipo) => {
    const b = blocks.find((x) => x.i === i && x.j === j);
    if (!b) return null;
    b.type = tipo;
    return b;
  };
  reservar(3, 3, 'labs');
  reservar(3, 4, 'studio');

  // ------------------------------------------------------------ calçadas
  const size = CELL - ROAD_W;      // 46
  for (const b of blocks) {
    col.addPlatform(
      b.cx - size / 2, b.cz - size / 2, b.cx + size / 2, b.cz + size / 2,
      () => CURB_H,
    );
  }

  // ------------------------------------------------------------ prédios
  for (const b of blocks) {
    if (b.type !== 'urban') continue;
    const lots = splitBlock(b, rng);
    for (const lot of lots) {
      rngInt(rng, 0, 5);   // variant (não afeta colisão, só textura)
      const maxH = 16 + b.density * b.density * 68 + rngRange(rng, -6, 16);
      let h = Math.max(9, maxH);
      const tiers = h > 46 && rng() < 0.65 ? rngInt(rng, 2, 3) : 1;
      let cw = lot.w, cd = lot.d, base = CURB_H;
      for (let t = 0; t < tiers; t++) {
        const th = t === tiers - 1 ? h : h * rngRange(rng, 0.42, 0.62);
        base += th;
        h -= th;
        cw *= rngRange(rng, 0.66, 0.82);
        cd *= rngRange(rng, 0.66, 0.82);
        if (h < 6) break;
      }
      const totalH = base;
      col.addBox(lot.x, lot.z, lot.w / 2, lot.d / 2, totalH, 'building');
      if (totalH > 52 && lot.w > 17 && lot.d > 17 && rng() < 0.5) {
        // heliponto visual no cliente — sem caixa de colisão (não prende no telhado)
      }
      if (totalH > 52 && lot.w > 17 && lot.d > 17 && rng() < 0.5) {
        // heliponto visual no cliente — sem caixa de colisão (não prende no telhado)
      }
    }
  }
  return blocks;
}

/** Divide o quarteirão em lotes — CÓPIA de City._splitBlock. */
function splitBlock(b, rng) {
  const S = BLOCK_INNER;
  const r = rng();
  const margin = 1.2;
  const lots = [];
  if (r < 0.30) {
    const w = S * rngRange(rng, 0.72, 0.95);
    const d = S * rngRange(rng, 0.72, 0.95);
    lots.push({ x: b.cx, z: b.cz, w, d });
  } else if (r < 0.62) {
    const h = S / 2 - margin;
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const w = h * rngRange(rng, 0.76, 0.98);
        const d = h * rngRange(rng, 0.76, 0.98);
        lots.push({ x: b.cx + sx * (S / 4), z: b.cz + sz * (S / 4), w, d });
      }
    }
  } else if (r < 0.84) {
    const vertical = rng() < 0.5;
    for (const s of [-1, 1]) {
      const w = vertical ? S * rngRange(rng, 0.8, 0.95) : S / 2 - margin;
      const d = vertical ? S / 2 - margin : S * rngRange(rng, 0.8, 0.95);
      lots.push({
        x: b.cx + (vertical ? 0 : s * (S / 4)),
        z: b.cz + (vertical ? s * (S / 4) : 0),
        w, d,
      });
    }
  } else {
    const vertical = rng() < 0.5;
    for (let k = -1; k <= 1; k++) {
      const w = vertical ? S * rngRange(rng, 0.78, 0.94) : S / 3 - margin;
      const d = vertical ? S / 3 - margin : S * rngRange(rng, 0.78, 0.94);
      lots.push({
        x: b.cx + (vertical ? 0 : k * (S / 3)),
        z: b.cz + (vertical ? k * (S / 3) : 0),
        w, d,
      });
    }
  }
  return lots;
}
