/**
 * Mundo do servidor — monta a CollisionWorld completa (terreno + lago/ponte +
 * cidade) com a MESMA geometria do cliente. É a fonte da verdade para
 * posição, tiro, spawn e zona.
 */

import { CollisionWorld } from './collision.js';
import { terrainHeight, bridgeY, onBridge, LAKE, BRIDGE } from './terrain.js';
import { buildCity } from './city.js';
import { buildLandmarksCollision, buildBrazilLandmarksCollision } from './landmarksCollision.js';
import { buildPropsCollision } from './propsCollision.js';
import { CURB_H, HALF } from '../config.js';

export function buildWorld() {
  const col = new CollisionWorld();
  col.terrainFn = terrainHeight;

  // lago
  col.addWaterZone(LAKE.minX, LAKE.minZ, LAKE.maxX, LAKE.maxZ, LAKE.surfaceY);

  // ponte (tabuleiro caminhável + guarda-corpo)
  const B = BRIDGE;
  col.addPlatform(
    B.x - B.halfW, B.z0 - 2, B.x + B.halfW, B.z3 + 2,
    (x, z, refY) => {
      const y = bridgeY(z);
      if (refY != null && refY < y - 1.6) return null;
      return y;
    },
  );
  for (let z = B.z0; z < B.z3; z += 4) {
    const y = bridgeY(z);
    for (const s of [-1, 1]) {
      col.addBox(B.x + s * (B.halfW + 0.05), z + 2, 0.25, 2.1, y + 1.25, 'rail', y - 0.8);
    }
  }
  col.addPlatform(B.x - B.halfW, HALF - 4, B.x + B.halfW, B.z0 + 1, () => 0.06);
  col.addPlatform(B.x - B.halfW, B.z3 - 1, B.x + B.halfW, B.z3 + 46, () => 0.06);

  // cidade (prédios + calçadas) — mesma seed do cliente
  const blocks = buildCity(col);

  // marcos do mapa (Rio, IMG e Brasil)
  buildLandmarksCollision(col);
  // [MP] galpões IMG (Labs/Estúdio) do centro NÃO existem no multiplayer:
  // spawn não nasce dentro deles e não há parede invisível.
  buildBrazilLandmarksCollision(col);

  // postes e árvores (mesma seed 777 do cliente) — o jogador não atravessa no MP
  buildPropsCollision(col, blocks);

  return { col, blocks, terrainHeight };
}
