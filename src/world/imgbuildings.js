import * as THREE from 'three';
import { CURB_H, BLOCK_INNER } from '../config.js';
import { voxMaterial } from '../ent/voxel.js';

/**
 * ============================================================
 *  Os prédios da comunidade: Estúdio IMG e Labs IMG
 * ============================================================
 *
 * Os dois pontos onde a campanha começa e termina eram só coordenadas
 * soltas — e caíam no MIOLO DE UM QUARTEIRÃO, ou seja, dentro de um
 * prédio genérico. O portal existia num lugar sem porta: o jogador via
 * o feixe de luz e não tinha como chegar nele.
 *
 * A malha explica o acidente: os cruzamentos ficam em múltiplos de 64 a
 * partir de −224 (−224, −160, −96, −32, 32, 96, 160, 224), então (0,0)
 * e (0,64) não são rua nenhuma — são exatamente o centro de um
 * quarteirão. Escolher coordenada "redonda" achando que era esquina foi
 * o erro.
 *
 * Agora cada um é um GALPÃO de verdade, com fachada, **porta** e um hall
 * onde o portal fica. O quarteirão é reservado antes da geração dos
 * prédios, pelo mesmo caminho que o heliporto já usava.
 */

/** Altura do piso interno (o mesmo da calçada). */
const PISO = CURB_H;

/**
 * Constrói um galpão com porta e hall.
 *
 * A colisão da fachada é dividida em DOIS trechos, deixando o vão da
 * porta livre — é isso que transforma "prédio com desenho de porta" em
 * "prédio em que se entra". Sem o vão, a porta seria pintura.
 */
function galpao(scene, col, spec) {
  const { cx, cz, larg, prof, alt, corParede, corTeto, nome } = spec;
  const g = new THREE.Group();
  scene.add(g);

  const hl = larg / 2, hp = prof / 2;
  const E = 0.6;                       // espessura da parede
  const PORTA_W = 7;                   // vão da porta, generoso para entrar correndo
  const PORTA_H = 5.2;

  const parede = voxMaterial(corParede, { aspereza: 0.9 });
  const teto = voxMaterial(corTeto, { aspereza: 0.85, metal: 0.25 });
  const piso = voxMaterial(0x3a3f47, { aspereza: 0.95 });
  const concreto = voxMaterial(0x8d8f93, { aspereza: 0.92 });

  const caixa = (mat, w, h, d, x, y, z, sombra = true) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    m.castShadow = sombra; m.receiveShadow = true;
    g.add(m);
    return m;
  };

  // ---- piso
  caixa(piso, larg, 0.3, prof, cx, PISO - 0.15, cz, false);

  // ---- fachada (frente = +Z, virada para a rua) com o VÃO DA PORTA
  const ladoW = (larg - PORTA_W) / 2;
  for (const s of [-1, 1]) {
    caixa(parede, ladoW, alt, E, cx + s * (PORTA_W / 2 + ladoW / 2), PISO + alt / 2, cz + hp);
  }
  // verga por cima da porta
  caixa(parede, PORTA_W, alt - PORTA_H, E, cx, PISO + PORTA_H + (alt - PORTA_H) / 2, cz + hp);

  // ---- demais paredes
  caixa(parede, larg, alt, E, cx, PISO + alt / 2, cz - hp);
  caixa(parede, E, alt, prof, cx - hl, PISO + alt / 2, cz);
  caixa(parede, E, alt, prof, cx + hl, PISO + alt / 2, cz);

  // ---- telhado de duas águas
  const ANG = 0.22;
  for (const s of [-1, 1]) {
    const t = caixa(teto, larg + 1.4, 0.35, prof / 2 / Math.cos(ANG) + 0.8,
      cx, PISO + alt + Math.sin(ANG) * prof / 4 + 0.2, cz + s * prof / 4);
    t.rotation.x = -s * ANG;
  }

  // ---- soleira e batentes: dão leitura de porta mesmo de longe
  caixa(concreto, PORTA_W + 1.2, 0.22, 1.6, cx, PISO + 0.05, cz + hp + 0.4, false);
  for (const s of [-1, 1]) {
    caixa(concreto, 0.5, PORTA_H, 0.7, cx + s * (PORTA_W / 2 + 0.25), PISO + PORTA_H / 2, cz + hp);
  }

  // ---- letreiro
  const letreiro = voxMaterial(0xffb020, { emissivo: 1.1 });
  caixa(letreiro, larg * 0.55, 1.1, 0.35, cx, PISO + alt + 1.0, cz + hp + 0.1, false);

  /*
   * ---- COLISÃO ----
   * As paredes bloqueiam; o vão da porta NÃO recebe colisor, e é por ali
   * que se entra. A verga acima da porta também fica de fora: ela está a
   * 5,2 m, bem acima da cabeça, e um colisor ali barraria quem passa.
   */
  const top = PISO + alt;
  for (const s of [-1, 1]) {
    col.addBox(cx + s * (PORTA_W / 2 + ladoW / 2), cz + hp, ladoW / 2, E, top, 'img', PISO - 1);
  }
  col.addBox(cx, cz - hp, hl, E, top, 'img', PISO - 1);
  col.addBox(cx - hl, cz, E, hp, top, 'img', PISO - 1);
  col.addBox(cx + hl, cz, E, hp, top, 'img', PISO - 1);
  // piso interno caminhável
  col.addPlatform(cx - hl, cz - hp, cx + hl, cz + hp, () => PISO);

  return { g, caixa, hl, hp, alt, nome };
}

/** Recheio do Labs IMG: gambiarra high-tech, como manda o roteiro. */
function recheioLabs(b, cx, cz) {
  const { caixa } = b;
  const metal = voxMaterial(0x4b5563, { metal: 0.7, aspereza: 0.4 });
  const madeira = voxMaterial(0x6b4423, { aspereza: 0.8 });
  const verde = voxMaterial(0x3ddc84, { emissivo: 1.2 });
  const amarelo = voxMaterial(0xffd43b, { emissivo: 0.5 });
  const azul = voxMaterial(0x25d0ff, { emissivo: 1.1 });
  const branco = voxMaterial(0xf2f2ee, { aspereza: 0.9 });

  // racks de GPU empilhados nas laterais, com LED verde
  for (const s of [-1, 1]) {
    for (let k = -1; k <= 1; k++) {
      const rx = cx + s * (b.hl - 2.4), rz = cz + k * 5.5;
      caixa(metal, 2.2, 5.2, 3.2, rx, PISO + 2.6, rz);
      for (let i = 0; i < 5; i++) {
        caixa(verde, 1.9, 0.16, 0.12, rx, PISO + 0.9 + i * 0.9, rz + s * 1.7, false);
      }
    }
  }
  // bandeira do Brasil no fundo
  caixa(verde, 7, 4.6, 0.2, cx, PISO + 5.4, cz - b.hp + 0.5, false);
  caixa(amarelo, 4.6, 2.8, 0.24, cx, PISO + 5.4, cz - b.hp + 0.42, false);
  caixa(azul, 1.9, 1.9, 0.28, cx, PISO + 5.4, cz - b.hp + 0.36, false);
  // quadro branco com as fórmulas (e a capivara)
  caixa(branco, 6.5, 3.2, 0.16, cx - b.hl + 1.2, PISO + 3.4, cz + 4, false);
  // mesa de mutirão no meio, com fita isolante
  caixa(madeira, 9, 0.4, 3.4, cx, PISO + 1.5, cz - 2);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    caixa(metal, 0.3, 1.3, 0.3, cx + sx * 4, PISO + 0.65, cz - 2 + sz * 1.4);
  }
}

/** Recheio do Estúdio IMG: bancada, monitores e ring light. */
function recheioEstudio(b, cx, cz) {
  const { caixa } = b;
  const madeira = voxMaterial(0x6b4423, { aspereza: 0.75 });
  const preto = voxMaterial(0x14181f, { aspereza: 0.6 });
  const tela = voxMaterial(0x25d0ff, { emissivo: 1.3 });
  const roxo = voxMaterial(0x6d28d9, { emissivo: 0.6 });

  caixa(madeira, 8, 0.5, 2.6, cx, PISO + 1.4, cz - 4);
  for (let i = -1; i <= 1; i++) {
    caixa(preto, 2.3, 1.4, 0.2, cx + i * 2.7, PISO + 2.6, cz - 5.2);
    caixa(tela, 2.0, 1.15, 0.06, cx + i * 2.7, PISO + 2.6, cz - 5.1, false);
  }
  // painel de LED roxo do canal
  caixa(roxo, 12, 0.22, 0.22, cx, PISO + 6.2, cz - b.hp + 0.4, false);
  for (const s of [-1, 1]) caixa(roxo, 0.22, 3.6, 0.22, cx + s * 6, PISO + 4.4, cz - b.hp + 0.4, false);
  // ring light
  const aro = new THREE.Mesh(
    new THREE.TorusGeometry(1.3, 0.14, 8, 26),
    voxMaterial(0xfff4d0, { emissivo: 1.4 }),
  );
  aro.position.set(cx - 5, PISO + 3.6, cz + 1);
  b.g.add(aro);
}

/**
 * Ergue os dois prédios da comunidade nos quarteirões reservados.
 * Devolve os pontos de portal — que ficam DENTRO do hall, logo depois
 * da porta.
 */
export class IMGBuildings {
  constructor(scene, col) {
    this.scene = scene;
    this.col = col;
    this.pontos = {};
  }

  build(city) {
    const larg = BLOCK_INNER - 4;      // 32 m: sobra recuo até a calçada
    const prof = BLOCK_INNER - 8;      // 28 m

    for (const spec of [
      { chave: 'labs', bloco: city.labsBlock, corParede: 0x9aa3ad, corTeto: 0x6b7280,
        alt: 9, recheio: recheioLabs },
      { chave: 'estudio', bloco: city.studioBlock, corParede: 0x2f3540, corTeto: 0x1d2129,
        alt: 8, recheio: recheioEstudio },
    ]) {
      if (!spec.bloco) continue;
      const { cx, cz } = spec.bloco;
      const b = galpao(this.scene, this.col, {
        cx, cz, larg, prof, alt: spec.alt,
        corParede: spec.corParede, corTeto: spec.corTeto,
      });
      spec.recheio(b, cx, cz);

      /*
       * O portal fica NO HALL, três metros depois da porta: perto o
       * bastante para se ver da rua pelo vão, e dentro o bastante para
       * o jogador ter de entrar de fato.
       */
      this.pontos[spec.chave] = { x: cx, y: PISO, z: cz + prof / 2 - 3.5 };
    }
    return this.pontos;
  }
}
