import * as THREE from 'three';
import { voxMaterial, VX } from '../ent/voxel.js';

/**
 * ============================================================
 *  ITENS QUE CAEM DO INIMIGO
 * ============================================================
 *
 * O roteiro do jogo 2D lista os itens de cura dentro de caixotes:
 * café coado (recupera pouco), guaraná (médio), churrasco (vida cheia)
 * e a GPU dourada (item raro). Aqui eles caem de quem você derruba.
 *
 * ---- POR QUE ISSO IMPORTA ----
 * Sem drop, a única direção possível da vida é para baixo: cada fase é
 * um orçamento fixo de corações que só encolhe. Com drop, LUTAR BEM
 * paga — quem enfrenta a onda de perto e limpa rápido recupera o que
 * gastou, e quem foge fica sem. É o incentivo invertido em relação à
 * regeneração por tempo, e os dois juntos cobrem os dois estilos.
 *
 * O item fica GIRANDO e SUBINDO E DESCENDO de propósito: objeto parado
 * no chão de uma cidade inteira some no ruído visual; movimento é o que
 * o olho pega na periferia.
 */

/** O que pode cair, com o peso do sorteio. */
export const ITENS = {
  cafe:       { cura: 1, cor: 0x6b4423, peso: 46, nome: 'CAFÉ COADO',  raio: 0.9 },
  guarana:    { cura: 2, cor: 0x3ddc84, peso: 30, nome: 'GUARANÁ',     raio: 1.0 },
  churrasco:  { cura: 99, cor: 0xc0392b, peso: 12, nome: 'CHURRASCO',  raio: 1.1 },
  gpu:        { cura: 0, cor: 0xffd700, peso: 12, nome: 'GPU DOURADA', raio: 1.0, recarrega: true },
};

const VIDA = 26;              // segundos até sumir
const RAIO_COLETA = 2.6;

export class Drops {
  constructor(scene, fx) {
    this.scene = scene;
    this.fx = fx;
    this.itens = [];
    this.grupo = new THREE.Group();
    scene.add(this.grupo);
    this.onColeta = null;
    this.t = 0;
  }

  /**
   * Sorteia e solta um item na posição de quem caiu.
   *
   * @param {THREE.Vector3} pos
   * @param {number} chance  0..1 (chefão usa 1)
   */
  talvezSoltar(pos, chance = 0.22) {
    if (Math.random() > chance) return null;

    // sorteio ponderado: café é comum, churrasco e GPU são achado
    const total = Object.values(ITENS).reduce((s, i) => s + i.peso, 0);
    let r = Math.random() * total, chave = 'cafe';
    for (const [k, v] of Object.entries(ITENS)) {
      r -= v.peso;
      if (r <= 0) { chave = k; break; }
    }
    return this.soltar(pos, chave);
  }

  soltar(pos, chave) {
    const def = ITENS[chave];
    if (!def) return null;

    const g = new THREE.Group();
    const mat = voxMaterial(def.cor, { emissivo: 0.75, aspereza: 0.5 });

    // caixote voxel: um cubo com cintas cruzadas, como no jogo 2D
    const cubo = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.9, 0.9), mat);
    cubo.castShadow = true;
    g.add(cubo);
    const fita = voxMaterial(0xf0e6c8, { emissivo: 0.35 });
    for (const eixo of ['x', 'y']) {
      const f = new THREE.Mesh(
        new THREE.BoxGeometry(eixo === 'x' ? 0.98 : 0.16, eixo === 'x' ? 0.16 : 0.98, 0.98), fita);
      g.add(f);
    }

    // halo no chão: é o que denuncia o item a 30 m de distância
    const anel = new THREE.Mesh(
      new THREE.RingGeometry(0.7, 1.15, 20),
      new THREE.MeshBasicMaterial({
        color: def.cor, transparent: true, opacity: 0.55, side: THREE.DoubleSide,
        depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
      }),
    );
    anel.rotation.x = -Math.PI / 2;
    g.add(anel);

    g.position.set(pos.x, pos.y, pos.z);
    this.grupo.add(g);

    const item = { chave, def, g, cubo, anel, t: 0, baseY: pos.y };
    this.itens.push(item);
    return item;
  }

  /**
   * @param {THREE.Vector3} jogador
   * @returns {object|null} o item coletado neste quadro
   */
  update(dt, jogador, col) {
    this.t += dt;
    let pego = null;

    for (let i = this.itens.length - 1; i >= 0; i--) {
      const it = this.itens[i];
      it.t += dt;

      if (it.t > VIDA) { this._remover(i); continue; }

      // assenta no chão do lugar onde caiu (pode ter caído num telhado)
      if (it.t < 0.1 && col) it.baseY = col.groundHeightAt(it.g.position.x, it.g.position.z, it.baseY + 2);

      it.g.position.y = it.baseY + 1.1 + Math.sin(this.t * 2.6 + i) * 0.22;
      it.cubo.rotation.y += dt * 1.7;
      it.cubo.rotation.x = Math.sin(this.t * 1.3 + i) * 0.16;
      it.anel.position.y = it.baseY - it.g.position.y + 0.08;
      const p = 1 + Math.sin(this.t * 3.4 + i) * 0.13;
      it.anel.scale.set(p, p, 1);

      /*
       * Perto do fim ele PISCA. Sumir sem aviso faz o jogador achar que
       * pegou quando não pegou; piscar dá o segundo de urgência que
       * transforma o item em decisão ("dá tempo de buscar?").
       */
      if (it.t > VIDA - 5) it.g.visible = Math.sin(it.t * 14) > -0.35;

      if (!pego) {
        const d = Math.hypot(jogador.x - it.g.position.x, jogador.z - it.g.position.z);
        const dy = Math.abs(jogador.y - it.baseY);
        if (d < RAIO_COLETA && dy < 4) {
          pego = it;
          if (this.fx) this.fx.impact(it.g.position, new THREE.Vector3(0, 1, 0));
          this._remover(i);
          if (this.onColeta) this.onColeta(it);
        }
      }
    }
    return pego;
  }

  _remover(i) {
    const it = this.itens[i];
    it.g.removeFromParent();
    this.itens.splice(i, 1);
  }

  limpar() {
    for (const it of this.itens) it.g.removeFromParent();
    this.itens = [];
  }
}
