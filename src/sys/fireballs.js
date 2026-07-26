import * as THREE from 'three';

/**
 * ============================================================
 *  BOLAS DE FOGO — o tiro dos inimigos
 * ============================================================
 *
 * Projétil lento, grande e brilhante, do jeito que os beat 'em up e os
 * FPS antigos faziam: você VÊ a bola saindo, ela leva um tempo até
 * chegar, e cabe a você sair da frente.
 *
 * ---- POR QUE LENTO ----
 * Tiro instantâneo (hitscan) não tem defesa: quando o inimigo decide
 * acertar, acertou, e o jogador só pode reclamar. Com projétil visível
 * a decisão volta para as mãos de quem joga — o inimigo cria a AMEAÇA,
 * e quem resolve se ela vira dano é você. É a diferença entre um jogo
 * que testa reflexo e um que testa sorte.
 *
 * ---- O TAMANHO É A ASSINATURA ----
 * O raio da bola é proporcional ao dono. Um drone cospe uma bolinha; um
 * colosso de 55 m atira uma esfera de seis metros que ilumina a rua.
 * Assim dá para julgar a ameaça pelo que se vê voando, sem precisar
 * olhar quem atirou — e a bola grande também é mais fácil de desviar,
 * o que compensa doer mais.
 */

const MAX = 64;
const VIDA = 6.0;

export class Fireballs {
  constructor(scene, fx) {
    this.fx = fx;

    /*
     * Uma esfera de raio 1 escalada por instância. O material é
     * `MeshBasicMaterial`: bola de fogo não recebe luz, ela É a luz —
     * sombrear faria o lado de trás ficar escuro e matar o brilho.
     */
    const geo = new THREE.SphereGeometry(1, 12, 10);
    const mat = new THREE.MeshBasicMaterial({ toneMapped: false });
    this.mesh = new THREE.InstancedMesh(geo, mat, MAX);
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 3), 3);
    scene.add(this.mesh);

    // halo: uma casca maior e translúcida, que dá o "brilho" sem luz real
    const halo = new THREE.MeshBasicMaterial({
      transparent: true, opacity: 0.28, depthWrite: false,
      blending: THREE.AdditiveBlending, toneMapped: false,
    });
    this.halo = new THREE.InstancedMesh(geo, halo, MAX);
    this.halo.frustumCulled = false;
    this.halo.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.halo.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 3), 3);
    scene.add(this.halo);

    this.itens = [];
    for (let i = 0; i < MAX; i++) {
      this.itens.push({
        vivo: false, t: 0, raio: 1, dano: 1,
        p: new THREE.Vector3(), v: new THREE.Vector3(),
        cor: new THREE.Color(0xff7a1a),
      });
    }

    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._e = new THREE.Vector3();
    this._fora = new THREE.Matrix4().makeScale(0, 0, 0);
    this._tmp = new THREE.Vector3();
    this._esconderTodas();

    this.onAcerto = null;
  }

  _esconderTodas() {
    for (let i = 0; i < MAX; i++) {
      this.mesh.setMatrixAt(i, this._fora);
      this.halo.setMatrixAt(i, this._fora);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.halo.instanceMatrix.needsUpdate = true;
  }

  /**
   * @param {THREE.Vector3} origem
   * @param {THREE.Vector3} direcao  já normalizada
   * @param {object} opts  { raio, vel, dano, cor }
   */
  disparar(origem, direcao, opts = {}) {
    const b = this.itens.find((x) => !x.vivo);
    if (!b) return false;
    b.vivo = true;
    b.t = 0;
    b.raio = opts.raio ?? 0.6;
    b.dano = opts.dano ?? 1;
    b.cor.setHex(opts.cor ?? 0xff7a1a);
    b.p.copy(origem);
    b.v.copy(direcao).normalize().multiplyScalar(opts.vel ?? 26);
    return true;
  }

  /**
   * @param {THREE.Vector3} alvo   posição do jogador (ou do helicóptero)
   * @param {number} raioAlvo      quão gordo é o alvo
   * @param {object} col           mundo de colisão (para bater em parede)
   * @returns {number} dano causado neste quadro
   */
  update(dt, alvo, raioAlvo = 1.1, col = null) {
    let dano = 0;

    for (let i = 0; i < MAX; i++) {
      const b = this.itens[i];
      if (!b.vivo) {
        this.mesh.setMatrixAt(i, this._fora);
        this.halo.setMatrixAt(i, this._fora);
        continue;
      }

      b.t += dt;
      if (b.t > VIDA) { this._apagar(i, b); continue; }

      const passo = b.v.length() * dt;
      b.p.addScaledVector(b.v, dt);

      // ---- acertou o jogador?
      if (alvo) {
        const d = this._tmp.copy(alvo).sub(b.p).length();
        if (d < b.raio + raioAlvo) {
          if (this.fx) this.fx.explode(b.p, b.raio * 0.9);
          if (this.onAcerto) this.onAcerto(b.p, b.dano);
          dano += b.dano;
          this._apagar(i, b);
          continue;
        }
      }

      /*
       * Bateu no cenário? A bola morre na parede. Sem isto ela
       * atravessaria prédio e chegaria do outro lado — e o jogador
       * perderia a única defesa que a cidade oferece de graça, que é se
       * esconder atrás de alguma coisa.
       */
      if (col) {
        const chao = col.groundHeightAt(b.p.x, b.p.z, b.p.y);
        if (b.p.y - b.raio < chao) { this._explodir(i, b); continue; }
        const dir = this._tmp.copy(b.v).normalize();
        const hit = col.raycast(b.p.x, b.p.y, b.p.z, dir.x, dir.y, dir.z, passo + b.raio);
        if (hit) { this._explodir(i, b); continue; }
      }

      // ---- desenho: a bola pulsa, o halo respira
      const pulso = 1 + Math.sin(b.t * 22) * 0.09;
      this._e.setScalar(b.raio * pulso);
      this._m.compose(b.p, this._q, this._e);
      this.mesh.setMatrixAt(i, this._m);
      this.mesh.setColorAt(i, b.cor);

      this._e.setScalar(b.raio * pulso * 1.85);
      this._m.compose(b.p, this._q, this._e);
      this.halo.setMatrixAt(i, this._m);
      this.halo.setColorAt(i, b.cor);
    }

    this.mesh.instanceMatrix.needsUpdate = true;
    this.halo.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    if (this.halo.instanceColor) this.halo.instanceColor.needsUpdate = true;
    return dano;
  }

  _explodir(i, b) {
    if (this.fx) this.fx.explode(b.p, b.raio * 0.7);
    this._apagar(i, b);
  }

  _apagar(i, b) {
    b.vivo = false;
    this.mesh.setMatrixAt(i, this._fora);
    this.halo.setMatrixAt(i, this._fora);
  }

  limpar() {
    for (const b of this.itens) b.vivo = false;
    this._esconderTodas();
  }
}
