/**
 * Helicópteros do multiplayer — entidades autoritativas do servidor.
 *
 * São 5 aparelhos espalhados pelo mapa (heliporto, Corcovado, Pelourinho,
 * Urca e ponte Hercílio Luz). A física é um espelho simplificado do
 * Helicopter do cliente (src/ent/helicopter.js), mas o rumo (yaw) vem só
 * dos controles manuais Q/R — no MP não há câmera interna, então nada de
 * desiredYaw. O cliente não integra nada: recebe a pose no snapshot e só
 * anima o rotor.
 */

import { HELI, WORLD_LIMIT } from './config.js';
import { groundY } from './physics.js';
import { angleDelta, clamp } from './util.js';

let heliUid = 1;

/** Posições dos 5 helicópteros (validadas contra o terreno/colisão). */
export const HELI_COLORS = [0x1f4f8f, 0xb3302f, 0x2e7d32, 0xe8b800, 0x7a5cc7];


// Cor de identificacao — cada heli do mapa tem uma cor distinta.
export const HELI_SPOTS = [
  { x: -64, z: 64 },        // heliporto central (dentro da cidade)
  { x: -160, z: 160 },      // noroeste — cruzamento de ruas largas
  { x: 160, z: 160 },       // nordeste
  { x: -160, z: -160 },     // sudoeste
  { x: 160, z: -160 },      // sudeste
];

export function createHelis(world, count = HELI_SPOTS.length) {
  const helis = [];
  for (let i = 0; i < count; i++) {
    const sp = HELI_SPOTS[i % HELI_SPOTS.length];
    let x = sp.x, z = sp.z;
    // segurança: se o ponto ficou bloqueado, procura um vizinho livre
    if (world.col.isBlocked(x, z, 2.2)) {
      for (const [dx, dz] of [[8, 0], [-8, 0], [0, 8], [0, -8], [12, 12], [-12, -12], [12, -12], [-12, 12]]) {
        if (!world.col.isBlocked(x + dx, z + dz, 2.2)) { x += dx; z += dz; break; }
      }
    }
    const y = groundY(world, x, z, 0) + HELI.landHeight;
    helis.push({
      id: heliUid++,
      cor: HELI_COLORS[i % HELI_COLORS.length],
      x, y, z,
      yaw: 0,
      vel: { x: 0, y: 0, z: 0 },
      pitch: 0, roll: 0,
      playerId: null,
      inp: null,
      fuel: HELI.fuelMax,
      idleT: 0,
      autoDesce: 0,
    });
  }
  return helis;
}

/**
 * Integra a física dos helicópteros a 30 Hz (mesmo tick dos corpos).
 * Com piloto: movimentos iguais aos do solo (frente/atrás, lateral, subir/
 * descer, Q/R para girar). Sem piloto: pousa suavemente se foi deixado no ar.
 */
export function updateHelis(world, helis, dt) {
  for (const h of helis) {
    if (h.playerId == null) {
      // sem piloto: se ficou no ar (ex.: piloto morreu), desce até pousar
      const surf = groundY(world, h.x, h.z, h.y);
      const minY = surf + HELI.landHeight;
      if (h.y > minY) {
        h.vel.y = Math.max(h.vel.y - 8 * dt, -8);   // descida suave (autorrotação)
        h.y += h.vel.y * dt;
        if (h.y <= minY) { h.y = minY; h.vel.y = 0; }
      } else {
        h.vel.y = 0;
      }
      h.vel.x = 0; h.vel.z = 0;
      h.pitch = 0; h.roll = 0;
      continue;
    }

    const inp = h.inp || { forward: 0, strafe: 0, up: 0, down: 0, yawLeft: 0, yawRight: 0 };

    // ---- gasolina: voando consome, pousado reabastece
    const surfIdle = groundY(world, h.x, h.z, h.y);
    const minYIdle = surfIdle + HELI.landHeight;
    const pousado = h.y <= minYIdle + HELI.fuelMinY;
    if (pousado) h.fuel = Math.min(HELI.fuelMax, h.fuel + HELI.fuelRefill * dt);
    else h.fuel = Math.max(0, h.fuel - HELI.fuelConsume * dt);
    const semFuel = h.fuel <= 0;

    // ---- tempo parado no ar (piloto sem interagir) — anti-"escondido no céu"
    let girando = false;
    if (inp.desiredYaw != null) girando = Math.abs(angleDelta(h.yaw, inp.desiredYaw)) > 0.05;
    const interagiu = inp.forward || inp.strafe || inp.up || inp.down || inp.yawLeft || inp.yawRight || girando;
    if (interagiu) { h.idleT = 0; h.autoDesce = 0; }
    else if (!pousado) h.idleT += dt;
    const descendoForcado = h.idleT > HELI.idleMax;

    if (semFuel || descendoForcado) {
      // sem gasolina: autorrotação (desce suave). Parado no ar: desce de
      // ~25 em 25 m (2 s caindo a -12 m/s + 2 s estabilizado) até o chão
      if (semFuel) {
        h.rotor = Math.max(0, h.rotor - 1.6 * dt);
        h.vel.y = Math.max(Math.min(h.vel.y, 0) - 10 * dt, -8);   // perde a subida na hora e cai
      } else {
        h.autoDesce += dt;
        const descendo = (h.autoDesce % HELI.idleCiclo) < HELI.idleCiclo / 2;
        h.vel.y = descendo ? -HELI.idleDesc : 0;
      }
      h.y += h.vel.y * dt;
      h.vel.x = 0; h.vel.z = 0;
      h.pitch = 0; h.roll = 0;
      if (h.y < minYIdle) { h.y = minYIdle; h.vel.y = 0; h.autoDesce = 0; h.idleT = 0; }
      const posQ = { x: h.x, y: h.y, z: h.z };
      if (world.col.resolveCircle(posQ, 2.0)) { h.x = posQ.x; h.z = posQ.z; }
      continue;
    }

    // guinada manual (Q/R) — mesmo yawRate do solo
    h.yaw += (inp.yawLeft - inp.yawRight) * HELI.yawRate * dt;

    // nariz segue a câmera do piloto (igual ao solo com câmera externa)
    if (inp.desiredYaw != null) {
      const d = angleDelta(h.yaw, inp.desiredYaw);
      h.yaw += clamp(d * 2.0, -HELI.yawRate, HELI.yawRate) * dt;
    }

    // inclinação visual (mesmo amortecimento do cliente, simplificado)
    h.pitch = dampN(h.pitch, clamp(inp.forward * 0.42, -0.42, 0.42), 4.5, dt);
    h.roll = dampN(h.roll, clamp(inp.strafe * 0.40, -0.40, 0.40), 4.5, dt);

    // frente e direita do aparelho (nariz +Z — convenção do modelo)
    const fx = Math.sin(h.yaw), fz = Math.cos(h.yaw);
    const rx = -Math.cos(h.yaw), rz = Math.sin(h.yaw);

    h.vel.x += (fx * inp.forward + rx * inp.strafe) * HELI.tiltAccel * dt;
    h.vel.z += (fz * inp.forward + rz * inp.strafe) * HELI.tiltAccel * dt;

    // vertical (espaço = subir, shift = descer; sem comando, plana)
    h.vel.y += (inp.up - inp.down) * HELI.liftAccel * dt;
    if (inp.up === 0 && inp.down === 0) h.vel.y = dampN(h.vel.y, 0, 2.2, dt);

    // arrasto e limites
    const drag = Math.exp(-HELI.drag * dt);
    h.vel.x *= drag; h.vel.z *= drag;
    h.vel.y = clamp(h.vel.y, -HELI.maxLift, HELI.maxLift);
    const hs = Math.hypot(h.vel.x, h.vel.z);
    const velMax = HELI.maxSpeed * (h.velMult ?? 1);   // [BOT-VEICULO] heli de bot voa na metade
    if (hs > velMax) { h.vel.x *= velMax / hs; h.vel.z *= velMax / hs; }

    // integração
    const yAntes = h.y;
    h.x += h.vel.x * dt;
    h.y += h.vel.y * dt;
    h.z += h.vel.z * dt;

    // não desce abaixo da superfície (sem "afundar" ao pousar em descida)
    const surf = groundY(world, h.x, h.z, h.y);
    const minY = surf + HELI.landHeight;
    if (h.y < minY && yAntes >= minY - 0.02) {
      h.y = minY;
      if (h.vel.y < 0) h.vel.y = 0;
    }

    // não atravessa prédios/marcos (empurra para fora, igual ao cliente)
    const before = { x: h.x, z: h.z };
    const pos = { x: h.x, y: h.y, z: h.z };
    if (world.col.resolveCircle(pos, 2.0)) {
      h.x = pos.x; h.z = pos.z;
      h.vel.x = (h.x - before.x) * 6;
      h.vel.z = (h.z - before.z) * 6;
    }

    // teto de voo e limites do mundo
    if (h.y > HELI.maxAlt) { h.y = HELI.maxAlt; h.vel.y = Math.min(0, h.vel.y); }
    h.x = clamp(h.x, -WORLD_LIMIT, WORLD_LIMIT);
    h.z = clamp(h.z, -WORLD_LIMIT, WORLD_LIMIT);
  }
}

/** Amortecimento exponencial (mesma fórmula do damp do cliente). */
function dampN(a, b, lambda, dt) {
  return a + (b - a) * (1 - Math.exp(-lambda * dt));
}
