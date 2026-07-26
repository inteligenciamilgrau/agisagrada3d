import * as THREE from 'three';
import { VoxelFigure, ALTURA } from './voxel.js';
import { HUMANOIDES, MODELOS, montarModelo } from './voxeldef.js';

/**
 * ============================================================
 *  CHEFÃO NA CIDADE
 * ============================================================
 *
 * Todo chefão da campanha luta a céu aberto, saindo do marco que ele
 * ocupou: a ponte, o museu, o pelourinho. Não há mais sala fechada —
 * a cidade é o campo de batalha, com trânsito, pedestres, carro e
 * helicóptero ao alcance.
 *
 * ---- OS TRÊS PORTES ----
 * O que separa um chefão do outro é o TAMANHO, e o tamanho muda a luta
 * inteira:
 *
 *   médio    ~4,5 m  — dá para encarar a pé, na porrada e no tiro
 *   grande    ~15 m  — precisa recuar; tiro ainda funciona, carro ajuda
 *   colossal  ~55 m  — só míssil de helicóptero
 *
 * A escala é a mecânica, não enfeite. Um boneco de 55 m combatido do
 * chão vira frustração, e um de 4,5 m combatido só de helicóptero vira
 * tédio — por isso `soMissil` está amarrado ao PORTE, e não solto na
 * ficha de cada um.
 *
 * Já `marcha` é da FICHA: dos dois colossos, só o Trunfo ameaça o Labs
 * IMG. O dragão do Deep-Zeek é igualmente enorme e persegue você.
 * Amarrar a marcha ao tamanho faria os dois jogarem a mesma luta.
 */

/**
 * `bola` é o tiro do chefão, e o RAIO acompanha a altura: um médio
 * cospe uma bola de um metro, o colosso atira uma esfera de seis que
 * ilumina a rua. O tamanho é a leitura da ameaça — e a bola grande
 * também é mais fácil de desviar, o que compensa doer mais.
 */
export const PORTES = {
  medio: {
    altura: 4.5, soMissil: false, tremor: 0.10, alcanceGolpe: 4.5,
    bola: { raio: 1.0, vel: 26, recarga: 2.4, alcance: 60 },
  },
  grande: {
    altura: 15, soMissil: false, tremor: 0.26, alcanceGolpe: 13,
    bola: { raio: 2.6, vel: 24, recarga: 2.8, alcance: 110 },
  },
  colossal: {
    altura: 55, soMissil: true, tremor: 0.50, alcanceGolpe: 23,
    bola: { raio: 6.0, vel: 30, recarga: 3.2, alcance: 240 },
  },
};

const _v = new THREE.Vector3();

export class CityBoss {
  /**
   * @param {THREE.Scene} scene
   * @param {object} col      mundo de colisão (para pisar no relevo certo)
   * @param {object} ficha    entrada de CHEFES
   * @param {object} inicio   {x, z} de onde ele sai (a "porta" do marco)
   * @param {object} destino  {x, z} para onde marcha (só porte colossal)
   */
  constructor(scene, col, ficha, inicio, destino = null) {
    this.col = col;
    this.ficha = ficha;
    this.porte = PORTES[ficha.porte] || PORTES.medio;
    /*
     * Só quem MARCHA tem destino. É flag da ficha e não do porte porque
     * o colosso que ameaça o Labs IMG é o Trunfo; o dragão do Deep-Zeek
     * é igualmente enorme e persegue VOCÊ. Amarrar a marcha ao tamanho
     * faria os dois colossos jogarem a mesma luta.
     */
    this.destino = ficha.marcha ? destino : null;
    this.vidaMax = ficha.vida;
    this.vida = ficha.vida;
    this.vivo = true;
    this.chefe = true;
    this.t = 0;
    this.morteT = 0;
    this.recarga = 2.0;
    this.chamaT = 0;

    const alt = this.porte.altura;

    if (ficha.modelo) {
      // não humanoide (o dragão do Deep-Zeek)
      const def = MODELOS[ficha.modelo];
      const m = montarModelo({ ...def, escala: (def.escala || 1) * (alt / 8) });
      this.fig = null;
      this.modelo = m;
      this.root = m.root;
    } else {
      const escala = alt / ALTURA;
      this.fig = new VoxelFigure({ ...HUMANOIDES[ficha.humano], escala });
      this.root = this.fig.root;
    }
    scene.add(this.root);

    const y = col.groundHeightAt(inicio.x, inicio.z, 5);
    this.root.position.set(inicio.x, y + (ficha.voa ? alt * 0.5 : 0), inicio.z);

    /*
     * A esfera de acerto sobe para o TRONCO e acompanha o porte.
     *
     * Com a esfera nos pés, mirar no peito errava — e mirar no peito é o
     * instinto de qualquer um. Num chefão de 55 m isso inviabilizava a
     * luta; num de 4,5 m já incomodava.
     */
    /*
     * Quem VOA já tem a raiz no meio do corpo: a posição dele é
     * mantida em chao + altura/2. Somar mais meia altura punha a
     * esfera de acerto no VAZIO acima da cabeça — foi o que fazia o
     * dragão do Deep-Zeek só receber tiro num ponto sem nada.
     * Quem anda tem a raiz nos pés, e aí o deslocamento é necessário.
     */
    this.alturaAlvo = ficha.voa ? 0 : alt * 0.52;
    this.raioAcerto = alt * 0.30;

    // vulto no chão: denuncia onde ele está mesmo atrás de um prédio
    const g = new THREE.CircleGeometry(alt * 0.28, 24);
    g.rotateX(-Math.PI / 2);
    this.vulto = new THREE.Mesh(g, new THREE.MeshBasicMaterial({
      color: 0x000000, transparent: true, opacity: 0.3, depthWrite: false,
    }));
    scene.add(this.vulto);

    this.onPisada = null;
    this.onCanetada = null;
    this.onBola = null;
    this.onChegou = null;
    this._passoAnterior = 0;
  }

  get position() { return this.root.position; }
  get fracaoVida() { return Math.max(0, this.vida / this.vidaMax); }
  get colossal() { return this.porte.soMissil; }

  get faseAtual() {
    const fases = this.ficha.fases;
    if (!fases) return null;
    const f = this.fracaoVida;
    let atual = fases[0];
    for (const fa of fases) if (f <= fa.ate) atual = fa;
    return atual;
  }

  /** Distância que falta para o destino (só faz sentido marchando). */
  get faltam() {
    if (!this.destino) return 0;
    return Math.hypot(this.destino.x - this.root.position.x,
                      this.destino.z - this.root.position.z);
  }

  /**
   * @param {boolean} deMissil
   * @returns {boolean} true se morreu agora
   */
  dano(n, deMissil = false) {
    if (!this.vivo) return false;
    // casca de colosso não se fura com pistola
    if (this.porte.soMissil && !deMissil) return false;
    this.vida -= n;
    if (this.fig) this.fig.levarDano();
    if (this.vida <= 0) {
      this.vivo = false;
      if (this.fig) this.fig.matar();
      return true;
    }
    return false;
  }

  /**
   * @param {THREE.Vector3} alvo  jogador ou helicóptero
   * @returns {number} dano causado ao jogador neste quadro
   */
  update(dt, alvo) {
    this.t += dt;
    const p = this.root.position;

    if (!this.vivo) {
      this.morteT += dt;
      if (this.fig) this.fig.update(dt, 0);
      else this.modelo.corpo.rotation.z = Math.min(Math.PI / 2, this.modelo.corpo.rotation.z + dt * 3);
      if (this.morteT > 2.2) p.y -= dt * (this.porte.altura * 0.05);
      this.vulto.material.opacity = Math.max(0, 0.3 - this.morteT * 0.08);
      this.vulto.position.set(p.x, this.col.groundHeightAt(p.x, p.z, p.y) + 0.12, p.z);
      return 0;
    }

    const fase = this.faseAtual;
    const vel = (fase && fase.vel) || this.ficha.vel;

    /*
     * ---- KING KONG NO CORCOVADO ----
     * Encurralado, o colosso larga a marcha e SOBE O MORRO para se
     * agarrar no Cristo Redentor. A partir daí ele não ameaça mais o
     * laboratório — ele só quer levar você junto, e a luta vira aérea
     * em volta da estátua.
     *
     * Vale como último ato porque inverte a pressão: até aqui o relógio
     * corria contra você (ele caminhando); agora ele está parado e é
     * VOCÊ quem tem de chegar perto de um bicho de 55 m encarapitado no
     * ponto mais alto do mapa.
     */
    if (fase && fase.trepar && !this._trepando) {
      this._trepando = true;
      // resolvido AQUI: a cota do morro só existe depois do mundo pronto
      this._alvoTrepar = typeof fase.trepar === 'function' ? fase.trepar() : fase.trepar;
      this._trepaDe = { x: p.x, z: p.z, y: p.y };
      this.destino = null;                       // a marcha acabou
      if (this.onTrepar) this.onTrepar();
    }

    let dx, dz, dist;
    if (this._trepando) {
      const t = this._alvoTrepar;
      dx = t.x - p.x; dz = t.z - p.z;
      dist = Math.hypot(dx, dz);

      if (dist > 3) {
        const passo = Math.min(vel * dt, dist - 3);
        p.x += (dx / dist) * passo;
        p.z += (dz / dist) * passo;
      } else {
        this.noAlto = true;
      }
      this.root.rotation.y = this.noAlto
        ? Math.atan2(alvo.x - p.x, alvo.z - p.z)   // encara quem se aproxima
        : Math.atan2(dx, dz);

      /*
       * A subida é interpolada pela distância percorrida, não pelo
       * relevo. O Corcovado de propósito não tem superfície caminhável
       * registrada (a colisão dele é amarrada à estrada em espiral, um
       * equilíbrio que já custou caro), então pedir a altura ao mundo
       * deixaria ele andando no pé do morro. Interpolar dá a escalada
       * sem encostar naquela geometria.
       */
      const total = Math.max(1, Math.hypot(t.x - this._trepaDe.x, t.z - this._trepaDe.z));
      const feito = Math.min(1, 1 - dist / total);
      /*
       * Chegando no alto a mira vira a cota FINAL, e a aproximação
       * acelera. Com a rampa quadrática sozinha ele parava uns metros
       * abaixo do Cristo: exponencial que converge nunca chega, e o
       * jogador via o colosso pairando perto da estátua em vez de
       * agarrado nela.
       */
      const yAlvo = this.noAlto
        ? t.y
        : this._trepaDe.y + (t.y - this._trepaDe.y) * (feito * feito);
      p.y += (yAlvo - p.y) * Math.min(1, dt * (this.noAlto ? 5 : 1.6));

      if (this.fig) {
        this.fig.update(dt, this.noAlto ? 0 : vel);
        if (this.noAlto) {
          // pose de quem está pendurado: os dois braços para cima
          this.fig.bracoE.rotation.x = -2.55 + Math.sin(this.t * 1.7) * 0.09;
          this.fig.bracoD.rotation.x = -2.55 - Math.sin(this.t * 1.7) * 0.09;
          this.fig.bracoE.rotation.z = 0.34;
          this.fig.bracoD.rotation.z = -0.34;
        }
      }
      this.vulto.material.opacity = 0;            // no alto não faz sombra no chão
      return this._revide(dt, alvo, fase);
    }

    /*
     * Fora da escalada: colossal que marcha vai para o objetivo,
     * ignorando você — o perigo é ele chegar. Os outros PERSEGUEM: sem
     * destino a alcançar, ficar longe seria a estratégia ótima e a luta
     * simplesmente não aconteceria.
     */
    const mira = this.destino || alvo;
    dx = mira.x - p.x; dz = mira.z - p.z;
    dist = Math.hypot(dx, dz);
    const parar = this.destino ? 4 : this.porte.alcanceGolpe * 0.8;

    if (dist > parar) {
      const passo = Math.min(vel * dt, dist - parar);
      p.x += (dx / dist) * passo;
      p.z += (dz / dist) * passo;
    } else if (this.destino && this.onChegou) {
      this.onChegou();
      this.onChegou = null;
    }
    if (dist > 0.5) this.root.rotation.y = Math.atan2(dx, dz);

    // pisa no relevo real: ele atravessa rua, calçada e morro
    const chao = this.col.groundHeightAt(p.x, p.z, p.y + 2);
    p.y = this.ficha.voa ? chao + this.porte.altura * 0.5 : chao;

    if (this.fig) this.fig.update(dt, vel);
    else if (this.modelo.rotores) for (const r of this.modelo.rotores) r.rotation.y += dt * 30;
    this.vulto.position.set(p.x, chao + 0.12, p.z);

    /*
     * Tremor amarrado à ANIMAÇÃO, não a um cronômetro: dispara quando a
     * perna cruza o chão, então o baque cai junto com o pé mesmo quando
     * ele muda de velocidade.
     */
    if (this.fig) {
      const s = Math.sin(this.fig.passo);
      if (this._passoAnterior <= 0 && s > 0 && this.onPisada) this.onPisada(p, this.porte.tremor);
      this._passoAnterior = s;
    }

    return this._revide(dt, alvo, fase);
  }

  /** Manotaço de perto, canetada de longe. */
  _revide(dt, alvo, fase) {
    const p = this.root.position;
    this.recarga = Math.max(0, this.recarga - dt);
    let dano = 0;
    const dAlvo = Math.hypot(alvo.x - p.x, alvo.z - p.z);
    const dyAlvo = alvo.y - p.y;

    if (this.recarga <= 0) {
      const noAlcance = dAlvo < this.porte.alcanceGolpe
        && dyAlvo > -2 && dyAlvo < this.porte.altura * 1.05;
      if (noAlcance) {
        this.recarga = this.ficha.recarga;
        // agarrado, ele só tem um braço livre: revida mais devagar
        if (this.noAlto) this.recarga *= 1.4;
        if (this.fig && !this.noAlto) this.fig.golpear();
        dano = this.ficha.dano;
      } else if (fase && fase.canetada && dAlvo < 320) {
        this.recarga = fase.intervalo || 3.2;
        if (this.fig && !this.noAlto) this.fig.golpear();
        if (this.onCanetada) {
          _v.set(p.x, p.y + this.porte.altura * 0.72, p.z);
          this.onCanetada(_v, alvo);
        }
      } else if (this.porte.bola && dAlvo < this.porte.bola.alcance) {
        // bola de fogo: o tiro comum de quem não solta canetada
        this.recarga = this.porte.bola.recarga;
        if (this.fig && !this.noAlto) this.fig.golpear();
        if (this.onBola) this.onBola(this, this.porte.bola);
      }
    }

    return dano;
  }

  remover() {
    if (this.fig) this.fig.dispose();
    else this.root.removeFromParent();
    this.vulto.removeFromParent();
  }
}
