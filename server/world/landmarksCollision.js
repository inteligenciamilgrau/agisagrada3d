/**
 * Colisão dos marcos do mundo no servidor (Rio, IMG e Brasil).
 * Garante que a CollisionWorld do servidor seja 100% idêntica à do cliente.
 */
import { CURB_H, BLOCK_INNER, CABLE, CELL } from '../config.js';
import { nodeCoord } from '../util.js';
import { terrainHeight } from './terrain.js';

export const CORCOVADO = { x: -640, z: -300, r: 190, h: 165 };
export const URCA = { x: 500, z: 250, r: 105, h: 78 };
export const PAO = { x: 700, z: 355, r: 130, h: 148 };

export const HERCILIO = {
  x: 62,
  z0: 244, z1: 302, z2: 422, z3: 480,
  deckY: 11.5,
  halfW: 5.2,
  towerH: 26,
};
export const MON = { x: -430, z: 128, rot: 0.42 };
export const PELOURINHO = { x: -110, z: -432, rot: -0.25 };

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function mountainSurfaceY(spec, roundness, x, z) {
  const r = Math.hypot(x - spec.x, z - spec.z);
  if (r >= spec.r) return spec.baseY;
  const p = 0.5 + roundness * 0.9;
  const t = 1 - Math.pow(r / spec.r, 1 / p);
  return spec.baseY + t * spec.h;
}

export function buildLandmarksCollision(col) {
  // ------------------------------------------------------------ Morros do Rio
  for (const s of [CORCOVADO, URCA, PAO]) {
    s.baseY = terrainHeight(s.x, s.z) - 6;
    s.topY = s.baseY + s.h;
  }

  // Corcovado, Urca, Pão de Açúcar rings
  const RINGS = 28;
  for (const [spec, roundness] of [[CORCOVADO, 0.55], [URCA, 0.85], [PAO, 0.95]]) {
    for (let i = 0; i < RINGS; i++) {
      const tTopo = (i + 1) / RINGS;
      const rr = spec.r * Math.pow(Math.max(0, 1 - tTopo), 0.5 + roundness * 0.9) * 0.85;
      col.addCircle(spec.x, spec.z, Math.max(1, rr), spec.baseY + spec.h * tTopo, 'mountain');
    }
  }

  // Mountain Floors
  for (const [spec, roundness] of [[URCA, 0.85], [PAO, 0.95]]) {
    col.addPlatform(
      spec.x - spec.r, spec.z - spec.r, spec.x + spec.r, spec.z + spec.r,
      (x, z, refY) => {
        const r = Math.hypot(x - spec.x, z - spec.z);
        if (r >= spec.r) return null;
        const y = Math.max(mountainSurfaceY(spec, roundness, x, z), terrainHeight(x, z));
        if (refY != null && refY < y - 2.5) return null;
        return y;
      },
    );
  }

  // ------------------------------------------------------------ Cristo Redentor
  const deckY = CORCOVADO.topY - 1;
  const DECK_WALK_R = 28;
  col.addCircle(CORCOVADO.x, CORCOVADO.z, 6, CORCOVADO.topY + 40, 'statue');
  col.addPlatform(
    CORCOVADO.x - DECK_WALK_R, CORCOVADO.z - DECK_WALK_R,
    CORCOVADO.x + DECK_WALK_R, CORCOVADO.z + DECK_WALK_R,
    (x, z, refY) => {
      if (Math.hypot(x - CORCOVADO.x, z - CORCOVADO.z) > DECK_WALK_R) return null;
      if (refY != null && Math.abs(refY - deckY) > 6) return null;
      return deckY;
    },
  );

  // Parapeito do Cristo
  const GRUPO_ROT = Math.PI * 0.15;
  const RAIL_R = 27 - 0.6;
  const M = 160;
  for (let i = 0; i < M; i++) {
    const a = (i / M) * Math.PI * 2;
    const w = a - GRUPO_ROT;
    col.addCircle(
      CORCOVADO.x + Math.cos(w) * RAIL_R,
      CORCOVADO.z + Math.sin(w) * RAIL_R,
      0.7, deckY + 1.2, 'rail', deckY - 0.6,
    );
  }

  // ------------------------------------------------------------ Bondinho
  const stations = [
    { x: 330, z: 165, y: terrainHeight(330, 165), ramp: true },
    { x: URCA.x, z: URCA.z, y: URCA.topY - 3 },
    { x: PAO.x, z: PAO.z, y: PAO.topY - 3 },
  ];
  for (let i = 0; i < stations.length; i++) {
    const a = stations[Math.max(0, i - 1)];
    const b = stations[Math.min(stations.length - 1, i + 1)];
    stations[i].bearing = Math.atan2(b.x - a.x, b.z - a.z);
    stations[i].deckY = stations[i].y + CABLE.rise;
    stations[i].cableY = stations[i].deckY + CABLE.cabinFloor;
  }

  const { halfX, halfZ, deckOver, rampLen, rampHalfW, rise } = CABLE;
  const hx = halfX + deckOver, hz = halfZ + deckOver;

  for (const st of stations) {
    col.addBox(st.x, st.z, hx, hz, st.deckY, 'station');
    col.addPlatform(st.x - hx, st.z - hz, st.x + hx, st.z + hz, () => st.deckY);
    for (const s of [-1, 1]) {
      col.addCircle(
        st.x + Math.cos(st.bearing) * s * 2.4, st.z - Math.sin(st.bearing) * s * 2.4,
        0.8, st.cableY, 'mast', st.deckY - 1,
      );
    }
    if (st.ramp) {
      const x1 = st.x - halfX - deckOver;
      const x0 = x1 - rampLen;
      const subida = rampLen - 3;
      const alturaEm = (x) => st.y + clamp((x - x0) / subida, 0, 1) * rise;

      col.addPlatform(x0, st.z - rampHalfW, x1, st.z + rampHalfW, (x, z, refY) => {
        const y = Math.max(alturaEm(x), terrainHeight(x, z));
        if (refY != null && refY < y - 1.3) return null;
        return y;
      });

      const TRECHO = 3;
      for (let x = x0 + 11; x < x1; x += TRECHO) {
        const xa = x, xb = Math.min(x1, x + TRECHO);
        const ya = alturaEm(xa), yb = alturaEm(xb);
        for (const s of [-1, 1]) {
          col.addBox(
            (xa + xb) / 2, st.z + s * rampHalfW,
            (xb - xa) / 2, 0.1,
            Math.max(ya, yb) + 1.05, 'rail', Math.min(ya, yb) - 0.7,
          );
        }
      }
    }
  }

  // ------------------------------------------------------------ Heliporto
  // espelho do cliente (landmarks.js _heliport): disco de 0,35 m sobre a
  // calçada, plataforma CIRCULAR — sem caixa sólida. A versão antiga usava
  // coordenadas erradas (256 no lugar de HALF) e uma caixa de 32×32 até
  // 18 m, um "prédio invisível" no cruzamento a sudoeste do heliporto que
  // bloqueava a rua e cortava o pulo.
  const cxHeli = nodeCoord(2) + CELL / 2;   // -64
  const czHeli = nodeCoord(4) + CELL / 2;   // 64
  const R = BLOCK_INNER / 2 - 2;            // 16
  const padY = CURB_H + 0.35;
  col.addPlatform(cxHeli - R, czHeli - R, cxHeli + R, czHeli + R,
    (px, pz) => (Math.hypot(px - cxHeli, pz - czHeli) <= R ? padY : null), true);
}

export function buildIMGBuildingsCollision(col) {
  const larg = BLOCK_INNER - 4; // 32
  const prof = BLOCK_INNER - 8; // 28
  const hl = larg / 2, hp = prof / 2; // 16, 14
  const E = 0.6;
  const PORTA_W = 7;
  const PISO = CURB_H;

  // Labs (3,3) -> cx = 0, cz = 0
  // Estudio (3,4) -> cx = 0, cz = 64
  // (centros dos blocos: nodeCoord + CELL/2 — o cliente os posiciona assim)
  for (const [cx, cz, alt] of [[0, 0, 9], [0, 64, 8]]) {
    const top = PISO + alt;
    const ladoW = (larg - PORTA_W) / 2;
    for (const s of [-1, 1]) {
      col.addBox(cx + s * (PORTA_W / 2 + ladoW / 2), cz + hp, ladoW / 2, E, top, 'img', PISO - 1);
    }
    col.addBox(cx, cz - hp, hl, E, top, 'img', PISO - 1);
    col.addBox(cx - hl, cz, E, hp, top, 'img', PISO - 1);
    col.addBox(cx + hl, cz, E, hp, top, 'img', PISO - 1);
    col.addPlatform(cx - hl, cz - hp, cx + hl, cz + hp, () => PISO);
  }
}

export function buildBrazilLandmarksCollision(col) {
  // Hercílio Luz Bridge
  const H = HERCILIO;
  col.addPlatform(
    H.x - H.halfW, H.z0, H.x + H.halfW, H.z3,
    (x, z, refY) => {
      if (refY != null && refY < H.deckY - 2.5) return null;
      return H.deckY;
    },
  );
  for (const s of [-1, 1]) {
    col.addBox(H.x + s * H.halfW, (H.z0 + H.z3) / 2, 0.2, (H.z3 - H.z0) / 2, H.deckY + 1.2, 'rail', H.deckY - 0.5);
  }

  // MON (Curitiba)
  col.addBox(MON.x, MON.z, 24, 18, 22, 'mon_building');
  col.addPlatform(MON.x - 30, MON.z - 25, MON.x + 30, MON.z + 25, () => 0.3);

  // Pelourinho (Salvador)
  col.addPlatform(
    PELOURINHO.x - 40, PELOURINHO.z - 40, PELOURINHO.x + 40, PELOURINHO.z + 40,
    (x, z) => terrainHeight(x, z) + 0.15,
  );
  // Sobrados ao redor da praça
  const p = PELOURINHO;
  for (const s of [-1, 1]) {
    col.addBox(p.x + s * 22, p.z, 6, 26, 12, 'pelourinho_sobrado');
    col.addBox(p.x, p.z + s * 22, 26, 6, 12, 'pelourinho_sobrado');
  }
}
