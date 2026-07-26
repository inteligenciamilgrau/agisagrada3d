import {
  PRESETS, DEFAULT_PRESET, POPULATIONS, DEFAULT_POPULATION,
  RENDER_DISTANCES, DEFAULT_RENDER_DISTANCE,
} from './config.js';
import { VOLUMES, DEFAULT_VOLUME } from './sys/audio.js';

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
  cycleMode: 'ciclo',                   // [13] ciclo | dia | noite
  presetIndex: DEFAULT_PRESET,          // qualidade gráfica
  populationIndex: DEFAULT_POPULATION,  // [61] quantidade de gente e carros
  renderDistanceIndex: DEFAULT_RENDER_DISTANCE,  // alcance de renderização
  volumeIndex: DEFAULT_VOLUME,                   // volume dos efeitos
};

const CICLOS = ['ciclo', 'dia', 'noite'];

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
  if (Number.isInteger(bruto.volumeIndex)
      && bruto.volumeIndex >= 0 && bruto.volumeIndex < VOLUMES.length) {
    s.volumeIndex = bruto.volumeIndex;
  }
  return s;
}

export class Settings {
  constructor() {
    this.data = this._carregar();
  }

  _carregar() {
    try {
      return sanear(JSON.parse(localStorage.getItem(CHAVE)));
    } catch {
      // localStorage pode estar indisponível (modo privado, file://).
      // Nesse caso o jogo roda igual, só não lembra entre sessões.
      return { ...PADRAO };
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
    this.data = { ...PADRAO };
    this._salvar();
    return this.data;
  }
}

export { PADRAO as CONFIG_PADRAO };
