import * as THREE from '../../vendor/three.module.js';
import { mergeGeometries } from '../../vendor/jsm/utils/BufferGeometryUtils.js';
import { HALF, PLATOS } from '../config.js';
import { clamp, smoothstep, lerp, makeRng } from '../utils.js';
import { grassTexture, asphaltTexture, waterNormalTexture } from '../gfx/textures.js';

/** Região plana ocupada pela cidade (não recebe relevo). */
const CITY_R = 240;
const TERRAIN_SIZE = 2600;
const TERRAIN_SEG = 220;
/** Altura lógica do asfalto. A malha do terreno é desenhada 6 cm abaixo disso
 *  para não brigar em z-fighting com as ruas da cidade. */
const BASE_Y = 0;
const MESH_SINK = 0.06;
const APPROACH_Y = 0.06;            // rua de acesso à ponte, fora da grade

// ------------------------------------------------------------------ [52] lago
export const LAKE = {
  minX: -168, maxX: 104,
  minZ: 286, maxZ: 438,
  surfaceY: -1.0,
  depth: 7.0,
  fade: 30,
};

// ------------------------------------------------------------------ [52] ponte
export const BRIDGE = {
  x: -32,                 // alinhada com a rua de índice 3 -> dá pra atravessar de carro
  halfW: 7,
  deckY: 5.4,
  arch: 1.5,
  z0: 262, z1: 300, z2: 424, z3: 462,
};

/** Altura do tabuleiro da ponte em função de Z (rampas + arco central). */
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

/**
 * Quanto o ponto está "dentro" do lago (0 fora, 1 no meio).
 * A margem recebe uma ondulação senoidal para a borda não sair um retângulo
 * perfeito — visto de cima, um lago retangular entrega na hora que é gerado.
 * A mesma máscara define o rebaixamento do terreno e a opacidade da água,
 * então margem e lâmina d'água sempre coincidem.
 */
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

/**
 * Corredor plano que leva a cidade até a ponte — sem ele o relevo natural
 * atravessaria a rua de acesso.
 */
function corridorMask(x, z) {
  const fx = 1 - clamp((Math.abs(x - BRIDGE.x) - 12) / 14, 0, 1);
  const fz = 1 - clamp((z - (BRIDGE.z3 + 40)) / 30, 0, 1);
  const fz0 = clamp((z - (HALF - 30)) / 20, 0, 1);
  return smoothstep(Math.min(fx, fz, fz0));
}

/** Relevo antes de qualquer terraplenagem. */
function terrenoNatural(x, z) {
  const d = Math.max(Math.abs(x), Math.abs(z));
  const away = smoothstep(clamp((d - CITY_R) / 80, 0, 1));
  return BASE_Y + away * hills(x, z);
}

/** [57][58][59] Quanto o platô manda no ponto (1 dentro, 0 fora). */
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

/*
 * A cota de cada platô é a MÉDIA do relevo natural sob ele. Calculada uma vez
 * aqui, na carga do módulo: `terrainHeight` é chamada milhares de vezes por
 * quadro e não pode sair integrando terreno.
 */
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

/** Altura do terreno (fora da cidade), já com platôs, corredor e lago. */
export function terrainHeight(x, z) {
  let y = terrenoNatural(x, z);

  // [57][58][59] terraplenagem dos marcos
  for (const p of PLATOS) {
    const m = platoMask(p, x, z);
    if (m > 0) y = lerp(y, p.y, m);
  }

  const corr = corridorMask(x, z);
  if (corr > 0) y = lerp(y, APPROACH_Y, corr);

  // o lago sempre vence: é ele que passa por baixo da ponte
  const lm = lakeMask(x, z);
  if (lm > 0) y = lerp(y, LAKE.surfaceY - LAKE.depth, lm);
  return y;
}

export class Terrain {
  constructor(scene, collision, quality = 'alta') {   // [FPS] quality controla as laminas de agua
    this.scene = scene;
    this.col = collision;
    this.group = new THREE.Group();
    this.group.name = 'terrain';
    scene.add(this.group);
    this.waterMats = [];
  }

  build() {
    this._buildGround();
    this._buildLake();
    this._buildBridge();
    this._buildAccessRoad();
  }

  // ------------------------------------------------------------------ solo
  _buildGround() {
    const geo = new THREE.PlaneGeometry(TERRAIN_SIZE, TERRAIN_SIZE, TERRAIN_SEG, TERRAIN_SEG);
    geo.rotateX(-Math.PI / 2);

    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const grassC = new THREE.Color(0x93a86a);
    const sandC = new THREE.Color(0xc9b48a);
    const rockC = new THREE.Color(0x8a8378);

    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const y = terrainHeight(x, z);
      pos.setY(i, y - MESH_SINK);

      // tinta por vértice: areia na margem, rocha no alto, grama no resto
      const c = grassC.clone();
      const shore = 1 - clamp(Math.abs(y - LAKE.surfaceY) / 2.6, 0, 1);
      if (shore > 0) c.lerp(sandC, shore * 0.9);
      if (y > 6) c.lerp(rockC, clamp((y - 6) / 8, 0, 1) * 0.7);
      if (y < LAKE.surfaceY - 1.5) c.lerp(new THREE.Color(0x3c4a3a), 0.7);   // fundo do lago
      colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();

    // UV em metros para a grama não esticar
    const uv = geo.attributes.uv;
    for (let i = 0; i < uv.count; i++) {
      uv.setXY(i, uv.getX(i) * (TERRAIN_SIZE / 12), uv.getY(i) * (TERRAIN_SIZE / 12));
    }

    const mat = new THREE.MeshStandardMaterial({
      map: grassTexture(),
      vertexColors: true,
      roughness: 0.97,
      metalness: 0.0,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    mesh.name = 'ground';
    this.group.add(mesh);
    this.groundMesh = mesh;
  }

  // ------------------------------------------------------------------ [52] lago
  _buildLake() {
    const w = LAKE.maxX - LAKE.minX + 24;
    const d = LAKE.maxZ - LAKE.minZ + 24;
    const cx = (LAKE.minX + LAKE.maxX) / 2;
    const cz = (LAKE.minZ + LAKE.maxZ) / 2;

    // duas lâminas de água com normais rolando em sentidos opostos -> ondas cruzadas
    // [FPS] presets baixa/média usam só 1 lâmina (overdraw transparente é caro com bloom)
    const camadas = this.quality === 'alta' ? 2 : 1;
    for (let layer = 0; layer < camadas; layer++) {
      const geo = new THREE.PlaneGeometry(w, d, 40, 40);
      geo.rotateX(-Math.PI / 2);

      // Alfa por vértice vindo da MESMA máscara que escava o terreno: a
      // lâmina d'água some exatamente onde o fundo sobe acima do nível da água.
      const vp = geo.attributes.position;
      const rgba = new Float32Array(vp.count * 4);
      for (let i = 0; i < vp.count; i++) {
        const wx = vp.getX(i) + cx, wz = vp.getZ(i) + cz;
        rgba[i * 4] = 1; rgba[i * 4 + 1] = 1; rgba[i * 4 + 2] = 1;
        rgba[i * 4 + 3] = smoothstep(clamp(lakeMask(wx, wz) * 4.5, 0, 1));
      }
      geo.setAttribute('color', new THREE.BufferAttribute(rgba, 4));

      const nrm = waterNormalTexture().clone();
      nrm.needsUpdate = true;
      nrm.wrapS = nrm.wrapT = THREE.RepeatWrapping;
      nrm.repeat.set(w / 26, d / 26);

      const mat = new THREE.MeshStandardMaterial({
        color: layer === 0 ? 0x123f52 : 0x1b5a72,
        normalMap: nrm,
        normalScale: new THREE.Vector2(0.42, 0.42),
        roughness: 0.055,
        metalness: 0.62,
        transparent: true,
        vertexColors: true,               // usa o alfa da margem
        opacity: layer === 0 ? 0.92 : 0.42,
        envMapIntensity: 1.6,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(cx, LAKE.surfaceY + layer * 0.05, cz);
      mesh.receiveShadow = false;
      mesh.name = 'water-' + layer;
      this.group.add(mesh);
      this.waterMats.push({ mat, nrm, dir: layer === 0 ? 1 : -1 });
    }

    this.col.addWaterZone(LAKE.minX, LAKE.minZ, LAKE.maxX, LAKE.maxZ, LAKE.surfaceY);
  }

  // ------------------------------------------------------------------ [52] ponte
  _buildBridge() {
    const B = BRIDGE;
    const deckGeos = [];
    const railGeos = [];
    const pillarGeos = [];
    const SEG = 3.0;

    for (let z = B.z0; z < B.z3; z += SEG) {
      const zc = z + SEG / 2;
      const y0 = bridgeY(z), y1 = bridgeY(z + SEG);
      const yc = (y0 + y1) / 2;
      const slope = Math.atan2(y1 - y0, SEG);
      const len = SEG / Math.cos(slope);

      // tabuleiro
      const g = new THREE.BoxGeometry(B.halfW * 2, 0.55, len);
      g.rotateX(-slope);
      g.translate(B.x, yc - 0.27, zc);
      deckGeos.push(g);

      // guarda-corpo dos dois lados
      for (const s of [-1, 1]) {
        const r = new THREE.BoxGeometry(0.16, 0.14, len);
        r.rotateX(-slope);
        r.translate(B.x + s * (B.halfW - 0.18), yc + 1.12, zc);
        railGeos.push(r);
        const r2 = new THREE.BoxGeometry(0.16, 0.14, len);
        r2.rotateX(-slope);
        r2.translate(B.x + s * (B.halfW - 0.18), yc + 0.62, zc);
        railGeos.push(r2);
      }
    }

    // montantes do guarda-corpo
    for (let z = B.z0; z < B.z3; z += 3.0) {
      const y = bridgeY(z);
      for (const s of [-1, 1]) {
        const p = new THREE.BoxGeometry(0.16, 1.2, 0.16);
        p.translate(B.x + s * (B.halfW - 0.18), y + 0.6, z);
        railGeos.push(p);
      }
    }

    // pilares dentro da água
    for (let z = B.z1 + 14; z < B.z2; z += 34) {
      const top = bridgeY(z);
      const h = top - (LAKE.surfaceY - LAKE.depth);
      for (const s of [-1, 1]) {
        const p = new THREE.CylinderGeometry(1.05, 1.35, h, 12);
        p.translate(B.x + s * 3.6, top - h / 2, z);
        pillarGeos.push(p);
      }
      // travessa
      const beam = new THREE.BoxGeometry(11, 0.7, 1.4);
      beam.translate(B.x, top - 0.85, z);
      pillarGeos.push(beam);
    }

    const concrete = new THREE.MeshStandardMaterial({ color: 0xa9a49a, roughness: 0.9, metalness: 0.03 });
    const steel = new THREE.MeshStandardMaterial({ color: 0x4d5560, roughness: 0.42, metalness: 0.85 });

    const deck = new THREE.Mesh(mergeGeometries(deckGeos, false), concrete);
    deck.castShadow = true; deck.receiveShadow = true; deck.name = 'bridge-deck';
    this.group.add(deck);

    const rails = new THREE.Mesh(mergeGeometries(railGeos, false), steel);
    rails.castShadow = true; rails.receiveShadow = true; rails.name = 'bridge-rails';
    this.group.add(rails);

    const pillars = new THREE.Mesh(mergeGeometries(pillarGeos, false), concrete);
    pillars.castShadow = true; pillars.receiveShadow = true; pillars.name = 'bridge-pillars';
    this.group.add(pillars);

    /*
     * Superfície caminhável e guarda-corpo.
     *
     * Os dois precisam saber que existe ESPAÇO EMBAIXO da ponte:
     *
     *  - o piso só vale para quem está na cota do tabuleiro. Sem o teste de
     *    `refY`, quem passasse por baixo (a nado, de barco ou de helicóptero)
     *    recebia a altura do deck e era jogado para cima dele;
     *  - o guarda-corpo precisa de `bottom`. Sem ele o colisor é tratado como
     *    se descesse até o fundo do lago, e o vão da ponte virava uma parede.
     */
    this.col.addPlatform(
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
        this.col.addBox(B.x + s * (B.halfW + 0.05), z + 2, 0.25, 2.1, y + 1.25, 'rail', y - 0.8);
      }
    }
  }

  /** Prolonga a rua da cidade até a ponte, para chegar de carro. */
  _buildAccessRoad() {
    const B = BRIDGE;
    const geos = [];
    const seg = (z0, z1) => {
      const g = new THREE.PlaneGeometry(B.halfW * 2, z1 - z0);
      g.rotateX(-Math.PI / 2);
      const uv = g.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 1.8, uv.getY(i) * ((z1 - z0) / 8));
      g.translate(B.x, APPROACH_Y, (z0 + z1) / 2);
      geos.push(g);
    };
    seg(HALF - 4, B.z0 + 1);
    seg(B.z3 - 1, B.z3 + 46);

    const mat = new THREE.MeshStandardMaterial({
      map: asphaltTexture(), roughness: 0.94, metalness: 0.02,
    });
    const mesh = new THREE.Mesh(mergeGeometries(geos, false), mat);
    mesh.receiveShadow = true;
    mesh.name = 'bridge-approach';
    this.group.add(mesh);

    this.col.addPlatform(B.x - B.halfW, HALF - 4, B.x + B.halfW, B.z0 + 1, () => APPROACH_Y);
    this.col.addPlatform(B.x - B.halfW, B.z3 - 1, B.x + B.halfW, B.z3 + 46, () => APPROACH_Y);
  }

  update(dt) {
    // rolagem das normais = ondulação da água
    for (const w of this.waterMats) {
      w.nrm.offset.x += dt * 0.012 * w.dir;
      w.nrm.offset.y += dt * 0.020 * w.dir;
    }
  }
}

export { CITY_R };
