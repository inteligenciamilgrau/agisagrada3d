import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { makeRng, rngRange, rngInt, clamp, lerp, smoothstep } from '../utils.js';
import { terrainHeight } from './terrain.js';
import {
  cobbleTexture, cobbleNormal, stuccoTexture, roofTileTexture, roofTileNormal,
  azulejoTexture, steelTexture, steelNormal, concreteTexture, curtainWallTexture,
  asphaltTexture, glowTexture,
} from '../gfx/textures.js';

/**
 * Marcos brasileiros fora do Rio, espalhados pelo mapa:
 *
 *   [57] Ponte Hercílio Luz (Florianópolis) — atravessa o lago
 *   [58] Museu Oscar Niemeyer, o "Museu do Olho" (Curitiba)
 *   [59] Pelourinho (Salvador)
 *
 * Todos ficam em terreno aberto, longe da malha da cidade, para não brigarem
 * com os quarteirões nem com a estrada do Corcovado. Cada um traz a sua
 * colisão, e os dois que dá para pisar (a ponte e a praça do Pelourinho)
 * registram plataforma caminhável.
 *
 * ---------------------------------------------------------------------------
 * COMO A GEOMETRIA É MONTADA
 *
 * Tudo é construído como listas de `BufferGeometry` agrupadas POR MATERIAL e
 * fundidas com `mergeGeometries` no fim. Um sobrado colonial tem umas 90
 * peças (batentes, bandeiras, balaústres, cimalha, telha); com uma malha por
 * peça seriam milhares de draw calls só na praça. Fundido por material, o
 * Pelourinho inteiro sai em menos de uma dúzia.
 *
 * O detalhe fino (rebite, junta de pedra, canaleta da telha, caixilho do
 * vidro) vai em TEXTURA + normal map, não em geometria. Nessa escala a imagem
 * é a mesma e o custo é incomparável.
 */

// ------------------------------------------------------------------ [57] ponte
/**
 * A ponte cruza o lago a leste da ponte de concreto da cidade (que fica em
 * x = -32). O vão central, entre as torres, é o trecho reto e alto; z0/z3 são
 * os encontros em terra firme, onde o tabuleiro desce até o chão.
 */
export const HERCILIO = {
  x: 62,
  z0: 244, z1: 302, z2: 422, z3: 480,
  deckY: 11.5,
  halfW: 5.2,
  towerH: 26,        // altura da torre acima do tabuleiro
  midChain: 12,      // onde a corrente e a treliça se encontram no meio do vão
};

/** [58] Museu do Olho, a oeste da cidade. */
export const MON = { x: -430, z: 128, rot: 0.42 };

/** [59] Pelourinho, ao norte da cidade. */
export const PELOURINHO = { x: -110, z: -432, rot: -0.25 };

/**
 * Funde uma lista de geometrias com segurança.
 *
 * `mergeGeometries` devolve **null** (só com um aviso no console) se a lista
 * misturar geometria indexada com não-indexada — e é exatamente o que
 * acontece ao juntar um `ExtrudeGeometry`, que nasce sem índice, com caixas e
 * toros, que nascem com. O sintoma é longe da causa: o erro aparece lá na
 * frente, dentro do construtor de `Mesh`, reclamando de `morphAttributes` de
 * uma geometria nula. Aqui a lista é normalizada antes.
 */
function fundir(geos) {
  const indexadas = geos.map((g) => !!g.index);
  const mistura = indexadas.some((v) => v !== indexadas[0]);
  const lista = mistura ? geos.map((g) => (g.index ? g.toNonIndexed() : g)) : geos;
  return mergeGeometries(lista, false);
}

/** Repete uma textura sem estragar a original (o cache é compartilhado). */
function rep(tex, u, v = u) {
  const t = tex.clone();
  t.needsUpdate = true;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(u, v);
  return t;
}

export class BrazilLandmarks {
  constructor(scene, collision, seed = 8712) {
    this.scene = scene;
    this.col = collision;
    this.rng = makeRng(seed);
    this.group = new THREE.Group();
    this.group.name = 'marcos-brasil';
    scene.add(this.group);
    /** Materiais que acendem à noite (janelas, lampiões, vitrine do museu). */
    this.nightMats = [];
    /** Sprites de halo que só aparecem à noite. */
    this.nightGlows = [];
  }

  build() {
    this._herciliLuz();       // [57]
    this._museuDoOlho();      // [58]
    this._pelourinho();       // [59]
  }

  /** Registra um material para acender junto com a noite. */
  _acende(mat, pico) {
    this.nightMats.push({ mat, pico });
    return mat;
  }

  // ==================================================================
  //  [57] Ponte Hercílio Luz
  // ==================================================================
  /**
   * A silhueta que identifica a ponte é a "lente" entre as duas torres: a
   * corrente de barras desce das torres até o meio do vão enquanto a treliça
   * de rigidez sobe do tabuleiro para o mesmo ponto. As duas se encontram no
   * centro, e é esse losango que se reconhece de longe.
   *
   * O que dá a leitura de ponte METÁLICA, e não de viga lisa pintada de
   * cinza, é a treliça: montantes e diagonais em X nos dois banzos, torres
   * treliçadas em vez de pilares chapados, e a corrente feita de elos
   * separados por placas. De perto se veem os rebites (que são textura).
   */
  _herciliLuz() {
    const H = HERCILIO;
    H.yA = terrainHeight(H.x, H.z0);
    H.yB = terrainHeight(H.x, H.z3);

    const aco = new THREE.MeshStandardMaterial({
      map: rep(steelTexture(), 3), normalMap: rep(steelNormal(), 3),
      color: 0xcdd3d8, roughness: 0.52, metalness: 0.82,
    });
    aco.normalScale.set(0.7, 0.7);
    const concreto = new THREE.MeshStandardMaterial({
      map: rep(concreteTexture(), 2), color: 0xa8a49b, roughness: 0.94, metalness: 0.02,
    });
    const asfalto = new THREE.MeshStandardMaterial({
      map: rep(asphaltTexture(), 1, 14), roughness: 0.95, metalness: 0.02,
    });

    const alturaEm = (z) => deckYHercilio(z);
    const estrutura = [];      // tudo que é aço
    const obra = [];           // concreto

    // ---------------------------------------------------------- tabuleiro
    const piso = [];
    const trecho = (za, zb, ya, yb) => {
      const L = Math.hypot(zb - za, yb - ya);
      const g = new THREE.BoxGeometry(H.halfW * 2, 0.7, L);
      g.rotateX(-Math.atan2(yb - ya, zb - za));
      g.translate(0, (ya + yb) / 2 - 0.35, (za + zb) / 2);
      piso.push(g);
    };
    trecho(H.z0, H.z1, H.yA, H.deckY);
    trecho(H.z1, H.z2, H.deckY, H.deckY);
    trecho(H.z2, H.z3, H.deckY, H.yB);
    const deck = new THREE.Mesh(fundir(piso), asfalto);
    deck.position.x = H.x;
    deck.receiveShadow = true; deck.castShadow = true;
    deck.name = 'hercilio-tabuleiro';
    this.group.add(deck);

    // vigas transversais por baixo do tabuleiro
    for (let z = H.z0 + 3; z < H.z3; z += 6) {
      const y = alturaEm(z);
      const v = new THREE.BoxGeometry(H.halfW * 2 + 0.6, 0.55, 0.4);
      v.translate(0, y - 0.95, z);
      estrutura.push(v);
    }
    // longarinas
    for (const s of [-1, 1]) {
      for (const [za, zb, ya, yb] of [
        [H.z0, H.z1, H.yA, H.deckY], [H.z1, H.z2, H.deckY, H.deckY], [H.z2, H.z3, H.deckY, H.yB],
      ]) {
        const L = Math.hypot(zb - za, yb - ya);
        const g = new THREE.BoxGeometry(0.35, 0.7, L);
        g.rotateX(-Math.atan2(yb - ya, zb - za));
        g.translate(s * (H.halfW - 0.3), (ya + yb) / 2 - 1.0, (za + zb) / 2);
        estrutura.push(g);
      }
    }

    // ---------------------------------------------------------- encontros e pilares
    /*
     * Encontros: o bloco que recebe o tabuleiro em terra firme.
     *
     * Ele fica INTEIRAMENTE ABAIXO do tabuleiro, quase todo enterrado, que é
     * onde um encontro de ponte fica. Na primeira versão era uma caixa alta
     * centrada no eixo da pista: subia 3,6 m acima do asfalto e virava um
     * paredão atravessado bem na boca da ponte.
     *
     * O que aparece de fora são as duas alas laterais, baixas, que guiam a
     * entrada em vez de fechá-la.
     */
    for (const [z, y] of [[H.z0, H.yA], [H.z3, H.yB]]) {
      const paraDentro = z === H.z0 ? 1 : -1;
      const ALT = 6;
      const enc = new THREE.BoxGeometry(H.halfW * 2 + 3, ALT, 8);
      enc.translate(0, y - 0.7 - ALT / 2, z + paraDentro * 1.5);
      obra.push(enc);

      for (const s of [-1, 1]) {
        const ala = new THREE.BoxGeometry(0.9, 1.5, 9);
        ala.translate(s * (H.halfW + 0.9), y + 0.4, z + paraDentro * 2.5);
        obra.push(ala);
      }
    }
    for (const [za, zb] of [[H.z0, H.z1], [H.z2, H.z3]]) {
      for (let z = za + 14; z < zb - 5; z += 18) {
        const topo = alturaEm(z) - 1.3;
        const solo = terrainHeight(H.x, z);
        const h = topo - solo;
        if (h < 1.5) continue;
        // pilar em pórtico: duas colunas e uma travessa
        for (const s of [-1, 1]) {
          const p = new THREE.CylinderGeometry(0.85, 1.15, h, 12);
          p.translate(s * (H.halfW - 1.0), solo + h / 2, z);
          obra.push(p);
        }
        const trav = new THREE.BoxGeometry(H.halfW * 2 - 0.4, 1.0, 1.4);
        trav.translate(0, topo - 0.3, z);
        obra.push(trav);
      }
    }

    // ---------------------------------------------------------- torres treliçadas
    const topoTorre = H.deckY + H.towerH;
    for (const z of [H.z1, H.z2]) {
      const baseY = terrainHeight(H.x, z);
      for (const s of [-1, 1]) {
        // duas pernas por lado, formando torre de seção quadrada
        for (const dz of [-1.5, 1.5]) {
          const perna = new THREE.BoxGeometry(0.9, topoTorre - baseY, 0.9);
          perna.translate(s * H.halfW, (baseY + topoTorre) / 2, z + dz);
          estrutura.push(perna);
        }
        // treliça em X entre as duas pernas, painel por painel
        const PAINEIS = 8;
        const y0 = H.deckY - 2, dyP = (topoTorre - y0) / PAINEIS;
        for (let i = 0; i < PAINEIS; i++) {
          const ya = y0 + i * dyP, yb = ya + dyP;
          const comp = Math.hypot(3, dyP);
          for (const dir of [1, -1]) {
            const d = new THREE.BoxGeometry(0.34, comp, 0.34);
            d.rotateX(dir * Math.atan2(3, dyP));
            d.translate(s * H.halfW, (ya + yb) / 2, z);
            estrutura.push(d);
          }
          const trav = new THREE.BoxGeometry(0.42, 0.42, 3);
          trav.translate(s * H.halfW, yb, z);
          estrutura.push(trav);
        }
      }
      // pórtico: travessas ligando os dois lados
      for (const y of [H.deckY + 6, H.deckY + 16, topoTorre]) {
        const t = new THREE.BoxGeometry(H.halfW * 2, 1.0, 1.2);
        t.translate(0, y, z);
        estrutura.push(t);
        // contraventamento em X do pórtico
        if (y !== topoTorre) continue;
        for (const dir of [1, -1]) {
          const comp = Math.hypot(H.halfW * 2, 10);
          const d = new THREE.BoxGeometry(comp, 0.3, 0.3);
          d.rotateZ(dir * Math.atan2(10, H.halfW * 2));
          d.translate(0, y - 5, z);
          estrutura.push(d);
        }
      }
      this.col.addCircle(H.x - H.halfW, z, 1.6, topoTorre, 'ponte');
      this.col.addCircle(H.x + H.halfW, z, 1.6, topoTorre, 'ponte');
    }

    // ---------------------------------------------------------- corrente e treliça
    const N = 24;
    const corrente = [], banzo = [];
    for (let i = 0; i <= N; i++) {
      const u = i / N;
      const z = lerp(H.z1, H.z2, u);
      const arco = Math.sin(Math.PI * u);
      corrente.push(new THREE.Vector3(0, topoTorre - (H.towerH - H.midChain) * arco, z));
      banzo.push(new THREE.Vector3(0, H.deckY + H.midChain * arco, z));
    }

    for (const s of [-1, 1]) {
      const X = s * H.halfW;

      /*
       * A corrente é feita de ELOS: barras chatas entre placas de ligação. Um
       * tubo liso funcionaria de longe, mas é justamente o serrilhado dos elos
       * que dá escala à ponte quando se voa rente a ela.
       */
      for (let i = 0; i < N; i++) {
        const a = corrente[i], b = corrente[i + 1];
        const comp = Math.hypot(b.z - a.z, b.y - a.y);
        for (const off of [-0.28, 0.28]) {
          const elo = new THREE.BoxGeometry(0.16, 0.42, comp * 0.94);
          elo.rotateX(-Math.atan2(b.y - a.y, b.z - a.z));
          elo.translate(X + off, (a.y + b.y) / 2, (a.z + b.z) / 2);
          estrutura.push(elo);
        }
        // placa do nó
        const no = new THREE.BoxGeometry(0.9, 0.9, 0.34);
        no.translate(X, b.y, b.z);
        estrutura.push(no);
      }

      // banzo superior da treliça de rigidez
      for (let i = 0; i < N; i++) {
        const a = banzo[i], b = banzo[i + 1];
        const comp = Math.hypot(b.z - a.z, b.y - a.y);
        const g = new THREE.BoxGeometry(0.42, 0.5, comp);
        g.rotateX(-Math.atan2(b.y - a.y, b.z - a.z));
        g.translate(X, (a.y + b.y) / 2, (a.z + b.z) / 2);
        estrutura.push(g);
      }

      // montantes + diagonais em X, painel a painel
      for (let i = 0; i < N; i++) {
        const a = banzo[i], b = banzo[i + 1];
        const passo = b.z - a.z;
        const hA = a.y - H.deckY, hB = b.y - H.deckY;
        if (hA > 0.6) {
          const m = new THREE.BoxGeometry(0.32, hA, 0.32);
          m.translate(X, H.deckY + hA / 2, a.z);
          estrutura.push(m);
        }
        const hMed = (hA + hB) / 2;
        if (hMed > 1.2) {
          for (const dir of [1, -1]) {
            const comp = Math.hypot(passo, hMed);
            const d = new THREE.BoxGeometry(0.26, comp, 0.26);
            d.rotateX(dir * Math.atan2(passo, hMed));
            d.translate(X, H.deckY + hMed / 2, a.z + passo / 2);
            estrutura.push(d);
          }
        }
        // pendural: liga a corrente ao banzo
        if (i % 2 === 0) {
          const c = corrente[i];
          const h = c.y - banzo[i].y;
          if (h > 0.8) {
            const p = new THREE.CylinderGeometry(0.11, 0.11, h, 6);
            p.translate(X, banzo[i].y + h / 2, c.z);
            estrutura.push(p);
          }
        }
      }
    }
    // travejamento superior entre as duas correntes
    for (let i = 2; i < N - 1; i += 3) {
      const c = corrente[i];
      const g = new THREE.BoxGeometry(H.halfW * 2, 0.3, 0.3);
      g.translate(0, c.y, c.z);
      estrutura.push(g);
      for (const dir of [1, -1]) {
        const comp = Math.hypot(H.halfW * 2, 9);
        const d = new THREE.BoxGeometry(comp, 0.2, 0.2);
        d.rotateY(dir * Math.atan2(9, H.halfW * 2));
        d.translate(0, c.y, c.z + 4.5);
        estrutura.push(d);
      }
    }

    // ---------------------------------------------------------- treliça dos acessos
    for (const [za, zb] of [[H.z0, H.z1], [H.z2, H.z3]]) {
      for (const s of [-1, 1]) {
        const X = s * H.halfW;
        for (let z = za; z < zb - 4; z += 6) {
          const yA = alturaEm(z), yB = alturaEm(z + 6);
          const alturaViga = 1.8;
          const sup = new THREE.BoxGeometry(0.3, 0.34, 6.2);
          sup.rotateX(-Math.atan2(yB - yA, 6));
          sup.translate(X, (yA + yB) / 2 - alturaViga, z + 3);
          estrutura.push(sup);
          for (const dir of [1, -1]) {
            const comp = Math.hypot(6, alturaViga);
            const d = new THREE.BoxGeometry(0.22, 0.22, comp);
            d.rotateX(dir * Math.atan2(alturaViga, 6));
            d.translate(X, (yA + yB) / 2 - alturaViga / 2 - 0.35, z + 3);
            estrutura.push(d);
          }
        }
      }
    }

    // ---------------------------------------------------------- guarda-corpo e lampiões
    for (let z = H.z0 + 2; z < H.z3; z += 3) {
      const y = alturaEm(z);
      for (const s of [-1, 1]) {
        const g = new THREE.BoxGeometry(0.16, 1.1, 0.16);
        g.translate(s * H.halfW, y + 0.55, z);
        estrutura.push(g);
        this.col.addCircle(H.x + s * H.halfW, z, 0.6, y + 1.05, 'rail', y - 0.8);
      }
      // corrimão contínuo
      for (const s of [-1, 1]) {
        for (const hy of [0.55, 1.05]) {
          const c = new THREE.BoxGeometry(0.1, 0.1, 3);
          c.translate(s * H.halfW, y + hy, z + 1.5);
          estrutura.push(c);
        }
      }
    }

    const aco3d = new THREE.Mesh(fundir(estrutura), aco);
    aco3d.position.x = H.x;
    aco3d.castShadow = true; aco3d.receiveShadow = true;
    aco3d.name = 'hercilio-estrutura';
    this.group.add(aco3d);

    const obra3d = new THREE.Mesh(fundir(obra), concreto);
    obra3d.position.x = H.x;
    obra3d.castShadow = true; obra3d.receiveShadow = true;
    obra3d.name = 'hercilio-concreto';
    this.group.add(obra3d);

    /*
     * Iluminação noturna: a ponte de verdade é conhecida pelo contorno aceso.
     * São materiais emissivos (custo zero) e não luzes reais — cada PointLight
     * pesa em todo fragmento iluminado da cena.
     */
    const lampMat = this._acende(new THREE.MeshStandardMaterial({
      color: 0x2a2a22, emissive: 0xffd9a0, emissiveIntensity: 0, toneMapped: true,
    }), 2.4);
    const lampadas = [];
    for (let z = H.z0 + 6; z < H.z3 - 4; z += 12) {
      const y = alturaEm(z);
      for (const s of [-1, 1]) {
        const poste = new THREE.BoxGeometry(0.14, 3.0, 0.14);
        poste.translate(s * H.halfW, y + 1.5, z);
        estrutura.push(poste);
        const lamp = new THREE.SphereGeometry(0.3, 10, 8);
        lamp.translate(s * H.halfW, y + 3.1, z);
        lampadas.push(lamp);
      }
    }
    // fio de luz acompanhando a corrente
    for (let i = 0; i <= N; i++) {
      const c = corrente[i];
      for (const s of [-1, 1]) {
        const l = new THREE.SphereGeometry(0.22, 8, 6);
        l.translate(s * H.halfW, c.y + 0.5, c.z);
        lampadas.push(l);
      }
    }
    const luzes = new THREE.Mesh(fundir(lampadas), lampMat);
    luzes.position.x = H.x;
    luzes.name = 'hercilio-luzes';
    this.group.add(luzes);

    // ---------------------------------------------------------- piso caminhável
    this.col.addPlatform(
      H.x - H.halfW, H.z0, H.x + H.halfW, H.z3,
      (x, z, refY) => {
        const y = deckYHercilio(z);
        if (y === null) return null;
        // quem está no lago, embaixo da ponte, não recebe a cota do tabuleiro
        if (refY != null && refY < y - 2.5) return null;
        return y;
      },
    );
  }

  // ==================================================================
  //  [58] Museu do Olho (Museu Oscar Niemeyer)
  // ==================================================================
  /**
   * Três peças montam o museu: o bloco horizontal sobre pilotis, o pilar
   * amarelo e o olho. O que engana a leitura, se faltar, é o VÃO — o olho
   * precisa flutuar bem acima da laje, apoiado num pilar só, senão vira um
   * disco pousado em cima do prédio.
   */
  _museuDoOlho() {
    const g = new THREE.Group();
    const solo = terrainHeight(MON.x, MON.z);

    const concreto = new THREE.MeshStandardMaterial({
      map: rep(concreteTexture(), 4, 2), color: 0xf0ece4, roughness: 0.88, metalness: 0.02,
    });
    const concretoFino = new THREE.MeshStandardMaterial({
      map: rep(concreteTexture(), 2), color: 0xe8e4dc, roughness: 0.9, metalness: 0.02,
    });
    const amarelo = new THREE.MeshStandardMaterial({
      map: rep(concreteTexture(), 2, 3), color: 0xe8a91c, roughness: 0.7, metalness: 0.05,
    });
    const vidroFachada = this._acende(new THREE.MeshStandardMaterial({
      map: rep(curtainWallTexture(20, 4), 3, 1),
      emissiveMap: rep(curtainWallTexture(20, 4, '#0b1a24', '#000000'), 3, 1),
      color: 0x8fa6b4, emissive: 0xffe6b0, emissiveIntensity: 0,
      roughness: 0.14, metalness: 0.55,
    }), 0.9);
    const vidroOlho = this._acende(new THREE.MeshStandardMaterial({
      map: rep(curtainWallTexture(28, 12, '#12303f', '#aab4bc'), 1),
      emissiveMap: rep(curtainWallTexture(28, 12, '#0d2634', '#000000'), 1),
      color: 0x7f97a6, emissive: 0xffdca6, emissiveIntensity: 0,
      roughness: 0.1, metalness: 0.6, side: THREE.DoubleSide,
    }), 1.1);

    // ---------------------------------------------------------- bloco sobre pilotis
    const base = [];
    // laje inferior e superior, com o corpo envidraçado entre elas
    const lajeInf = new THREE.BoxGeometry(80, 1.1, 36);
    lajeInf.translate(0, 6.2, 0);
    base.push(lajeInf);
    const lajeSup = new THREE.BoxGeometry(84, 1.3, 39);
    lajeSup.translate(0, 12.4, 0);
    base.push(lajeSup);
    // testeira cega nas cabeceiras
    for (const s of [-1, 1]) {
      const t = new THREE.BoxGeometry(4, 5.2, 36);
      t.translate(s * 38, 9.3, 0);
      base.push(t);
    }
    // pilotis: o bloco fica no ar
    for (let i = -3; i <= 3; i++) {
      for (const dz of [-13, 13]) {
        const p = new THREE.BoxGeometry(2.2, 6.2, 2.2);
        p.translate(i * 12, 3.1, dz);
        base.push(p);
      }
    }
    const bloco = new THREE.Mesh(fundir(base), concreto);
    bloco.castShadow = true; bloco.receiveShadow = true;
    g.add(bloco);

    // pele de vidro do bloco
    const pele = new THREE.Mesh(new THREE.BoxGeometry(76.2, 5.0, 36.2), vidroFachada);
    pele.position.y = 9.3;
    g.add(pele);

    // ---------------------------------------------------------- pilar amarelo
    /*
     * O pilar é achatado e um pouco cônico: visto de frente é uma lâmina
     * larga, de lado quase some. É esse contraste que faz o olho parecer
     * equilibrado num apoio só.
     */
    const pilar = [];
    const PH = 26;
    const corpo = new THREE.CylinderGeometry(1, 1, PH, 4, 1);
    corpo.rotateY(Math.PI / 4);
    corpo.scale(9.5, 1, 3.4);
    corpo.translate(0, 13 + 6.8, 0);
    pilar.push(corpo);
    const sapata = new THREE.BoxGeometry(22, 1.2, 9);
    sapata.translate(0, 7.0, 0);
    pilar.push(sapata);
    const pilarMesh = new THREE.Mesh(fundir(pilar), amarelo);
    pilarMesh.castShadow = true; pilarMesh.receiveShadow = true;
    g.add(pilarMesh);

    // ---------------------------------------------------------- o olho
    const OLHO_Y = 47;
    /*
     * A casca é um elipsoide cortado na altura do equador em duas metades
     * levemente diferentes, com um aro em volta. A pupila é uma superfície
     * envidraçada em cada face, recuada, com caixilho na textura.
     */
    const casca = new THREE.SphereGeometry(1, 56, 32);
    casca.scale(35, 15, 9);
    const olho = new THREE.Mesh(casca, concretoFino);
    olho.position.y = OLHO_Y;
    olho.castShadow = true; olho.receiveShadow = true;
    g.add(olho);

    /*
     * A pupila é um SEGUNDO elipsoide, mais estreito mas um pouco mais
     * "gordo" na profundidade: ele fura a casca no meio e afunda dentro dela
     * perto da borda. O resultado é uma íris de verdade, com contorno curvo,
     * em vez de um adesivo colado na frente.
     *
     * Uma calota encaixada por dentro (a primeira tentativa) simplesmente não
     * aparecia: ficava inteira dentro da casca e o olho saía branco liso.
     * As medidas vêm de resolver onde as duas superfícies se cruzam — com
     * (28, 12, 9.52) contra (35, 15, 9) o encontro cai em x ≈ 14, ou seja
     * uma íris de uns 28 m num olho de 70 m.
     */
    const pupila = new THREE.SphereGeometry(1, 48, 28);
    pupila.scale(28, 12, 9.52);
    const iris = new THREE.Mesh(pupila, vidroOlho);
    iris.position.y = OLHO_Y;
    g.add(iris);

    // aro de acabamento no equador da casca
    const aro = new THREE.Mesh(new THREE.TorusGeometry(1, 0.03, 12, 80), amarelo);
    aro.scale.set(35.2, 15.2, 35.2);
    aro.position.y = OLHO_Y;
    g.add(aro);

    // ---------------------------------------------------------- rampa curva
    /*
     * A rampa de acesso é o terceiro gesto do conjunto. Sai do jardim, curva e
     * encosta no bloco. Feita por extrusão ao longo de uma curva: com caixas
     * retas a curva ficaria facetada.
     */
    const curva = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-14, 0.4, 40),
      new THREE.Vector3(4, 1.8, 38),
      new THREE.Vector3(18, 3.8, 31),
      new THREE.Vector3(24, 5.6, 22),
      new THREE.Vector3(20, 6.6, 15),
    ]);
    const perfil = new THREE.Shape();
    perfil.moveTo(-3.2, -0.35); perfil.lineTo(3.2, -0.35);
    perfil.lineTo(3.2, 0.35); perfil.lineTo(-3.2, 0.35);
    perfil.closePath();
    const rampaGeo = new THREE.ExtrudeGeometry(perfil, {
      steps: 60, bevelEnabled: false, extrudePath: curva,
    });
    const rampa = new THREE.Mesh(rampaGeo, concretoFino);
    rampa.castShadow = true; rampa.receiveShadow = true;
    g.add(rampa);
    // parapeito da rampa
    const guardaRampa = [];
    for (let i = 0; i <= 40; i++) {
      const p = curva.getPoint(i / 40);
      const t = curva.getTangent(i / 40);
      const nx = -t.z, nz = t.x;
      const n = Math.hypot(nx, nz) || 1;
      for (const s of [-1, 1]) {
        const b = new THREE.BoxGeometry(0.22, 1.0, 0.22);
        b.translate(p.x + (nx / n) * s * 3.1, p.y + 0.85, p.z + (nz / n) * s * 3.1);
        guardaRampa.push(b);
      }
    }
    const gr = new THREE.Mesh(fundir(guardaRampa), amarelo);
    gr.castShadow = true;
    g.add(gr);

    // ---------------------------------------------------------- espelho d'água
    const agua = new THREE.Mesh(
      new THREE.BoxGeometry(92, 0.5, 26),
      new THREE.MeshPhysicalMaterial({
        color: 0x22414f, roughness: 0.035, metalness: 0.25,
        envMapIntensity: 2.4, clearcoat: 1, clearcoatRoughness: 0.03,
      }),
    );
    agua.position.set(0, 0.25, 40);
    g.add(agua);
    const borda = new THREE.Mesh(new THREE.BoxGeometry(96, 0.7, 30), concretoFino);
    borda.position.set(0, 0.2, 40);
    borda.receiveShadow = true;
    g.add(borda);

    // esplanada
    const piso = new THREE.Mesh(new THREE.BoxGeometry(110, 0.4, 96), concreto);
    piso.position.set(0, 0.05, 14);
    piso.receiveShadow = true;
    g.add(piso);

    g.position.set(MON.x, solo, MON.z);
    g.rotation.y = MON.rot;
    g.name = 'museu-do-olho';
    this.group.add(g);

    // halo noturno do olho
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTexture(), color: 0xffd9a0, transparent: true,
      opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    halo.scale.set(120, 60, 1);
    halo.position.set(MON.x, solo + OLHO_Y, MON.z);
    this.group.add(halo);
    this.nightGlows.push({ sprite: halo, pico: 0.5 });

    /*
     * ---- colisão ----
     * O museu é um bloco NO AR sobre pilotis, e dá para andar por baixo —
     * é o gesto que define o prédio. A caixa antes ia do chão ao topo e
     * fechava o vão inteiro: o pilotis existia no desenho e não na
     * colisão, então o jogador batia numa parede invisível de 84 m.
     *
     * Agora a caixa começa na face inferior da laje (6,2 − 1,1/2 ≈ 5,65)
     * e o que barra lá embaixo são os 14 pilotis, um a um.
     *
     * O pilar amarelo não entra: ele nasce em y ≈ 6,4, apoiado na laje,
     * e nunca chega ao chão.
     */
    const c = Math.cos(MON.rot), s = Math.sin(MON.rot);
    const SOB_LAJE = 5.6;
    this.col.addBox(MON.x, MON.z, Math.abs(42 * c) + Math.abs(20 * s),
      Math.abs(42 * s) + Math.abs(20 * c), solo + 13.7, 'museu', solo + SOB_LAJE);

    // os pilotis: 7 pórticos de 2,2 m, nas mesmas posições do desenho
    for (let i = -3; i <= 3; i++) {
      for (const lz of [-13, 13]) {
        const lx = i * 12;
        this.col.addCircle(
          MON.x + lx * c + lz * s,
          MON.z - lx * s + lz * c,
          1.25, solo + SOB_LAJE, 'pilotis',
        );
      }
    }
    MON.y = solo;
    MON.olhoY = solo + OLHO_Y;
  }

  // ==================================================================
  //  [59] Pelourinho
  // ==================================================================
  /**
   * Duas fileiras de sobrados coloniais coloridos de frente uma para a outra,
   * com a igreja fechando a praça. As cores saem de uma paleta fixa e a
   * variação (altura, largura, revestimento) vem do gerador com semente, então
   * a rua nasce diferente a cada casa mas igual a cada partida.
   *
   * O que faz o casario parecer colonial e não caixa colorida:
   *   - cunhal e cimalha brancos destacando cada sobrado do vizinho
   *   - sacada de ferro com balaústres nas janelas do andar de cima
   *   - bandeira em arco sobre as portas do térreo
   *   - telha-canal com beiral saliente, apoiado em cachorros de madeira
   *   - reboco manchado de umidade e chuva (textura), com algumas fachadas
   *     revestidas de azulejo português
   */
  _pelourinho() {
    const P = PELOURINHO;
    const g = new THREE.Group();
    const rng = this.rng;

    /*
     * O terreno sob o largo já vem APLAINADO pelo platô (config.js/PLATOS),
     * então basta uma amostra: o chão é o mesmo em toda a praça.
     *
     * Antes eu tentei resolver pelo outro lado, levantando a laje até o ponto
     * mais alto do relevo. Não funciona: ali o terreno varia 6 m, e a laje
     * virava um bloco boiando no ar do lado baixo, sem como subir. Quem tem
     * que ceder é o terreno, não o piso.
     */
    const cs = Math.cos(P.rot), sn = Math.sin(P.rot);
    const solo = terrainHeight(P.x, P.z);
    // faixa de degraus que liga o calçamento ao chão em volta
    const PRACA = { cx: -12, hx: 58, hz: 31 };
    const DEGRAU = 0.25, BORDA = 2.4;

    const CORES = [0xe8b93f, 0x4f97c4, 0x77b46a, 0xe0776f, 0xefe3c8, 0xc98ec0, 0x63b7ae, 0xd9a441];

    const branco = new THREE.MeshStandardMaterial({
      map: rep(stuccoTexture(0xf6f2e8), 1), color: 0xffffff, roughness: 0.86,
    });
    const telhaMat = new THREE.MeshStandardMaterial({
      map: rep(roofTileTexture(), 3, 2), normalMap: rep(roofTileNormal(), 3, 2),
      color: 0xffffff, roughness: 0.88, metalness: 0.02,
    });
    telhaMat.normalScale.set(1.1, 1.1);
    const madeira = new THREE.MeshStandardMaterial({ color: 0x3f2a1c, roughness: 0.82 });
    const ferro = new THREE.MeshStandardMaterial({ color: 0x1b1c20, roughness: 0.5, metalness: 0.7 });
    const pedra = new THREE.MeshStandardMaterial({
      map: rep(cobbleTexture(), 3), normalMap: rep(cobbleNormal(), 3),
      color: 0xb9b3a8, roughness: 0.95,
    });
    const azulejo = new THREE.MeshStandardMaterial({
      map: rep(azulejoTexture(), 2, 3), roughness: 0.35, metalness: 0.05,
    });
    const vidroJanela = this._acende(new THREE.MeshStandardMaterial({
      color: 0x14181e, emissive: 0xffc46a, emissiveIntensity: 0, roughness: 0.25, metalness: 0.1,
    }), 0.9);

    // ---------------------------------------------------------- calçamento
    // o calçamento se estende para -X para servir de adro da igreja
    const pedraPiso = new THREE.MeshStandardMaterial({
      map: rep(cobbleTexture(), 12, 7), normalMap: rep(cobbleNormal(), 12, 7),
      color: 0xffffff, roughness: 0.93,
    });
    const praca = new THREE.Mesh(
      new THREE.BoxGeometry(PRACA.hx * 2, 1.4, PRACA.hz * 2), pedraPiso,
    );
    praca.position.set(PRACA.cx, -0.2, 0);
    praca.receiveShadow = true;
    g.add(praca);

    /*
     * Dois degraus em volta do largo, em vez de um degrau único de meio metro.
     * O jogador sobe caminhando, sem precisar pular, e a borda deixa de
     * parecer uma laje largada no chão.
     */
    const escadaria = [];
    for (let i = 1; i <= 2; i++) {
      const fora = (BORDA / 2) * i;
      const alto = 0.5 - DEGRAU * i;
      const w = (PRACA.hx + fora) * 2, d = (PRACA.hz + fora) * 2;
      for (const [sx, sz, bw, bd] of [
        [0, -(PRACA.hz + fora / 2), w, fora], [0, PRACA.hz + fora / 2, w, fora],
        [-(PRACA.hx + fora / 2), 0, fora, d], [PRACA.hx + fora / 2, 0, fora, d],
      ]) {
        const deg = new THREE.BoxGeometry(bw, 1.2, bd);
        deg.translate(PRACA.cx + sx, alto - 0.6, sz);
        escadaria.push(deg);
      }
    }
    const degraus3d = new THREE.Mesh(fundir(escadaria), pedraPiso);
    degraus3d.receiveShadow = true;
    g.add(degraus3d);

    // ---------------------------------------------------------- sobrados
    const porCor = new Map();     // reboco pintado, uma malha por cor
    const trim = [], telhados = [], janelas = [], ferragem = [], madeiras = [], azulejos = [];

    for (const lado of [-1, 1]) {
      // a fileira começa em -26 para sobrar adro entre a igreja e a primeira casa
      let x = -26;
      while (x < 32) {
        const larg = rngRange(rng, 7.5, 10.5);
        const andares = rngInt(rng, 2, 3);
        const peDir = 3.5;
        const alt = 4.2 + andares * peDir;
        const prof = 11;
        const cx = x + larg / 2;
        const cz = lado * 19;
        const frente = cz - lado * (prof / 2);     // face virada para a praça
        const fora = -lado;                        // sinal que aponta para a praça

        const revestido = rng() < 0.22;            // fachada de azulejo
        const cor = CORES[rngInt(rng, 0, CORES.length - 1)];

        // ---- corpo
        const casa = new THREE.BoxGeometry(larg - 0.35, alt, prof);
        casa.translate(cx, alt / 2 + 0.5, cz);
        if (revestido) {
          // a caixa inteira fica no reboco; só a fachada recebe o azulejo
          if (!porCor.has(0xefe3c8)) porCor.set(0xefe3c8, []);
          porCor.get(0xefe3c8).push(casa);
          const placa = new THREE.BoxGeometry(larg - 0.5, alt - 4.0, 0.12);
          placa.translate(cx, alt / 2 + 2.2, frente + fora * 0.07);
          azulejos.push(placa);
        } else {
          if (!porCor.has(cor)) porCor.set(cor, []);
          porCor.get(cor).push(casa);
        }

        // ---- cunhais (pilastras brancas nos cantos)
        for (const s of [-1, 1]) {
          const cun = new THREE.BoxGeometry(0.55, alt, prof + 0.12);
          cun.translate(cx + s * (larg / 2 - 0.3), alt / 2 + 0.5, cz);
          trim.push(cun);
        }
        // ---- cimalha com dentículos
        const cim = new THREE.BoxGeometry(larg + 0.5, 0.7, prof + 0.7);
        cim.translate(cx, alt + 0.75, cz);
        trim.push(cim);
        for (let d = 0; d < Math.floor(larg / 0.8); d++) {
          const dent = new THREE.BoxGeometry(0.34, 0.34, 0.34);
          dent.translate(cx - larg / 2 + 0.5 + d * 0.8, alt + 0.24, frente + fora * 0.3);
          trim.push(dent);
        }
        // ---- barra de proteção na base
        const barra = new THREE.BoxGeometry(larg - 0.2, 1.0, prof + 0.3);
        barra.translate(cx, 1.0, cz);
        trim.push(barra);

        // ---- telhado de duas águas com beiral
        const rh = 2.1;
        const meia = (prof + 1.6) / 2;
        const decl = Math.hypot(meia, rh);
        const ang = Math.atan2(rh, meia);
        for (const s of [-1, 1]) {
          const agua = new THREE.BoxGeometry(larg + 0.9, 0.3, decl);
          agua.rotateX(s * ang);
          agua.translate(cx, alt + 1.1 + rh / 2, cz + s * meia / 2);
          telhados.push(agua);
        }
        const cumeeira = new THREE.CylinderGeometry(0.32, 0.32, larg + 1.0, 8, 1, false, 0, Math.PI);
        cumeeira.rotateZ(Math.PI / 2);
        cumeeira.translate(cx, alt + 1.1 + rh, cz);
        telhados.push(cumeeira);
        // cachorros: as pontas de viga que sustentam o beiral
        for (let d = 0; d < Math.floor(larg / 1.4); d++) {
          const cach = new THREE.BoxGeometry(0.18, 0.2, 1.1);
          cach.translate(cx - larg / 2 + 0.7 + d * 1.4, alt + 1.0, frente + fora * 0.55);
          madeiras.push(cach);
        }

        // ---- portas do térreo, com bandeira em arco
        const nPortas = larg > 9 ? 3 : 2;
        for (let i = 0; i < nPortas; i++) {
          const jx = cx + (i - (nPortas - 1) / 2) * (larg / (nPortas + 0.25));
          const porta = new THREE.BoxGeometry(1.5, 2.9, 0.22);
          porta.translate(jx, 1.95, frente + fora * 0.12);
          madeiras.push(porta);
          const moldura = new THREE.BoxGeometry(1.95, 3.3, 0.14);
          moldura.translate(jx, 2.05, frente + fora * 0.05);
          trim.push(moldura);
          // bandeira: meia-lua envidraçada sobre a porta
          const band = new THREE.CylinderGeometry(0.72, 0.72, 0.18, 14, 1, false, 0, Math.PI);
          band.rotateX(Math.PI / 2);
          band.rotateZ(fora > 0 ? 0 : Math.PI);
          band.translate(jx, 3.5, frente + fora * 0.12);
          janelas.push(band);
          const arco = new THREE.TorusGeometry(0.86, 0.1, 6, 18, Math.PI);
          arco.rotateZ(fora > 0 ? 0 : Math.PI);
          arco.translate(jx, 3.5, frente + fora * 0.14);
          trim.push(arco);
        }

        // ---- janelas dos andares altos, com sacada de ferro
        for (let a = 1; a <= andares; a++) {
          const ny = 4.2 + (a - 1) * peDir + 1.5;
          const cols = larg > 9 ? 3 : 2;
          for (let i = 0; i < cols; i++) {
            const jx = cx + (i - (cols - 1) / 2) * (larg / (cols + 0.25));
            const vao = new THREE.BoxGeometry(1.2, 2.2, 0.2);
            vao.translate(jx, ny, frente + fora * 0.1);
            janelas.push(vao);
            // batentes e verga
            const mold = new THREE.BoxGeometry(1.62, 2.6, 0.16);
            mold.translate(jx, ny, frente + fora * 0.04);
            trim.push(mold);
            const verga = new THREE.BoxGeometry(1.95, 0.28, 0.3);
            verga.translate(jx, ny + 1.42, frente + fora * 0.12);
            trim.push(verga);
            // folhas de madeira encostadas nas laterais
            for (const s of [-1, 1]) {
              const folha = new THREE.BoxGeometry(0.42, 2.2, 0.1);
              folha.translate(jx + s * 0.8, ny, frente + fora * 0.2);
              madeiras.push(folha);
            }

            // sacada: laje fina + balaústres + corrimão
            if (a === 1) {
              const laje = new THREE.BoxGeometry(2.1, 0.16, 0.85);
              laje.translate(jx, ny - 1.18, frente + fora * 0.42);
              trim.push(laje);
              for (let b = 0; b <= 7; b++) {
                const bal = new THREE.BoxGeometry(0.07, 0.85, 0.07);
                bal.translate(jx - 0.95 + b * 0.27, ny - 0.72, frente + fora * 0.78);
                ferragem.push(bal);
              }
              for (const dz of [0.78, 0.06]) {
                const cor2 = new THREE.BoxGeometry(2.1, 0.08, 0.08);
                cor2.translate(jx, ny - 0.32, frente + fora * dz);
                ferragem.push(cor2);
              }
              for (const s of [-1, 1]) {
                const lat = new THREE.BoxGeometry(0.08, 0.85, 0.78);
                lat.translate(jx + s * 1.02, ny - 0.72, frente + fora * 0.42);
                ferragem.push(lat);
              }
            }
          }
        }

        x += larg;
      }
    }

    for (const [cor, geos] of porCor) {
      const m = new THREE.Mesh(fundir(geos), new THREE.MeshStandardMaterial({
        map: rep(stuccoTexture(cor), 1, 1), color: 0xffffff, roughness: 0.9, metalness: 0,
      }));
      m.castShadow = true; m.receiveShadow = true;
      g.add(m);
    }
    const add = (geos, mat, sombra = true) => {
      if (!geos.length) return null;
      const m = new THREE.Mesh(fundir(geos), mat);
      m.castShadow = sombra; m.receiveShadow = true;
      g.add(m);
      return m;
    };
    add(trim, branco);
    add(telhados, telhaMat);
    add(madeiras, madeira);
    add(ferragem, ferro);
    add(azulejos, azulejo, false);
    add(janelas, vidroJanela, false);

    /*
     * ---------------------------------------------------------- igreja
     *
     * A igreja FECHA a rua, de frente para o vão central entre as duas
     * fileiras — não fica atrás do casario. É assim no largo de verdade: o
     * casario faz as laterais e a igreja arremata o fundo, de modo que quem
     * entra na rua olha direto para a fachada.
     *
     * Ela é modelada num referencial próprio (nave na origem, fachada virada
     * para +Z) e só depois é girada um quarto de volta e levada para a ponta
     * -X da rua. Modelar já deitado ficaria ilegível: cada peça teria de ser
     * pensada com X e Z trocados.
     *
     * `rotateY(π/2)` leva (x,y,z) para (z,y,-x): as duas torres, que estão em
     * x = ±13,5, caem em z = ∓13,5 — exatamente sobre as faces internas das
     * fileiras de casas, emoldurando a rua.
     */
    const igreja = [], igrejaTrim = [], igrejaTelha = [], igrejaVidro = [];
    const IZ = 0;
    const IGREJA_X = -52;                    // fachada em x = IGREJA_X + 14
    const nave = new THREE.BoxGeometry(24, 16, 28);
    nave.translate(0, 8.5, IZ);
    igreja.push(nave);

    /*
     * Frontão barroco.
     *
     * Feito por extrusão de um SHAPE (arco com base reta) em vez de meio
     * cilindro: o `thetaLength` do cilindro não garante qual metade sobra
     * depois das rotações, e na primeira tentativa o frontão nasceu de pé,
     * como um paredão branco tapando a fachada inteira.
     */
    const arco = new THREE.Shape();
    arco.moveTo(-7, 0);
    arco.absarc(0, 0, 7, Math.PI, 0, true);
    arco.closePath();
    const fronton = new THREE.ExtrudeGeometry(arco, { depth: 1.6, bevelEnabled: false });
    fronton.translate(0, 16.3, IZ + 13.6);
    igrejaTrim.push(fronton);

    // volutas: as espirais que amarram o frontão às laterais
    for (const s of [-1, 1]) {
      const voluta = new THREE.TorusGeometry(1.9, 0.45, 8, 20, Math.PI * 0.95);
      voluta.rotateZ(s > 0 ? -Math.PI / 2 : Math.PI / 2);
      voluta.translate(s * 8.4, 15.6, IZ + 14.2);
      igrejaTrim.push(voluta);
    }
    // pilastras da fachada
    for (const s of [-1, 1]) {
      for (const dx of [4.5, 10]) {
        const pil = new THREE.BoxGeometry(1.5, 16, 0.8);
        pil.translate(s * dx, 8.5, IZ + 14.3);
        igrejaTrim.push(pil);
      }
    }
    // torres sineiras
    for (const s of [-1, 1]) {
      const torre = new THREE.BoxGeometry(8, 30, 8);
      torre.translate(s * 13.5, 15, IZ + 8);
      igreja.push(torre);
      // arcos do campanário
      for (const face of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
        const arco = new THREE.BoxGeometry(face[0] ? 0.5 : 3.2, 5, face[0] ? 3.2 : 0.5);
        arco.translate(s * 13.5 + face[0] * 4.0, 26, IZ + 8 + face[1] * 4.0);
        igrejaVidro.push(arco);
      }
      // cimalha e coroamento piramidal
      const cim = new THREE.BoxGeometry(9.4, 1.0, 9.4);
      cim.translate(s * 13.5, 30.3, IZ + 8);
      igrejaTrim.push(cim);
      const coroa = new THREE.ConeGeometry(6.4, 8, 4);
      coroa.rotateY(Math.PI / 4);
      coroa.translate(s * 13.5, 34.8, IZ + 8);
      igrejaTelha.push(coroa);
      // cruz no alto
      const h = new THREE.BoxGeometry(0.22, 2.4, 0.22);
      h.translate(s * 13.5, 40, IZ + 8);
      igrejaTrim.push(h);
      const t2 = new THREE.BoxGeometry(1.2, 0.22, 0.22);
      t2.translate(s * 13.5, 40.5, IZ + 8);
      igrejaTrim.push(t2);
    }
    // telhado da nave
    for (const s of [-1, 1]) {
      const agua = new THREE.BoxGeometry(25, 0.4, 15.5);
      agua.rotateX(s * 0.30);
      agua.translate(0, 18.4, IZ + s * 7.3);
      igrejaTelha.push(agua);
    }
    // portal e óculo
    const portal = new THREE.BoxGeometry(4.6, 8, 0.5);
    portal.translate(0, 4.5, IZ + 14.2);
    igrejaVidro.push(portal);
    const portalArco = new THREE.TorusGeometry(2.6, 0.35, 8, 20, Math.PI);
    portalArco.translate(0, 8.5, IZ + 14.3);
    igrejaTrim.push(portalArco);
    const oculo = new THREE.CylinderGeometry(2.2, 2.2, 0.5, 24);
    oculo.rotateX(Math.PI / 2);
    oculo.translate(0, 13, IZ + 14.2);
    igrejaVidro.push(oculo);
    const oculoAro = new THREE.TorusGeometry(2.5, 0.3, 8, 24);
    oculoAro.translate(0, 13, IZ + 14.3);
    igrejaTrim.push(oculoAro);
    // escadaria
    for (let i = 0; i < 4; i++) {
      const deg = new THREE.BoxGeometry(20 - i * 1.2, 0.32, 4.5 - i * 0.9);
      deg.translate(0, 0.55 + i * 0.32, IZ + 16.5 + i * 0.5);
      igrejaTrim.push(deg);
    }

    // deita a igreja e a leva para a ponta da rua (ver comentário acima)
    const assentaIgreja = (lista) => lista.map((geo) => {
      geo.rotateY(Math.PI / 2);
      geo.translate(IGREJA_X, 0, 0);
      return geo;
    });
    assentaIgreja(igreja); assentaIgreja(igrejaTrim);
    assentaIgreja(igrejaTelha); assentaIgreja(igrejaVidro);

    add(igreja, new THREE.MeshStandardMaterial({
      map: rep(stuccoTexture(0xf2ece0), 1, 1), color: 0xffffff, roughness: 0.9,
    }));
    add(igrejaTrim, new THREE.MeshStandardMaterial({
      map: rep(stuccoTexture(0xd8e4ee), 1), color: 0xffffff, roughness: 0.82,
    }));
    add(igrejaTelha, telhaMat);
    add(igrejaVidro, vidroJanela, false);

    // ---------------------------------------------------------- o pelourinho
    const col = [];
    const degraus = new THREE.CylinderGeometry(3.4, 3.9, 0.4, 8);
    degraus.translate(0, 0.7, 0);
    col.push(degraus);
    const degraus2 = new THREE.CylinderGeometry(2.7, 3.2, 0.4, 8);
    degraus2.translate(0, 1.1, 0);
    col.push(degraus2);
    const base = new THREE.CylinderGeometry(1.15, 1.35, 1.1, 8);
    base.translate(0, 1.85, 0);
    col.push(base);
    const fuste = new THREE.CylinderGeometry(0.5, 0.62, 4.6, 12);
    fuste.translate(0, 4.7, 0);
    col.push(fuste);
    const capitel = new THREE.CylinderGeometry(0.95, 0.62, 0.9, 12);
    capitel.translate(0, 7.45, 0);
    col.push(capitel);
    const abaco = new THREE.BoxGeometry(1.9, 0.35, 1.9);
    abaco.translate(0, 8.05, 0);
    col.push(abaco);
    /*
     * O monumento do adro é um CRUZEIRO: a coluna termina em cruz de pedra,
     * como o Cruzeiro de São Francisco. Antes terminava numa esfera, o que
     * fazia dele um poste ornamental qualquer — é a cruz que identifica a
     * peça e que amarra o conjunto com a igreja atrás.
     */
    /*
     * O braço da cruz corre em Z, atravessado à rua.
     *
     * A rua do largo corre em X, então um braço em X deixa a cruz de perfil
     * para quem vem pela rua — só se vê a haste, e o monumento parece um
     * poste. Atravessado, ele se apresenta de frente tanto para quem entra
     * quanto para quem sai da igreja.
     */
    const CRUZ_Y = 8.25;                    // topo do ábaco
    const haste = new THREE.BoxGeometry(0.42, 3.4, 0.42);
    haste.translate(0, CRUZ_Y + 1.7, 0);
    col.push(haste);
    const braco = new THREE.BoxGeometry(0.42, 0.42, 2.3);
    braco.translate(0, CRUZ_Y + 2.35, 0);
    col.push(braco);
    // remates nas três pontas, que é o que dá o ar de talha em pedra
    for (const [ry, rz] of [[CRUZ_Y + 3.5, 0], [CRUZ_Y + 2.35, -1.24], [CRUZ_Y + 2.35, 1.24]]) {
      const remate = new THREE.SphereGeometry(0.3, 12, 8);
      remate.translate(0, ry, rz);
      col.push(remate);
    }
    // fica no adro, à frente da igreja, e não no meio da rua
    for (const geo of col) geo.translate(-16, 0, 0);
    add(col, pedra);

    // ---------------------------------------------------------- lampiões
    const lampiaoVidro = this._acende(new THREE.MeshStandardMaterial({
      color: 0x2a2418, emissive: 0xffcb70, emissiveIntensity: 0,
    }), 2.2);
    const postes = [], lentes = [];
    // lampiões acompanhando a rua, junto às fachadas e fora das sacadas
    for (const [px, pz] of [[-30, -11], [-30, 11], [-6, -11], [-6, 11],
      [18, -11], [18, 11], [34, -11], [34, 11]]) {
      const p = new THREE.CylinderGeometry(0.13, 0.2, 4.4, 8);
      p.translate(px, 2.7, pz);
      postes.push(p);
      const braco = new THREE.BoxGeometry(0.16, 0.16, 0.16);
      braco.translate(px, 5.0, pz);
      postes.push(braco);
      const caixa = new THREE.CylinderGeometry(0.42, 0.28, 0.85, 4);
      caixa.translate(px, 5.35, pz);
      lentes.push(caixa);
      const chapeu = new THREE.ConeGeometry(0.55, 0.45, 4);
      chapeu.translate(px, 5.95, pz);
      postes.push(chapeu);
      this.col.addCircle(P.x + px * Math.cos(P.rot) + pz * Math.sin(P.rot),
        P.z - px * Math.sin(P.rot) + pz * Math.cos(P.rot), 0.4, solo + 4, 'poste');
    }
    add(postes, ferro);
    add(lentes, lampiaoVidro, false);

    g.position.set(P.x, solo, P.z);
    g.rotation.y = P.rot;
    g.name = 'pelourinho';
    this.group.add(g);

    // ---------------------------------------------------------- colisão e chão
    const c = Math.cos(P.rot), s = Math.sin(P.rot);
    const gira = (lx, lz) => ({ x: P.x + lx * c + lz * s, z: P.z - lx * s + lz * c });

    for (const lado of [-1, 1]) {
      for (let lx = -26; lx < 32; lx += 4) {
        const p = gira(lx + 2, lado * 19);
        this.col.addCircle(p.x, p.z, 2.6, solo + 12, 'casario');
      }
    }
    /*
     * A igreja é sólida (não tem interior modelado): uma malha de círculos
     * cobre a nave deitada em -X, que ocupa x de -66 a -38 e z de -12 a 12.
     *
     * O passo é menor que o alcance de cada círculo de propósito. Com a
     * primeira grade, mais espaçada, sobravam duas frestas de ~3 m na
     * fachada por onde dava para entrar andando de lado.
     */
    for (let lx = -64; lx <= -38; lx += 4) {
      for (let lz = -10.5; lz <= 10.5; lz += 3.5) {
        const p = gira(lx, lz);
        this.col.addCircle(p.x, p.z, 2.6, solo + 20, 'igreja');
      }
    }
    const colP = gira(-16, 0);
    this.col.addCircle(colP.x, colP.z, 3.9, solo + 1.1, 'pelourinho');

    /*
     * Piso do largo: o calçamento no miolo e os dois degraus na borda.
     *
     * A escada precisa existir também na COLISÃO, não só no desenho — senão o
     * jogador vê os degraus e continua esbarrando numa parede invisível de
     * meio metro.
     */
    const TOTAL = BORDA;
    this.col.addPlatform(
      P.x - 90, P.z - 52, P.x + 70, P.z + 52,
      (x, z, refY) => {
        const dx = x - P.x, dz = z - P.z;
        const lx = dx * c - dz * s, lz = dx * s + dz * c;
        // quanto o ponto passa da borda do calçamento (0 = dentro)
        const fora = Math.max(
          Math.abs(lx - PRACA.cx) - PRACA.hx,
          Math.abs(lz) - PRACA.hz,
        );
        if (fora > TOTAL) return null;
        const degrau = fora <= 0 ? 0 : Math.ceil(fora / (BORDA / 2));
        const y = solo + 0.5 - degrau * DEGRAU;
        if (refY != null && refY < y - 2.5) return null;
        return y;
      },
    );
    P.y = solo;
  }

  // ------------------------------------------------------------------ noite
  update(dt, nightFactor) {
    const on = Math.pow(Math.max(0, (nightFactor - 0.2) / 0.8), 0.8);
    for (const n of this.nightMats) n.mat.emissiveIntensity = on * n.pico;
    for (const h of this.nightGlows) h.sprite.material.opacity = on * h.pico;
  }
}

/** Altura do tabuleiro da Hercílio Luz em função de Z (null fora da ponte). */
export function deckYHercilio(z) {
  const H = HERCILIO;
  if (z < H.z0 || z > H.z3) return null;
  const yA = H.yA ?? terrainHeight(H.x, H.z0);
  const yB = H.yB ?? terrainHeight(H.x, H.z3);
  if (z < H.z1) return lerp(yA, H.deckY, smoothstep(clamp((z - H.z0) / (H.z1 - H.z0), 0, 1)));
  if (z > H.z2) return lerp(H.deckY, yB, smoothstep(clamp((z - H.z2) / (H.z3 - H.z2), 0, 1)));
  return H.deckY;
}
