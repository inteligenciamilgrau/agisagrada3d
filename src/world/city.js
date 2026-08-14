import * as THREE from '../../vendor/three.module.js';
import { mergeGeometries } from '../../vendor/jsm/utils/BufferGeometryUtils.js';
import {
  GRID, CELL, HALF, ROAD_W, ROAD_H, CURB, CURB_H, BLOCK_INNER, PALETTE,
  LANE, WALK_OFF, STOP_LINE, NIGHT,
} from '../config.js';
import { nodeCoord, makeRng, rngRange, rngInt, rngPick } from '../utils.js';
import {
  asphaltTexture, asphaltRoughness, sidewalkTexture, facadeTextures,
  FACADE_CELL_W, FACADE_CELL_H, helipadTexture,
} from '../gfx/textures.js';

const FACADE_VARIANTS = 6;

/** Plano deitado no chão (XZ) com UV escalado em metros. */
function groundQuad(w, d, uvScale = 1) {
  const g = new THREE.PlaneGeometry(w, d);
  g.rotateX(-Math.PI / 2);
  if (uvScale !== 1) {
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) {
      uv.setXY(i, uv.getX(i) * (w / uvScale), uv.getY(i) * (d / uvScale));
    }
  }
  return g;
}

/**
 * [1] Cidade 3D procedural: malha de ruas, quarteirões, calçadas e prédios.
 */
export class City {
  constructor(scene, collision, seed = 20260725) {
    this.scene = scene;
    this.col = collision;
    this.rng = makeRng(seed);

    this.blocks = [];           // metadados dos quarteirões
    this.buildings = [];        // {x,z,w,d,h} para minimapa e lógica
    this.facadeMaterials = [];  // para acender as janelas à noite
    this.parkBlocks = [];
    this.rooftopPads = [];      // [46] helipontos em lajes

    this.group = new THREE.Group();
    this.group.name = 'city';
    scene.add(this.group);
  }

  build() {
    this._layout();
    this._buildRoads();
    this._buildSidewalks();
    this._buildMarkings();
    this._buildBuildings();
  }

  // ------------------------------------------------------------------ layout
  _layout() {
    const rng = this.rng;
    for (let i = 0; i < GRID - 1; i++) {
      for (let j = 0; j < GRID - 1; j++) {
        const cx = nodeCoord(i) + CELL / 2;
        const cz = nodeCoord(j) + CELL / 2;
        // distância normalizada ao centro -> centro da cidade tem prédios altos
        const d = Math.max(Math.abs(cx), Math.abs(cz)) / HALF;
        let type = 'urban';
        if (rng() < 0.11) type = 'park';                    // [16] praças com plantas
        const block = { i, j, cx, cz, type, density: 1 - d };
        this.blocks.push(block);
        if (type === 'park') this.parkBlocks.push(block);
      }
    }

    // [43] reserva um quarteirão para o heliporto ANTES de plantar árvores,
    // senão a praça nasceria com vegetação em cima da pista de pouso
    const helipadBlock = this.blockAt(2, 4) || this.blocks[0];
    helipadBlock.type = 'heliport';
    const k = this.parkBlocks.indexOf(helipadBlock);
    if (k >= 0) this.parkBlocks.splice(k, 1);
    this.heliportBlock = helipadBlock;

    /*
     * Reserva os quarteirões do Labs IMG e do Estúdio IMG, pelo mesmo
     * caminho do heliporto: marcados ANTES da geração dos prédios, para
     * nascerem vazios e receberem o galpão da comunidade.
     *
     * Isto conserta um erro de coordenada: os portais das duas fases
     * estavam em (0,0) e (0,64), que parecem esquinas mas são o CENTRO
     * de um quarteirão — os cruzamentos ficam em múltiplos de 64 a
     * partir de -224. O portal nascia dentro de um prédio genérico, sem
     * porta por onde entrar.
     */
    const reservar = (i, j, tipo) => {
      const b = this.blockAt(i, j);
      if (!b) return null;
      b.type = tipo;
      const k = this.parkBlocks.indexOf(b);
      if (k >= 0) this.parkBlocks.splice(k, 1);
      return b;
    };
    this.labsBlock = reservar(3, 3, 'labs');       // centro do mapa: (0, 0)
    this.studioBlock = reservar(3, 4, 'studio');   // ao lado:        (0, 64)
  }

  blockAt(i, j) {
    return this.blocks.find((b) => b.i === i && b.j === j);
  }

  // ------------------------------------------------------------------ ruas
  _buildRoads() {
    const geos = [];

    // trechos entre cruzamentos
    for (let j = 0; j < GRID; j++) {
      const z = nodeCoord(j);
      for (let i = 0; i < GRID - 1; i++) {
        const x0 = nodeCoord(i) + ROAD_H, x1 = nodeCoord(i + 1) - ROAD_H;
        const g = groundQuad(x1 - x0, ROAD_W, 8);
        g.translate((x0 + x1) / 2, 0, z);
        geos.push(g);
      }
    }
    for (let i = 0; i < GRID; i++) {
      const x = nodeCoord(i);
      for (let j = 0; j < GRID - 1; j++) {
        const z0 = nodeCoord(j) + ROAD_H, z1 = nodeCoord(j + 1) - ROAD_H;
        const g = groundQuad(ROAD_W, z1 - z0, 8);
        g.translate(x, 0, (z0 + z1) / 2);
        geos.push(g);
      }
    }
    // quadrados dos cruzamentos
    for (let i = 0; i < GRID; i++) {
      for (let j = 0; j < GRID; j++) {
        const g = groundQuad(ROAD_W, ROAD_W, 8);
        g.translate(nodeCoord(i), 0, nodeCoord(j));
        geos.push(g);
      }
    }

    const mat = new THREE.MeshStandardMaterial({
      map: asphaltTexture(),
      roughnessMap: asphaltRoughness(),
      roughness: 0.94,
      metalness: 0.02,
      color: 0xffffff,
    });
    mat.map.repeat.set(1, 1);

    const mesh = new THREE.Mesh(mergeGeometries(geos, false), mat);
    mesh.receiveShadow = true;
    mesh.name = 'roads';
    this.group.add(mesh);
    this.roadMaterial = mat;
  }

  // ------------------------------------------------------------------ [16] calçadas
  _buildSidewalks() {
    const geos = [];
    const size = CELL - ROAD_W;      // 46

    for (const b of this.blocks) {
      // laje da calçada com o meio-fio (caixa baixa = borda visível + sombra de contato)
      const g = new THREE.BoxGeometry(size, CURB_H, size);
      g.translate(b.cx, CURB_H / 2, b.cz);
      // UV das laterais fica esticado, mas elas são finas — o topo é o que importa
      geos.push(g);

      // colisão do meio-fio é dispensável (degrau baixo), mas o quarteirão
      // inteiro serve de plataforma caminhável
      this.col.addPlatform(
        b.cx - size / 2, b.cz - size / 2, b.cx + size / 2, b.cz + size / 2,
        () => CURB_H,
      );
    }

    const mat = new THREE.MeshStandardMaterial({
      map: sidewalkTexture(),
      roughness: 0.88,
      metalness: 0.0,
    });
    mat.map.repeat.set(size / 6, size / 6);

    const mesh = new THREE.Mesh(mergeGeometries(geos, false), mat);
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    mesh.name = 'sidewalks';
    this.group.add(mesh);
  }

  // ------------------------------------------------------------------ [19][21] faixas
  _buildMarkings() {
    const whites = [];
    const yellows = [];
    const Y = 0.012;   // levemente acima do asfalto

    // ---- [19] linha amarela dupla no eixo + tracejado das bordas
    const addDashedCenter = (x0, z0, x1, z1) => {
      const len = Math.hypot(x1 - x0, z1 - z0);
      const dx = (x1 - x0) / len, dz = (z1 - z0) / len;
      const dash = 3.0, gap = 2.6;
      const along = dx !== 0;
      for (let t = 1.5; t < len - 1.5; t += dash + gap) {
        const l = Math.min(dash, len - 1.5 - t);
        if (l <= 0.3) break;
        const mx = x0 + dx * (t + l / 2), mz = z0 + dz * (t + l / 2);
        for (const off of [-0.28, 0.28]) {
          const g = groundQuad(along ? l : 0.16, along ? 0.16 : l);
          g.translate(mx + (along ? 0 : off), Y, mz + (along ? off : 0));
          yellows.push(g);
        }
      }
    };

    // ---- linha branca contínua junto ao meio-fio
    const addEdgeLines = (x0, z0, x1, z1) => {
      const along = x1 !== x0;
      const len = Math.hypot(x1 - x0, z1 - z0);
      for (const off of [-(ROAD_H - 0.6), ROAD_H - 0.6]) {
        const g = groundQuad(along ? len : 0.14, along ? 0.14 : len);
        g.translate(
          (x0 + x1) / 2 + (along ? 0 : off), Y,
          (z0 + z1) / 2 + (along ? off : 0),
        );
        whites.push(g);
      }
    };

    for (let j = 0; j < GRID; j++) {
      const z = nodeCoord(j);
      for (let i = 0; i < GRID - 1; i++) {
        const x0 = nodeCoord(i) + ROAD_H, x1 = nodeCoord(i + 1) - ROAD_H;
        addDashedCenter(x0, z, x1, z);
        addEdgeLines(x0, z, x1, z);
      }
    }
    for (let i = 0; i < GRID; i++) {
      const x = nodeCoord(i);
      for (let j = 0; j < GRID - 1; j++) {
        const z0 = nodeCoord(j) + ROAD_H, z1 = nodeCoord(j + 1) - ROAD_H;
        addDashedCenter(x, z0, x, z1);
        addEdgeLines(x, z0, x, z1);
      }
    }

    // ---- [21] faixas de pedestre + linha de retenção em cada aproximação
    // A faixa é pintada exatamente em WALK_OFF, que é por onde o pedestre anda,
    // e a linha de retenção fica atrás dela, em STOP_LINE.
    const STRIPES = 6, STRIPE_W = 0.75, CROSS_DEPTH = 3.2;
    for (let i = 0; i < GRID; i++) {
      for (let j = 0; j < GRID; j++) {
        const nx = nodeCoord(i), nz = nodeCoord(j);
        const hasE = i < GRID - 1, hasW = i > 0, hasN = j < GRID - 1, hasS = j > 0;

        // faixa atravessando a rua vertical (o pedestre anda em X)
        const crossX = (zSign) => {
          const zc = nz + zSign * WALK_OFF;
          for (let s = 0; s < STRIPES; s++) {
            const off = (s - (STRIPES - 1) / 2) * ((ROAD_W - 3.2) / STRIPES);
            const g = groundQuad(STRIPE_W, CROSS_DEPTH);
            g.translate(nx + off, Y + 0.002, zc);
            whites.push(g);
          }
        };
        // faixa atravessando a rua horizontal (o pedestre anda em Z)
        const crossZ = (xSign) => {
          const xc = nx + xSign * WALK_OFF;
          for (let s = 0; s < STRIPES; s++) {
            const off = (s - (STRIPES - 1) / 2) * ((ROAD_W - 3.2) / STRIPES);
            const g = groundQuad(CROSS_DEPTH, STRIPE_W);
            g.translate(xc, Y + 0.002, nz + off);
            whites.push(g);
          }
        };

        if (hasN) crossX(1);
        if (hasS) crossX(-1);
        if (hasE) crossZ(1);
        if (hasW) crossZ(-1);

        // linha de retenção, sempre na faixa de quem se aproxima [23]
        const stopBar = (ax, az, w, d) => {
          const g = groundQuad(w, d);
          g.translate(ax, Y + 0.001, az);
          whites.push(g);
        };
        const S = STOP_LINE;
        if (hasS) stopBar(nx - LANE, nz - S, 8.2, 0.5);   // vindo do sul, faixa em -X
        if (hasN) stopBar(nx + LANE, nz + S, 8.2, 0.5);   // vindo do norte, faixa em +X
        if (hasW) stopBar(nx - S, nz + LANE, 0.5, 8.2);   // vindo do oeste, faixa em +Z
        if (hasE) stopBar(nx + S, nz - LANE, 0.5, 8.2);   // vindo do leste, faixa em -Z
      }
    }

    const whiteMat = new THREE.MeshStandardMaterial({
      color: 0xf2f2ee, roughness: 0.62, metalness: 0.0,
      emissive: 0x1a1a18, emissiveIntensity: 0.5,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    const yellowMat = new THREE.MeshStandardMaterial({
      color: 0xe8b93a, roughness: 0.66, metalness: 0.0,
      emissive: 0x2a1e05, emissiveIntensity: 0.5,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });

    const wm = new THREE.Mesh(mergeGeometries(whites, false), whiteMat);
    wm.receiveShadow = true; wm.name = 'markings-white';
    this.group.add(wm);

    const ym = new THREE.Mesh(mergeGeometries(yellows, false), yellowMat);
    ym.receiveShadow = true; ym.name = 'markings-yellow';
    this.group.add(ym);
  }

  // ------------------------------------------------------------------ [20] prédios
  _buildBuildings() {
    const rng = this.rng;
    const wallsByVariant = Array.from({ length: FACADE_VARIANTS }, () => []);
    const roofGeos = [];
    const detailGeos = [];
    const padGeos = [];

    for (const b of this.blocks) {
      if (b.type !== 'urban') continue;

      const lots = this._splitBlock(b, rng);
      for (const lot of lots) {
        const variant = rngInt(rng, 0, FACADE_VARIANTS - 1);
        const maxH = 16 + b.density * b.density * 68 + rngRange(rng, -6, 16);
        let h = Math.max(9, maxH);

        // torres altas ganham recuos (setbacks) — silhueta muito mais interessante
        const tiers = h > 46 && rng() < 0.65 ? rngInt(rng, 2, 3) : 1;
        let cw = lot.w, cd = lot.d, base = CURB_H;

        for (let t = 0; t < tiers; t++) {
          const th = t === tiers - 1 ? h : h * rngRange(rng, 0.42, 0.62);
          this._addBox(wallsByVariant[variant], roofGeos, lot.x, base, lot.z, cw, th, cd, variant);
          base += th;
          h -= th;
          cw *= rngRange(rng, 0.66, 0.82);
          cd *= rngRange(rng, 0.66, 0.82);
          if (h < 6) break;
        }

        const totalH = base;
        this.buildings.push({ x: lot.x, z: lot.z, w: lot.w, d: lot.d, h: totalH });

        // [31][45] colisão + footprint que impede spawn dentro do prédio
        this.col.addBox(lot.x, lot.z, lot.w / 2, lot.d / 2, totalH, 'building');

        this._roofDetails(detailGeos, padGeos, lot.x, lot.z, cw, cd, totalH, totalH > 52, rng);
      }
    }

    // paredes: uma malha por variante de fachada (6 draw calls para a cidade toda)
    for (let v = 0; v < FACADE_VARIANTS; v++) {
      if (!wallsByVariant[v].length) continue;
      const tex = facadeTextures(v);
      const mat = new THREE.MeshStandardMaterial({
        map: tex.map,
        emissiveMap: tex.emissive,          // [13] janelas acendem à noite
        emissive: 0xffffff,
        emissiveIntensity: 0,
        roughnessMap: tex.roughness,
        roughness: 1.0,
        metalness: 0.22,
        envMapIntensity: 1.1,
      });
      this.facadeMaterials.push(mat);
      const mesh = new THREE.Mesh(mergeGeometries(wallsByVariant[v], false), mat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.name = 'facades-' + v;
      this.group.add(mesh);
    }

    const roofMat = new THREE.MeshStandardMaterial({
      color: 0x51565e, roughness: 0.93, metalness: 0.06,
    });
    const roofs = new THREE.Mesh(mergeGeometries(roofGeos, false), roofMat);
    roofs.castShadow = true; roofs.receiveShadow = true; roofs.name = 'roofs';
    this.group.add(roofs);

    const detMat = new THREE.MeshStandardMaterial({
      color: 0x6b7078, roughness: 0.72, metalness: 0.45,
    });
    const dets = new THREE.Mesh(mergeGeometries(detailGeos, false), detMat);
    dets.castShadow = true; dets.receiveShadow = true; dets.name = 'roof-details';
    this.group.add(dets);

    // [46] helipontos de laje
    if (padGeos.length) {
      const padMat = new THREE.MeshStandardMaterial({
        map: helipadTexture(), roughness: 0.85, metalness: 0.05,
      });
      const pads = new THREE.Mesh(mergeGeometries(padGeos, false), padMat);
      pads.receiveShadow = true; pads.name = 'rooftop-pads';
      this.group.add(pads);
    }
  }

  /** Divide a área construível do quarteirão em 1..4 lotes. */
  _splitBlock(b, rng) {
    const S = BLOCK_INNER;
    const r = rng();
    const margin = 1.2;
    const lots = [];

    if (r < 0.30) {
      // torre única ocupando quase todo o lote
      const w = S * rngRange(rng, 0.72, 0.95);
      const d = S * rngRange(rng, 0.72, 0.95);
      lots.push({ x: b.cx, z: b.cz, w, d });
    } else if (r < 0.62) {
      // quatro prédios
      const h = S / 2 - margin;
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          const w = h * rngRange(rng, 0.76, 0.98);
          const d = h * rngRange(rng, 0.76, 0.98);
          lots.push({ x: b.cx + sx * (S / 4), z: b.cz + sz * (S / 4), w, d });
        }
      }
    } else if (r < 0.84) {
      // duas lâminas
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
      // fileira de três (comercial)
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

  /**
   * Uma caixa de prédio como 4 paredes (UV em metros, janelas nunca cortadas)
   * mais a laje de cobertura.
   */
  _addBox(wallOut, roofOut, x, y, z, w, h, d, variant) {
    // colunas/andares múltiplos de 4 -> a textura (4x4 janelas) fecha certinho
    const colsW = Math.max(4, Math.round(w / FACADE_CELL_W / 4) * 4);
    const colsD = Math.max(4, Math.round(d / FACADE_CELL_W / 4) * 4);
    const rows = Math.max(4, Math.round(h / FACADE_CELL_H / 4) * 4);

    const face = (pw, ru, rotY, ox, oz) => {
      const g = new THREE.PlaneGeometry(pw, h);
      const uv = g.attributes.uv;
      for (let i = 0; i < uv.count; i++) {
        uv.setXY(i, uv.getX(i) * (ru / 4), uv.getY(i) * (rows / 4));
      }
      g.rotateY(rotY);
      g.translate(x + ox, y + h / 2, z + oz);
      wallOut.push(g);
    };

    face(w, colsW, 0, 0, d / 2);                  // +Z
    face(w, colsW, Math.PI, 0, -d / 2);           // -Z
    face(d, colsD, Math.PI / 2, w / 2, 0);        // +X
    face(d, colsD, -Math.PI / 2, -w / 2, 0);      // -X

    const roof = groundQuad(w, d, 4);
    roof.translate(x, y + h + 0.001, z);
    roofOut.push(roof);
  }

  _roofDetails(out, padOut, x, z, w, d, top, tall, rng) {
    // platibanda (mureta do telhado)
    const ph = 0.85, pt = 0.32;
    const wall = (bw, bd, ox, oz) => {
      const g = new THREE.BoxGeometry(bw, ph, bd);
      g.translate(x + ox, top + ph / 2, z + oz);
      out.push(g);
    };
    wall(w, pt, 0, d / 2 - pt / 2);
    wall(w, pt, 0, -d / 2 + pt / 2);
    wall(pt, d, w / 2 - pt / 2, 0);
    wall(pt, d, -w / 2 + pt / 2, 0);

    // casa de máquinas + caixa d'água + condensadores
    const nBoxes = rngInt(rng, 1, 3);
    for (let i = 0; i < nBoxes; i++) {
      const bw = rngRange(rng, 1.6, Math.max(2, w * 0.28));
      const bd = rngRange(rng, 1.6, Math.max(2, d * 0.28));
      const bh = rngRange(rng, 1.1, 3.0);
      const g = new THREE.BoxGeometry(bw, bh, bd);
      g.translate(
        x + rngRange(rng, -w / 2 + bw, w / 2 - bw),
        top + bh / 2,
        z + rngRange(rng, -d / 2 + bd, d / 2 - bd),
      );
      out.push(g);
    }

    // antena nos prédios altos
    if (tall && rng() < 0.55) {
      const ah = rngRange(rng, 5, 14);
      const g = new THREE.CylinderGeometry(0.13, 0.2, ah, 6);
      g.translate(x, top + ah / 2, z);
      out.push(g);
    }

    // [46] heliponto em lajes grandes e altas
    if (tall && w > 17 && d > 17 && rng() < 0.5) {
      const R = Math.min(w, d) * 0.36;
      const pad = new THREE.CircleGeometry(R, 28);
      pad.rotateX(-Math.PI / 2);
      pad.translate(x, top + 0.06, z);
      padOut.push(pad);
      this.rooftopPads.push({ x, z, y: top + 0.06, r: R });
    }
  }

  /** [13][20] Acende as janelas conforme a noite chega. */
  setNight(t) {
    const glow = Math.pow(t, 1.4) * NIGHT.windowGlow;
    for (const m of this.facadeMaterials) m.emissiveIntensity = glow;
  }
}
