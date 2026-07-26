/**
 * [11] Mouse para a visão + WASD para o jogador.
 * [12] Scroll controla o zoom.
 * [15] Pointer lock no mouse, com ESC para soltar (que também pausa — [48]).
 */
export class Input {
  constructor(canvas) {
    this.canvas = canvas;
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
    this.onKey = null;              // callback (code) para teclas de ação

    this._bind();
  }

  _bind() {
    window.addEventListener('keydown', (e) => {
      // ESC precisa passar mesmo com o cursor dentro de um campo de texto,
      // senão não dá para fechar o celular nem pausar enquanto digita [48][56]
      if (e.code === 'Escape') {
        if (this.onKey) this.onKey('Escape', e);
        return;
      }
      // as demais teclas são ignoradas enquanto o jogador digita [56]
      if (this._typing(e.target)) return;

      if (!this.keys.has(e.code)) this._justPressed.add(e.code);
      this.keys.add(e.code);
      // e.repeat evita que segurar F fique entrando e saindo do carro
      if (this.onKey && !e.repeat) this.onKey(e.code, e);
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) {
        e.preventDefault();
      }
    });

    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
    });

    window.addEventListener('blur', () => {
      this.keys.clear();
      this.mouseDown = false;
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

  down(code) { return this.keys.has(code); }
  pressed(code) { return this._justPressed.has(code); }

  /** Eixos de movimento normalizados (WASD + setas). */
  get axes() {
    const f = (this.down('KeyW') || this.down('ArrowUp') ? 1 : 0) -
              (this.down('KeyS') || this.down('ArrowDown') ? 1 : 0);
    const s = (this.down('KeyD') || this.down('ArrowRight') ? 1 : 0) -
              (this.down('KeyA') || this.down('ArrowLeft') ? 1 : 0);
    return { forward: f, strafe: s };
  }

  get running() { return this.down('ShiftLeft') || this.down('ShiftRight'); }   // [30]
  get jumping() { return this.down('Space'); }                                   // [36]
  /** [60] Turbo do modo Deus. */
  get boosting() { return this.down('ControlLeft') || this.down('ControlRight'); }

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
