/**
 * ============================================================
 *  TRILHA — o chiptune do jogo 2D, portado
 * ============================================================
 *
 * Motor de música sequenciado em WebAudio, trazido inteiro do
 * beat 'em up 2D da comunidade: mesmas trilhas, mesmos acordes, mesma
 * marcha imperial do chefão. Nenhum arquivo de áudio.
 *
 * ---- COMO TOCA ----
 * Um relógio de semicolcheias. A cada quadro o jogo chama `update()`,
 * que agenda no futuro próximo (`ATRASO`) todos os passos que couberem.
 * Agendar à frente em vez de tocar "agora" é o que segura o tempo: o
 * `requestAnimationFrame` varia de 10 ms de um quadro para o outro, e
 * disparar nota na hora do quadro faria a batida balançar junto com o
 * FPS. O relógio do áudio não balança.
 *
 * ---- AS TRILHAS ----
 * Cada uma é um punhado de compassos (raiz + acorde), um estilo de
 * bateria, um padrão de baixo e opcionalmente arpejo, naipe de metais
 * e colchão. `saopaulo` é a exceção: é o tema surf em Mi frígio
 * composto nota a nota, e roda por um caminho próprio.
 */

const MV_MUSICA = 0.62;      // a trilha entra abaixo dos efeitos, para não competir
const ATRASO = 0.12;         // quanto agendar à frente do relógio de áudio

// ---------------------------------------------------------------- acordes
const Mj = (r) => ({ r, ch: [0, 4, 7] });
const Mi = (r) => ({ r, ch: [0, 3, 7] });
const M7c = (r) => ({ r, ch: [0, 4, 7, 11] });
const m7c = (r) => ({ r, ch: [0, 3, 7, 10] });
const D7c = (r) => ({ r, ch: [0, 4, 7, 10] });
const Pw = (r) => ({ r, ch: [0, 7, 12] });

// ---------------------------------------------------------------- o tema surf
// raízes MIDI: C3=48 D=50 E=52 F=53 G=55 A=57 B=59
const E = 52, F = 53, G = 55, GS = 56, A = 57, B = 59, C = 60, D = 62, E5 = 64;
const _ = null;

/** PARTE 1 — o riff original: sobe ao topo e desce correndo. */
const LEAD1 = [
  E, E, E, E, E, E, F, E, GS, GS, GS, GS, GS, GS, A, GS,
  B, B, B, B, C, B, A, GS, A, A, A, A, GS, A, GS, F,
  E, E, E, E, E, E, F, E, GS, GS, GS, GS, GS, GS, A, GS,
  B, B, C, C, D, D, E5, E5, D, C, B, A, GS, F, E, _,
];
const BASS1 = [
  E - 24, _, _, _, E - 24, _, _, _, E - 24, _, _, _, E - 24, _, _, _,
  A - 24, _, _, _, A - 24, _, _, _, B - 24, _, _, _, B - 24, _, _, _,
  E - 24, _, _, _, E - 24, _, _, _, E - 24, _, _, _, E - 24, _, _, _,
  A - 24, _, _, _, B - 24, _, _, _, E - 24, _, _, _, B - 24, _, _, _,
];
/** PARTE 2 — misirlou raiz: dois tempos no I, dois um semitom acima. */
const LEAD2 = [
  E, E, E, E, E, E, F, E, F, F, F, F, F, F, E, F,
  E, E, GS, GS, B, B, A, GS, F, F, A, A, C, C, A, F,
  E, E, E, E, E, F, E, D, F, F, F, F, F, GS, F, E,
  E, GS, B, E5, D, C, B, A, GS, A, GS, F, E, F, E, _,
];
/** PARTE 3 — cadência andaluza: Am → G → F → E. */
const LEAD3A = [
  A, A, A, A, C, C, B, A,
  G, G, G, G, B, B, A, G,
  F, F, F, F, A, A, G, F,
  E, E, E, E, GS, GS, F, E,
];
/** Na volta a cadência DOBRA: quatro tempos por acorde. */
const LEAD3B = [
  A, A, A, A, C, C, B, A, A, A, A, A, E5, E5, C, A,
  G, G, G, G, B, B, A, G, G, G, G, G, D, D, B, G,
  F, F, F, F, A, A, G, F, F, F, F, F, C, C, A, F,
  E, E, E, E, GS, GS, F, E, E, GS, B, E5, GS, F, E, _,
];
const CAD_ROOTS = [A - 24, G - 24, F - 24, E - 24];
const P1_LEN = LEAD1.length * 2;
const P2_LEN = LEAD2.length * 2;
const P3_LEN = LEAD3A.length + LEAD3B.length;
const SONG_LEN = P1_LEN + P2_LEN + P3_LEN;

// ---------------------------------------------------------------- trilhas
export const TRACKS = {
  /** Tema surf em Mi frígio — o hino do canal. Composto nota a nota. */
  saopaulo: { bpm: 168, custom: true },

  washington: {
    bpm: 128, drums: 'marchdrive', bassPat: 'drive',
    stabs: [0, 4, 8, 12], stabInst: 'piano',
    arp: { rate: 4, pattern: 'up', octaves: 1, inst: 'keys', vol: 0.04 },
    // A: marcha pomposa em dó · B: vira menor, conspiração no gabinete
    bars: [Mj(48), Mj(53), Mj(48), Mj(55), Mj(48), Mj(53), D7c(55), Mj(48),
           Mi(57), Mi(57), Mj(53), Mj(53), D7c(50), D7c(50), Mj(55), D7c(55)],
  },

  fabrica: {
    bpm: 150, drums: 'techno', bassPat: 'drive', stabs: [0, 10], stabInst: 'keys',
    arp: { rate: 2, pattern: 'up', octaves: 2, inst: 'pluck', vol: 0.045 },
    // A: martelo industrial em mi · B: a esteira acelera subindo
    bars: [Pw(52), Pw(52), Pw(52), Pw(52), Pw(48), Pw(48), Pw(50), Pw(50),
           Pw(52), Pw(52), Pw(55), Pw(55), Pw(57), Pw(57), Pw(59), Pw(59)],
  },

  vale: {
    bpm: 128, drums: 'popdrive', bassPat: 'drive',
    stabs: [0, 6, 8, 14], stabInst: 'keys', pad: true,
    arp: { rate: 2, pattern: 'updown', octaves: 1, inst: 'keys', vol: 0.04 },
    // A: synthpop corporativo sorridente · B: a máscara escorrega
    bars: [M7c(48), m7c(57), M7c(53), D7c(55), M7c(48), m7c(57), M7c(53), D7c(55),
           m7c(52), m7c(57), m7c(50), D7c(55), m7c(52), m7c(57), M7c(53), D7c(55)],
  },

  biblioteca: {
    bpm: 104, drums: 'tension', bassPat: 'eighths', pad: true,
    arp: { rate: 2, pattern: 'down', octaves: 1, inst: 'keys', vol: 0.05 },
    // A: órgão descendo na catedral em ré menor · B: o aspirador se aproxima
    bars: [Mi(50), Mi(50), Mi(55), Mi(55), Mj(57), Mj(57), Mi(50), Mi(50),
           Mj(58), Mi(55), { r: 52, ch: [0, 3, 6] }, D7c(57), Mi(50), Mi(55), D7c(57), Mi(50)],
  },

  muralha: {
    bpm: 122, drums: 'surfrock', bassPat: 'eighths', stabs: [0, 8], stabInst: 'piano',
    arp: { rate: 2, pattern: 'updown', octaves: 1, inst: 'pluck', vol: 0.05 },
    // A: dedilhado pentatônico sereno · B: o dragão circula
    bars: [Mi(57), Mi(57), Mj(53), Mj(53), Mj(55), Mj(55), Mi(52), Mi(52),
           Mj(48), Mj(55), Mi(57), Mi(52), Mj(53), Mj(55), Mi(57), Mi(57)],
  },

  final: {
    bpm: 152, drums: 'epic', bassPat: 'drive', stabs: [0, 8], stabInst: 'piano',
    arp: { rate: 2, pattern: 'up', octaves: 2, inst: 'pluck', vol: 0.05 },
    // A: corrida heroica Am-F-C-G · B: a onda final aperta
    bars: [Mi(57), Mj(53), Mj(48), Mj(55), Mi(57), Mj(53), Mj(48), Mj(55),
           Mi(50), Mj(58), Mj(53), Mj(48), Mi(50), Mj(58), Mj(52), D7c(52)],
  },

  /**
   * A MÚSICA DO MAL — marcha imperial em sol menor.
   * DUN DUN DUN / DUN-da-duuun. Na parte B os metais calam e sobra o medo.
   */
  boss: (() => {
    const b1 = [67, _, _, _, 67, _, _, _, 67, _, _, _, _, _, _, _];
    const b2 = [63, _, _, _, _, _, 60, _, 55, _, _, _, _, _, _, _];
    const b4 = [63, _, _, _, _, _, 60, _, 62, _, _, _, _, _, _, _];
    const b5 = [62, _, _, _, 62, _, _, _, 62, _, _, _, _, _, _, _];
    const b6 = [63, _, _, _, _, _, 60, _, 57, _, _, _, _, _, _, _];
    return {
      bpm: 138, drums: 'march', bassPat: 'eighths',
      stabs: [0, 8], stabInst: 'piano', pad: true,
      arp: { rate: 4, pattern: 'down', octaves: 1, inst: 'keys', vol: 0.035 },
      bars: [Mi(55), Mj(51), Mi(55), D7c(50), Mi(55), Mj(51), Mi(55), Mi(55),
             Mi(55), Mj(56), Mi(55), Mj(56), Mi(55), Mj(56), D7c(50), D7c(50)],
      tune: [...b1, ...b2, ...b1, ...b4, ...b5, ...b6, ...b1, ...b2,
             ...Array(128).fill(null)],
    };
  })(),

  menu: {
    bpm: 84, drums: 'lofi', bassPat: 'half', stabs: [0, 7], stabInst: 'keys', pad: true,
    // lofi de planejamento: café, mapa e acordes com 7ª
    bars: [M7c(53), m7c(52), m7c(50), M7c(48), M7c(53), m7c(52), m7c(50), M7c(48),
           M7c(58), m7c(57), m7c(55), D7c(48), M7c(58), m7c(57), m7c(55), D7c(55)],
  },

  abertura: {
    bpm: 72, drums: 'suspense', bassPat: 'half', pad: true,
    arp: { rate: 4, pattern: 'up', octaves: 1, inst: 'keys', vol: 0.05 },
    // lenda antiga: piano lento sobre colchão, com o V maior de suspense
    bars: [Mi(57), Mi(57), Mj(53), Mj(53), Mj(48), Mj(48), Mj(52), Mj(52),
           Mi(57), Mj(53), Mj(48), Mj(52), Mi(57), Mj(53), Mj(52), Mj(52)],
  },

  vitoria: {
    bpm: 138, drums: 'marchdrive', bassPat: 'rootFifth',
    stabs: [0, 4, 8, 12], stabInst: 'piano',
    arp: { rate: 2, pattern: 'up', octaves: 2, inst: 'pluck', vol: 0.05 },
    bars: [Mj(48), Mj(55), Mi(57), Mj(53), Mj(48), Mj(53), Mj(55), Mj(48),
           Mj(53), Mj(55), Mi(57), Mj(52), Mj(53), Mj(55), Mj(48), Mj(48)],
  },

  festa: {
    bpm: 148, drums: 'popdrive', bassPat: 'drive',
    stabs: [0, 4, 8, 12], stabInst: 'piano',
    arp: { rate: 2, pattern: 'up', octaves: 2, inst: 'pluck', vol: 0.055 },
    // A FESTA DA AGI: dó maior radiante, arpejo subindo feito fogos
    bars: [Mj(48), Mj(53), Mj(55), Mj(48), Mj(48), Mj(53), Mj(55), Mj(48),
           Mj(53), Mj(55), Mi(52), Mi(57), Mj(53), Mj(55), Mj(48), D7c(55)],
  },

  gameover: {
    bpm: 66, drums: 'none', bassPat: 'half', pad: true,
    arp: { rate: 4, pattern: 'down', octaves: 1, inst: 'keys', vol: 0.05 },
    bars: [Mi(57), Mi(57), Mj(53), Mj(52), Mi(57), Mi(50), Mj(52), Mi(57)],
  },
};

/** Qual trilha toca em cada fase da campanha. */
export const MUSICA_DA_FASE = {
  chamado: 'saopaulo', canetada: 'washington', lata: 'fabrica',
  lucro: 'vale', biblioteca: 'biblioteca', muralha: 'muralha', labs: 'final',
};

// ============================================================ o motor
export class Music {
  /** @param {Audio} audio  dono do AudioContext e do volume mestre */
  constructor(audio) {
    this.audio = audio;
    this.nome = null;
    this.passo = 0;
    this.proximo = 0;
    this.ligada = true;
    this._ruidoBuf = null;
  }

  get ctx() { return this.audio.ctx; }
  /** A trilha sai pelo barramento de MÚSICA, com volume próprio. */
  get destino() { return this.audio.musica; }
  get vol() { return MV_MUSICA; }

  /** Troca de trilha. Reinicia do compasso 1 — a entrada tem que ser clara. */
  tocar(nome) {
    if (nome === this.nome || !TRACKS[nome]) return;
    this.nome = nome;
    this.passo = 0;
    if (this.ctx) this.proximo = Math.max(this.proximo, this.ctx.currentTime + 0.06);
  }

  parar() { this.nome = null; }

  /** Chamado a cada quadro: agenda tudo que couber na janela de ATRASO. */
  update() {
    if (!this.ligada || !this.nome || !this.ctx || !this.audio.prontoMusica) return;
    const trk = TRACKS[this.nome];
    if (!trk) return;

    /*
     * Andamento FIXO, o da própria trilha.
     *
     * Cheguei a amarrá-lo à velocidade do carro — a música acelerava
     * junto. Soa esperto no papel e atrapalha na prática: a trilha
     * carrega a identidade do jogo, e ela mudando de tempo a cada toque
     * no acelerador vira ruído em vez de música. Tempo de trilha é
     * decisão de composição, não de telemetria.
     */
    const dur = 60 / trk.bpm / 4;                 // semicolcheia
    const agora = this.ctx.currentTime;
    if (this.proximo < agora) this.proximo = agora + 0.02;

    /*
     * Teto de 64 passos por quadro: se a aba ficar em segundo plano e
     * voltar, `currentTime` pulou vários segundos e o laço tentaria
     * agendar milhares de notas de uma vez — o navegador engasga e sai
     * um borrão. Melhor perder o trecho perdido do que despejar tudo.
     */
    let n = 0;
    while (this.proximo < agora + ATRASO && n++ < 64) {
      if (trk.custom) this._passoSurf(this.passo, this.proximo);
      else this._passoTrilha(trk, this.passo, this.proximo, dur);
      this.passo++;
      this.proximo += dur;
    }
  }

  // ------------------------------------------------------------ instrumentos
  _ruido(dur) {
    const ctx = this.ctx;
    const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const b = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }

  _freq(m) { return 440 * Math.pow(2, (m - 69) / 12); }

  _kick(t) {
    const ctx = this.ctx;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(130, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.1);
    g.gain.setValueAtTime(0.35 * this.vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    o.connect(g); g.connect(this.destino);
    o.start(t); o.stop(t + 0.13);
  }

  _snare(t) {
    const ctx = this.ctx;
    const s = ctx.createBufferSource(), g = ctx.createGain(), f = ctx.createBiquadFilter();
    s.buffer = this._ruido(0.12);
    f.type = 'bandpass'; f.frequency.value = 1800; f.Q.value = 0.8;
    g.gain.setValueAtTime(0.22 * this.vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.11);
    s.connect(f); f.connect(g); g.connect(this.destino);
    s.start(t);
  }

  _hat(t, aberto) {
    const ctx = this.ctx;
    const dur = aberto ? 0.09 : 0.035;
    const s = ctx.createBufferSource(), g = ctx.createGain(), f = ctx.createBiquadFilter();
    s.buffer = this._ruido(dur);
    f.type = 'highpass'; f.frequency.value = 7000;
    g.gain.setValueAtTime(0.08 * this.vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(f); f.connect(g); g.connect(this.destino);
    s.start(t);
  }

  _lead(t, midi, acento, dur) {
    const ctx = this.ctx;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'square'; o.frequency.value = this._freq(midi);
    g.gain.setValueAtTime((acento ? 0.09 : 0.06) * this.vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur * 0.9);
    o.connect(g); g.connect(this.destino);
    o.start(t); o.stop(t + dur);
  }

  _baixo(t, midi, dur) {
    const ctx = this.ctx;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'triangle'; o.frequency.value = this._freq(midi);
    g.gain.setValueAtTime(0.14 * this.vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur * 1.8);
    o.connect(g); g.connect(this.destino);
    o.start(t); o.stop(t + dur * 2);
  }

  _pluck(t, m, vol, dur, tipo = 'square') {
    const ctx = this.ctx;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = tipo; o.frequency.value = this._freq(m);
    g.gain.setValueAtTime(vol * this.vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(this.destino);
    o.start(t); o.stop(t + dur + 0.02);
  }

  /** "Piano" chiptune: fundamental + oitava + detune, decaimento de martelo. */
  _piano(t, m, vol = 0.07) {
    const f = this._freq(m);
    for (const [ff, vv, ty] of [[f, 1, 'triangle'], [f * 2, 0.35, 'sine'], [f * 1.003, 0.5, 'sine']]) {
      const o = this.ctx.createOscillator(), g = this.ctx.createGain();
      o.type = ty; o.frequency.value = ff;
      g.gain.setValueAtTime(vol * vv * this.vol, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.55);
      o.connect(g); g.connect(this.destino);
      o.start(t); o.stop(t + 0.6);
    }
  }

  _keys(t, m, vol = 0.05, dur = 0.3) {
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = 'sine'; o.frequency.value = this._freq(m);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol * this.vol, t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.001, t + Math.max(0.1, dur));
    o.connect(g); g.connect(this.destino);
    o.start(t); o.stop(t + dur + 0.05);
  }

  /** Metais imperiais: dois saws destunados com filtro, ataque marcado. */
  _brass(t, m, vol = 0.075, dur = 0.4) {
    const f = this._freq(m);
    for (const ff of [f * 0.996, f * 1.005]) {
      const o = this.ctx.createOscillator(), g = this.ctx.createGain(), fl = this.ctx.createBiquadFilter();
      o.type = 'sawtooth'; o.frequency.value = ff;
      fl.type = 'lowpass'; fl.frequency.value = 1400;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(vol * this.vol, t + 0.02);
      g.gain.setValueAtTime(vol * 0.8 * this.vol, t + dur * 0.6);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      o.connect(fl); fl.connect(g); g.connect(this.destino);
      o.start(t); o.stop(t + dur + 0.03);
    }
  }

  _pad(t, m, dur, vol = 0.028) {
    const f = this._freq(m);
    for (const ff of [f * 0.997, f * 1.004]) {
      const o = this.ctx.createOscillator(), g = this.ctx.createGain(), fl = this.ctx.createBiquadFilter();
      o.type = 'sawtooth'; o.frequency.value = ff;
      fl.type = 'lowpass'; fl.frequency.value = 900;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(vol * this.vol, t + Math.min(0.4, dur * 0.3));
      g.gain.setValueAtTime(vol * this.vol, t + dur * 0.7);
      g.gain.linearRampToValueAtTime(0.0001, t + dur);
      o.connect(fl); fl.connect(g); g.connect(this.destino);
      o.start(t); o.stop(t + dur + 0.05);
    }
  }

  // ------------------------------------------------------------ sequência
  /** Bateria por estilo, com virada no fim de cada bloco de 8 compassos. */
  _bateria(estilo, s16, barIdx, t) {
    const virada = (barIdx % 8) === 7 && s16 >= 10;
    if (virada && s16 % 2 === 0) { this._snare(t); return; }
    switch (estilo) {
      case 'march':
        if (s16 === 0 || s16 === 8) this._kick(t);
        if (s16 === 4 || s16 === 12) this._snare(t);
        if (s16 % 2 === 0) this._hat(t, false);
        break;
      case 'marchdrive':
        if (s16 === 0 || s16 === 6 || s16 === 8) this._kick(t);
        if (s16 === 4 || s16 === 12) this._snare(t);
        this._hat(t, s16 === 14);
        break;
      case 'surfrock':
        if (s16 === 0 || s16 === 6 || s16 === 10) this._kick(t);
        if (s16 === 4 || s16 === 12) this._snare(t);
        if (s16 % 2 === 0) this._hat(t, s16 === 14);
        break;
      case 'popdrive':
        if (s16 === 0 || s16 === 7 || s16 === 10) this._kick(t);
        if (s16 === 4 || s16 === 12) this._snare(t);
        this._hat(t, s16 === 14);
        break;
      case 'tension':
        if (s16 === 0 || s16 === 7) this._kick(t);
        if (s16 === 12) this._snare(t);
        if (s16 % 2 === 0) this._hat(t, s16 === 10);
        break;
      case 'techno':
        if (s16 % 4 === 0) this._kick(t);
        if (s16 === 4 || s16 === 12) this._snare(t);
        if (s16 % 4 === 2) this._hat(t, s16 === 14);
        break;
      case 'pop':
        if (s16 === 0 || s16 === 10) this._kick(t);
        if (s16 === 4 || s16 === 12) this._snare(t);
        if (s16 % 2 === 0) this._hat(t, false);
        break;
      case 'lofi':
        if (s16 === 0 || s16 === 7) this._kick(t);
        if (s16 === 8) this._snare(t);
        if (s16 % 4 === 2) this._hat(t, false);
        break;
      case 'epic':
        if (s16 === 0 || s16 === 6 || s16 === 8) this._kick(t);
        if (s16 === 4 || s16 === 12) this._snare(t);
        this._hat(t, s16 === 14);
        break;
      case 'suspense':
        if (s16 === 0) this._kick(t);
        if (s16 === 10) this._hat(t, true);
        break;
    }
  }

  _linhaBaixo(pattern, bar, s16, t, dur) {
    const raiz = bar.r - 12, quinta = raiz + 7;
    switch (pattern) {
      case 'eighths':   if (s16 % 2 === 0) this._baixo(t, raiz, dur); break;
      case 'offbeat':   if (s16 % 4 === 2) this._baixo(t, raiz, dur); break;
      case 'rootFifth': if (s16 % 4 === 0) this._baixo(t, (s16 / 4) % 2 === 0 ? raiz : quinta, dur); break;
      case 'half':      if (s16 === 0 || s16 === 8) this._baixo(t, raiz, dur); break;
      case 'drive':     if (s16 % 2 === 0) this._baixo(t, (s16 % 8) === 6 ? quinta : raiz, dur); break;
    }
  }

  /** Um passo de trilha generativa: harmonia + arpejo + bateria + metais. */
  _passoTrilha(trk, gIdx, t, dur) {
    const total = trk.bars.length * 16;
    const idx = gIdx % total;
    const barIdx = Math.floor(idx / 16);
    const bar = trk.bars[barIdx];
    const s16 = idx % 16;

    this._bateria(trk.drums, s16, barIdx, t);
    this._linhaBaixo(trk.bassPat, bar, s16, t, dur);

    if (trk.stabs && trk.stabs.includes(s16)) {
      for (const iv of bar.ch) {
        if (trk.stabInst === 'keys') this._keys(t, bar.r + 12 + iv, 0.045, dur * 3);
        else this._piano(t, bar.r + 12 + iv, 0.055);
      }
    }
    if (trk.pad && s16 === 0) {
      for (const iv of bar.ch) this._pad(t, bar.r + 12 + iv, dur * 16);
    }
    if (trk.arp && s16 % trk.arp.rate === 0) {
      const a = trk.arp;
      let tons = bar.ch.map((iv) => bar.r + 24 + iv);
      if (a.octaves === 2) tons = tons.concat(bar.ch.map((iv) => bar.r + 36 + iv));
      const n = Math.floor(idx / a.rate);
      let tom;
      if (a.pattern === 'down') tom = tons[tons.length - 1 - (n % tons.length)];
      else if (a.pattern === 'updown') {
        const L = tons.length * 2 - 2, k = n % L;
        tom = tons[k < tons.length ? k : L - k];
      } else tom = tons[n % tons.length];
      if (a.inst === 'keys') this._keys(t, tom, a.vol || 0.05, dur * a.rate * 1.1);
      else this._pluck(t, tom, a.vol || 0.05, dur * a.rate * 0.95);
    }
    // melodia explícita por cima (os metais da marcha imperial)
    if (trk.tune) {
      const tn = trk.tune[idx % trk.tune.length];
      if (tn !== null && tn !== undefined) this._brass(t, tn, 0.08, dur * 3.4);
    }
  }

  /** O tema surf: composto nota a nota, não gerado por acordes. */
  _passoSurf(gIdx, t) {
    const dur = 60 / TRACKS.saopaulo.bpm / 4;
    const idx = gIdx % SONG_LEN;
    const s16 = idx % 16;

    // batida surf: bumbo no 1 e no "e" do 2, caixa no 2 e no 4
    if (s16 === 0 || s16 === 6 || s16 === 10) this._kick(t);
    if (s16 === 4 || s16 === 12) this._snare(t);
    if (idx % 2 === 0) this._hat(t, s16 === 14);

    let lead = null, baixo = null;
    if (idx < P1_LEN) {
      const i = idx % LEAD1.length;
      lead = LEAD1[i]; baixo = BASS1[i];
    } else if (idx < P1_LEN + P2_LEN) {
      const i = (idx - P1_LEN) % LEAD2.length;
      lead = LEAD2[i];
      if (i % 2 === 0) baixo = (i % 16) < 8 ? E - 24 : F - 24;   // pump Mi→Fá
    } else {
      const i = idx - P1_LEN - P2_LEN;
      if (i < LEAD3A.length) {
        lead = LEAD3A[i];
        if (i % 2 === 0) baixo = CAD_ROOTS[Math.floor(i / 8)];
      } else {
        const j = i - LEAD3A.length;
        lead = LEAD3B[j];
        if (j % 2 === 0) baixo = CAD_ROOTS[Math.floor(j / 16)];
      }
    }
    if (lead !== null) this._lead(t, lead, s16 % 4 === 0, dur);
    if (baixo !== null) this._baixo(t, baixo, dur);
  }

  /** Fanfarra de chefão derrotado, por cima da trilha. */
  fanfarra() {
    if (!this.ctx || !this.audio.prontoMusica) return;
    const t0 = this.ctx.currentTime + 0.03;
    const seq = [60, 64, 67, 72, 67, 72, 76, 79];
    seq.forEach((m, i) => this._piano(t0 + i * 0.09, m, 0.09));
    for (const m of [72, 76, 79, 84]) this._piano(t0 + seq.length * 0.09 + 0.05, m, 0.08);
    this._snare(t0);
    this._kick(t0 + seq.length * 0.09);
  }
}
