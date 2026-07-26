/**
 * ============================================================
 *  Controles na tela — versão para celular e tablet
 * ============================================================
 *
 * Três peças, e só:
 *
 *   1. o ANALÓGICO, embaixo à esquerda, que anda e corre;
 *   2. o resto da tela, que é a ÁREA DE OLHAR — arrastar gira a câmera,
 *      dois dedos dão zoom (o mouse e o scroll de quem joga no PC);
 *   3. um punhado de BOTÕES embaixo à direita: atirar, pular, ação — e
 *      os contextuais, que só aparecem quando servem para alguma coisa.
 *
 * O analógico é FLUTUANTE: ele nasce onde o dedo encostou, em vez de
 * exigir que o polegar acerte um círculo desenhado. Num celular o
 * jogador não olha para o próprio dedo — ele olha para a cidade.
 *
 * Nada aqui conhece o jogo. Tudo o que este módulo faz é escrever no
 * `Input`, exatamente como o teclado escreve. Para o `game.js` não há
 * diferença entre um polegar e um WASD.
 */

/** Raio útil do analógico, em pixels: onde a deflexão vale 1. */
const RAIO = 52;

/** Multiplicador do arrasto sobre a sensibilidade do mouse. */
const SENS_OLHAR = 1.9;

/** Quantos pixels de pinça valem um "passo" de scroll. */
const PASSO_PINCA = 26;

export class TouchControls {
  constructor(input) {
    this.input = input;
    this.el = document.getElementById('touch');
    this.zona = document.getElementById('tc-stick-zone');
    this.base = document.getElementById('tc-base');
    this.knob = document.getElementById('tc-knob');
    this.areaOlhar = document.getElementById('tc-look');

    this.ativo = false;
    this._stickId = null;
    this._olharId = null;
    this._pincaId = null;
    this._pincaDist = 0;
    this._pincaAcc = 0;

    this._ligarAnalogico();
    this._ligarOlhar();
    this._ligarBotoes();
  }

  // ==================================================================
  //  liga / desliga
  // ==================================================================
  /** Liga o modo toque por inteiro (inclusive o layout do HUD, via CSS). */
  ativar(on) {
    this.ativo = !!on;
    document.body.classList.toggle('toque', this.ativo);
    if (!this.ativo) {
      this._soltarTudo();
      this.el.classList.add('hidden');
    }
  }

  /**
   * Mostra os controles conforme a situação.
   *
   * Some inteiro quando há menu, celular, Plano ou cutscene na tela:
   * são momentos em que o jogador não comanda o Bob, e deixar os botões
   * ali por baixo do painel só polui — e ainda por cima eles ficariam
   * inalcançáveis, atrás da camada de cima.
   */
  atualizar({ jogando, modal, modo, emFase, deus }) {
    if (!this.ativo) return;
    const mostrar = jogando && !modal;
    this.el.classList.toggle('hidden', !mostrar);
    if (!mostrar) { this._soltarTudo(); return; }

    const noHeli = modo === 'heli';
    const noVeiculo = noHeli || modo === 'car';
    const voando = noHeli || deus;                 // [43][60]

    // voando, o PULAR vira SUBIR e ganha um par para descer
    this._mostrar('tc-descer', voando);
    this._rotular('tc-pular', voando ? '▲' : 'PULAR');
    this._mostrar('tc-visao', noVeiculo);          // [25] só há visão interna em veículo
    this._mostrar('tc-missil', !!emFase);          // o teleguiado só existe em fase
  }

  _mostrar(id, on) {
    const el = document.getElementById(id);
    if (el) el.classList.toggle('hidden', !on);
  }

  _rotular(id, texto) {
    const el = document.getElementById(id);
    if (el && el.textContent !== texto) el.textContent = texto;
  }

  /** Solta tudo que estivesse pressionado (troca de tela, menu, pausa). */
  _soltarTudo() {
    this.input.zerarToque();
    this._stickId = this._olharId = this._pincaId = null;
    this._resetKnob();
    for (const b of this.el.querySelectorAll('.tc-btn, .tc-icon')) b.classList.remove('press');
  }

  // ==================================================================
  //  analógico
  // ==================================================================
  _ligarAnalogico() {
    const z = this.zona;

    z.addEventListener('pointerdown', (e) => {
      if (this._stickId !== null) return;
      this._stickId = e.pointerId;
      z.setPointerCapture(e.pointerId);

      const r = z.getBoundingClientRect();
      this._origem = { x: e.clientX, y: e.clientY };
      this.base.style.left = (e.clientX - r.left) + 'px';
      this.base.style.top = (e.clientY - r.top) + 'px';
      this.base.classList.add('on');
      e.preventDefault();
    });

    z.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this._stickId) return;
      let dx = e.clientX - this._origem.x;
      let dy = e.clientY - this._origem.y;

      const d = Math.hypot(dx, dy);
      const mag = Math.min(1, d / RAIO);
      if (d > RAIO) { dx = (dx / d) * RAIO; dy = (dy / d) * RAIO; }

      this.knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
      // no talo o anel acende: é o aviso de que o Bob passou a correr [30]
      this.base.classList.toggle('correndo', mag > 0.93);

      /*
       * Zona morta: abaixo dela o comando é ZERO, não "quase zero".
       * O polegar nunca fica parado de verdade, e sem esse piso o Bob
       * ficava se arrastando sozinho enquanto o jogador só mirava.
       */
      const t = this.input.toque;
      const vale = mag >= 0.14;
      t.mag = vale ? mag : 0;
      t.forward = vale ? (-dy / RAIO) : 0;
      t.strafe = vale ? (dx / RAIO) : 0;
      e.preventDefault();
    });

    const soltar = (e) => {
      if (e.pointerId !== this._stickId) return;
      this._stickId = null;
      this.input.toque.forward = this.input.toque.strafe = this.input.toque.mag = 0;
      this._resetKnob();
    };
    z.addEventListener('pointerup', soltar);
    z.addEventListener('pointercancel', soltar);
  }

  _resetKnob() {
    this.base.classList.remove('on', 'correndo');
    this.base.style.left = '';
    this.base.style.top = '';
    this.knob.style.transform = 'translate(-50%,-50%)';
  }

  // ==================================================================
  //  olhar e zoom
  // ==================================================================
  _ligarOlhar() {
    const a = this.areaOlhar;

    a.addEventListener('pointerdown', (e) => {
      if (this._olharId === null) {
        this._olharId = e.pointerId;
        this._ultimo = { x: e.clientX, y: e.clientY };
        a.setPointerCapture(e.pointerId);
      } else if (this._pincaId === null) {
        // segundo dedo: vira pinça de zoom e a rotação para até ele sair
        this._pincaId = e.pointerId;
        this._pincaPos = { x: e.clientX, y: e.clientY };
        this._pincaDist = Math.hypot(e.clientX - this._ultimo.x, e.clientY - this._ultimo.y);
        this._pincaAcc = 0;
        a.setPointerCapture(e.pointerId);
      }
      e.preventDefault();
    });

    a.addEventListener('pointermove', (e) => {
      if (e.pointerId === this._pincaId) {
        this._pincaPos = { x: e.clientX, y: e.clientY };
        this._medirPinca();
        return;
      }
      if (e.pointerId !== this._olharId) return;

      const dx = e.clientX - this._ultimo.x;
      const dy = e.clientY - this._ultimo.y;
      this._ultimo = { x: e.clientX, y: e.clientY };

      if (this._pincaId !== null) { this._medirPinca(); return; }
      this.input.olhar(dx * SENS_OLHAR, dy * SENS_OLHAR);
    });

    const soltar = (e) => {
      if (e.pointerId === this._pincaId) { this._pincaId = null; return; }
      if (e.pointerId !== this._olharId) return;
      this._olharId = null;
      // o dedo que sobrou assume o olhar, sem salto: ele vira a nova âncora
      if (this._pincaId !== null) {
        this._olharId = this._pincaId;
        this._ultimo = { ...this._pincaPos };
        this._pincaId = null;
      }
    };
    a.addEventListener('pointerup', soltar);
    a.addEventListener('pointercancel', soltar);
  }

  /** [12] Afastar os dedos aproxima a câmera; juntar, afasta. */
  _medirPinca() {
    if (this._pincaId === null || !this._ultimo || !this._pincaPos) return;
    const d = Math.hypot(this._pincaPos.x - this._ultimo.x, this._pincaPos.y - this._ultimo.y);
    this._pincaAcc += d - this._pincaDist;
    this._pincaDist = d;
    while (Math.abs(this._pincaAcc) >= PASSO_PINCA) {
      const passo = Math.sign(this._pincaAcc);
      this.input.pinca(-passo);
      this._pincaAcc -= passo * PASSO_PINCA;
    }
  }

  // ==================================================================
  //  botões
  // ==================================================================
  _ligarBotoes() {
    for (const b of this.el.querySelectorAll('[data-acao],[data-segura]')) {
      const acao = b.dataset.acao;
      const segura = b.dataset.segura;

      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        b.setPointerCapture(e.pointerId);
        b.classList.add('press');
        navigator.vibrate?.(10);
        if (segura) this.input.toque[segura] = true;
        else if (acao) this.input.acaoDeToque(acao, e);
      });

      const solta = (e) => {
        b.classList.remove('press');
        if (segura) this.input.toque[segura] = false;
        e.preventDefault();
      };
      b.addEventListener('pointerup', solta);
      b.addEventListener('pointercancel', solta);
      b.addEventListener('contextmenu', (e) => e.preventDefault());
    }
  }
}

/**
 * O aparelho é de toque?
 *
 * `pointer: coarse` é a pergunta certa — "o ponteiro principal é
 * impreciso?" —, não `maxTouchPoints`, que dá verdadeiro em notebook
 * com tela sensível, onde o jogador ainda quer mouse e teclado.
 */
export function ehToque() {
  return window.matchMedia?.('(pointer: coarse)').matches
    || (navigator.maxTouchPoints > 0 && !window.matchMedia?.('(pointer: fine)').matches);
}
