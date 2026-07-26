import * as THREE from 'three';

/**
 * ============================================================
 *  Personagem voxel — pixel art com profundidade
 * ============================================================
 *
 * Bonecos de caixa, proporção estilo Minecraft. A escolha é do Bob e
 * tem duas razões práticas além do gosto:
 *
 * 1. É a tradução honesta do pixel art 2D do jogo original. Voxel é
 *    pixel com profundidade — a identidade visual atravessa.
 * 2. É MAIS BARATO que o pedestre atual. Uma pessoa da cidade são 10
 *    malhas de cilindro e esfera; um boneco desses são 6 caixas, e
 *    caixas iguais dividem geometria e material.
 *
 * O que impede de parecer asset colado de outro jogo é o MATERIAL, não
 * a forma: os blocos entram com `MeshStandardMaterial` e recebem o
 * mesmo sol, o mesmo céu por IBL e as mesmas sombras do resto da cena.
 * Forma blocada + luz realista lê como estilo; cor chapada sem luz
 * leria como erro.
 *
 * ---- ESCALA ----
 * Proporção Minecraft em "voxels": cabeça 8, tronco 12, perna 12 = 32
 * de altura. Com VX = 1.8/32 o boneco nasce com 1,80 m — a mesma
 * altura do pedestre que já existe, então colisão, câmera e mira
 * continuam valendo sem tocar em nada.
 */

export const VX = 1.8 / 32;          // 1 voxel em metros
export const ALTURA = 32 * VX;       // 1,80 m

// ---------------------------------------------------------------- materiais
/*
 * Cache por cor+acabamento. Sem isto, 40 inimigos iguais criariam 400
 * materiais e o three recompilaria shader à toa. Com o cache, a cidade
 * inteira compartilha um punhado.
 */
const _mats = new Map();

export function voxMaterial(cor, { metal = 0, aspereza = 0.85, emissivo = 0 } = {}) {
  const chave = `${cor}|${metal}|${aspereza}|${emissivo}`;
  let m = _mats.get(chave);
  if (m) return m;
  m = new THREE.MeshStandardMaterial({
    color: cor,
    roughness: aspereza,
    metalness: metal,
    emissive: emissivo ? cor : 0x000000,
    emissiveIntensity: emissivo,
  });
  _mats.set(chave, m);
  return m;
}

// ---------------------------------------------------------------- geometria
/*
 * Uma caixa 1x1x1 compartilhada por todo mundo, redimensionada por
 * `scale`. Assim o projeto inteiro tem UMA BoxGeometry na memória.
 * O pivô sobe para o topo quando a peça precisa girar pendurada
 * (braço no ombro, perna no quadril).
 */
const CAIXA = new THREE.BoxGeometry(1, 1, 1);
const CAIXA_TOPO = new THREE.BoxGeometry(1, 1, 1);
CAIXA_TOPO.translate(0, -0.5, 0);

function bloco(w, h, d, mat, pivoNoTopo = false) {
  const m = new THREE.Mesh(pivoNoTopo ? CAIXA_TOPO : CAIXA, mat);
  m.scale.set(w * VX, h * VX, d * VX);
  return m;
}

/**
 * Peça extra (chapéu, óculos, mochila, chifre...). Fica pendurada numa
 * parte do corpo e acompanha a animação dela de graça.
 */
function extra(def, alvo) {
  const mat = voxMaterial(def.cor, {
    metal: def.metal || 0,
    aspereza: def.aspereza ?? 0.85,
    emissivo: def.emissivo || 0,
  });
  const m = bloco(def.w, def.h, def.d, mat);
  m.position.set((def.x || 0) * VX, (def.y || 0) * VX, (def.z || 0) * VX);
  if (def.rot) m.rotation.set(def.rot[0] || 0, def.rot[1] || 0, def.rot[2] || 0);
  m.castShadow = true;
  alvo.add(m);
  return m;
}

// ---------------------------------------------------------------- figura
/**
 * Boneco articulado. A raiz fica NO CHÃO (y = 0 nos pés), igual ao
 * `Human` que já existe — assim quem posiciona não precisa saber de
 * altura de quadril.
 */
export class VoxelFigure {
  /**
   * @param {object} spec  molde do personagem (ver `voxeldef.js`)
   */
  constructor(spec) {
    this.spec = spec;
    this.escala = spec.escala || 1;

    this.root = new THREE.Group();

    /*
     * root → pivot → corpo.
     *
     * O `pivot` existe para o VoxelFigure poder substituir o `Human` da
     * cidade sem que ninguém perceba: é onde o jogador pendura o pacote
     * [50] e onde entra o balanço vertical do passo. Mesma API, molde
     * diferente.
     */
    this.pivot = new THREE.Group();
    this.root.add(this.pivot);

    // corpo inteiro num grupo: escala e "tombo" da morte aplicam aqui
    this.corpo = new THREE.Group();
    this.corpo.scale.setScalar(this.escala);
    this.pivot.add(this.corpo);

    const pele = voxMaterial(spec.pele ?? 0xd9a066);
    const matTorso = voxMaterial(spec.torso ?? 0x3355aa, spec.acabamento || {});
    const matBraco = voxMaterial(spec.bracos ?? spec.torso ?? 0x3355aa, spec.acabamento || {});
    const matPerna = voxMaterial(spec.pernas ?? 0x2f3b4a, spec.acabamento || {});

    // ---- tronco: 8 x 12 x 4, dos 12 aos 24 voxels de altura
    this.torso = bloco(8, 12, 4, matTorso);
    this.torso.position.y = 18 * VX;
    this.torso.castShadow = true;
    this.corpo.add(this.torso);

    // ---- cabeça: 8³, dos 24 aos 32. Grupo próprio para olhar em volta.
    this.pescoco = new THREE.Group();
    this.pescoco.position.y = 24 * VX;
    this.corpo.add(this.pescoco);

    this.cabeca = bloco(8, 8, 8, spec.cabecaCor ? voxMaterial(spec.cabecaCor, spec.acabamento || {}) : pele);
    this.cabeca.position.y = 4 * VX;
    this.cabeca.castShadow = true;
    this.pescoco.add(this.cabeca);

    // ---- braços: pivô no ombro (y = 24), balançam de lá
    this.bracoE = new THREE.Group();
    this.bracoD = new THREE.Group();
    this.bracoE.position.set(-6 * VX, 23 * VX, 0);
    this.bracoD.position.set(6 * VX, 23 * VX, 0);
    for (const [g, lado] of [[this.bracoE, -1], [this.bracoD, 1]]) {
      const b = bloco(4, 12, 4, matBraco, true);
      b.castShadow = true;
      g.add(b);
      g.userData.lado = lado;
      this.corpo.add(g);
    }

    // ---- pernas: pivô no quadril (y = 12)
    this.pernaE = new THREE.Group();
    this.pernaD = new THREE.Group();
    this.pernaE.position.set(-2 * VX, 12 * VX, 0);
    this.pernaD.position.set(2 * VX, 12 * VX, 0);
    for (const g of [this.pernaE, this.pernaD]) {
      const p = bloco(4, 12, 4, matPerna, true);
      p.castShadow = true;
      g.add(p);
      this.corpo.add(g);
    }

    // ---- peças extras, penduradas na parte que a definição mandar
    this.extras = [];
    const destino = {
      cabeca: this.pescoco, torso: this.torso, corpo: this.corpo,
      bracoE: this.bracoE, bracoD: this.bracoD,
    };
    for (const e of spec.extras || []) {
      const alvo = destino[e.em || 'cabeca'] || this.pescoco;
      // no tronco o pivô é o centro da peça; compensa para o extra usar
      // a mesma régua de voxels da figura toda (0 = pé)
      const off = alvo === this.torso ? -18 : (alvo === this.pescoco ? -24 : 0);
      this.extras.push(extra({ ...e, y: (e.y || 0) + off }, alvo));
    }

    // ---- estado de animação
    this.t = Math.random() * 10;      // fase própria: ninguém anda em sincronia
    this.passo = 0;
    this.gestoBraco = 0;              // 0..1 acena / mira
    this.ataque = 0;                  // 0..1 tempo restante do golpe
    this.dano = 0;                    // 0..1 piscada de dano
    this.morto = false;
    this.carrying = false;            // [50] segurando o pacote

    this._matsOriginais = null;
  }

  get position() { return this.root.position; }

  // ---- apelidos que mantêm a API do `Human` da cidade ----
  get armGesture() { return this.gestoBraco; }
  set armGesture(v) { this.gestoBraco = v; }

  /** Vira o corpo inteiro para um rumo (radianos). */
  set rumo(r) { this.root.rotation.y = r; }
  get rumo() { return this.root.rotation.y; }

  /**
   * @param {number} dt
   * @param {number} vel  velocidade horizontal em m/s (0 = parado)
   */
  update(dt, vel = 0) {
    this.t += dt;

    if (this.morto) {
      // tomba para a frente e fica
      this.corpo.rotation.x = Math.min(Math.PI / 2, this.corpo.rotation.x + dt * 4);
      return;
    }

    // ---- pernas e braços
    const andando = vel > 0.15;
    if (andando) {
      // cadência proporcional à velocidade: correr não vira moonwalk
      this.passo += dt * Math.min(14, 3.2 + vel * 1.9);
      const a = Math.sin(this.passo) * Math.min(0.85, 0.28 + vel * 0.075);
      this.pernaE.rotation.x = a;
      this.pernaD.rotation.x = -a;
      this.bracoE.rotation.x = -a * 0.8;
      this.bracoD.rotation.x = a * 0.8;
    } else {
      // parado: respiração leve, senão o boneco parece congelado
      const r = Math.sin(this.t * 1.6) * 0.045;
      this.pernaE.rotation.x *= 0.85;
      this.pernaD.rotation.x *= 0.85;
      this.bracoE.rotation.x = -r;
      this.bracoD.rotation.x = r;
      this.torso.position.y = (18 + Math.sin(this.t * 1.6) * 0.12) * VX;
    }

    // braços afastados do corpo enquanto anda (senão atravessam o tronco)
    this.bracoE.rotation.z = 0.06 + (andando ? 0.04 : 0);
    this.bracoD.rotation.z = -0.06 - (andando ? 0.04 : 0);

    // ---- golpe: braço direito à frente, rápido na ida e devagar na volta
    if (this.ataque > 0) {
      this.ataque = Math.max(0, this.ataque - dt * 3.4);
      const f = Math.sin((1 - this.ataque) * Math.PI);
      this.bracoD.rotation.x = -1.9 * f;
      this.bracoD.rotation.z = -0.06 - 0.5 * f;
    }

    // ---- [50] pacote em mãos: os dois braços à frente, segurando
    if (this.carrying) {
      this.bracoE.rotation.x = -1.35;
      this.bracoD.rotation.x = -1.35;
      this.bracoE.rotation.z = 0.16;
      this.bracoD.rotation.z = -0.16;
    }

    // ---- gesto de acenar (portador do pacote, NPC chamando)
    if (this.gestoBraco > 0) {
      this.bracoE.rotation.x = -2.3 + Math.sin(this.t * 7) * 0.4;
      this.bracoE.rotation.z = 0.5;
    }

    // ---- piscada de dano
    if (this.dano > 0) {
      this.dano = Math.max(0, this.dano - dt * 2.6);
      this._pintarDano(this.dano > 0 && Math.sin(this.dano * 40) > 0);
    }
  }

  golpear() { this.ataque = 1; }

  levarDano() {
    this.dano = 1;
  }

  matar() {
    this.morto = true;
    this._pintarDano(false);
  }

  /**
   * Pinta o boneco de branco por um instante ao levar dano.
   *
   * Troca `emissive` em vez de `color`: o material é COMPARTILHADO entre
   * todos os bonecos da mesma cor, então mexer nele pintaria a turma
   * inteira. Por isso cada figura ganha cópias próprias na primeira vez
   * que apanha — e só aí, para quem nunca apanhar não custar nada.
   */
  _pintarDano(ligado) {
    if (!this._matsOriginais) {
      this._matsOriginais = [];
      this.corpo.traverse((o) => {
        if (!o.isMesh) return;
        this._matsOriginais.push([o, o.material]);
        o.material = o.material.clone();
      });
    }
    for (const [o] of this._matsOriginais) {
      o.material.emissive.setHex(ligado ? 0xffffff : 0x000000);
      o.material.emissiveIntensity = ligado ? 0.75 : 0;
    }
  }

  /** Sombra do corpo inteiro custa caro em multidão; só o tronco basta. */
  sombraSimples() {
    this.corpo.traverse((o) => { if (o.isMesh) o.castShadow = false; });
    this.torso.castShadow = true;
    this.cabeca.castShadow = true;
  }

  addTo(parent) { parent.add(this.root); return this; }

  dispose() {
    this.corpo.traverse((o) => {
      if (o.isMesh && this._matsOriginais) o.material.dispose();
    });
    this.root.removeFromParent();
  }
}
