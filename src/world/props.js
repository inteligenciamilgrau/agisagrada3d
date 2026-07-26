import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CELL, ROAD_W, BLOCK_INNER, CURB_H, QUALITY, PROP_OFF, NIGHT } from '../config.js';
import { makeRng, rngRange, rngInt, dist2Sq } from '../utils.js';
import { glowTexture } from '../gfx/textures.js';

const BLOCK_HALF = (CELL - ROAD_W) / 2;      // 23
/**
 * Distância do centro do quarteirão até a linha de postes e árvores.
 * Fica junto ao meio-fio, deixando a faixa de caminhada livre para os
 * pedestres passarem sem atravessar nada.
 */
const BAND = CELL / 2 - PROP_OFF;            // 22.1

/**
 * [22] Postes de iluminação e [16] plantas (árvores, arbustos, canteiros),
 * além de bancos e lixeiras. Tudo instanciado para manter o custo baixo.
 */
export class Props {
  constructor(scene, collision, seed = 777) {
    this.scene = scene;
    this.col = collision;
    this.rng = makeRng(seed);
    this.group = new THREE.Group();
    this.group.name = 'props';
    scene.add(this.group);

    this.lamps = [];            // {x,z,y} cabeça da luminária
    this.lampLights = [];       // pool de PointLight reais
    this.nightAmount = 0;

    this._lightsEnabled = false;
    this._selTimer = 0;
    this._bestLamp = new Array(QUALITY.maxDynamicLights).fill(null);
    this._bestD2 = new Array(QUALITY.maxDynamicLights).fill(Infinity);
  }

  build(city) {
    this._collectPlacements(city);
    this._buildLamps();
    this._buildTrees();
    this._buildStreetFurniture();
    this._buildLampLightPool();
  }

  // ------------------------------------------------------------------ posições
  _collectPlacements(city) {
    const rng = this.rng;
    this.lampSpots = [];
    this.treeSpots = [];
    this.bushSpots = [];
    this.benchSpots = [];

    for (const b of city.blocks) {
      // 4 lados do quarteirão
      const edges = [
        { ax: 'x', sign: 1 }, { ax: 'x', sign: -1 },
        { ax: 'z', sign: 1 }, { ax: 'z', sign: -1 },
      ];
      for (const e of edges) {
        for (let k = -1; k <= 1; k++) {
          const t = k * (BLOCK_HALF - 4.5);
          const px = e.ax === 'x' ? b.cx + e.sign * BAND : b.cx + t;
          const pz = e.ax === 'x' ? b.cz + t : b.cz + e.sign * BAND;
          // o braço da luminária (local +Z) precisa apontar para FORA do
          // quarteirão, ou seja, por cima da rua
          const rot = e.ax === 'x' ? (e.sign > 0 ? Math.PI / 2 : -Math.PI / 2)
                                   : (e.sign > 0 ? 0 : Math.PI);
          if (k === 0) {
            this.lampSpots.push({ x: px, z: pz, rot });          // [22]
          } else if (rng() < 0.72) {
            this.treeSpots.push({ x: px, z: pz });               // [16]
          } else if (rng() < 0.5) {
            this.benchSpots.push({ x: px, z: pz, rot });
          }
        }
      }

      // praças: árvores e arbustos preenchendo o miolo
      if (b.type === 'park') {
        const R = BLOCK_INNER / 2 - 1.5;
        const n = rngInt(rng, 9, 15);
        for (let i = 0; i < n; i++) {
          this.treeSpots.push({
            x: b.cx + rngRange(rng, -R, R),
            z: b.cz + rngRange(rng, -R, R),
          });
        }
        for (let i = 0; i < 16; i++) {
          this.bushSpots.push({
            x: b.cx + rngRange(rng, -R, R),
            z: b.cz + rngRange(rng, -R, R),
          });
        }
        for (let i = 0; i < 3; i++) {
          this.benchSpots.push({
            x: b.cx + rngRange(rng, -R * 0.7, R * 0.7),
            z: b.cz + rngRange(rng, -R * 0.7, R * 0.7),
            rot: rngRange(rng, 0, Math.PI * 2),
          });
        }
      }
    }
  }

  // ------------------------------------------------------------------ [22] postes
  _buildLamps() {
    const H = 7.4;
    const poleGeos = [];
    // mastro + braço curvo, montados uma vez e instanciados
    const pole = new THREE.CylinderGeometry(0.11, 0.17, H, 8);
    pole.translate(0, H / 2, 0);
    poleGeos.push(pole);
    const base = new THREE.CylinderGeometry(0.26, 0.32, 0.5, 8);
    base.translate(0, 0.25, 0);
    poleGeos.push(base);
    const arm = new THREE.BoxGeometry(0.13, 0.13, 1.9);
    arm.translate(0, H - 0.22, 0.95);
    poleGeos.push(arm);
    const knee = new THREE.SphereGeometry(0.15, 8, 6);
    knee.translate(0, H - 0.22, 0.05);
    poleGeos.push(knee);
    const poleGeo = mergeGeometries(poleGeos, false);

    const headGeo = new THREE.BoxGeometry(0.62, 0.24, 1.15);
    headGeo.translate(0, H - 0.42, 1.75);

    const metal = new THREE.MeshStandardMaterial({ color: 0x33383f, roughness: 0.5, metalness: 0.8 });
    // a lente emissiva é o que o bloom transforma em brilho de rua
    this.lampLensMat = new THREE.MeshStandardMaterial({
      color: 0x2a2b2e, emissive: 0xffd9a0, emissiveIntensity: 0, roughness: 0.3, metalness: 0.1,
    });

    const n = this.lampSpots.length;
    const poles = new THREE.InstancedMesh(poleGeo, metal, n);
    const heads = new THREE.InstancedMesh(headGeo, this.lampLensMat, n);
    poles.castShadow = true; heads.castShadow = true;
    poles.receiveShadow = true;

    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const v1 = new THREE.Vector3(1, 1, 1);
    const glowPos = new Float32Array(n * 3);

    for (let i = 0; i < n; i++) {
      const s = this.lampSpots[i];
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), s.rot);
      m.compose(new THREE.Vector3(s.x, CURB_H, s.z), q, v1);
      poles.setMatrixAt(i, m);
      heads.setMatrixAt(i, m);

      // posição real da lâmpada (ponta do braço, já rotacionada)
      const lx = s.x + Math.sin(s.rot) * 1.75;
      const lz = s.z + Math.cos(s.rot) * 1.75;
      const ly = CURB_H + H - 0.55;
      this.lamps.push({ x: lx, y: ly, z: lz });
      glowPos[i * 3] = lx; glowPos[i * 3 + 1] = ly; glowPos[i * 3 + 2] = lz;

      // [31] o poste colide
      this.col.addCircle(s.x, s.z, 0.28, CURB_H + H, 'lamp');
    }
    poles.instanceMatrix.needsUpdate = true;
    heads.instanceMatrix.needsUpdate = true;
    this.group.add(poles, heads);

    // halo aditivo em volta de cada lâmpada
    const gg = new THREE.BufferGeometry();
    gg.setAttribute('position', new THREE.BufferAttribute(glowPos, 3));
    this.glowMat = new THREE.PointsMaterial({
      map: glowTexture(), size: 7.5, sizeAttenuation: true,
      transparent: true, opacity: 0, depthWrite: false,
      blending: THREE.AdditiveBlending, fog: true,
    });
    this.glow = new THREE.Points(gg, this.glowMat);
    this.glow.name = 'lamp-glow';
    this.group.add(this.glow);
  }

  /** Poucas luzes reais, sempre nas lâmpadas mais próximas do jogador. */
  _buildLampLightPool() {
    // o pool nasce no tamanho máximo; o perfil de qualidade define quantas
    // ficam de fato ativas
    for (let i = 0; i < QUALITY.maxDynamicLights; i++) {
      const l = new THREE.PointLight(0xffcf94, 0, 34, 1.9);
      l.visible = false;
      this.scene.add(l);
      this.lampLights.push(l);
    }
    this._activeLights = QUALITY.maxDynamicLights;
  }

  /** Quantidade de postes com luz real (definida pelo perfil de qualidade). */
  setMaxLights(n) {
    this._activeLights = Math.max(0, Math.min(n, this.lampLights.length));
    // força reavaliar a visibilidade na próxima atualização
    this._lightsEnabled = null;
    this._selTimer = 0;
  }

  // ------------------------------------------------------------------ [16] árvores
  _buildTrees() {
    const rng = this.rng;

    const trunkGeo = new THREE.CylinderGeometry(0.16, 0.30, 3.1, 7);
    trunkGeo.translate(0, 1.55, 0);
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5a4632, roughness: 0.95 });

    // copa: três massas irregulares dão volume sem custo
    const blobs = [];
    const b1 = new THREE.IcosahedronGeometry(1.75, 1); b1.translate(0, 3.9, 0); blobs.push(b1);
    const b2 = new THREE.IcosahedronGeometry(1.25, 1); b2.translate(0.95, 3.25, 0.4); blobs.push(b2);
    const b3 = new THREE.IcosahedronGeometry(1.15, 1); b3.translate(-0.8, 3.45, -0.55); blobs.push(b3);
    const leafGeo = mergeGeometries(blobs, false);
    // deforma um pouco os vértices para tirar a cara de esfera
    const lp = leafGeo.attributes.position;
    for (let i = 0; i < lp.count; i++) {
      lp.setXYZ(i,
        lp.getX(i) + (rng() - 0.5) * 0.35,
        lp.getY(i) + (rng() - 0.5) * 0.35,
        lp.getZ(i) + (rng() - 0.5) * 0.35);
    }
    leafGeo.computeVertexNormals();
    const leafMat = new THREE.MeshStandardMaterial({
      color: 0x4f7a34, roughness: 0.88, metalness: 0,
      flatShading: true,
    });

    const n = this.treeSpots.length;
    const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, n);
    const leaves = new THREE.InstancedMesh(leafGeo, leafMat, n);
    trunks.castShadow = true; leaves.castShadow = true;      // [44]
    trunks.receiveShadow = true; leaves.receiveShadow = true;

    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const colorLeaf = new THREE.Color();

    for (let i = 0; i < n; i++) {
      const s = this.treeSpots[i];
      const sc = rngRange(rng, 0.78, 1.35);
      q.setFromAxisAngle(up, rngRange(rng, 0, Math.PI * 2));
      m.compose(new THREE.Vector3(s.x, CURB_H, s.z), q, new THREE.Vector3(sc, sc * rngRange(rng, 0.9, 1.2), sc));
      trunks.setMatrixAt(i, m);
      leaves.setMatrixAt(i, m);
      // variação de verde por instância
      colorLeaf.setHSL(0.26 + rng() * 0.07, 0.42 + rng() * 0.2, 0.24 + rng() * 0.12);
      leaves.setColorAt(i, colorLeaf);

      // [31] tronco colide
      this.col.addCircle(s.x, s.z, 0.42 * sc, CURB_H + 3, 'tree');
    }
    trunks.instanceMatrix.needsUpdate = true;
    leaves.instanceMatrix.needsUpdate = true;
    if (leaves.instanceColor) leaves.instanceColor.needsUpdate = true;
    this.group.add(trunks, leaves);

    // arbustos das praças
    if (this.bushSpots.length) {
      const bushGeo = new THREE.IcosahedronGeometry(0.85, 1);
      const bushMat = new THREE.MeshStandardMaterial({ color: 0x3f6b2d, roughness: 0.92, flatShading: true });
      const bushes = new THREE.InstancedMesh(bushGeo, bushMat, this.bushSpots.length);
      bushes.castShadow = true; bushes.receiveShadow = true;
      for (let i = 0; i < this.bushSpots.length; i++) {
        const s = this.bushSpots[i];
        const sc = rngRange(rng, 0.6, 1.25);
        q.setFromAxisAngle(up, rngRange(rng, 0, Math.PI * 2));
        m.compose(new THREE.Vector3(s.x, CURB_H + 0.35 * sc, s.z), q, new THREE.Vector3(sc, sc * 0.75, sc));
        bushes.setMatrixAt(i, m);
      }
      bushes.instanceMatrix.needsUpdate = true;
      this.group.add(bushes);
    }
  }

  // ------------------------------------------------------------------ mobiliário
  _buildStreetFurniture() {
    if (!this.benchSpots.length) return;
    const parts = [];
    const seat = new THREE.BoxGeometry(1.7, 0.09, 0.52);
    seat.translate(0, 0.46, 0);
    parts.push(seat);
    const backr = new THREE.BoxGeometry(1.7, 0.42, 0.08);
    backr.translate(0, 0.72, -0.24);
    parts.push(backr);
    for (const s of [-0.72, 0.72]) {
      const leg = new THREE.BoxGeometry(0.1, 0.46, 0.46);
      leg.translate(s, 0.23, 0);
      parts.push(leg);
    }
    const geo = mergeGeometries(parts, false);
    const mat = new THREE.MeshStandardMaterial({ color: 0x6b4a2f, roughness: 0.82, metalness: 0.08 });

    const n = this.benchSpots.length;
    const mesh = new THREE.InstancedMesh(geo, mat, n);
    mesh.castShadow = true; mesh.receiveShadow = true;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < n; i++) {
      const s = this.benchSpots[i];
      q.setFromAxisAngle(up, s.rot ?? 0);
      m.compose(new THREE.Vector3(s.x, CURB_H, s.z), q, new THREE.Vector3(1, 1, 1));
      mesh.setMatrixAt(i, m);
    }
    mesh.instanceMatrix.needsUpdate = true;
    this.group.add(mesh);
  }

  /** [13][22] Acende a iluminação pública e move as luzes reais para perto do jogador. */
  update(dt, nightFactor, focus) {
    this.nightAmount = nightFactor;
    const on = Math.pow(Math.max(0, (nightFactor - 0.25) / 0.75), 0.8);

    this.lampLensMat.emissiveIntensity = on * NIGHT.lampLens;
    this.glowMat.opacity = on * NIGHT.lampGlow;

    /*
     * ATENÇÃO: alternar `light.visible` muda a quantidade de luzes da cena,
     * o que muda a chave de cache do programa e faz o three RECOMPILAR os
     * shaders de tudo. Fazer isso a cada frame (conforme o jogador anda)
     * engasgava o jogo inteiro à noite.
     *
     * Agora o pool troca de estado UMA vez por ciclo dia/noite. Dentro da
     * noite as luzes ficam sempre visíveis e só a intensidade e a posição
     * mudam — isso não recompila nada.
     */
    const enabled = on >= 0.02;
    if (enabled !== this._lightsEnabled) {
      this._lightsEnabled = enabled;
      for (let i = 0; i < this.lampLights.length; i++) {
        this.lampLights[i].visible = enabled && i < this._activeLights;
        this.lampLights[i].intensity = 0;
      }
    }
    if (!enabled || this._activeLights === 0) return;

    // reposicionar as luzes é caro à toa a 60fps: 5x por segundo basta
    this._selTimer -= dt;
    if (this._selTimer > 0) return;
    this._selTimer = 0.2;

    // seleção das N mais próximas sem alocar nem ordenar a lista toda
    const N = this._activeLights;
    const bestLamp = this._bestLamp, bestD2 = this._bestD2;
    for (let i = 0; i < N; i++) { bestLamp[i] = null; bestD2[i] = Infinity; }

    for (const lamp of this.lamps) {
      const d2 = dist2Sq(lamp.x, lamp.z, focus.x, focus.z);
      if (d2 >= 60 * 60 || d2 >= bestD2[N - 1]) continue;
      let k = N - 1;
      while (k > 0 && bestD2[k - 1] > d2) {
        bestD2[k] = bestD2[k - 1];
        bestLamp[k] = bestLamp[k - 1];
        k--;
      }
      bestD2[k] = d2;
      bestLamp[k] = lamp;
    }

    for (let i = 0; i < N; i++) {
      const l = this.lampLights[i];
      const lamp = bestLamp[i];
      if (lamp) {
        l.position.set(lamp.x, lamp.y, lamp.z);
        l.intensity = on * NIGHT.lampPower;
      } else {
        l.intensity = 0;      // apagada, mas continua visível (sem recompilar)
      }
    }
  }
}
