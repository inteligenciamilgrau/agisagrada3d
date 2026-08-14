/**
 * ============================================================
 *  SOM — tudo sintetizado, nenhum arquivo
 * ============================================================
 *
 * Cada efeito é montado na hora com osciladores e ruído em WebAudio.
 * O jogo 2D já fazia assim ("trilha chiptune 100% sintetizada, zero
 * arquivos de áudio") e aqui a razão é a mesma, mais uma: o projeto
 * inteiro não tem um único asset externo — as texturas são
 * procedurais, os retratos são o modelo voxel projetado. Um .mp3 seria
 * a primeira exceção, e uma exceção que pesa megabytes.
 *
 * ---- O CONTEXTO NASCE NO PRIMEIRO CLIQUE ----
 * Navegador nenhum deixa tocar áudio antes de um gesto do usuário. Se
 * o `AudioContext` fosse criado na carga, nasceria suspenso e todo som
 * sairia mudo até alguém descobrir o porquê. Ele é criado (e retomado)
 * no primeiro gesto real — que no jogo é o clique em INICIAR.
 */

/**
 * Volumes padrão, em 0..1. São dois BARRAMENTOS separados: cada um
 * tem seu ganho e os dois desaguam no mestre.
 *
 * Separar não é luxo — os dois disputam a mesma faixa. Quem quer
 * ouvir a trilha inteira precisa abaixar o tiro; quem joga com a
 * família dormindo quer o efeito baixo e a música desligada. Com um
 * controle só, toda escolha é um meio-termo ruim.
 */
export const VOL_EFEITOS_PADRAO = 0.55;
export const VOL_MUSICA_PADRAO = 0.45;

export class Audio {
  constructor() {
    this.ctx = null;
    this.master = null;
    /** Saída dos EFEITOS (tiro, explosão, motor, passos). */
    this.efeitos = null;
    /** Saída da TRILHA. `music.js` pendura tudo aqui. */
    this.musica = null;
    this.ganho = VOL_EFEITOS_PADRAO;
    this.ganhoMusica = VOL_MUSICA_PADRAO;
    this._ruidoBuf = null;
    /*
     * Trava por efeito: sem ela, uma explosão que pega 12 pedestres
     * dispara 12 sons no mesmo milissegundo e o resultado satura —
     * vira um estalo sujo em vez de um estouro. Um efeito por tipo a
     * cada poucos centésimos basta para a percepção.
     */
    this._ultimo = new Map();
  }

  /** Chamar de dentro de um gesto do usuário (clique, tecla). */
  acordar() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;                       // navegador sem WebAudio: jogo segue mudo
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 1;
      this.master.connect(this.ctx.destination);

      /*
       * ---- O GRAFO ----
       *   efeitos ─┐
       *            ├─> master ─> destino
       *   musica  ─┘
       *
       * Os DOIS barramentos vão para o MESTRE, nunca um para o outro.
       * Ligar a música no barramento de efeitos faria o slider de efeitos
       * mandar na trilha também — e o de efeitos ligado nele mesmo é um
       * laço que não chega a lugar nenhum: silêncio absoluto.
       */
      this.efeitos = this.ctx.createGain();
      this.efeitos.gain.value = this.ganho;
      this.efeitos.connect(this.master);

      this.musica = this.ctx.createGain();
      this.musica.gain.value = this.ganhoMusica;
      this.musica.connect(this.master);
    }
    /*
     * `resume()` devolve uma promise: se o gesto não foi aceito (ou o
     * contexto nasceu suspenso por política de autoplay), ela REJEITA.
     * Sem o catch, o erro morre no console e o jogo fica mudo sem
     * explicação. Com ele, o próximo gesto (qualquer toque/tecla) tenta
     * de novo — e em navegador que recusa o primeiro, o segundo toque
     * costuma passar.
     */
    if (this.ctx.state !== 'running') {
      const p = this.ctx.resume();
      if (p && p.catch) p.catch(() => {});
    }
  }

  /** Volume dos efeitos (0..1). */
  setGanho(v) {
    this.ganho = v;
    if (this.efeitos) this.efeitos.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02);
  }

  /** Volume da trilha (0..1). */
  setGanhoMusica(v) {
    this.ganhoMusica = v;
    if (this.musica) this.musica.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02);
  }

  get pronto() { return !!this.ctx && this.ganho > 0; }
  get prontoMusica() { return !!this.ctx && this.ganhoMusica > 0; }

  _podeTocar(chave, minIntervalo) {
    const t = this.ctx.currentTime;
    const u = this._ultimo.get(chave) || -9;
    if (t - u < minIntervalo) return false;
    this._ultimo.set(chave, t);
    return true;
  }

  // ---------------------------------------------------------- tijolos
  /** Buffer de ruído branco, reaproveitado por todos os efeitos. */
  _ruido() {
    if (!this._ruidoBuf) {
      const n = this.ctx.sampleRate * 1.2;
      const b = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
      const d = b.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
      this._ruidoBuf = b;
    }
    return this._ruidoBuf;
  }

  /** Estouro de ruído filtrado: base de tiro, explosão e passo. */
  _bum({ dur = 0.4, vol = 0.5, corte = 900, alvoCorte = 90, tipo = 'lowpass', q = 1 }) {
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this._ruido();
    const f = this.ctx.createBiquadFilter();
    f.type = tipo; f.Q.value = q;
    f.frequency.setValueAtTime(corte, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(20, alvoCorte), t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    src.connect(f); f.connect(g); g.connect(this.efeitos);
    src.start(t); src.stop(t + dur + 0.02);
  }

  /** Nota de oscilador com envelope: base dos bipes e das fanfarras. */
  _nota({ de = 440, para = null, dur = 0.15, vol = 0.2, onda = 'square', atraso = 0 }) {
    const t = this.ctx.currentTime + atraso;
    const o = this.ctx.createOscillator();
    o.type = onda;
    o.frequency.setValueAtTime(de, t);
    if (para) o.frequency.exponentialRampToValueAtTime(Math.max(20, para), t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.efeitos);
    o.start(t); o.stop(t + dur + 0.02);
  }

  // ---------------------------------------------------------- efeitos
  tiro() {
    if (!this.pronto || !this._podeTocar('tiro', 0.04)) return;
    this._bum({ dur: 0.13, vol: 0.42, corte: 3200, alvoCorte: 300 });
    this._nota({ de: 720, para: 130, dur: 0.09, vol: 0.14, onda: 'square' });
  }

  missil() {
    if (!this.pronto || !this._podeTocar('missil', 0.08)) return;
    this._bum({ dur: 0.55, vol: 0.36, corte: 1100, alvoCorte: 2600, tipo: 'bandpass', q: 1.6 });
    this._nota({ de: 150, para: 620, dur: 0.5, vol: 0.16, onda: 'sawtooth' });
  }

  /** @param {number} escala 1 = normal, 2+ = explosão grande */
  explosao(escala = 1) {
    if (!this.pronto || !this._podeTocar('explosao', 0.06)) return;
    const e = Math.min(3, escala);
    this._bum({ dur: 0.45 + e * 0.25, vol: 0.55, corte: 1400, alvoCorte: 60 });
    this._nota({ de: 110 * (1 / e), para: 28, dur: 0.4 + e * 0.2, vol: 0.3, onda: 'sine' });
  }

  /** Pisada do chefão colossal. @param {number} forca 0..1 */
  passo(forca = 0.5) {
    if (!this.pronto || !this._podeTocar('passo', 0.12)) return;
    this._bum({ dur: 0.5, vol: 0.3 + forca * 0.4, corte: 420, alvoCorte: 40 });
    this._nota({ de: 62, para: 24, dur: 0.45, vol: 0.22 + forca * 0.3, onda: 'sine' });
  }

  /** Decreto voando: assobio de papel. */
  canetada() {
    if (!this.pronto || !this._podeTocar('canetada', 0.15)) return;
    this._bum({ dur: 0.4, vol: 0.2, corte: 700, alvoCorte: 3400, tipo: 'bandpass', q: 3 });
  }

  acerto() {
    if (!this.pronto || !this._podeTocar('acerto', 0.03)) return;
    this._nota({ de: 1500, para: 900, dur: 0.05, vol: 0.13, onda: 'square' });
  }

  /** Inimigo caiu. */
  abateu() {
    if (!this.pronto || !this._podeTocar('abateu', 0.05)) return;
    this._nota({ de: 420, para: 90, dur: 0.22, vol: 0.2, onda: 'sawtooth' });
  }

  dano() {
    if (!this.pronto) return;
    this._bum({ dur: 0.3, vol: 0.4, corte: 600, alvoCorte: 80 });
    this._nota({ de: 230, para: 70, dur: 0.28, vol: 0.26, onda: 'sawtooth' });
  }

  /** Bicada do Loro / ferrão do Saci. */
  companheiro() {
    if (!this.pronto || !this._podeTocar('comp', 0.08)) return;
    this._nota({ de: 900, para: 1700, dur: 0.08, vol: 0.15, onda: 'square' });
    this._nota({ de: 1700, para: 700, dur: 0.09, vol: 0.12, onda: 'square', atraso: 0.07 });
  }

  /** Pacote coletado / entregue. */
  item(bom = true) {
    if (!this.pronto) return;
    const base = bom ? 660 : 440;
    this._nota({ de: base, dur: 0.1, vol: 0.16, onda: 'square' });
    this._nota({ de: base * 1.5, dur: 0.14, vol: 0.16, onda: 'square', atraso: 0.09 });
  }

  /** Peça do Plano conquistada. */
  conquista() {
    if (!this.pronto) return;
    const notas = [523, 659, 784, 1047];
    notas.forEach((f, i) => this._nota({ de: f, dur: 0.3, vol: 0.17, onda: 'square', atraso: i * 0.11 }));
  }

  /** Entrou numa fase. */
  fase() {
    if (!this.pronto) return;
    this._nota({ de: 196, dur: 0.5, vol: 0.2, onda: 'sawtooth' });
    this._nota({ de: 294, dur: 0.5, vol: 0.16, onda: 'sawtooth', atraso: 0.14 });
    this._nota({ de: 392, dur: 0.7, vol: 0.18, onda: 'sawtooth', atraso: 0.28 });
  }

  /** Fim de fase. */
  vitoria() {
    if (!this.pronto) return;
    [392, 523, 659, 784, 1047].forEach((f, i) =>
      this._nota({ de: f, dur: 0.45, vol: 0.2, onda: 'square', atraso: i * 0.13 }));
  }

  derrota() {
    if (!this.pronto) return;
    [392, 330, 262, 196].forEach((f, i) =>
      this._nota({ de: f, dur: 0.5, vol: 0.22, onda: 'sawtooth', atraso: i * 0.18 }));
  }

  /** Letrinha do diálogo. Curto e baixo: toca dezenas de vezes por fala. */
  blip() {
    if (!this.pronto || !this._podeTocar('blip', 0.035)) return;
    this._nota({ de: 620 + Math.random() * 120, dur: 0.03, vol: 0.045, onda: 'square' });
  }

  // ---------------------------------------------------- ambiente do inimigo
  /**
   * ZUMBIDO DOS DRONES — um enxame, não um som por bicho.
   *
   * É uma nota contínua só, cuja altura e volume vêm de QUANTOS drones
   * existem e de QUÃO PERTO está o mais próximo. Um oscilador por drone
   * daria doze osciladores batendo de fase e viraria serra elétrica; um
   * enxame que engrossa conforme eles chegam é o que o ouvido espera —
   * e é o aviso: dá para saber que vem drone antes de ver.
   */
  _ligarZumbido() {
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    const o2 = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    const f = this.ctx.createBiquadFilter();
    o.type = 'sawtooth'; o.frequency.value = 92;
    // segundo oscilador levemente destunado: é o batimento que dá o
    // "vrrrr" de asa, em vez de um tom limpo de sirene
    o2.type = 'sawtooth'; o2.frequency.value = 97;
    f.type = 'bandpass'; f.frequency.value = 420; f.Q.value = 2.2;
    g.gain.setValueAtTime(0.0001, t);
    o.connect(f); o2.connect(f); f.connect(g); g.connect(this.efeitos);
    o.start(t); o2.start(t);
    this._zum = { o, o2, g, f };
  }

  /**
   * @param {number} perto   0 = longe/nenhum, 1 = em cima do jogador
   * @param {number} quantos drones vivos por perto
   */
  zumbido(perto, quantos) {
    if (!this.ctx) return;
    if (!this._zum) this._ligarZumbido();
    const t = this.ctx.currentTime;
    const alvo = this.ganho > 0 ? Math.min(0.16, perto * 0.09 + quantos * 0.012) : 0;
    // rampa lenta: o enxame se aproxima, não aparece
    this._zum.g.gain.setTargetAtTime(alvo, t, 0.25);
    this._zum.o.frequency.setTargetAtTime(88 + perto * 34, t, 0.3);
    this._zum.o2.frequency.setTargetAtTime(94 + perto * 37, t, 0.3);
    this._zum.f.frequency.setTargetAtTime(380 + perto * 320, t, 0.3);
  }

  /** Silencia o enxame (fim de fase). */
  calarZumbido() {
    if (this._zum) this._zum.g.gain.setTargetAtTime(0, this.ctx.currentTime, 0.15);
  }

  /**
   * PATINHA DE ROBÔ no chão — tique metálico curto.
   *
   * Disparado pelos inimigos que andam, com trava própria: numa onda de
   * seis, o passo de cada um sai em momentos diferentes e o conjunto
   * vira aquele tec-tec-tec de coisa se aproximando.
   *
   * @param {number} perto 0..1 (mais perto = mais alto e mais agudo)
   */
  patinha(perto = 0.5) {
    if (!this.pronto || !this._podeTocar('patinha', 0.055)) return;
    const t = this.ctx.currentTime;
    const vol = 0.03 + perto * 0.09;
    // clique curto e seco
    const src = this.ctx.createBufferSource();
    src.buffer = this._ruido();
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 1900 + perto * 1500;
    f.Q.value = 5;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0005, t + 0.05);
    src.connect(f); f.connect(g); g.connect(this.efeitos);
    src.start(t); src.stop(t + 0.07);
    // "tin" metálico por cima, para não virar só estalo de ruído
    this._nota({ de: 2600 + Math.random() * 500, para: 1500, dur: 0.045, vol: vol * 0.5, onda: 'square' });
  }

  // ---------------------------------------------------- motor do carro
  /**
   * MOTOR — um oscilador só, cuja altura segue a rotação.
   *
   * Não é uma amostra em laço nem um som por marcha: são dois dentes de
   * serra destunados passando por um filtro, com a frequência amarrada à
   * velocidade. Acelerar sobe o tom, soltar desce — que é tudo que o
   * ouvido precisa para sentir o carro respondendo.
   *
   * A "marcha" existe só no número: a frequência sobe dentro da faixa,
   * volta ao pé quando troca, e sobe de novo. É o serrote de um jogo de
   * corrida antigo, e é o suficiente para a velocidade ter som próprio.
   */
  _ligarMotor() {
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    const o2 = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    const f = this.ctx.createBiquadFilter();
    o.type = 'sawtooth'; o.frequency.value = 60;
    o2.type = 'square'; o2.frequency.value = 30;      // oitava abaixo: o ronco
    f.type = 'lowpass'; f.frequency.value = 700; f.Q.value = 1.4;
    g.gain.setValueAtTime(0.0001, t);
    o.connect(f); o2.connect(f); f.connect(g); g.connect(this.efeitos);
    o.start(t); o2.start(t);
    this._motor = { o, o2, g, f };
  }

  /**
   * @param {number} frac   0 = parado, 1 = velocidade máxima
   * @param {boolean} dentro  o jogador está DENTRO do carro
   */
  motor(frac, dentro) {
    if (!this.ctx) return;
    if (!this._motor) this._ligarMotor();
    const t = this.ctx.currentTime;
    const m = this._motor;

    if (!dentro || this.ganho <= 0) {
      m.g.gain.setTargetAtTime(0, t, 0.12);
      return;
    }
    // marcha: a rotação sobe até o fim da faixa e recomeça acima
    const marcha = Math.min(3, Math.floor(frac * 4));
    const dentroDaMarcha = frac * 4 - marcha;
    const rot = 55 + dentroDaMarcha * 85 + marcha * 16;

    m.o.frequency.setTargetAtTime(rot, t, 0.06);
    m.o2.frequency.setTargetAtTime(rot * 0.5, t, 0.06);
    m.f.frequency.setTargetAtTime(420 + frac * 1500, t, 0.08);
    /*
     * Ganho MUITO baixo de propósito.
     *
     * Tiro e explosão são transientes: soam alto por um instante e
     * somem. O motor é contínuo — no mesmo nível numérico ele domina a
     * mistura e cansa em meio minuto de direção. Aqui ele é presença,
     * não protagonista: dá para saber que o carro está ligado e que
     * acelerou, sem cobrir a trilha nem o tiro.
     */
    m.g.gain.setTargetAtTime(0.007 + frac * 0.019, t, 0.08);
  }

  /** Desliga o motor (saiu do carro). */
  calarMotor() {
    if (this._motor) this._motor.g.gain.setTargetAtTime(0, this.ctx.currentTime, 0.15);
  }

  /** [36] Impulso do pulo: um "hup" curto que sobe. */
  pulo() {
    if (!this.pronto || !this._podeTocar('pulo', 0.1)) return;
    this._nota({ de: 300, para: 700, dur: 0.11, vol: 0.13, onda: 'square' });
    this._bum({ dur: 0.1, vol: 0.1, corte: 900, alvoCorte: 2200, tipo: 'bandpass', q: 2 });
  }

  /**
   * Aterrissagem. O peso vem da VELOCIDADE de queda: descer de um degrau
   * é um toque, cair do helicóptero é um baque. Um som só para os dois
   * casos faria o degrau soar como despencar.
   *
   * @param {number} forca 0..1
   */
  aterrissar(forca = 0.3) {
    if (!this.pronto || !this._podeTocar('aterrissar', 0.09)) return;
    this._bum({ dur: 0.16 + forca * 0.2, vol: 0.12 + forca * 0.32, corte: 700, alvoCorte: 70 });
    if (forca > 0.35) this._nota({ de: 120, para: 45, dur: 0.16, vol: forca * 0.22, onda: 'sine' });
  }

  // ---------------------------------------------------- hélice
  /**
   * HÉLICE — o "flap-flap-flap" do rotor.
   *
   * Não é um tom: é ruído passando por um filtro que ABRE E FECHA na
   * frequência das pás. É essa modulação que o ouvido lê como pá
   * cortando o ar; um oscilador puro soaria como zumbido de inseto,
   * que é justamente o som dos drones e ia confundir os dois.
   */
  _ligarHelice() {
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this._ruido();
    src.loop = true;

    const f = this.ctx.createBiquadFilter();
    f.type = "bandpass"; f.frequency.value = 320; f.Q.value = 1.1;

    // LFO: abre e fecha o filtro na cadência das pás
    const lfo = this.ctx.createOscillator();
    lfo.type = "sine"; lfo.frequency.value = 13;
    const lfoG = this.ctx.createGain();
    lfoG.gain.value = 220;
    lfo.connect(lfoG); lfoG.connect(f.frequency);

    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    src.connect(f); f.connect(g); g.connect(this.efeitos);
    src.start(t); lfo.start(t);
    this._helice = { src, f, g, lfo };
  }

  /**
   * @param {boolean} ligado  o jogador está no helicóptero
   * @param {number} carga    0 = marcha lenta, 1 = subindo com tudo
   */
  helice(ligado, carga = 0) {
    if (!this.ctx) return;
    if (!this._helice) this._ligarHelice();
    const t = this.ctx.currentTime;
    const h = this._helice;

    if (!ligado || this.ganho <= 0) {
      h.g.gain.setTargetAtTime(0, t, 0.25);
      return;
    }
    // volume contido: é pano de fundo do voo, não protagonista
    h.g.gain.setTargetAtTime(0.02 + carga * 0.022, t, 0.15);
    h.lfo.frequency.setTargetAtTime(12 + carga * 5, t, 0.2);
    h.f.frequency.setTargetAtTime(300 + carga * 190, t, 0.2);
  }

  calarHelice() {
    if (this._helice) this._helice.g.gain.setTargetAtTime(0, this.ctx.currentTime, 0.2);
  }

  /** Perto de um portal. */
  portal() {
    if (!this.pronto || !this._podeTocar('portal', 1.2)) return;
    this._nota({ de: 784, dur: 0.18, vol: 0.1, onda: 'sine' });
    this._nota({ de: 1047, dur: 0.22, vol: 0.09, onda: 'sine', atraso: 0.1 });
  }
}
