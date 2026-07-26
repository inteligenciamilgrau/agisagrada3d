import * as THREE from 'three';

/**
 * ============================================================
 *  CANETADAS — os decretos voadores do Trunfo
 * ============================================================
 *
 * "Vou resolver isso do jeito que resolvo tudo: NA CANETADA!"
 *
 * Folhas de decreto douradas que saem da mão do gigante e perseguem o
 * helicóptero. São o ataque de longo alcance dele: sem isso, bastava
 * ficar parado no ar a 200 m e metralhar de míssil sem risco nenhum.
 *
 * ---- A PERSEGUIÇÃO DECAI ----
 * A folha corrige o rumo com força no começo e vai PERDENDO a
 * capacidade de virar, até seguir reto.
 *
 * Uma taxa constante, por menor que fosse, acabava sempre acertando:
 * bastava a folha ser mais rápida que o alvo e o encontro virava
 * questão de tempo. Não havia manobra que resolvesse, só esperar a
 * batida — e foi assim que as cartas do Deep-Zeek viraram imposto.
 *
 * Com o decaimento existe uma JANELA: quem aguenta os dois primeiros
 * segundos e então corta vê o papel se comprometer com o rumo errado
 * e passar reto.
 */

const MAX = 24;
const VEL = 44;
/** Correção de rumo INICIAL (rad/s). Decai até zero em TEMPO_GUIA. */
const GIRO = 1.9;
/** Depois disto a folha não corrige mais: segue reto até expirar. */
const TEMPO_GUIA = 2.2;
const VIDA = 5.0;
const RAIO_ACERTO = 4.5;

export class Canetadas {
  constructor(scene, fx) {
    this.fx = fx;

    // uma folha de papel: plano fino dourado, dois lados
    const geo = new THREE.BoxGeometry(2.6, 0.12, 3.6);
    const mat = new THREE.MeshStandardMaterial({
      color: 0xffd700, emissive: 0xffb020, emissiveIntensity: 0.7,
      roughness: 0.45, metalness: 0.3,
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, MAX);
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(this.mesh);

    this.itens = [];
    for (let i = 0; i < MAX; i++) {
      this.itens.push({
        vivo: false, t: 0,
        p: new THREE.Vector3(), v: new THREE.Vector3(),
      });
    }

    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler();
    this._fora = new THREE.Matrix4().makeScale(0, 0, 0);
    this._tmp = new THREE.Vector3();

    this.onAcerto = null;
    this._esconderTodas();
  }

  _esconderTodas() {
    for (let i = 0; i < MAX; i++) this.mesh.setMatrixAt(i, this._fora);
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  disparar(origem, alvo) {
    const c = this.itens.find((x) => !x.vivo);
    if (!c) return false;
    c.vivo = true;
    c.t = 0;
    c.p.copy(origem);
    c.v.copy(alvo).sub(origem).normalize().multiplyScalar(VEL);
    return true;
  }

  /**
   * @param {THREE.Vector3} alvo  posição do helicóptero (ou do jogador)
   * @returns {number} dano causado neste quadro
   */
  update(dt, alvo) {
    let dano = 0;

    for (let i = 0; i < MAX; i++) {
      const c = this.itens[i];
      if (!c.vivo) { this.mesh.setMatrixAt(i, this._fora); continue; }

      c.t += dt;
      if (c.t > VIDA) { c.vivo = false; this.mesh.setMatrixAt(i, this._fora); continue; }

      // ---- correção de rumo, decaindo com a idade do papel
      const guia = GIRO * Math.max(0, 1 - c.t / TEMPO_GUIA);
      if (alvo) {
        this._tmp.copy(alvo).sub(c.p);
        const d = this._tmp.length();
        if (d > 0.001) {
          this._tmp.divideScalar(d);
          const atual = c.v.clone().normalize();
          // gira `GIRO * dt` radianos na direção do alvo
          const passo = Math.min(1, guia * dt);
          atual.lerp(this._tmp, passo).normalize();
          c.v.copy(atual).multiplyScalar(VEL);
        }

        if (d < RAIO_ACERTO) {
          c.vivo = false;
          this.mesh.setMatrixAt(i, this._fora);
          if (this.fx) this.fx.explode(c.p, 1.1);
          if (this.onAcerto) this.onAcerto(c.p);
          dano += 1;
          continue;
        }
      }

      c.p.addScaledVector(c.v, dt);

      // a folha roda enquanto voa — papel em turbilhão
      this._e.set(c.t * 3.1, Math.atan2(c.v.x, c.v.z), c.t * 4.7);
      this._q.setFromEuler(this._e);
      this._m.compose(c.p, this._q, { x: 1, y: 1, z: 1 });
      this.mesh.setMatrixAt(i, this._m);
    }

    this.mesh.instanceMatrix.needsUpdate = true;
    return dano;
  }

  limpar() {
    for (const c of this.itens) c.vivo = false;
    this._esconderTodas();
  }
}
