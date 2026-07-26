import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { HALF } from '../config.js';
import { clamp, lerp, smoothstep, TAU } from '../utils.js';
import { asphaltTexture, asphaltRoughness } from '../gfx/textures.js';
import { terrainHeight } from './terrain.js';

/**
 * [53] Estrada que sai da cidade, cruza o descampado e sobe o Corcovado
 * em espiral até o mirante do Cristo Redentor.
 *
 * A pista é definida ANALITICAMENTE (raio e altura em função do ângulo), e não
 * como uma lista de pontos. Isso permite responder "qual a altura da estrada
 * em (x,z)?" invertendo a espiral, que é o que faz o carro e o jogador
 * andarem em cima dela — o sistema de colisão só sabe consultar altura por
 * coordenada, não seguir splines.
 */

const HALF_W = 4.6;              // meia-largura da pista
/**
 * Raio mínimo da espiral. Precisa ser MAIOR que o mirante do Cristo (raio 30
 * na base), senão a última volta passa por baixo do piso dele e a consulta de
 * altura devolve a cota do mirante — o carro era teleportado para cima ao se
 * aproximar e não conseguia mais descer.
 */
const MIN_R = 32;
const GRADE = 0.085;             // 8,5% de inclinação, constante em toda a subida
const DTH = 0.02;                // passo angular da integração (rad)

/**
 * O morro não é um cone liso: a modelagem desloca cada vértice em até ±16% do
 * raio para dar cara de rocha. Uma estrada colada no perfil MÉDIO ficaria
 * enterrada nessas saliências em boa parte do trajeto.
 *
 * Por isso o eixo da pista é afastado por um fator sobre o raio (para vencer o
 * ruído, que é proporcional) mais uma folga fixa. O resultado é uma estrada
 * destacada da encosta — que é justamente o que os pilares vão sustentar.
 */
/*
 * O fator proporcional sozinho não basta: perto do topo o raio é pequeno e
 * 1.17 × raio rende centímetros, então a BORDA INTERNA da pista (meia-largura
 * para dentro do eixo) voltava a entrar na rocha. A folga fixa precisa cobrir
 * a meia-largura, garantindo ~1,4 m de sobra mesmo no ponto mais estreito.
 */
const NOISE_CLEAR = 1.18;        // maior que o pico do ruído (1.158)
const LIFT = 6;                  // > HALF_W, para a borda interna também sobrar

const DECK_DEPTH = 0.65;         // espessura do tabuleiro
const PILLAR_SPACING = 15;       // distância entre pilares
const PILLAR_MIN_H = 1.6;        // abaixo disso a pista já encosta na encosta

/** Onde a estrada encosta na malha viária da cidade. */
const CITY_JOIN = { x: -HALF - 9, z: -HALF };     // (-233, -224)

export class MountainRoad {
  /**
   * @param {object} spec CORCOVADO — precisa já ter baseY e topY calculados
   * @param {number} roundness mesma constante usada para modelar o morro
   */
  constructor(scene, collision, spec, roundness) {
    this.scene = scene;
    this.col = collision;
    this.spec = spec;
    this.profileExp = 0.5 + roundness * 0.9;

    this.yStart = spec.baseY + 10;
    this.yEnd = spec.topY - 1;               // exatamente o piso do mirante
    // começa virado para a cidade, que fica a nordeste do morro
    this.theta0 = Math.atan2(-spec.z, -spec.x);
    this._buildPath();

    this.group = new THREE.Group();
    this.group.name = 'estrada-corcovado';
    scene.add(this.group);
  }

  // ------------------------------------------------------------------ geometria da curva
  /** Raio da silhueta do morro na fração de altura t. */
  profileRadius(t) {
    return this.spec.r * Math.pow(Math.max(0, 1 - t), this.profileExp);
  }

  /**
   * Raio da pista em função da ALTURA (não do ângulo).
   * A estrada acompanha a encosta e, perto do topo, para de encolher para
   * poder dar a volta final no pináculo e alcançar o mirante.
   */
  radiusAtHeight(y) {
    const t = clamp((y - this.spec.baseY) / this.spec.h, 0, 1);
    return Math.max(this.profileRadius(t) * NOISE_CLEAR + LIFT, MIN_R);
  }

  /**
   * Altura da encosta (perfil médio) num dado raio — o inverso de
   * `profileRadius`. É o que diz até onde cada pilar precisa descer.
   * Fora do raio da base o cone acabou, então devolve o nível do pé do morro.
   */
  coneSurfaceHeight(r) {
    const razao = clamp(r / this.spec.r, 0, 1);
    const t = clamp(1 - Math.pow(razao, 1 / this.profileExp), 0, 1);
    return this.spec.baseY + t * this.spec.h;
  }

  /**
   * Integra a espiral com inclinação CONSTANTE.
   *
   * Parametrizar a altura pelo ângulo (y linear em θ) produzia rampas de 29%
   * perto do topo: lá em cima o morro estreita, cada volta fica curta e o
   * mesmo ganho de altura se espreme em muito menos estrada. Aqui é o
   * contrário: a cada passo o avanço horizontal define quanto se sobe, então
   * a rampa é a mesma do pé ao mirante e a quantidade de voltas sai da
   * geometria do morro.
   */
  _buildPath() {
    const pts = [];
    let th = this.theta0;
    let y = this.yStart;
    let r = this.radiusAtHeight(y);
    pts.push({ th, r, y });

    for (let guard = 0; guard < 20000 && y < this.yEnd; guard++) {
      const ds = r * DTH;                  // avanço horizontal do passo
      y = Math.min(this.yEnd, y + ds * GRADE);
      th += DTH;
      r = this.radiusAtHeight(y);
      pts.push({ th, r, y });
    }

    this.path = pts;
    this.thetaEnd = th;
    this.turns = (th - this.theta0) / TAU;
  }

  /** Interpola a tabela da espiral. */
  _sample(u) {
    const n = this.path.length - 1;
    const f = clamp(u, 0, 1) * n;
    const i = Math.min(n - 1, Math.floor(f));
    const k = f - i;
    const a = this.path[i], b = this.path[i + 1];
    return { th: lerp(a.th, b.th, k), r: lerp(a.r, b.r, k), y: lerp(a.y, b.y, k) };
  }

  heightAt(u) { return this._sample(u).y; }
  radiusAt(u) { return this._sample(u).r; }
  angleAt(u) { return this._sample(u).th; }

  pointAt(u, out = new THREE.Vector3()) {
    const s = this._sample(u);
    return out.set(
      this.spec.x + Math.cos(s.th) * s.r,
      s.y,
      this.spec.z + Math.sin(s.th) * s.r,
    );
  }

  /**
   * Raio de colisão do morro na fração de altura t: a borda INTERNA da pista.
   * É isso que impede o carro de entrar na rocha sem impedir que ele ande na
   * estrada. Sem isso os anéis de colisão do morro barravam a subida.
   */
  collisionRadiusAt(t) {
    const y = this.spec.baseY + t * this.spec.h;
    if (y < this.yStart - 6 || y > this.yEnd + 6) {
      return this.profileRadius(t) * 0.85;      // fora do trecho da estrada
    }
    return Math.max(1, this.radiusAtHeight(y) - HALF_W);
  }

  /**
   * [31] Altura da estrada em (x,z), ou null se o ponto está fora dela.
   *
   * Inverte a espiral: para o ângulo do ponto, testa cada volta e vê em qual
   * delas o raio bate. Perto do pico o raio satura em MIN_R e VÁRIAS voltas
   * passam pelo mesmo ponto do plano — por isso `refY` (a altura atual de quem
   * pergunta) desempata e escolhe o nível certo. Sem isso, quem estivesse na
   * volta de cima seria teleportado para a de baixo.
   */
  surfaceHeightAt(x, z, refY = null) {
    const niveis = this.levelsAt(x, z);
    if (!niveis.length) return null;
    if (refY == null) return niveis[0];

    let melhor = niveis[0], melhorDist = Infinity;
    for (const y of niveis) {
      const d = Math.abs(y - refY);
      if (d < melhorDist) { melhorDist = d; melhor = y; }
    }
    return melhor;
  }

  /**
   * TODAS as cotas da estrada que passam por (x,z) — normalmente uma, mas
   * mais de uma onde as voltas se sobrepõem perto do pico.
   */
  levelsAt(x, z, out = []) {
    out.length = 0;
    const dx = x - this.spec.x, dz = z - this.spec.z;
    const rq = Math.hypot(dx, dz);
    if (rq > this.path[0].r + HALF_W || rq < MIN_R - HALF_W) return out;

    let base = Math.atan2(dz, dx);
    while (base < this.theta0) base += TAU;
    while (base >= this.theta0 + TAU) base -= TAU;

    for (let th = base; th <= this.thetaEnd; th += TAU) {
      const f = (th - this.theta0) / DTH;
      const i = Math.floor(f);
      if (i < 0 || i >= this.path.length - 1) continue;
      const k = f - i;
      const a = this.path[i], b = this.path[i + 1];
      if (Math.abs(rq - lerp(a.r, b.r, k)) > HALF_W) continue;
      out.push(lerp(a.y, b.y, k));
    }
    return out;
  }

  // ------------------------------------------------------------------ trecho reto
  /** Altura do trecho que liga a cidade ao pé da espiral (segue o terreno). */
  _approachHeight(s, x, z) {
    const solo = terrainHeight(x, z) + 0.12;
    // nos últimos 20% vira rampa para casar com a cota da espiral
    const k = smoothstep(clamp((s - 0.8) / 0.2, 0, 1));
    return lerp(solo, this.yStart, k);
  }

  _approachPoint(s, out = new THREE.Vector3()) {
    const p0 = CITY_JOIN;
    const p1 = this.pointAt(0);
    const x = lerp(p0.x, p1.x, s);
    const z = lerp(p0.z, p1.z, s);
    return out.set(x, this._approachHeight(s, x, z), z);
  }

  // ------------------------------------------------------------------ construção
  build() {
    const asfalto = [];
    const guarda = [];
    const faixas = [];
    const concreto = [];

    // ---------------------------------------------------------- reta de acesso
    const APROX = 90;
    const pontosAprox = [];
    for (let i = 0; i <= APROX; i++) pontosAprox.push(this._approachPoint(i / APROX));
    asfalto.push(this._ribbon(pontosAprox, HALF_W));
    this._dashes(pontosAprox, faixas);

    // corredor caminhável do trecho reto
    const p0 = CITY_JOIN, p1 = this.pointAt(0);
    this.col.addPlatform(
      Math.min(p0.x, p1.x) - HALF_W - 2, Math.min(p0.z, p1.z) - HALF_W - 2,
      Math.max(p0.x, p1.x) + HALF_W + 2, Math.max(p0.z, p1.z) + HALF_W + 2,
      (x, z) => this._approachSurface(x, z),
    );

    // ---------------------------------------------------------- espiral
    // pontos direto da tabela integrada (sem reamostrar: é o traçado exato)
    const pontos = this.path.map((p) => new THREE.Vector3(
      this.spec.x + Math.cos(p.th) * p.r, p.y, this.spec.z + Math.sin(p.th) * p.r,
    ));
    asfalto.push(this._ribbon(pontos, HALF_W));
    this._dashes(pontos, faixas);
    this._guardrails(pontos, guarda);
    this._deckSkirt(pontos, concreto);      // espessura do tabuleiro
    this._pillars(pontos, concreto);        // alicerces

    // a plataforma cobre todo o morro; o yFn devolve null fora da pista.
    // O raio vem do traçado real, não do morro: a pista agora fica bem
    // afastada da encosta e pode passar do raio da base.
    const R = this.path[0].r + HALF_W + 6;
    this.col.addPlatform(
      this.spec.x - R, this.spec.z - R, this.spec.x + R, this.spec.z + R,
      (x, z, refY) => this.surfaceHeightAt(x, z, refY),
    );

    // ---------------------------------------------------------- malhas
    const matAsfalto = new THREE.MeshStandardMaterial({
      map: asphaltTexture(), roughnessMap: asphaltRoughness(),
      roughness: 0.95, metalness: 0.02,
    });
    const pista = new THREE.Mesh(mergeGeometries(asfalto, false), matAsfalto);
    pista.receiveShadow = true;
    pista.name = 'estrada-asfalto';
    this.group.add(pista);

    const matFaixa = new THREE.MeshStandardMaterial({
      color: 0xe8b93a, roughness: 0.66,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    const linhas = new THREE.Mesh(mergeGeometries(faixas, false), matFaixa);
    linhas.receiveShadow = true;
    this.group.add(linhas);

    const matGuarda = new THREE.MeshStandardMaterial({
      color: 0xc9ccd1, roughness: 0.5, metalness: 0.7,
    });
    const grade = new THREE.Mesh(mergeGeometries(guarda, false), matGuarda);
    grade.castShadow = true;
    grade.receiveShadow = true;
    this.group.add(grade);

    const matConcreto = new THREE.MeshStandardMaterial({
      color: 0x9c9689, roughness: 0.93, metalness: 0.02,
    });
    const estrutura = new THREE.Mesh(mergeGeometries(concreto, false), matConcreto);
    estrutura.castShadow = true;
    estrutura.receiveShadow = true;
    estrutura.name = 'estrada-alicerces';
    this.group.add(estrutura);
  }

  /**
   * Espessura do tabuleiro: duas faixas verticais nas bordas.
   * Sem isso a pista é um plano de espessura zero e, vista de lado,
   * parece uma folha de papel flutuando na encosta.
   */
  _deckSkirt(pontos, out) {
    for (const lado of [-1, 1]) {
      const n = pontos.length;
      const pos = new Float32Array(n * 2 * 3);
      const nor = new Float32Array(n * 2 * 3);
      const uv = new Float32Array(n * 2 * 2);
      const idx = [];
      const dir = new THREE.Vector3();

      for (let i = 0; i < n; i++) {
        const c = pontos[i];
        const a = pontos[Math.max(0, i - 1)];
        const b = pontos[Math.min(n - 1, i + 1)];
        dir.set(b.x - a.x, 0, b.z - a.z).normalize();
        const lx = -dir.z * lado, lz = dir.x * lado;
        const ex = c.x + lx * HALF_W, ez = c.z + lz * HALF_W;

        for (let s = 0; s < 2; s++) {
          const k = (i * 2 + s) * 3;
          pos[k] = ex;
          pos[k + 1] = s === 0 ? c.y : c.y - DECK_DEPTH;
          pos[k + 2] = ez;
          nor[k] = lx; nor[k + 1] = 0; nor[k + 2] = lz;
          const q = (i * 2 + s) * 2;
          uv[q] = s; uv[q + 1] = i * 0.1;
        }
        if (i < n - 1) {
          const v = i * 2;
          if (lado > 0) idx.push(v, v + 1, v + 2, v + 1, v + 3, v + 2);
          else idx.push(v, v + 2, v + 1, v + 1, v + 2, v + 3);
        }
      }

      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
      g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      g.setIndex(idx);
      out.push(g);
    }
  }

  /**
   * Alicerces: pilares descendo do tabuleiro até a encosta, com viga
   * transversal no topo e sapata na base. Onde a pista já está encostada no
   * morro o pilar é dispensado.
   */
  _pillars(pontos, out) {
    const p = this._resample(pontos, PILLAR_SPACING);
    const dir = new THREE.Vector3();

    for (let i = 0; i < p.length; i++) {
      const c = p[i];
      const a = p[Math.max(0, i - 1)];
      const b = p[Math.min(p.length - 1, i + 1)];
      dir.set(b.x - a.x, 0, b.z - a.z).normalize();

      // lateral da pista e sentido "para fora do morro"
      const lx = -dir.z, lz = dir.x;
      const ox = c.x - this.spec.x, oz = c.z - this.spec.z;
      const sinal = (lx * ox + lz * oz) >= 0 ? 1 : -1;

      // o pilar fica deslocado para o lado de fora: é a parte em balanço
      const px = c.x + lx * HALF_W * 0.45 * sinal;
      const pz = c.z + lz * HALF_W * 0.45 * sinal;

      const raio = Math.hypot(px - this.spec.x, pz - this.spec.z);
      const ySolo = this.coneSurfaceHeight(raio) - 2;   // enterra na rocha
      const topo = c.y - DECK_DEPTH;
      const h = topo - ySolo;
      if (h < PILLAR_MIN_H) continue;

      /*
       * A espiral passa por cima dela mesma. Se houver outra volta da estrada
       * entre este ponto e o chão, o pilar desceria ATRAVESSANDO a pista de
       * baixo, brotando no meio da rua. Nesses pontos o apoio é dispensado —
       * visualmente já existe estrutura logo abaixo.
       */
      const niveis = this.levelsAt(px, pz);
      let atravessa = false;
      for (const y of niveis) {
        if (y < topo - 1.5 && y > ySolo + 0.5) { atravessa = true; break; }
      }
      if (atravessa) continue;

      const fuste = new THREE.CylinderGeometry(0.62, 1.05, h, 10);
      fuste.translate(px, ySolo + h / 2, pz);
      out.push(fuste);

      // sapata
      const sapata = new THREE.CylinderGeometry(1.5, 1.9, 1.4, 10);
      sapata.translate(px, ySolo + 0.7, pz);
      out.push(sapata);

      // viga transversal sob o tabuleiro. rotY(θ) leva +X local para
      // (cos θ, -sin θ), então θ = atan2(-lz, lx) alinha a viga à largura.
      const viga = new THREE.BoxGeometry(HALF_W * 2 - 0.4, 0.55, 1.3);
      viga.rotateY(Math.atan2(-lz, lx));
      viga.translate(c.x, topo - 0.28, c.z);
      out.push(viga);
    }
  }

  /** Altura do trecho reto em (x,z), ou null se estiver fora dele. */
  _approachSurface(x, z) {
    const p0 = CITY_JOIN, p1 = this.pointAt(0);
    const vx = p1.x - p0.x, vz = p1.z - p0.z;
    const len2 = vx * vx + vz * vz;
    const s = ((x - p0.x) * vx + (z - p0.z) * vz) / len2;
    if (s < 0 || s > 1) return null;
    // distância perpendicular ao eixo da reta
    const px = p0.x + vx * s, pz = p0.z + vz * s;
    if (Math.hypot(x - px, z - pz) > HALF_W) return null;
    return this._approachHeight(s, px, pz);
  }

  /** Fita de asfalto a partir de uma polilinha central. */
  _ribbon(pontos, halfW) {
    const n = pontos.length;
    const pos = new Float32Array(n * 2 * 3);
    const nor = new Float32Array(n * 2 * 3);
    const uv = new Float32Array(n * 2 * 2);
    const idx = [];
    const dir = new THREE.Vector3();
    let dist = 0;

    for (let i = 0; i < n; i++) {
      const c = pontos[i];
      const a = pontos[Math.max(0, i - 1)];
      const b = pontos[Math.min(n - 1, i + 1)];
      dir.set(b.x - a.x, 0, b.z - a.z).normalize();
      // perpendicular horizontal
      const lx = -dir.z, lz = dir.x;

      if (i > 0) {
        const p = pontos[i - 1];
        dist += Math.hypot(c.x - p.x, c.y - p.y, c.z - p.z);
      }

      for (let s = 0; s < 2; s++) {
        const sign = s === 0 ? -1 : 1;
        const k = (i * 2 + s) * 3;
        pos[k] = c.x + lx * halfW * sign;
        pos[k + 1] = c.y;
        pos[k + 2] = c.z + lz * halfW * sign;
        nor[k] = 0; nor[k + 1] = 1; nor[k + 2] = 0;
        const q = (i * 2 + s) * 2;
        uv[q] = s;                 // through the width
        uv[q + 1] = dist / 8;      // 8 m por repetição da textura
      }

      if (i < n - 1) {
        const v = i * 2;
        idx.push(v, v + 1, v + 2, v + 1, v + 3, v + 2);
      }
    }

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(idx);
    return g;
  }

  /**
   * Reamostra a polilinha em intervalos aproximadamente iguais.
   * A integração da espiral dá passos de tamanho MUITO diferente (~3,6 m no pé
   * do morro, ~0,5 m no topo, onde o raio é pequeno). Espaçar por índice
   * deixaria o guarda-corpo ralo embaixo e absurdamente denso em cima.
   */
  _resample(pontos, espacamento) {
    const out = [pontos[0].clone()];
    let acc = 0;
    for (let i = 1; i < pontos.length; i++) {
      acc += pontos[i].distanceTo(pontos[i - 1]);
      if (acc >= espacamento) { out.push(pontos[i].clone()); acc = 0; }
    }
    const fim = pontos[pontos.length - 1];
    if (out[out.length - 1].distanceTo(fim) > espacamento * 0.4) out.push(fim.clone());
    return out;
  }

  /** [19] Tracejado amarelo no eixo. */
  _dashes(pontos, out) {
    const p = this._resample(pontos, 6);
    for (let i = 0; i < p.length - 1; i += 2) {
      const a = p[i], b = p[i + 1];
      const dx = b.x - a.x, dz = b.z - a.z;
      const len = Math.hypot(dx, dz);
      if (len < 0.4) continue;
      const g = new THREE.PlaneGeometry(0.18, len * 0.55);
      g.rotateX(-Math.PI / 2);
      g.rotateY(Math.atan2(dx, dz));
      g.translate((a.x + b.x) / 2, (a.y + b.y) / 2 + 0.02, (a.z + b.z) / 2);
      out.push(g);
    }
  }

  /**
   * [31] Guarda-corpo na borda de fora — sem ele o carro cai da encosta.
   * O poste vira colisor: é o que segura quem sai da pista.
   */
  _guardrails(pontos, out) {
    const dir = new THREE.Vector3();

    /** Ponto da borda externa correspondente a um índice da polilinha. */
    const borda = (p, i, arr) => {
      const a = arr[Math.max(0, i - 1)];
      const b = arr[Math.min(arr.length - 1, i + 1)];
      dir.set(b.x - a.x, 0, b.z - a.z).normalize();
      const lx = -dir.z, lz = dir.x;
      // externo = o lado que aponta para longe do eixo do morro
      const ox = p.x - this.spec.x, oz = p.z - this.spec.z;
      const s = (lx * ox + lz * oz) >= 0 ? 1 : -1;
      return { x: p.x + lx * HALF_W * s, z: p.z + lz * HALF_W * s, ang: Math.atan2(dir.x, dir.z) };
    };

    /*
     * Colisão a cada 3 m com raio 1,1: os colisores precisam ficar juntos o
     * bastante para o carro (raio 1,75) não passar pela fresta e despencar da
     * encosta. Uma folga de 3 − 2×1,1 = 0,8 m é intransponível para ele.
     */
    const colisao = this._resample(pontos, 3);
    for (let i = 0; i < colisao.length; i++) {
      const y = colisao[i].y;
      const e = borda(colisao[i], i, colisao);
      // a base é obrigatória: perto do topo as voltas ficam quase uma sobre a
      // outra, e sem ela o guarda-corpo de cima barraria a pista de baixo
      this.col.addCircle(e.x, e.z, 1.1, y + 1.1, 'guardrail', y - 1.2);
    }

    // a parte visível é bem mais espaçada
    const visual = this._resample(pontos, 5);
    for (let i = 0; i < visual.length; i++) {
      const p = visual[i];
      const e = borda(p, i, visual);
      const poste = new THREE.BoxGeometry(0.14, 0.9, 0.14);
      poste.translate(e.x, p.y + 0.45, e.z);
      out.push(poste);

      const trilho = new THREE.BoxGeometry(0.1, 0.22, 5.2);
      trilho.rotateY(e.ang);
      trilho.translate(e.x, p.y + 0.72, e.z);
      out.push(trilho);
    }
  }
}

export { HALF_W as ROAD_HALF_W };
