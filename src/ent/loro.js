import * as THREE from 'three';
import { MODELOS, montarModelo } from './voxeldef.js';

/**
 * ============================================================
 *  Loro Estocástico — o mascote que voa junto
 * ============================================================
 *
 * O papagaio da comunidade acompanha o Bob o tempo todo: voa atrás e um
 * pouco acima do ombro, pousa quando o Bob para e sai batendo asa quando
 * ele corre.
 *
 * Ele NÃO segue a posição do Bob diretamente. Persegue um ponto-alvo
 * atrás do ombro com amortecimento, e é essa folga que faz parecer bicho
 * e não peça grudada: quando o Bob vira de repente, o Loro faz a curva
 * larga e alcança depois, como um pássaro faria.
 */

const ALVO_ALTURA = 2.35;      // acima dos pés do Bob
const ALVO_ATRAS = 1.15;       // atrás do ombro
const ALVO_LADO = 0.85;        // deslocado para a direita

export class Loro {
  constructor(scene) {
    const m = montarModelo(MODELOS.loro);
    this.root = m.root;
    this.corpo = m.corpo;
    this.asas = m.asas;
    this.root.scale.setScalar(0.55);      // bicho de ombro, não de mochila
    scene.add(this.root);

    this.alvo = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.t = 0;
    this._iniciado = false;

    /*
     * ---- "Repetição Infinita" ----
     * No jogo 2D o Loro repetia o último golpe que viu na tela. Aqui a
     * tradução é: o Bob atira NO AR e o Loro copia — mergulha no inimigo
     * mais próximo. Fica sendo o golpe aéreo do jogo, e continua sendo
     * uma piada sobre papagaio estocástico repetindo o que ouviu.
     */
    this.estado = 'segue';        // segue | mergulha | volta
    this.presa = null;            // Foe visado
    this.recarga = 0;             // não pode sair mergulhando sem parar
    this.onAcerto = null;
  }

  get podeAtacar() { return this.estado === 'segue' && this.recarga <= 0; }

  /** Manda o Loro em cima de um inimigo. */
  atacar(foe) {
    if (!this.podeAtacar || !foe || !foe.vivo) return false;
    this.presa = foe;
    this.estado = 'mergulha';
    this.recarga = 1.1;
    return true;
  }

  set visible(v) { this.root.visible = v; }
  get visible() { return this.root.visible; }

  /**
   * @param {THREE.Vector3} dono  posição (nos pés) de quem ele segue
   * @param {number} yaw          para onde o dono está virado
   * @param {number} vel          velocidade do dono em m/s
   */
  update(dt, dono, yaw, vel = 0) {
    this.t += dt;
    this.recarga = Math.max(0, this.recarga - dt);

    // ---- para onde ele está indo agora
    const sn = Math.sin(yaw), cs = Math.cos(yaw);
    let perseguindo = false;

    if (this.estado === 'mergulha') {
      const p = this.presa;
      if (!p || !p.vivo) {
        this.estado = 'volta'; this.presa = null;
      } else {
        perseguindo = true;
        const a = p.root.position;
        this.alvo.set(a.x, a.y + (p.alturaAlvo || 1), a.z);
        // encostou: crava o bico e volta
        if (this.root.position.distanceTo(this.alvo) < 1.1) {
          if (this.onAcerto) this.onAcerto(p);
          this.estado = 'volta';
          this.presa = null;
        }
      }
    }

    if (!perseguindo) {
      // ponto atrás do ombro direito, no referencial do dono
      this.alvo.set(
        dono.x - sn * ALVO_ATRAS + cs * ALVO_LADO,
        dono.y + ALVO_ALTURA + Math.sin(this.t * 2.1) * 0.16,
        dono.z - cs * ALVO_ATRAS - sn * ALVO_LADO,
      );
      // já voltou para perto do ombro: volta a só seguir
      if (this.estado === 'volta' && this.root.position.distanceTo(this.alvo) < 1.6) {
        this.estado = 'segue';
      }
    }

    if (!this._iniciado) { this.root.position.copy(this.alvo); this._iniciado = true; }

    /*
     * Mola amortecida em vez de `lerp` direto. O `lerp` chega ao alvo e
     * para seco; a mola passa um pouco e volta, que é o balanço que faz
     * a coisa parecer viva.
     */
    const p = this.root.position;
    // mergulhando a mola fica MUITO mais dura: é investida, não passeio
    const atacando = this.estado === 'mergulha';
    const k = atacando ? 190 : 26;
    const amort = atacando ? 16 : 8.5;
    this.vel.x += ((this.alvo.x - p.x) * k - this.vel.x * amort) * dt;
    this.vel.y += ((this.alvo.y - p.y) * k - this.vel.y * amort) * dt;
    this.vel.z += ((this.alvo.z - p.z) * k - this.vel.z * amort) * dt;
    p.addScaledVector(this.vel, dt);

    // no mergulho ele gira feito um parafuso — dá leitura de ataque
    this.corpo.rotation.z = atacando ? this.t * 22 : 0;

    // olha para onde está indo; parado, encara o mesmo rumo do dono
    const vh = Math.hypot(this.vel.x, this.vel.z);
    if (vh > 0.35) this.root.rotation.y = Math.atan2(this.vel.x, this.vel.z);
    else this.root.rotation.y = yaw;

    // inclina no sentido do voo
    this.corpo.rotation.x = -Math.min(0.4, vh * 0.10);

    /*
     * As asas batem mais rápido quanto mais ele precisa correr atrás.
     * Quase parado, o bater vira um planar lento — o Loro "pousa" no ar.
     */
    const bater = Math.min(19, 5 + vh * 3.4 + vel * 1.2);
    const a = Math.sin(this.t * bater) * (0.35 + Math.min(0.7, vh * 0.16));
    if (this.asas[0]) this.asas[0].rotation.z = 0.35 + a;
    if (this.asas[1]) this.asas[1].rotation.z = -0.35 - a;
  }

  dispose() { this.root.removeFromParent(); }
}
