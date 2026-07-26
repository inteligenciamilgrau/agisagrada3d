import * as THREE from 'three';
import { VX, voxMaterial } from './voxel.js';

/**
 * ============================================================
 *  Moldes voxel — quem é quem
 * ============================================================
 *
 * Os valores são em VOXELS, na mesma régua da figura: y = 0 nos pés,
 * 32 no alto da cabeça. A frente é +Z (mesma convenção do `Human` da
 * cidade, onde `rotation.y = atan2(dx, dz)`), então rosto, crachá e
 * gravata ficam em z positivo.
 *
 * As descrições vieram dos prompts de sprite do jogo 2D — o chapéu do
 * Bob, a gravata vermelha comprida do Trunfo, o gorro de LED do Saci.
 * Traduzir para caixa obriga a escolher as 3 ou 4 marcas que
 * identificam o personagem à distância; é o mesmo exercício do pixel
 * art, com um eixo a mais.
 */

// ============================================================ humanoides
export const HUMANOIDES = {
  // ---------------------------------------------------------------- heróis
  bob: {
    nome: 'Bob',
    pele: 0xd9a066,
    torso: 0x6b4423,        // jaqueta de couro
    bracos: 0x6b4423,
    pernas: 0x3d4a5c,       // jeans
    extras: [
      // fedora: aba larga + copa. As duas peças juntas é o que lê como
      // "Indiana" de longe — só a copa viraria touca.
      { em: 'cabeca', w: 13, h: 1,   d: 13, y: 32.4, cor: 0x7a5c2e },
      { em: 'cabeca', w: 8.4, h: 3.4, d: 8.4, y: 34.2, cor: 0x8a6a36 },
      // óculos de nerd
      { em: 'cabeca', w: 8.4, h: 1.6, d: 0.6, y: 28.6, z: 4.1, cor: 0x14181f },
      // barba por fazer
      { em: 'cabeca', w: 6,   h: 1.8, d: 0.5, y: 25.6, z: 4.1, cor: 0x6b5238 },
      // mochila de expedição
      { em: 'torso',  w: 6,   h: 7,   d: 3,   y: 19, z: -3.4, cor: 0x4a3520 },
      // o Prompt Mágico: tablet-pergaminho dourado na mão direita
      { em: 'bracoD', w: 5, h: 6.5, d: 0.8, y: -11, z: 2.4, cor: 0xffb020,
        metal: 0.55, aspereza: 0.3, emissivo: 0.5 },
    ],
  },

  fefe: {
    nome: 'Fê-Fê Li',
    pele: 0xe0b48c,
    torso: 0x1f2937,        // blazer escuro
    bracos: 0x1f2937,
    pernas: 0x111827,
    extras: [
      { em: 'cabeca', w: 8.6, h: 5, d: 8.6, y: 30.5, cor: 0x1a1410 },       // cabelo
      // olhos-rótulo: a visão computacional que classifica o inimigo
      { em: 'cabeca', w: 8.4, h: 1.4, d: 0.6, y: 28.8, z: 4.1, cor: 0x25d0ff, emissivo: 1.4 },
    ],
  },

  escudeiro: {
    nome: 'Escudeiro Mil Grau',
    pele: 0xc98d5e,
    torso: 0x6d28d9,        // moletom roxo
    bracos: 0x6d28d9,
    pernas: 0x27303f,
    extras: [
      { em: 'cabeca', w: 8.6, h: 4, d: 8.6, y: 30.8, cor: 0x2a2018 },
      // headset gamer: arco + conchas
      { em: 'cabeca', w: 9.4, h: 1.2, d: 1.6, y: 32.3, cor: 0x14181f },
      { em: 'cabeca', w: 1.6, h: 3.4, d: 3.4, x: -4.6, y: 28.6, cor: 0x14181f },
      { em: 'cabeca', w: 1.6, h: 3.4, d: 3.4, x: 4.6,  y: 28.6, cor: 0x14181f },
      // chama do logo no peito
      { em: 'torso',  w: 4, h: 4, d: 0.5, y: 19, z: 2.3, cor: 0xffb020, emissivo: 0.8 },
      // teclado mecânico marreta
      { em: 'bracoD', w: 3, h: 8, d: 2.4, y: -12, cor: 0x2b3444 },
    ],
  },

  mira: {
    nome: 'Mira Mutante',
    pele: 0xdda87e,
    torso: 0x8a8f98,        // trench coat cinza
    bracos: 0x8a8f98,
    pernas: 0x3a4048,
    extras: [
      { em: 'cabeca', w: 8.6, h: 5, d: 8.6, y: 30.5, cor: 0x4a2f1c },
      { em: 'bracoE', w: 5, h: 4, d: 2.4, y: -11, cor: 0x5b4636 },          // maleta
    ],
  },

  curupira: {
    nome: 'CURUPIRA-1',
    escala: 0.8,
    pele: 0x3ddc84,
    cabecaCor: 0x1f2937,    // carinha de tela
    torso: 0x2f9e44,
    bracos: 0x2f9e44,
    pernas: 0xffd43b,
    extras: [
      // cabelo de fibra óptica cor de fogo
      { em: 'cabeca', w: 9, h: 3.4, d: 9, y: 32.6, cor: 0xff7a1a, emissivo: 1.1 },
      // a tela simpática
      { em: 'cabeca', w: 6, h: 3, d: 0.5, y: 28.6, z: 4.1, cor: 0x3ddc84, emissivo: 1.5 },
    ],
  },

  // ---------------------------------------------------------------- chefões
  estagiario: {
    nome: 'Estagiário Vibe-Coder',
    pele: 0xe8b98c,
    torso: 0x60a5fa,        // polo azul de consultoria
    bracos: 0x60a5fa,
    pernas: 0xb8a888,       // calça caqui
    extras: [
      { em: 'cabeca', w: 8.6, h: 4, d: 8.6, y: 30.8, cor: 0x2f2417 },
      // O crachá. É a piada inteira do personagem: três logos ao mesmo
      // tempo. Aqui vira uma plaquinha branca pendurada no peito.
      { em: 'torso',  w: 3.4, h: 4.4, d: 0.5, y: 17, z: 2.3, cor: 0xf5f5f5 },
      { em: 'torso',  w: 0.6, h: 3.4, d: 0.4, y: 21, z: 2.2, cor: 0xcbd5e1 },  // cordão
    ],
  },

  trunfo: {
    nome: 'Donald Trunfo',
    escala: 1.15,
    pele: 0xe8a34a,         // laranja, claro
    torso: 0x1e3a8a,        // terno azul grande demais
    bracos: 0x1e3a8a,
    pernas: 0x1e3a8a,
    extras: [
      // cabelo alaranjado armado
      { em: 'cabeca', w: 9, h: 3.2, d: 9, y: 32.4, cor: 0xf0a03c },
      // boné vermelho
      { em: 'cabeca', w: 9.2, h: 2.4, d: 9.2, y: 34, cor: 0xdc2626 },
      { em: 'cabeca', w: 9.2, h: 1,   d: 4,  y: 32.8, z: 5.5, cor: 0xdc2626 },
      // a gravata vermelha longa demais — a marca registrada
      { em: 'torso',  w: 2.2, h: 14, d: 0.6, y: 15, z: 2.3, cor: 0xb91c1c },
      // caneta dourada gigante das canetadas
      { em: 'bracoD', w: 1.6, h: 8, d: 1.6, y: -13, cor: 0xffd700, metal: 0.9, aspereza: 0.2 },
    ],
  },

  ilon: {
    nome: 'Ilon Mosca',
    escala: 1.05,
    pele: 0xdda87e,
    torso: 0x111318,        // camiseta preta
    bracos: 0x111318,
    pernas: 0x1f2937,       // jeans escuro
    extras: [
      { em: 'cabeca', w: 8.6, h: 4, d: 8.6, y: 30.8, cor: 0x24170f },
      // celular sempre na mão, tuitando
      { em: 'bracoD', w: 2.4, h: 4, d: 0.6, y: -11, z: 2, cor: 0x25d0ff, emissivo: 0.9 },
    ],
  },

  samuca: {
    nome: 'Samuca Altíssimo',
    escala: 1.05,
    pele: 0xe8bd97,
    torso: 0x9ca3af,        // suéter cinza caro
    bracos: 0x9ca3af,
    pernas: 0x4b5563,
    extras: [
      { em: 'cabeca', w: 8.6, h: 3.6, d: 8.6, y: 30.6, cor: 0x6b4f32 },
      // o asteriskozinho de "beneficial for humanity*", flutuando
      { em: 'cabeca', w: 2.6, h: 2.6, d: 0.6, y: 36, cor: 0xffd700, emissivo: 1.2 },
    ],
  },

  dario: {
    nome: 'Dário Amô-Dei',
    escala: 1.05,
    pele: 0xe0b189,
    torso: 0x1e3a5f,        // blazer marinho
    bracos: 0x1e3a5f,
    pernas: 0x2b3444,
    extras: [
      { em: 'cabeca', w: 9, h: 4.4, d: 9, y: 31, cor: 0x3f2d1e },          // cabelo cacheado
      // auréola falsa presa num pauzinho — ela é segurada, não merecida
      { em: 'cabeca', w: 7, h: 0.8, d: 7, y: 37, cor: 0xffd700, emissivo: 1.1 },
      { em: 'cabeca', w: 0.6, h: 4, d: 0.6, x: 3, y: 34.6, cor: 0x8a8f98 },
      // O ASPIRADOR DE DADOS nas costas: corpo + bocal + mangueira.
      { em: 'torso',  w: 6.5, h: 8, d: 4, y: 19, z: -4, cor: 0x374151, metal: 0.5, aspereza: 0.45 },
      { em: 'torso',  w: 3, h: 3, d: 3, y: 23.5, z: -4, cor: 0x25d0ff, emissivo: 0.9 },
      { em: 'torso',  w: 2, h: 2, d: 5, y: 16, z: 3, cor: 0x4b5563, metal: 0.4 },
    ],
  },

  // ---------------------------------------------------------------- capangas
  lobista: {
    nome: 'Lobista',
    pele: 0xd9a066,
    torso: 0x374151, bracos: 0x374151, pernas: 0x1f2937,
    extras: [
      { em: 'cabeca', w: 8.6, h: 3.6, d: 8.6, y: 30.6, cor: 0x2a2018 },
      { em: 'torso',  w: 1.8, h: 9, d: 0.5, y: 16, z: 2.3, cor: 0x9ca3af },   // gravata
      { em: 'bracoD', w: 4.4, h: 3.4, d: 1.8, y: -11, cor: 0x3a2a1a },        // maleta
    ],
  },

  advogado: {
    nome: 'Advogado',
    pele: 0xe8bd97,
    torso: 0x111827, bracos: 0x111827, pernas: 0x111827,
    extras: [
      { em: 'cabeca', w: 8.6, h: 3.4, d: 8.6, y: 30.5, cor: 0x4a4a4a },
      { em: 'torso',  w: 1.8, h: 9, d: 0.5, y: 16, z: 2.3, cor: 0x7f1d1d },
      // escudo de papel: a liminar
      { em: 'bracoE', w: 6, h: 7, d: 0.6, y: -11, z: 1.6, cor: 0xf5f5f0 },
    ],
  },

  pm: {
    nome: 'Product Manager',
    pele: 0xdda87e,
    torso: 0x0d9488, bracos: 0x0d9488, pernas: 0x334155,
    extras: [
      { em: 'cabeca', w: 8.6, h: 3.6, d: 8.6, y: 30.6, cor: 0x5a3a22 },
      // o roadmap enrolado, usado como bastão
      { em: 'bracoD', w: 1.8, h: 9, d: 1.8, y: -12, cor: 0xf5f5f0 },
    ],
  },

  optimus: {
    nome: 'Optimus',
    pele: 0xd4d8dd,
    cabecaCor: 0x14181f,
    torso: 0xe5e7eb, bracos: 0xd1d5db, pernas: 0x9ca3af,
    acabamento: { metal: 0.75, aspereza: 0.35 },
    extras: [
      // visor vermelho — o único ponto de cor num robô todo branco
      { em: 'cabeca', w: 7, h: 1.8, d: 0.6, y: 28.6, z: 4.1, cor: 0xff4d4d, emissivo: 1.4 },
    ],
  },

  clone: {
    nome: 'Clone Temu',
    // versão desbotada dos heróis: mesma silhueta, paleta lavada
    pele: 0xa89078,
    torso: 0x5a6b7a, bracos: 0x5a6b7a, pernas: 0x4a5560,
    extras: [
      { em: 'cabeca', w: 13, h: 1, d: 13, y: 32.4, cor: 0x6a6255 },
      { em: 'cabeca', w: 8.4, h: 3.4, d: 8.4, y: 34.2, cor: 0x726a5c },
    ],
  },
};

// ============================================================ modelos livres
/*
 * Nem todo personagem é gente. Drone, crawler e o dragão do Deep-Zeek
 * são listas cruas de caixas — mais simples que forçar um esqueleto
 * humanoide onde não cabe.
 */
export const MODELOS = {
  drone: {
    escala: 1,
    voa: true,
    pecas: [
      { w: 7, h: 2.5, d: 7, y: 0, cor: 0x2b3444, metal: 0.6, aspereza: 0.4 },
      { w: 3, h: 2, d: 3, y: 1.6, cor: 0x1a1f28, metal: 0.6 },
      // olho vermelho de vigilância
      { w: 2.2, h: 2.2, d: 0.6, y: 0.2, z: 3.6, cor: 0xff4d4d, emissivo: 1.6 },
      // braços dos rotores
      { w: 16, h: 0.7, d: 0.9, y: 1, cor: 0x39424f, metal: 0.5 },
      { w: 0.9, h: 0.7, d: 16, y: 1, cor: 0x39424f, metal: 0.5 },
    ],
    rotores: [                              // giram sozinhos
      { x: -7.2, y: 1.7, z: 0 }, { x: 7.2, y: 1.7, z: 0 },
      { x: 0, y: 1.7, z: -7.2 }, { x: 0, y: 1.7, z: 7.2 },
    ],
  },

  crawler: {
    escala: 1,
    pecas: [
      // corpo de caranguejo de scraping, baixo e largo
      { w: 9, h: 3.5, d: 7, y: 3.5, cor: 0x4b5563, metal: 0.55, aspereza: 0.45 },
      { w: 5, h: 2, d: 4, y: 6, cor: 0x374151, metal: 0.55 },
      { w: 1.8, h: 1.8, d: 0.6, x: -2, y: 4, z: 3.6, cor: 0xff7a1a, emissivo: 1.3 },
      { w: 1.8, h: 1.8, d: 0.6, x: 2,  y: 4, z: 3.6, cor: 0xff7a1a, emissivo: 1.3 },
      // seis perninhas
      { w: 1, h: 3.5, d: 1, x: -5, y: 1.8, z: 2.5, cor: 0x2b3444, metal: 0.6 },
      { w: 1, h: 3.5, d: 1, x: -5, y: 1.8, z: 0,   cor: 0x2b3444, metal: 0.6 },
      { w: 1, h: 3.5, d: 1, x: -5, y: 1.8, z: -2.5, cor: 0x2b3444, metal: 0.6 },
      { w: 1, h: 3.5, d: 1, x: 5,  y: 1.8, z: 2.5, cor: 0x2b3444, metal: 0.6 },
      { w: 1, h: 3.5, d: 1, x: 5,  y: 1.8, z: 0,   cor: 0x2b3444, metal: 0.6 },
      { w: 1, h: 3.5, d: 1, x: 5,  y: 1.8, z: -2.5, cor: 0x2b3444, metal: 0.6 },
    ],
  },

  loro: {
    nome: 'Loro Estocástico',
    escala: 1,
    voa: true,
    pecas: [
      // papagaio verde-neon: corpo, cabeça, bico, rabo
      { w: 4.5, h: 5.5, d: 4, y: 0, cor: 0x3ddc84 },
      { w: 4, h: 4, d: 4, y: 4.4, cor: 0x2fbf6f },
      { w: 1.8, h: 2, d: 2.4, y: 4, z: 2.8, cor: 0xffb020 },                 // bico
      // olhos espirais (a alucinação mora aqui)
      { w: 1.2, h: 1.2, d: 0.5, x: -1.2, y: 5.2, z: 2.1, cor: 0xffffff, emissivo: 0.9 },
      { w: 1.2, h: 1.2, d: 0.5, x: 1.2,  y: 5.2, z: 2.1, cor: 0xffffff, emissivo: 0.9 },
      { w: 2, h: 5, d: 1.2, y: -2, z: -2.4, cor: 0x25d0ff, rot: [0.5, 0, 0] }, // rabo azul
    ],
    asas: [                                  // batem enquanto voa
      { x: -2.8, y: 1.5, z: 0, w: 1.4, h: 4.5, d: 5 },
      { x: 2.8,  y: 1.5, z: 0, w: 1.4, h: 4.5, d: 5 },
    ],
  },

  deepzeek: {
    nome: 'Xi Deep-Zeek',
    escala: 1.4,
    voa: true,
    pecas: [
      // dragão-servidor: cabeça, corpo segmentado, escamas de placa solar
      { w: 8, h: 6, d: 10, y: 0, cor: 0x7f1d1d, metal: 0.5, aspereza: 0.4 },
      { w: 3, h: 2, d: 2, x: -2.4, y: 1.5, z: 5.4, cor: 0xff4d4d, emissivo: 1.6 },
      { w: 3, h: 2, d: 2, x: 2.4,  y: 1.5, z: 5.4, cor: 0xff4d4d, emissivo: 1.6 },
      { w: 9, h: 7, d: 9,  y: -1, z: -9,  cor: 0x991b1b, metal: 0.5 },
      { w: 8, h: 6, d: 8,  y: -2, z: -17, cor: 0x7f1d1d, metal: 0.5 },
      { w: 6, h: 5, d: 7,  y: -3, z: -24, cor: 0x631414, metal: 0.5 },
      // bigodes de néon
      { w: 0.8, h: 0.8, d: 9, x: -4.5, y: 1, z: 8, cor: 0x25d0ff, emissivo: 1.4 },
      { w: 0.8, h: 0.8, d: 9, x: 4.5,  y: 1, z: 8, cor: 0x25d0ff, emissivo: 1.4 },
    ],
  },

  sacibot: {
    nome: 'Saci-Bot',
    escala: 0.85,
    pecas: [
      { w: 7, h: 8, d: 5, y: 12, cor: 0x6b7280, metal: 0.6, aspereza: 0.45 },
      { w: 6, h: 6, d: 6, y: 19, cor: 0x4b5563, metal: 0.6 },
      // gorro de LED vermelho — o Saci
      { w: 6.6, h: 3, d: 6.6, y: 23, cor: 0xdc2626, emissivo: 0.7 },
      { w: 5, h: 1.5, d: 0.6, y: 19, z: 3.1, cor: 0xffb020, emissivo: 1.3 },
      // a perna única + turbina
      { w: 3.5, h: 8, d: 3.5, y: 4, cor: 0x9ca3af, metal: 0.7 },
      { w: 5, h: 3, d: 5, y: 0.5, cor: 0x25d0ff, emissivo: 1.1 },
      { w: 2.5, h: 6, d: 2.5, x: -5, y: 13, cor: 0x9ca3af, metal: 0.6 },
      { w: 2.5, h: 6, d: 2.5, x: 5,  y: 13, cor: 0x9ca3af, metal: 0.6 },
    ],
  },
};

/**
 * Monta um modelo livre. Devolve `{ root, rotores, asas }` — quem
 * anima decide o que fazer com as partes móveis.
 */
export function montarModelo(def) {
  const root = new THREE.Group();
  const corpo = new THREE.Group();
  corpo.scale.setScalar(def.escala || 1);
  root.add(corpo);

  const caixa = (p) => {
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(p.w * VX, p.h * VX, p.d * VX),
      voxMaterial(p.cor, {
        metal: p.metal || 0,
        aspereza: p.aspereza ?? 0.85,
        emissivo: p.emissivo || 0,
      }),
    );
    m.position.set((p.x || 0) * VX, (p.y || 0) * VX, (p.z || 0) * VX);
    if (p.rot) m.rotation.set(p.rot[0] || 0, p.rot[1] || 0, p.rot[2] || 0);
    m.castShadow = true;
    return m;
  };

  for (const p of def.pecas) corpo.add(caixa(p));

  const rotores = [];
  for (const r of def.rotores || []) {
    const g = new THREE.Group();
    g.position.set(r.x * VX, r.y * VX, r.z * VX);
    const pa = new THREE.Mesh(
      new THREE.BoxGeometry(7 * VX, 0.35 * VX, 0.9 * VX),
      voxMaterial(0x1a1f28, { metal: 0.4, aspereza: 0.5 }),
    );
    g.add(pa);
    corpo.add(g);
    rotores.push(g);
  }

  const asas = [];
  for (const a of def.asas || []) {
    const g = new THREE.Group();
    g.position.set(a.x * VX, a.y * VX, a.z * VX);
    const asa = new THREE.Mesh(
      new THREE.BoxGeometry(a.w * VX, a.h * VX, a.d * VX),
      voxMaterial(0x2fbf6f),
    );
    asa.castShadow = true;
    g.add(asa);
    corpo.add(g);
    asas.push(g);
  }

  return { root, corpo, rotores, asas };
}
