/* eslint-disable no-unused-vars */

/**
 * [31] Sistema de colisão: prédios, postes, árvores e mureta do lago bloqueiam
 * o jogador, os NPCs e os veículos.
 * [45] Também responde "esse ponto está livre?" para não nascer ninguém dentro de prédio.
 * [46] Guarda a altura do topo de cada caixa para o helicóptero pousar em lajes.
 */

const CELL_SIZE = 20;
/** Altura típica de uma entidade, usada para saber se um colisor passa por cima dela. */
const ENTITY_H = 2.2;

export class CollisionWorld {
  constructor() {
    this.boxes = [];       // {minX,minZ,maxX,maxZ,top,tag}
    this.circles = [];     // {x,z,r,top,tag}
    this.platforms = [];   // superfícies caminháveis (ponte, lajes) {minX,..,y|yFn}
    this.grid = new Map();
    this.waterZones = [];  // [52] regiões de lago
    this.terrainFn = null; // altura do terreno natural fora da cidade
  }

  // ------------------------------------------------------------------ inserção
  _key(cx, cz) { return cx + ',' + cz; }

  _insert(entry, minX, minZ, maxX, maxZ) {
    const x0 = Math.floor(minX / CELL_SIZE), x1 = Math.floor(maxX / CELL_SIZE);
    const z0 = Math.floor(minZ / CELL_SIZE), z1 = Math.floor(maxZ / CELL_SIZE);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cz = z0; cz <= z1; cz++) {
        const k = this._key(cx, cz);
        let arr = this.grid.get(k);
        if (!arr) { arr = []; this.grid.set(k, arr); }
        arr.push(entry);
      }
    }
  }

  /**
   * Caixa sólida centrada em (cx,cz) com meias-extensões (hx,hz).
   * `bottom` só importa em cenário empilhado (a estrada em espiral do
   * Corcovado): sem ele, o guarda-corpo de uma volta lá em cima bloquearia
   * quem está passando na volta de baixo, porque o colisor seria tratado
   * como se descesse até o chão.
   */
  addBox(cx, cz, hx, hz, top = 999, tag = 'solid', bottom = -1e6) {
    const b = {
      kind: 'box', minX: cx - hx, maxX: cx + hx, minZ: cz - hz, maxZ: cz + hz,
      top, bottom, tag,
    };
    this.boxes.push(b);
    this._insert(b, b.minX, b.minZ, b.maxX, b.maxZ);
    return b;
  }

  /** Cilindro sólido (postes, troncos, semáforos). */
  addCircle(x, z, r, top = 999, tag = 'solid', bottom = -1e6) {
    const c = { kind: 'circle', x, z, r, top, bottom, tag };
    this.circles.push(c);
    this._insert(c, x - r, z - r, x + r, z + r);
    return c;
  }

  /**
   * Superfície caminhável elevada (deck da ponte, laje, heliponto).
   *
   * `groundHeightAt` devolve a PRIMEIRA plataforma que responde, então a ordem
   * de cadastro é a ordem de prioridade. `porCima` põe a nova na frente da
   * fila: é o que faz o disco do heliponto valer mais que a calçada do
   * quarteirão em que ele foi desenhado — a calçada é cadastrada bem antes,
   * quando a cidade é gerada, e sem isso ela venceria sempre.
   */
  addPlatform(minX, minZ, maxX, maxZ, yFn, porCima = false) {
    const p = { minX, minZ, maxX, maxZ, yFn };
    if (porCima) this.platforms.unshift(p);
    else this.platforms.push(p);
    return p;   // devolve a entrada (para remoção/restauração no MP)
  }

  // remove uma caixa de colisão (usado p/ tirar as paredes dos galpões IMG no MP)
  removeBox(b) {
    const k = this.boxes.indexOf(b);
    if (k >= 0) this.boxes.splice(k, 1);
    for (const arr of this.grid.values()) {
      const j = arr.indexOf(b);
      if (j >= 0) arr.splice(j, 1);
    }
  }

  // religa uma caixa removida por removeBox (volta ao grid na posição original)
  restoreBox(b) {
    this.boxes.push(b);
    this._insert(b, b.minX, b.minZ, b.maxX, b.maxZ);
  }

  addWaterZone(minX, minZ, maxX, maxZ, surfaceY) {
    this.waterZones.push({ minX, minZ, maxX, maxZ, surfaceY });
  }

  // ------------------------------------------------------------------ consultas
  /** Todos os sólidos que podem tocar um círculo em (x,z). */
  near(x, z, r) {
    const out = [];
    const x0 = Math.floor((x - r) / CELL_SIZE), x1 = Math.floor((x + r) / CELL_SIZE);
    const z0 = Math.floor((z - r) / CELL_SIZE), z1 = Math.floor((z + r) / CELL_SIZE);
    const seen = new Set();
    for (let cx = x0; cx <= x1; cx++) {
      for (let cz = z0; cz <= z1; cz++) {
        const arr = this.grid.get(this._key(cx, cz));
        if (!arr) continue;
        for (const e of arr) {
          if (seen.has(e)) continue;
          seen.add(e);
          out.push(e);
        }
      }
    }
    return out;
  }

  /**
   * [45] Ponto livre para nascer? Considera altura: um ponto no chão dentro
   * da projeção de um prédio está bloqueado.
   */
  isBlocked(x, z, r = 0.5, y = 0.5, height = ENTITY_H) {
    for (const e of this.near(x, z, r)) {
      if (e.top <= y + 0.05) continue;
      if (e.bottom >= y + height) continue;      // colisor está acima da cabeça
      if (e.kind === 'box') {
        const cx = Math.max(e.minX, Math.min(x, e.maxX));
        const cz = Math.max(e.minZ, Math.min(z, e.maxZ));
        const dx = x - cx, dz = z - cz;
        if (dx * dx + dz * dz < r * r) return true;
      } else {
        const dx = x - e.x, dz = z - e.z;
        const rr = e.r + r;
        if (dx * dx + dz * dz < rr * rr) return true;
      }
    }
    return false;
  }

  /**
   * Empurra um círculo para fora dos sólidos. `pos` é mutado.
   * Sólidos com topo abaixo de `pos.y` são ignorados (você está em cima deles).
   * Retorna true se houve colisão.
   */
  resolveCircle(pos, r, height = ENTITY_H) {
    let hit = false;
    const list = this.near(pos.x, pos.z, r + 0.5);
    // duas passadas resolvem bem cantos entre dois sólidos
    for (let pass = 0; pass < 2; pass++) {
      for (const e of list) {
        if (e.top <= pos.y + 0.06) continue;
        if (e.bottom >= pos.y + height) continue;   // passa por baixo dele

        if (e.kind === 'box') {
          const cx = Math.max(e.minX, Math.min(pos.x, e.maxX));
          const cz = Math.max(e.minZ, Math.min(pos.z, e.maxZ));
          let dx = pos.x - cx, dz = pos.z - cz;
          let d2 = dx * dx + dz * dz;

          if (d2 > r * r) continue;

          if (d2 > 1e-8) {
            const d = Math.sqrt(d2);
            const push = r - d;
            pos.x += (dx / d) * push;
            pos.z += (dz / d) * push;
          } else {
            // centro dentro da caixa: sai pelo lado mais próximo
            const toL = pos.x - e.minX, toR = e.maxX - pos.x;
            const toB = pos.z - e.minZ, toT = e.maxZ - pos.z;
            const m = Math.min(toL, toR, toB, toT);
            if (m === toL) pos.x = e.minX - r;
            else if (m === toR) pos.x = e.maxX + r;
            else if (m === toB) pos.z = e.minZ - r;
            else pos.z = e.maxZ + r;
          }
          hit = true;
        } else {
          let dx = pos.x - e.x, dz = pos.z - e.z;
          const rr = e.r + r;
          let d2 = dx * dx + dz * dz;
          if (d2 > rr * rr) continue;
          const d = Math.sqrt(d2) || 1e-4;
          if (d2 < 1e-8) { dx = 1; dz = 0; }
          const push = rr - d;
          pos.x += (dx / d) * push;
          pos.z += (dz / d) * push;
          hit = true;
        }
      }
      if (!hit) break;
    }
    return hit;
  }

  /** [46] Altura do telhado sob (x,z) — 0 se não houver prédio. */
  roofHeightAt(x, z) {
    let best = 0;
    for (const e of this.near(x, z, 0.1)) {
      if (e.tag !== 'building' && e.tag !== 'helipad' && e.tag !== 'img') continue;
      if (e.kind === 'box') {
        if (x >= e.minX && x <= e.maxX && z >= e.minZ && z <= e.maxZ && e.top > best) best = e.top;
      }
    }
    return best;
  }

  /**
   * Superfície caminhável, na ordem: plataformas (calçada, deck da ponte),
   * lago e, por último, o asfalto/terreno natural.
   *
   * `refY` é a altura atual de quem pergunta. Serve para plataformas que se
   * empilham no mesmo (x,z) — caso da estrada em espiral do Corcovado, onde
   * duas voltas passam uma por cima da outra e é preciso saber em qual delas
   * a entidade está.
   */
  groundHeightAt(x, z, refY = null) {
    for (const p of this.platforms) {
      if (x >= p.minX && x <= p.maxX && z >= p.minZ && z <= p.maxZ) {
        const y = p.yFn(x, z, refY);
        if (y !== null && y !== undefined) return y;
      }
    }
    for (const w of this.waterZones) {
      if (x >= w.minX && x <= w.maxX && z >= w.minZ && z <= w.maxZ) {
        return w.surfaceY - 0.85;      // o jogador entra na água até a cintura
      }
    }
    return this.terrainFn ? this.terrainFn(x, z) : 0;
  }

  isInWater(x, z) {
    for (const w of this.waterZones) {
      if (x >= w.minX && x <= w.maxX && z >= w.minZ && z <= w.maxZ) {
        for (const p of this.platforms) {
          if (x >= p.minX && x <= p.maxX && z >= p.minZ && z <= p.maxZ) return false;
        }
        return true;
      }
    }
    return false;
  }

  /**
   * Raycast horizontal-agnóstico contra as caixas (usado pelos projéteis).
   * Retorna {t, nx, nz, ny, entry} ou null. Só testa sólidos, o chão é tratado à parte.
   */
  raycast(ox, oy, oz, dx, dy, dz, maxT) {
    let best = null;
    const steps = Math.ceil(maxT / CELL_SIZE) + 1;
    const seen = new Set();
    for (let s = 0; s <= steps; s++) {
      const t = (s / steps) * maxT;
      const px = ox + dx * t, pz = oz + dz * t;
      for (const e of this.near(px, pz, CELL_SIZE)) {
        if (seen.has(e)) continue;
        seen.add(e);
        const h = e.kind === 'box'
          ? rayBox(ox, oy, oz, dx, dy, dz, e, maxT)
          : rayCylinder(ox, oy, oz, dx, dy, dz, e, maxT);
        if (h && (!best || h.t < best.t)) best = h;
      }
    }
    return best;
  }
}

// ------------------------------------------------------------------ raycasts
function rayBox(ox, oy, oz, dx, dy, dz, b, maxT) {
  const inv = (v) => (Math.abs(v) < 1e-8 ? 1e8 : 1 / v);
  const ix = inv(dx), iy = inv(dy), iz = inv(dz);

  let t1 = (b.minX - ox) * ix, t2 = (b.maxX - ox) * ix;
  let tmin = Math.min(t1, t2), tmax = Math.max(t1, t2);
  let axis = 0, sign = t1 > t2 ? 1 : -1;

  t1 = (0 - oy) * iy; t2 = (b.top - oy) * iy;
  let ymin = Math.min(t1, t2), ymax = Math.max(t1, t2);
  if (ymin > tmin) { tmin = ymin; axis = 1; sign = t1 > t2 ? 1 : -1; }
  tmax = Math.min(tmax, ymax);

  t1 = (b.minZ - oz) * iz; t2 = (b.maxZ - oz) * iz;
  let zmin = Math.min(t1, t2), zmax = Math.max(t1, t2);
  if (zmin > tmin) { tmin = zmin; axis = 2; sign = t1 > t2 ? 1 : -1; }
  tmax = Math.min(tmax, zmax);

  if (tmax < tmin || tmax < 0 || tmin > maxT || tmin < 0) return null;

  const n = [0, 0, 0];
  n[axis] = sign;
  return { t: tmin, nx: n[0], ny: n[1], nz: n[2], entry: b };
}

function rayCylinder(ox, oy, oz, dx, dy, dz, c, maxT) {
  const rx = ox - c.x, rz = oz - c.z;
  const a = dx * dx + dz * dz;
  if (a < 1e-8) return null;
  const b = 2 * (rx * dx + rz * dz);
  const cc = rx * rx + rz * rz - c.r * c.r;
  const disc = b * b - 4 * a * cc;
  if (disc < 0) return null;
  const t = (-b - Math.sqrt(disc)) / (2 * a);
  if (t < 0 || t > maxT) return null;
  const y = oy + dy * t;
  if (y < 0 || y > c.top) return null;
  const hx = ox + dx * t - c.x, hz = oz + dz * t - c.z;
  const len = Math.hypot(hx, hz) || 1;
  return { t, nx: hx / len, ny: 0, nz: hz / len, entry: c };
}
