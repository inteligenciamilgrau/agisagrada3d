import {
  PRESETS, DEFAULT_PRESET, POPULATIONS, DEFAULT_POPULATION,
  RENDER_DISTANCES, DEFAULT_RENDER_DISTANCE,
} from './config.js';
import { VOL_EFEITOS_PADRAO, VOL_MUSICA_PADRAO } from './sys/audio.js';
import { ACAO_POR_ID, PROIBIDAS } from './keys.js';

/**
 * Preferências do jogador, guardadas no localStorage do navegador.
 *
 * Tudo que o jogador consegue configurar passa por aqui: limite de tempo [8],
 * modo de iluminação [13] e perfil gráfico. Ao abrir o jogo de novo, as
 * escolhas voltam do jeito que ficaram.
 */

const CHAVE = 'cidade3d:config:v1';

const PADRAO = {
  timerEnabled: false,                  // [8] começa sem limite de tempo
  /*
   * [13] SEMPRE DIA por padrão.
   *
   * O ciclo dia/noite é bonito e continua disponível na tecla N, mas
   * como PADRÃO ele atrapalha: metade das partidas começa no escuro,
   * e a campanha depende de enxergar o inimigo chegando de longe numa
   * cidade aberta. Quem quiser a noite escolhe; quem só quer jogar
   * não devia precisar escolher.
   */
  cycleMode: 'dia',                     // ciclo | dia | noite
  presetIndex: DEFAULT_PRESET,          // qualidade gráfica
  populationIndex: DEFAULT_POPULATION,  // [61] quantidade de gente e carros
  renderDistanceIndex: DEFAULT_RENDER_DISTANCE,  // alcance de renderização
  volEfeitos: Math.round(VOL_EFEITOS_PADRAO * 100),   // 0..100
  volMusica: Math.round(VOL_MUSICA_PADRAO * 100),     // 0..100
  /**
   * Controles na tela: 'auto' liga sozinho em celular e tablet, 'on'
   * força (útil para conferir o layout no PC) e 'off' nunca liga.
   */
  toque: 'auto',
  /** Ação -> `event.code`. Vazio significa "tudo no padrão de fábrica". */
  teclas: {},
};

const CICLOS = ['ciclo', 'dia', 'noite'];
const TOQUES = ['auto', 'on', 'off'];

/**
 * Aceita só valores válidos. O que estiver salvo pode ter vindo de uma versão
 * antiga do jogo ou ter sido editado à mão — um `presetIndex` fora da faixa
 * quebraria a inicialização inteira.
 */
function sanear(bruto) {
  const s = { ...PADRAO };
  if (!bruto || typeof bruto !== 'object') return s;

  if (typeof bruto.timerEnabled === 'boolean') s.timerEnabled = bruto.timerEnabled;
  if (CICLOS.includes(bruto.cycleMode)) s.cycleMode = bruto.cycleMode;
  if (Number.isInteger(bruto.presetIndex)
      && bruto.presetIndex >= 0 && bruto.presetIndex < PRESETS.length) {
    s.presetIndex = bruto.presetIndex;
  }
  if (Number.isInteger(bruto.populationIndex)
      && bruto.populationIndex >= 0 && bruto.populationIndex < POPULATIONS.length) {
    s.populationIndex = bruto.populationIndex;
  }
  if (Number.isInteger(bruto.renderDistanceIndex)
      && bruto.renderDistanceIndex >= 0 && bruto.renderDistanceIndex < RENDER_DISTANCES.length) {
    s.renderDistanceIndex = bruto.renderDistanceIndex;
  }
  for (const k of ['volEfeitos', 'volMusica']) {
    const v = bruto[k];
    if (Number.isFinite(v) && v >= 0 && v <= 100) s[k] = Math.round(v);
  }
  if (TOQUES.includes(bruto.toque)) s.toque = bruto.toque;

  // teclas: só entra ação que existe, com tecla que é permitida
  if (bruto.teclas && typeof bruto.teclas === 'object') {
    s.teclas = {};
    for (const [id, code] of Object.entries(bruto.teclas)) {
      if (!ACAO_POR_ID[id]) continue;
      if (typeof code !== 'string' || !code || PROIBIDAS.has(code)) continue;
      s.teclas[id] = code;
    }
  }
  return s;
}

export class Settings {
  constructor() {
    /**
     * Primeira vez neste navegador?
     *
     * Serve para escolher um padrão melhor sem passar por cima de
     * ninguém: num celular estreando o jogo vale começar em BAIXA, mas
     * quem já escolheu ALTA da outra vez tem que reencontrar ALTA.
     */
    this.novo = true;
    this.data = this._carregar();
  }

  _carregar() {
    try {
      const bruto = localStorage.getItem(CHAVE);
      this.novo = !bruto;
      return sanear(JSON.parse(bruto));
    } catch {
      // localStorage pode estar indisponível (modo privado, file://).
      // Nesse caso o jogo roda igual, só não lembra entre sessões.
      return { ...PADRAO, teclas: {} };
    }
  }

  _salvar() {
    try {
      localStorage.setItem(CHAVE, JSON.stringify(this.data));
    } catch {
      /* sem persistência: segue o jogo */
    }
  }

  get(chave) { return this.data[chave]; }

  set(chave, valor) {
    if (this.data[chave] === valor) return;
    this.data[chave] = valor;
    this._salvar();
  }

  /** Volta tudo ao padrão de fábrica. */
  reset() {
    this.data = { ...PADRAO, teclas: {} };
    this._salvar();
    return this.data;
  }
}

export { PADRAO as CONFIG_PADRAO };
