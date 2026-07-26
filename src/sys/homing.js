import * as THREE from 'three';

/**
 * ============================================================
 *  MÍSSIL TELEGUIADO — a arma da trava
 * ============================================================
 *
 * Uma arma pesada com recarga longa: aponta a mira num inimigo, a trava
 * fecha, e o míssil PERSEGUE ele até acertar.
 *
 * Ela existe para resolver um problema concreto da campanha a céu
 * aberto. O tiro comum e o míssil do helicóptero são balísticos: contra
 * um drone que zigue-zagueia a 40 m, ou contra um chefão de 15 m que
 * anda enquanto você recua, acertar vira loteria. O teleguiado dá um
 * golpe FORTE e CERTO — em troca de esperar a recarga.
 *
 * ---- COMO A TRAVA FUNCIONA ----
 * Não é raio exato. A mira acha o inimigo cujo ângulo em relação à
 * direção da câmera é o menor dentro de um cone; assim vale "colocar a
 * mira em cima", que é o que o jogador acha que está fazendo, e não
 * "encostar o raio no colisor", que é o que a matemática faria.
 *
 * O cone é generoso de perto e apertado de longe — isso sai de graça da
 * própria geometria: um alvo distante ocupa menos ângulo.
 */

const MAX = 6;
const VEL_INICIAL = 42;
const VEL_MAX = 120;
const ACEL = 55;
const GIRO = 3.4;             // rad/s de correção de rumo: persegue firme
const VIDA = 9;
const RAIO_ACERTO = 3.2;
/** Meio-ângulo do cone de trava (radianos). ~14° dá "mirei nele". */
const CONE = 0.25;
export const ALCANCE_TRAVA = 260;

export class HomingMissiles {
  /**
   * @param {THREE.Scene} scene
   * @param {object} fx     efeitos (fumaça e explosão)
   * @param {number} recarga  segundos entre disparos
   */
  constructor(scene, fx, recarga = 11) {
    this.fx = fx;
    this.recargaMax = recarga;
    this.recarga = 0;

    const geo = new THREE.ConeGeometry(0.42, 2.2, 10);
    geo.rotateX(Math.PI / 2);            // aponta para -Z, o "para frente"
    const mat = new THREE.MeshStandardMaterial({
      color: 0xe8e8ea, emissive: 0x25d0ff, emissiveIntensity: 0.55,
      roughness: 0.35, metalness: 0.6,
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, MAX);
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(this.mesh);

    this.itens = [];
    for (let i = 0; i < MAX; i++) {
      this.itens.push({
        vivo: false, t: 0, vel: VEL_INICIAL, fumaca: 0,
        p: new THREE.Vector3(), d: new THREE.Vector3(), alvo: null,
      });
    }

    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._fora = new THREE.Matrix4().makeScale(0, 0, 0);
    this._up = new THREE.Vector3(0, 1, 0);
    this._tmp = new THREE.Vector3();

    this.onAcerto = null;
    this._esconderTodos();
  }

  _esconderTodos() {
    for (let i = 0; i < MAX; i++) this.mesh.setMatrixAt(i, this._fora);
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  get pronto() { return this.recarga <= 0; }
  /** 0 = recarregando agora, 1 = pronto. Serve para a barra no HUD. */
  get carga() { return this.recargaMax ? 1 - this.recarga / this.recargaMax : 1; }

  /**
   * Acha o inimigo travável mais alinhado com a mira.
   *
   * @param {THREE.Vector3} origem     posição da câmera
   * @param {THREE.Vector3} direcao    para onde a mira aponta (normalizada)
   * @param {Array} inimigos           lista de Foe / CityBoss
   * @returns {object|null}
   */
  procurarAlvo(origem, direcao, inimigos) {
    if (!inimigos || !inimigos.length) return null;
    let melhor = null, melhorAng = CONE;

    for (const f of inimigos) {
      if (!f || !f.vivo) continue;
      const c = f.root.position;
      this._tmp.set(c.x, c.y + (f.alturaAlvo || 1), c.z).sub(origem);
      const d = this._tmp.length();
      if (d < 3 || d > ALCANCE_TRAVA) continue;
      this._tmp.divideScalar(d);

      // ângulo entre a mira e o alvo
      const cos = Math.min(1, Math.max(-1, this._tmp.dot(direcao)));
      const ang = Math.acos(cos);
      /*
       * Alvo grande "puxa" a trava: o meio-ângulo que ele ocupa na tela
       * conta a favor. Sem isso, um colosso de 55 m visto de perto ficava
       * MAIS difícil de travar que um drone — o centro dele sai do cone
       * justamente quando ele enche a tela.
       */
      const folga = Math.atan2(f.raioAcerto || 1, d);
      if (ang - folga < melhorAng) { melhorAng = ang - folga; melhor = f; }
    }
    return melhor;
  }

  /** @returns {boolean} true se disparou */
  disparar(origem, direcao, alvo) {
    if (this.recarga > 0 || !alvo || !alvo.vivo) return false;
    const m = this.itens.find((x) => !x.vivo);
    if (!m) return false;

    this.recarga = this.recargaMax;
    m.vivo = true; m.t = 0; m.vel = VEL_INICIAL; m.fumaca = 0;
    m.alvo = alvo;
    m.p.copy(origem).addScaledVector(direcao, 2.2);
    m.d.copy(direcao).normalize();
    return true;
  }

  update(dt) {
    this.recarga = Math.max(0, this.recarga - dt);

    for (let i = 0; i < MAX; i++) {
      const m = this.itens[i];
      if (!m.vivo) { this.mesh.setMatrixAt(i, this._fora); continue; }

      m.t += dt;
      // o alvo morreu no caminho: o míssil segue reto e expira
      if (m.alvo && !m.alvo.vivo) m.alvo = null;
      if (m.t > VIDA) { this._apagar(i, m); continue; }

      if (m.alvo) {
        const c = m.alvo.root.position;
        this._tmp.set(c.x, c.y + (m.alvo.alturaAlvo || 1), c.z).sub(m.p);
        const dist = this._tmp.length();

        if (dist < RAIO_ACERTO + (m.alvo.raioAcerto || 1)) {
          if (this.fx) this.fx.explode(m.p, 2.4);
          if (this.onAcerto) this.onAcerto(m.alvo, m.p.clone());
          this._apagar(i, m);
          continue;
        }
        // correção de rumo limitada: curva firme, mas ainda é um míssil
        this._tmp.divideScalar(dist);
        m.d.lerp(this._tmp, Math.min(1, GIRO * dt)).normalize();
      }

      m.vel = Math.min(VEL_MAX, m.vel + ACEL * dt);
      const passo = m.vel * dt;
      m.p.addScaledVector(m.d, passo);

      // rastro por DISTÂNCIA, não por quadro: fica igual em qualquer FPS
      m.fumaca += passo;
      while (m.fumaca > 2.0 && this.fx) {
        m.fumaca -= 2.0;
        this.fx.trail(m.p.x - m.d.x * 1.2, m.p.y - m.d.y * 1.2, m.p.z - m.d.z * 1.2);
      }

      this._q.setFromUnitVectors(new THREE.Vector3(0, 0, -1), m.d);
      this._m.compose(m.p, this._q, { x: 1, y: 1, z: 1 });
      this.mesh.setMatrixAt(i, this._m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  _apagar(i, m) {
    m.vivo = false;
    m.alvo = null;
    this.mesh.setMatrixAt(i, this._fora);
  }

  limpar() {
    for (const m of this.itens) { m.vivo = false; m.alvo = null; }
    this._esconderTodos();
  }
}
