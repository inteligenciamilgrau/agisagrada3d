// src/util/aim.js
/**
 * [AIM ASSIST] magnetismo de mira — usado no solo (game.js) e no MP (match.js).
 *
 * Se um alvo (inimigo/bot/player) estiver dentro de um cone pequeno ao redor
 * da linha de tiro, devolve a direção para o CENTRO dele. O jogador não
 * precisa acertar o corpo na pixel: basta mirar perto — o tiro "gruda".
 * O cone (padrão ~6°) é pequeno: não rouba o tiro de quem mira errado longe,
 * só tira o peso de acertar um corpo fino em movimento.
 *
 * @param {number} ox,oy,oz  origem do tiro (câmera)
 * @param {number} dx,dy,dz  direção atual da mira (normalizada)
 * @param {Array<{x:number,y:number,z:number,vivo?:boolean}>} alvos
 * @param {number} alcance   distância máxima do alvo (metros)
 * @param {number} cone      raio angular em radianos (0.11 ≈ 6,3°)
 * @returns {{x:number,y:number,z:number}|null} direção assistida para o
 *          centro do alvo mais próximo angularmente, ou null se ninguém
 *          está dentro do cone.
 */
export function aimAssist(ox, oy, oz, dx, dy, dz, alvos, alcance = 140, cone = 0.11) {
  let melhor = null;
  let melhorAng = cone;
  for (const a of alvos) {
    if (!a || a.vivo === false) continue;
    const lx = a.x - ox, ly = a.y - oy, lz = a.z - oz;
    const dist = Math.hypot(lx, ly, lz);
    if (dist > alcance || dist < 0.01) continue;
    const dot = (lx * dx + ly * dy + lz * dz) / dist;
    const ang = Math.acos(Math.max(-1, Math.min(1, dot)));
    if (ang < melhorAng) {
      melhorAng = ang;
      melhor = { lx, ly, lz, dist };
    }
  }
  if (!melhor) return null;
  const d = 1 / melhor.dist;
  return { x: melhor.lx * d, y: melhor.ly * d, z: melhor.lz * d };
}
