import * as THREE from 'three';
import { voxMaterial, VX } from './voxel.js';

/**
 * ============================================================
 *  A arma na tela (viewmodel)
 * ============================================================
 *
 * O canto inferior direito da tela, estilo Doom: a mão do Bob segurando
 * o **Prompt Mágico** — o tablet-pergaminho dourado que, no roteiro,
 * materializa os prompts que ele digita.
 *
 * ---- COMO ELA FICA SEMPRE NA FRENTE ----
 * A arma é filha da CÂMERA, não da cena. Assim ela acompanha o olhar de
 * graça, sem precisar recalcular posição a cada quadro.
 *
 * Duas consequências que precisaram de cuidado:
 *
 * 1. Objeto filho de câmera só é desenhado se a própria câmera estiver
 *    na cena. Three.js percorre o grafo a partir da cena, e uma câmera
 *    solta não é visitada — a arma simplesmente não apareceria.
 * 2. Com 0,35 m de distância ela cairia dentro do `near` da câmera e
 *    seria cortada. Por isso o modelo é MINIATURA (escala ~0.5) e fica
 *    logo além do plano de corte, em vez de ser um objeto de tamanho
 *    real colado no rosto.
 */

const POS_REPOUSO = new THREE.Vector3(0.26, -0.22, -0.52);

export class ViewModel {
  constructor(camera, scene) {
    this.cam = camera;

    // a câmera precisa estar na cena para os filhos dela serem desenhados
    if (!camera.parent) scene.add(camera);

    this.root = new THREE.Group();
    this.root.position.copy(POS_REPOUSO);
    this.root.visible = false;
    /*
     * renderOrder alto + sem escrita de profundidade contra o mundo não
     * resolve sozinho a interpenetração em parede; o que resolve é a
     * arma ser pequena e próxima. Mantemos a profundidade normal para
     * ela receber a luz e a sombra da cena como qualquer objeto.
     */
    camera.add(this.root);

    this._montar();

    this.t = 0;
    this.coice = 0;      // 0..1, decai depois do tiro
    this.balanco = 0;
  }

  _montar() {
    const g = new THREE.Group();
    g.scale.setScalar(0.5);
    this.root.add(g);

    const bloco = (w, h, d, x, y, z, mat) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w * VX, h * VX, d * VX), mat);
      m.position.set(x * VX, y * VX, z * VX);
      g.add(m);
      return m;
    };

    const pele = voxMaterial(0xd9a066);
    const manga = voxMaterial(0x6b4423);          // jaqueta de couro do Bob
    const dourado = voxMaterial(0xffb020, { metal: 0.6, aspereza: 0.28, emissivo: 0.55 });
    const moldura = voxMaterial(0x8a6a2e, { metal: 0.7, aspereza: 0.3 });

    // antebraço entrando pelo canto da tela
    bloco(4, 4, 12, 0, -3, 4, manga);
    // mão
    bloco(4.4, 4.4, 4, 0, -1.4, -2, pele);
    // o Prompt Mágico: moldura + tela acesa virada para o jogador
    bloco(9, 11, 1.2, 0, 2.2, -3.4, moldura);
    this.tela = bloco(7.6, 9.4, 0.5, 0, 2.2, -4.1, dourado);

    // três "linhas de prompt" que piscam na tela
    this.linhas = [];
    for (let i = 0; i < 3; i++) {
      const l = bloco(5.2 - i * 1.2, 0.9, 0.3, -0.6 + i * 0.3, 4.4 - i * 2, -4.5,
        voxMaterial(0xfff0c0, { emissivo: 1.5 }));
      this.linhas.push(l);
    }
  }

  set visible(v) { this.root.visible = v; }
  get visible() { return this.root.visible; }

  /** Chamado a cada tiro. */
  darCoice() { this.coice = 1; }

  /**
   * @param {number} vel  velocidade do jogador (dá o balanço do passo)
   */
  update(dt, vel = 0) {
    if (!this.root.visible) return;
    this.t += dt;
    this.coice = Math.max(0, this.coice - dt * 5.5);

    // balanço do passo: sobe e desce em oito, como a mão de quem anda
    this.balanco = damp(this.balanco, Math.min(1, vel / 5), 6, dt);
    const b = this.balanco;
    const bx = Math.sin(this.t * 7.5) * 0.014 * b;
    const by = Math.abs(Math.cos(this.t * 7.5)) * 0.016 * b;

    // coice: recua e levanta o bico
    const c = this.coice * this.coice;
    this.root.position.set(
      POS_REPOUSO.x + bx,
      POS_REPOUSO.y - by + c * 0.03,
      POS_REPOUSO.z + c * 0.10,
    );
    this.root.rotation.x = c * 0.42;
    this.root.rotation.z = Math.sin(this.t * 3.7) * 0.02 * b;

    // as linhas de prompt piscam em cadência própria
    for (let i = 0; i < this.linhas.length; i++) {
      const on = Math.sin(this.t * (3.1 + i * 1.7)) > -0.35;
      this.linhas[i].visible = on;
    }
  }
}

/** Amortecimento exponencial, igual ao de `utils.js` (evita import circular). */
function damp(a, b, lambda, dt) {
  return b + (a - b) * Math.exp(-lambda * dt);
}
