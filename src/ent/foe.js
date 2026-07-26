import * as THREE from 'three';
import { VoxelFigure, ALTURA } from './voxel.js';
import { HUMANOIDES, MODELOS, montarModelo } from './voxeldef.js';
import { CORCOVADO } from '../world/landmarks.js';

/**
 * ============================================================
 *  Inimigos e chefões da campanha
 * ============================================================
 *
 * Todo inimigo é um boneco voxel com vida, um jeito de andar e um
 * golpe. A IA é curta de propósito: num beat 'em up o que diverte é a
 * PRESSÃO (vários vindo de lados diferentes), não a esperteza de cada
 * um. Inimigo esperto sozinho vira chato; seis burros viram luta.
 */

/** Fichas dos inimigos comuns. `modelo` aponta para `voxeldef.js`. */
/**
 * Fichas dos inimigos comuns. `modelo` aponta para `voxeldef.js`.
 *
 * `bola` é o tiro: { raio, vel, recarga, alcance, cor }. Quem tem bola
 * PARA a uma distância e atira, em vez de correr para o corpo a corpo —
 * é o que faz a onda ter frente e fundo, com uns pressionando de perto
 * e outros castigando de longe.
 */
export const FICHAS = {
  drone: {
    vida: 20, vel: 6.5, voa: 3.2, dano: 1, alcance: 2.2, recarga: 1.5, pontos: 5,
    modelo: 'drone',
    bola: { raio: 0.42, vel: 30, recarga: 2.2, alcance: 55, cor: 0xff4d4d },
  },
  crawler: {
    vida: 26, vel: 4.6, dano: 1, alcance: 2.0, recarga: 1.4, pontos: 5,
    modelo: 'crawler',
    bola: { raio: 0.5, vel: 24, recarga: 2.6, alcance: 42, cor: 0xff7a1a },
  },
  lobista: {
    vida: 32, vel: 3.4, dano: 1, alcance: 2.4, recarga: 1.6, pontos: 8,
    humano: 'lobista',
    bola: { raio: 0.55, vel: 26, recarga: 3.0, alcance: 45, cor: 0xffd700 },
  },
  advogado: {
    vida: 40, vel: 3.0, dano: 1, alcance: 2.4, recarga: 1.8, pontos: 10,
    humano: 'advogado',
    bola: { raio: 0.62, vel: 22, recarga: 3.2, alcance: 48, cor: 0xf5f5f0 },
  },
  pm: {
    vida: 34, vel: 3.6, dano: 1, alcance: 2.6, recarga: 1.5, pontos: 8,
    humano: 'pm',
    bola: { raio: 0.55, vel: 27, recarga: 2.8, alcance: 45, cor: 0x0d9488 },
  },
  optimus: {
    vida: 46, vel: 3.8, dano: 1, alcance: 2.4, recarga: 1.4, pontos: 12,
    humano: 'optimus',
    bola: { raio: 0.6, vel: 32, recarga: 2.4, alcance: 52, cor: 0xff4d4d },
  },
  clone: {
    vida: 38, vel: 4.4, dano: 1, alcance: 2.4, recarga: 1.3, pontos: 12,
    humano: 'clone',
    bola: { raio: 0.5, vel: 28, recarga: 2.5, alcance: 46, cor: 0x25d0ff },
  },
};

/** Fichas dos chefões. `fases` são os limiares de vida que mudam o padrão. */
export const CHEFES = {
  estagiario: {
    nome: 'ESTAGIÁRIO VIBE-CODER',
    vida: 210, vel: 4.0, dano: 1, alcance: 4.5, recarga: 1.7,
    pontos: 100, humano: 'estagiario', porte: 'medio',
    fases: [
      { ate: 1.00, rotulo: 'CUMPRINDO OKR',        chama: 2, tipo: 'drone', intervalo: 6.0 },
      { ate: 0.60, rotulo: 'PEDINDO REFORÇO',      chama: 3, tipo: 'drone', intervalo: 4.5 },
      { ate: 0.25, rotulo: 'DESESPERO POR EFETIVAÇÃO', chama: 4, tipo: 'drone', intervalo: 3.0 },
    ],
  },
  trunfo: {
    nome: 'DONALD TRUNFO', vida: 300, vel: 3.6, dano: 1, alcance: 4.5, recarga: 1.6,
    pontos: 250, humano: 'trunfo', porte: 'medio',
    fases: [
      // a cada troca de padrão ele "muda de opinião", como no roteiro
      { ate: 1.00, rotulo: 'REGULAMENTAÇÃO É CRIME', chama: 2, tipo: 'lobista', intervalo: 5.5 },
      { ate: 0.50, rotulo: 'EU INVENTEI A REGULAMENTAÇÃO', chama: 3, tipo: 'advogado', intervalo: 4.0 },
    ],
  },

  /**
   * O Trunfo COLOSSAL da fase 1, a céu aberto.
   *
   * Vida alta porque só míssil o machuca e a cadência do míssil é
   * baixa. Ele SAI DO CORCOVADO — o morro onde vai acabar agarrado no
   * Cristo — e marcha os ~650 m até o Labs IMG. `vel` é em m/s: a 9 m/s
   * a travessia leva ~72 s, e esse é o relógio real da fase.
   */
  trunfoGigante: {
    nome: 'DONALD TRUNFO', vida: 900, vel: 9, dano: 1, alcance: 20, recarga: 2.2,
    pontos: 400, humano: 'trunfo', porte: 'colossal', colossal: true, marcha: true,
    fases: [
      { ate: 1.00, rotulo: 'REGULAMENTAÇÃO É CRIME',        vel: 9,  canetada: 1, intervalo: 3.4 },
      { ate: 0.60, rotulo: 'EU INVENTEI A REGULAMENTAÇÃO',  vel: 12, canetada: 2, intervalo: 2.6 },
      /*
       * Último ato: encurralado, ele larga a marcha e SOBE O CORCOVADO
       * para se agarrar no Cristo. A pressão inverte — até aqui o
       * relógio corria contra você; agora ele está parado no ponto mais
       * alto do mapa e é você quem precisa chegar perto.
       */
      {
        // corre de volta morro acima: a fuga tem que ser rápida, senão
        // o último ato vira uma caminhada de dois minutos
        ate: 0.28, rotulo: 'AGARRADO NO CRISTO REDENTOR', vel: 26,
        canetada: 3, intervalo: 1.7,
        /*
         * FUNÇÃO, não objeto: `CORCOVADO.topY` só passa a existir quando
         * `Landmarks.build()` roda, e esta tabela é avaliada na CARGA do
         * módulo — bem antes disso. Como objeto literal, o `y` sairia
         * `undefined` e o colosso escalaria para NaN.
         */
        trepar: () => ({ x: CORCOVADO.x, z: CORCOVADO.z, y: CORCOVADO.topY - 6 }),
      },
    ],
  },

  ilon: {
    nome: 'ILON MOSCA', vida: 520, vel: 4.2, dano: 1, alcance: 13, recarga: 1.9,
    pontos: 250, humano: 'ilon', porte: 'grande',
    fases: [
      // fase 1: tuíta de cima mandando robô; fase 2: desce e briga
      { ate: 1.00, rotulo: 'TUITANDO DE CIMA', chama: 3, tipo: 'optimus', intervalo: 5.0 },
      { ate: 0.55, rotulo: 'DESCEU NO MECHA', chama: 2, tipo: 'optimus', intervalo: 3.6 },
      // "demite" os próprios robôs no fim: para de chamar reforço
      { ate: 0.20, rotulo: 'DEMITINDO OS PRÓPRIOS ROBÔS', chama: 0, intervalo: 99 },
    ],
  },

  samuca: {
    nome: 'SAMUCA ALTÍSSIMO', vida: 330, vel: 4.4, dano: 1, alcance: 4.5, recarga: 1.6,
    pontos: 250, humano: 'samuca', porte: 'medio',
    fases: [
      { ate: 1.00, rotulo: 'EXPERIÊNCIA ANTECIPADA DE COMBATE', chama: 2, tipo: 'pm', intervalo: 5.0 },
      { ate: 0.60, rotulo: 'ANUNCIANDO UM NOVO MODELO', chama: 3, tipo: 'pm', intervalo: 3.8 },
      { ate: 0.25, rotulo: 'PIVOTANDO', chama: 3, tipo: 'advogado', intervalo: 3.2 },
    ],
  },

  dario: {
    nome: 'DÁRIO AMÔ-DEI', vida: 560, vel: 3.6, dano: 1, alcance: 13, recarga: 2.0,
    pontos: 250, humano: 'dario', porte: 'grande',
    fases: [
      { ate: 1.00, rotulo: 'ASPIRANDO SEUS DADOS', chama: 2, tipo: 'crawler', intervalo: 4.8 },
      { ate: 0.55, rotulo: 'ENSAIO DE 15 MIL PALAVRAS', chama: 3, tipo: 'crawler', intervalo: 3.6 },
    ],
  },

  deepzeek: {
    nome: 'XI DEEP-ZEEK', vida: 950, vel: 7.5, dano: 1, alcance: 23, recarga: 2.2,
    pontos: 300, modelo: 'deepzeek', porte: 'colossal', voa: true, colossal: true,
    fases: [
      /*
       * Sem `canetada`: decreto de papel é assinatura do Trunfo. O
       * dragão usa a BOLA DE FOGO do porte colossal — seis metros de
       * diâmetro, que é o que se espera de um bicho desse tamanho.
       */
      { ate: 1.00, rotulo: 'GOLPES CATALOGADOS E CLONADOS', chama: 2, tipo: 'clone', vel: 7.5 },
      // solta o próprio modelo de graça: para de chamar clone contra você
      { ate: 0.40, rotulo: 'ABRIU O MODELO DE GRAÇA', chama: 0, vel: 9 },
    ],
  },
};

const _v = new THREE.Vector3();

// ---------------------------------------------------------------- inimigo
export class Foe {
  /**
   * @param {THREE.Group} pai   grupo da arena
   * @param {object} ficha      entrada de FICHAS ou CHEFES
   * @param {object} pos        {x,y,z} onde nasce
   */
  constructor(pai, ficha, pos, chefe = false) {
    this.ficha = ficha;
    this.chefe = chefe;
    this.vidaMax = ficha.vida;
    this.vida = ficha.vida;
    this.vivo = true;
    this.recarga = 0;
    this.t = Math.random() * 6;
    this.morteT = 0;

    if (ficha.humano) {
      const spec = { ...HUMANOIDES[ficha.humano] };
      if (ficha.escala) spec.escala = (spec.escala || 1) * ficha.escala;
      this.fig = new VoxelFigure(spec);
      if (!chefe) this.fig.sombraSimples();     // multidão: só tronco e cabeça
      this.root = this.fig.root;
      this.altura = ALTURA * (spec.escala || 1);
    } else {
      const def = MODELOS[ficha.modelo];
      const m = montarModelo(def);
      this.fig = null;
      this.modelo = m;
      this.root = m.root;
      this.altura = 1.2;
    }

    this.root.position.set(pos.x, pos.y + (ficha.voa || 0), pos.z);
    pai.add(this.root);

    // altura do centro para o teste de acerto da bala
    this.raioAcerto = chefe ? 1.5 : 1.0;
    this.alturaAlvo = ficha.voa ? 0.2 : this.altura * 0.55;

    // fase atual do chefão
    this.faseIdx = 0;
    this.chamaT = 0;
    /** Avisado quando ele atira: quem cria a bola é o `game.js`. */
    this.onBola = null;
  }

  get position() { return this.root.position; }
  get fracaoVida() { return Math.max(0, this.vida / this.vidaMax); }

  get faseAtual() {
    const fases = this.ficha.fases;
    if (!fases) return null;
    const f = this.fracaoVida;
    let atual = fases[0];
    for (const fa of fases) if (f <= fa.ate) atual = fa;
    return atual;
  }

  /**
   * @param {number} n
   * @param {boolean} _deMissil  ignorado aqui; só o colosso distingue a arma
   * @returns {boolean} true se morreu agora
   */
  dano(n, _deMissil = false) {
    if (!this.vivo) return false;
    this.vida -= n;
    if (this.fig) this.fig.levarDano();
    if (this.vida <= 0) {
      this.vivo = false;
      if (this.fig) this.fig.matar();
      return true;
    }
    return false;
  }

  /**
   * @param {THREE.Vector3} alvo  posição do jogador
   * @param {object} col          mundo de colisão (para achar o chão)
   * @returns {number} dano causado ao jogador neste quadro (0 ou dano)
   */
  update(dt, alvo, col, arena) {
    this.t += dt;

    if (!this.vivo) {
      this.morteT += dt;
      if (this.fig) this.fig.update(dt, 0);
      else this.modelo.corpo.rotation.z = Math.min(Math.PI / 2, this.modelo.corpo.rotation.z + dt * 5);
      // o corpo afunda e some
      if (this.morteT > 1.2) this.root.position.y -= dt * 1.6;
      return 0;
    }

    const p = this.root.position;
    const dx = alvo.x - p.x, dz = alvo.z - p.z;
    const distH = Math.hypot(dx, dz);
    const rumo = Math.atan2(dx, dz);
    this.root.rotation.y = rumo;

    let golpe = 0;
    this.recarga = Math.max(0, this.recarga - dt);

    /*
     * Quem tem BOLA para longe e atira; quem não tem vem para cima.
     * A distância de parada é 70% do alcance do tiro — perto o bastante
     * para acertar, longe o bastante para o jogador ter espaço de
     * desviar da bola que já está no ar.
     */
    const b = this.ficha.bola;
    const parar = b ? b.alcance * 0.7 : this.ficha.alcance * 0.85;
    let vel = 0;
    if (distH > parar) {
      vel = this.ficha.vel;
      const passo = Math.min(vel * dt, distH - parar);
      p.x += (dx / distH) * passo;
      p.z += (dz / distH) * passo;
      // não atravessa a parede da arena
      if (arena && !arena.dentro(p.x, p.z, -1)) {
        p.x -= (dx / distH) * passo;
        p.z -= (dz / distH) * passo;
      }
    } else if (this.recarga <= 0) {
      if (b && distH > this.ficha.alcance) {
        // ---- tiro: bola de fogo na direção do jogador
        this.recarga = b.recarga;
        if (this.fig) this.fig.golpear();
        if (this.onBola) this.onBola(this, b);
      } else {
        // ---- golpe corpo a corpo
        this.recarga = this.ficha.recarga;
        if (this.fig) this.fig.golpear();
        golpe = this.ficha.dano;
      }
    }

    // ---- altura: voador flutua, terrestre pisa no chão
    if (this.ficha.voa) {
      const base = col ? col.groundHeightAt(p.x, p.z, p.y) : 0;
      const alvoY = base + this.ficha.voa + Math.sin(this.t * 2.2) * 0.35;
      p.y += (alvoY - p.y) * Math.min(1, dt * 3);
      // inclina na direção do movimento, como drone de verdade
      this.modelo.corpo.rotation.x = -Math.min(0.35, vel * 0.05);
      for (const r of this.modelo.rotores) r.rotation.y += dt * 46;
    } else {
      const base = col ? col.groundHeightAt(p.x, p.z, p.y) : 0;
      p.y = base;
    }

    if (this.fig) this.fig.update(dt, vel);
    else if (this.modelo.asas) {
      const b = Math.sin(this.t * 14) * 0.7;
      if (this.modelo.asas[0]) this.modelo.asas[0].rotation.z = b;
      if (this.modelo.asas[1]) this.modelo.asas[1].rotation.z = -b;
    }

    return golpe;
  }

  remover() {
    if (this.fig) this.fig.dispose();
    else this.root.removeFromParent();
  }
}
