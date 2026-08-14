/**
 * Mísseis de canhão dos helicópteros do MP — projéteis autoritativos.
 * O piloto dispara (E/clique) e o projétil voa reto da ponta do aparelho
 * até bater no mundo ou em alguém; aí explode em ÁREA (dano com queda pela
 * distância). O visual (foguete voando + explosão) é só do cliente, que
 * recebe MISSIL_FIRE (disparo) e MISSIL (explosão).
 */
import { MISSIL } from './config.js';

export function createMissis() {
  return [];
}

/** Integra os projéteis; chama onExplosao(m) quando um explode/expira. */
export function updateMissis(world, misseis, players, dt, onExplosao) {
  for (let i = misseis.length - 1; i >= 0; i--) {
    const m = misseis[i];
    m.t -= dt;
    // homing: curva em direção ao alvo travado na mira (teleguiado do solo)
    // [MISSIL RETO] voa na direcao do disparo ate bater (igual ao solo - sem homing)
    const dist = MISSIL.speed * dt;
    const sub = Math.max(1, Math.ceil(dist / 1.5));
    const sdt = dt / sub;
    let explodiu = false;
    for (let s = 0; s < sub && !explodiu; s++) {
      m.x += m.dx * MISSIL.speed * sdt;
      m.y += m.dy * MISSIL.speed * sdt;
      m.z += m.dz * MISSIL.speed * sdt;
      const g = world.col.groundHeightAt(m.x, m.z, m.y + 0.4);
      if (m.y <= g + 0.1) explodiu = true;
      else if (world.col.raycast(m.x - m.dx, m.y - m.dy, m.z - m.dz, m.dx, m.dy, m.dz, dist / sub + 0.6)) explodiu = true;
    }
    // colisão com jogadores (esfera ~2,0 m no peito)
    if (!explodiu) {
      for (const p of players) {
        if (!p.body || p.hp <= 0) continue;
        const dx = m.x - p.body.pos.x;
        const dy = m.y - (p.body.pos.y + 1);
        const dz = m.z - p.body.pos.z;
        if (dx * dx + dy * dy + dz * dz < 4.0) { explodiu = true; break; }
      }
    }
    if (explodiu || m.t <= 0) {
      if (onExplosao) onExplosao(m);
      misseis.splice(i, 1);
    }
  }
}
