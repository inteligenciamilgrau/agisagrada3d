// src/net/predict.js
// Predição local (client-side prediction) do multiplayer.
//
// O corpo local anda NA HORA com o input — sem esperar o snapshot voltar do
// servidor (que causava ~100-170ms de atraso + micro-correções = o corpo
// "arrastava" e tremia). Esta função replica EXATAMENTE a física autoritativa
// do servidor (server/physics.js stepBody + groundY) com as constantes do MP
// (server/config.js PLAYER), para que a predição e o servidor concordem; o
// snapshot volta só para RECONCILIAR divergências reais (empurrão, colisão
// diferente, teleporte) — ver o branch local de RemotePlayer.update().

export const MP_PLAYER = {
  radius: 0.42,
  height: 1.78,
  walkSpeed: 12.8,
  runSpeed: 29.0,
  accel: 58,
  jumpSpeed: 10,
  gravity: 28,
};

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

// Mesmo piso do servidor: chão do mapa ou laje do prédio quando se chega por
// cima (groundY do server/physics.js).
function floorAt(col, x, z, refY) {
  let g = col.groundHeightAt(x, z, refY);
  const roof = col.roofHeightAt(x, z);
  if (roof > g && refY != null && refY >= roof - 0.35) g = roof;
  return g;
}

/**
 * Prediz um passo do corpo local (rp). Muta rp.x/y/z e o estado interno
 * _vx/_vz/_vy/_onGround.
 * @param {object} rp   RemotePlayer local
 * @param {object} inp  { moveX, moveZ, yaw, run, jump } — MESMOS valores do
 *                      T.INPUT enviado ao servidor (jump já é borda: true só
 *                      no frame do clique)
 * @param {number} dt   delta do frame (segundos)
 * @param {object} col  colisão do mundo do cliente (game.col)
 */
export function predictBody(rp, inp, dt, col) {
  const P = MP_PLAYER;
  const cy = inp.yaw;
  const sinY = Math.sin(cy), cosY = Math.cos(cy);
  const wishX = (inp.moveZ * -sinY) + (inp.moveX * cosY);
  const wishZ = (inp.moveZ * -cosY) - (inp.moveX * sinY);
  const len = Math.hypot(wishX, wishZ);
  const maxSpeed = inp.run ? P.runSpeed : P.walkSpeed;
  let wx = 0, wz = 0;
  if (len > 0.001) {
    wx = (wishX / len) * maxSpeed;
    wz = (wishZ / len) * maxSpeed;
  }

  rp._vx = rp._vx || 0;
  rp._vz = rp._vz || 0;
  rp._vy = rp._vy || 0;
  rp._vx += clamp(wx - rp._vx, -P.accel * dt, P.accel * dt);
  rp._vz += clamp(wz - rp._vz, -P.accel * dt, P.accel * dt);

  if (inp.jump && rp._onGround) {
    rp._vy = P.jumpSpeed;
    rp._onGround = false;
  }
  rp._vy -= P.gravity * dt;

  // Sub-passos (não atravessa poste fino) — igual ao servidor.
  const dist = Math.hypot(rp._vx, rp._vy, rp._vz) * dt;
  const sub = Math.max(1, Math.ceil(dist / 0.3));
  const sdt = dt / sub;
  for (let i = 0; i < sub; i++) {
    rp.x += rp._vx * sdt;
    rp.z += rp._vz * sdt;
    rp.y += rp._vy * sdt;

    const g = floorAt(col, rp.x, rp.z, rp.y + 0.3);
    if (rp.y <= g) {
      rp.y = g;
      rp._vy = 0;
      rp._onGround = true;
    } else {
      rp._onGround = false;
    }

    if (col.resolveCircle) col.resolveCircle(rp, P.radius, P.height);
  }
}
