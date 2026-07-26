/**
 * [11] Mouse para a visão + teclas configuráveis para o jogador.
 * [12] Scroll controla o zoom.
 * [15] Pointer lock no mouse, com ESC para soltar (que também pausa — [48]).
 *
 * ---- AÇÕES, NÃO TECLAS ----
 * Nada aqui para fora fala em `KeyF` ou `Space`: o resto do jogo pede
 * ações ('acao', 'pular', 'atirar') e o `Keybinds` diz qual tecla
 * corresponde a cada uma. É o que deixa a tela de configuração
 * funcionar e o que permite ao controle de toque disparar exatamente os
 * mesmos comandos, sem inventar eventos de teclado falsos.
 */
/** Modificadores que existem em par: um vale pelo outro. */
const GEMEAS = {
  ShiftLeft: 'ShiftRight', ShiftRight: 'ShiftLeft',
  ControlLeft: 'ControlRight', ControlRight: 'ControlLeft',
  AltLeft: 'AltRight', AltRight: 'AltLeft',
};

export class Input {
  constructor(canvas, binds) {
    this.canvas = canvas;
    this.binds = binds;
    this.keys = new Set();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.wheel = 0;
    this.locked = false;
    this.enabled = false;

    this.mouseDown = false;
    this.mousePressed = false;      // borda de subida
    this._justPressed = new Set();

    this.onLockChange = null;
    this.onAcao = null;             // callback (idAcao, evento) para ações de borda

    /**
     * Estado do controle na tela. O `TouchControls` escreve aqui e nada
     * mais no jogo precisa saber que existe um dedo em vez de um teclado.
     *
     * `mag` é a deflexão do analógico (0..1): é ela que dá movimento
     * proporcional — e, no talo, o correr.
     */
    this.toque = {
      forward: 0, strafe: 0, mag: 0,
      pular: false, correr: false, atirar: false, turbo: false,
    };

    this._bind();
  }

  _bind() {
    window.addEventListener('keydown', (e) => {
      // ESC precisa passar mesmo com o cursor dentro de um campo de texto,
      // senão não dá para fechar o celular nem pausar enquanto digita [48][56]
      if (e.code === 'Escape') {
        if (this.onAcao) this.onAcao('menu', e);
        return;
      }
      // as demais teclas são ignoradas enquanto o jogador digita [56]
      if (this._typing(e.target)) return;

      if (!this.keys.has(e.code)) this._justPressed.add(e.code);
      this.keys.add(e.code);

      const acao = this.binds ? this.binds.acao(e.code) : null;
      // e.repeat evita que segurar a tecla fique entrando e saindo do carro
      if (acao && this.onAcao && !e.repeat) this.onAcao(acao, e);

      // tecla com papel no jogo não pode também rolar a página nem
      // mudar o foco; as setas continuam valendo como movimento
      if (acao || ['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) {
        e.preventDefault();
      }
    });

    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
    });

    window.addEventListener('blur', () => {
      this.keys.clear();
      this.mouseDown = false;
      this.zerarToque();
    });

    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.mouseDX += e.movementX || 0;
      this.mouseDY += e.movementY || 0;
    });

    this.canvas.addEventListener('mousedown', (e) => {
      if (e.button === 0) {
        if (!this.mouseDown) this.mousePressed = true;
        this.mouseDown = true;
      }
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouseDown = false;
    });

    window.addEventListener('wheel', (e) => {
      if (!this.enabled) return;
      this.wheel += Math.sign(e.deltaY);
      e.preventDefault();
    }, { passive: false });

    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
      if (!this.locked) { this.keys.clear(); this.mouseDown = false; }
      if (this.onLockChange) this.onLockChange(this.locked);
    });

    // evita o menu de contexto atrapalhando a mira
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  _typing(el) {
    return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
  }

  requestLock() {
    if (this.locked) return;
    const p = this.canvas.requestPointerLock?.();
    // o navegador bloqueia o pedido por ~1s depois de um ESC; ignorar é seguro
    if (p && p.catch) p.catch(() => {});
  }

  releaseLock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  down(code) { return !!code && this.keys.has(code); }
  pressed(code) { return this._justPressed.has(code); }

  /**
   * A tecla desta ação está pressionada?
   *
   * O Shift, o Ctrl e o Alt da DIREITA valem pelos da esquerda — quem
   * corre com o mindinho direito sempre pôde, e o mapa de teclas não
   * podia tirar isso. Só enquanto o par estiver livre: se o jogador
   * amarrou uma ação própria no Shift direito, ela é que manda.
   */
  segurando(id) {
    const c = this.binds ? this.binds.code(id) : null;
    if (!c) return false;
    if (this.keys.has(c)) return true;
    const par = GEMEAS[c];
    return !!par && this.keys.has(par) && !this.binds.acao(par);
  }

  // ------------------------------------------------------------------ toque
  /** Botão da tela pediu uma ação (mesmo caminho de uma tecla). */
  acaoDeToque(id, ev) {
    if (this.onAcao) this.onAcao(id, ev);
  }

  /** Arrasto na tela gira a visão — é o "mouse" de quem joga no celular. */
  olhar(dx, dy) {
    this.mouseDX += dx;
    this.mouseDY += dy;
  }

  /** Pinça de dois dedos: mesmo efeito do scroll [12]. */
  pinca(passos) {
    this.wheel += passos;
  }

  zerarToque() {
    const t = this.toque;
    t.forward = t.strafe = t.mag = 0;
    t.pular = t.correr = t.atirar = t.turbo = false;
  }

  // ------------------------------------------------------------------ eixos
  /**
   * Eixos de movimento (teclas + setas + analógico da tela).
   *
   * O resultado NÃO é normalizado para 1: a magnitude atravessa até o
   * jogador, e é ela que faz o analógico andar devagar quando o dedo
   * empurra pouco. Só o que passa de 1 é aparado — na diagonal do
   * teclado, para não correr mais rápido em 45°.
   */
  get axes() {
    let f = (this.segurando('frente') || this.down('ArrowUp') ? 1 : 0)
          - (this.segurando('tras') || this.down('ArrowDown') ? 1 : 0);
    let s = (this.segurando('direita') || this.down('ArrowRight') ? 1 : 0)
          - (this.segurando('esquerda') || this.down('ArrowLeft') ? 1 : 0);

    const t = this.toque;
    if (t.mag > 0.001) { f += t.forward; s += t.strafe; }

    const m = Math.hypot(f, s);
    if (m > 1) { f /= m; s /= m; }
    return { forward: f, strafe: s };
  }

  /**
   * [30] Correr.
   *
   * No toque não há Shift: correr é empurrar o analógico até o fim. Uma
   * ação a menos na tela, e o gesto é o que a mão já faria por instinto.
   */
  get running() {
    return this.segurando('correr') || this.toque.correr || this.toque.mag > 0.93;
  }

  /**
   * DESCER, voando — e só isso.
   *
   * Não é o mesmo que `running`, por mais que no teclado as duas saiam
   * do Shift: no ar, o analógico no talo quer dizer "para a frente,
   * depressa", e se descer também estivesse pendurado nele o
   * helicóptero cairia toda vez que o jogador acelerasse.
   */
  get descer() {
    return this.segurando('correr') || this.toque.correr;
  }

  get jumping() { return this.segurando('pular') || this.toque.pular; }        // [36]

  /** [60] Turbo do modo Deus. */
  get boosting() { return this.segurando('turbo') || this.toque.turbo; }

  /** Consome os deltas do frame. */
  consumeMouse() {
    const d = { dx: this.mouseDX, dy: this.mouseDY };
    this.mouseDX = 0; this.mouseDY = 0;
    return d;
  }

  consumeWheel() {
    const w = this.wheel;
    this.wheel = 0;
    return w;
  }

  consumeClick() {
    const c = this.mousePressed;
    this.mousePressed = false;
    return c;
  }

  endFrame() {
    this._justPressed.clear();
  }
}
