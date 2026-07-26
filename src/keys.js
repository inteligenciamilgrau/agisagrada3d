/**
 * ============================================================
 *  Teclas configuráveis
 * ============================================================
 *
 * O jogo não pergunta mais "que TECLA foi apertada" e sim "que AÇÃO o
 * jogador pediu". A tradução mora aqui.
 *
 * Essa inversão é o que permite três coisas ao mesmo tempo:
 *   1. a tela de configuração troca uma tecla sem que `game.js` saiba;
 *   2. o teclado de quem joga em AZERTY ou ABNT2 deixa de ser problema;
 *   3. os botões da tela de toque disparam as MESMAS ações, sem
 *      simular eventos de teclado.
 */

/** Grupos, na ordem em que aparecem na tela de controles. */
export const GRUPOS = ['MOVIMENTO', 'AÇÃO', 'MUNDO'];

/**
 * Teclas que nunca podem ser reatribuídas: ou são do navegador (F5, F11,
 * F12) ou já têm papel fixo no jogo (ESC abre o menu, e sem ele um
 * atalho mal escolhido tranca o jogador dentro da partida).
 */
export const PROIBIDAS = new Set(['Escape', 'F5', 'F11', 'F12', 'Tab']);

export const ACOES = [
  // ------------------------------------------------------ movimento
  { id: 'frente',   grupo: 'MOVIMENTO', padrao: 'KeyW',        nome: 'Andar para frente' },
  { id: 'tras',     grupo: 'MOVIMENTO', padrao: 'KeyS',        nome: 'Andar para trás' },
  { id: 'esquerda', grupo: 'MOVIMENTO', padrao: 'KeyA',        nome: 'Ir para a esquerda' },
  { id: 'direita',  grupo: 'MOVIMENTO', padrao: 'KeyD',        nome: 'Ir para a direita' },
  { id: 'correr',   grupo: 'MOVIMENTO', padrao: 'ShiftLeft',   nome: 'Correr · descer (voando)' },
  { id: 'pular',    grupo: 'MOVIMENTO', padrao: 'Space',       nome: 'Pular · subir (voando) · avançar a fala' },
  { id: 'turbo',    grupo: 'MOVIMENTO', padrao: 'ControlLeft', nome: 'Turbo do Modo Deus' },

  // ------------------------------------------------------ ação
  { id: 'atirar',  grupo: 'AÇÃO', padrao: 'KeyE', nome: 'Atirar · míssil do helicóptero' },
  { id: 'missil',  grupo: 'AÇÃO', padrao: 'KeyX', nome: 'Míssil teleguiado' },
  { id: 'acao',    grupo: 'AÇÃO', padrao: 'KeyF', nome: 'Entrar na fase / no veículo · pular a cena' },
  { id: 'visao',   grupo: 'AÇÃO', padrao: 'KeyV', nome: 'Câmera interna / externa' },
  { id: 'plano',   grupo: 'AÇÃO', padrao: 'KeyJ', nome: 'O Plano da AGI' },
  { id: 'celular', grupo: 'AÇÃO', padrao: 'KeyC', nome: 'Celular' },
  { id: 'heliEsq', grupo: 'AÇÃO', padrao: 'KeyQ', nome: 'Girar o helicóptero à esquerda' },
  { id: 'heliDir', grupo: 'AÇÃO', padrao: 'KeyR', nome: 'Girar o helicóptero à direita' },

  // ------------------------------------------------------ mundo
  { id: 'graficos', grupo: 'MUNDO', padrao: 'KeyG', nome: 'Qualidade gráfica' },
  { id: 'alcance',  grupo: 'MUNDO', padrao: 'KeyL', nome: 'Alcance de renderização' },
  { id: 'luz',      grupo: 'MUNDO', padrao: 'KeyN', nome: 'Dia / noite / ciclo' },
  { id: 'gente',    grupo: 'MUNDO', padrao: 'KeyP', nome: 'Movimento na cidade' },
  { id: 'som',      grupo: 'MUNDO', padrao: 'KeyO', nome: 'Mudo (liga/desliga o som)' },
  { id: 'tempo',    grupo: 'MUNDO', padrao: 'KeyT', nome: 'Limite de tempo' },
  { id: 'deus',     grupo: 'MUNDO', padrao: 'KeyM', nome: 'Modo Deus (voar)' },
];

/** Índice rápido id -> definição. */
export const ACAO_POR_ID = Object.fromEntries(ACOES.map((a) => [a.id, a]));

const NOMES = {
  Space: 'ESPAÇO', Enter: 'ENTER', Backspace: '⌫', CapsLock: 'CAPS',
  ShiftLeft: 'SHIFT', ShiftRight: 'SHIFT DIR',
  ControlLeft: 'CTRL', ControlRight: 'CTRL DIR',
  AltLeft: 'ALT', AltRight: 'ALT GR',
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
  Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']',
  Semicolon: ';', Quote: "'", Backquote: '`', Backslash: '\\',
  Comma: ',', Period: '.', Slash: '/', IntlBackslash: '\\', IntlRo: '/',
};

/** Nome curto e legível de um `event.code`. */
export function rotuloTecla(code) {
  if (!code) return '—';
  if (NOMES[code]) return NOMES[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return 'NUM ' + code.slice(6);
  return code;
}

/**
 * O mapa ação -> tecla, com persistência.
 *
 * Guarda também o caminho inverso (tecla -> ação), que é o que o `Input`
 * consulta a cada `keydown` — refazer essa busca varrendo a lista toda,
 * várias vezes por quadro, seria trabalho à toa.
 */
export class Keybinds {
  constructor(settings) {
    this.settings = settings;
    this.mapa = {};
    for (const a of ACOES) this.mapa[a.id] = a.padrao;

    const salvo = settings ? settings.get('teclas') : null;
    if (salvo && typeof salvo === 'object') {
      for (const [id, code] of Object.entries(salvo)) {
        if (!ACAO_POR_ID[id]) continue;                 // ação que não existe mais
        if (typeof code !== 'string' || !code) continue;
        if (PROIBIDAS.has(code)) continue;
        this.mapa[id] = code;
      }
    }
    this._indexar();
  }

  _indexar() {
    this.porTecla = {};
    for (const [id, code] of Object.entries(this.mapa)) {
      if (code) this.porTecla[code] = id;
    }
  }

  _salvar() {
    if (this.settings) this.settings.set('teclas', { ...this.mapa });
  }

  /** Tecla (`event.code`) de uma ação. */
  code(id) { return this.mapa[id] || null; }

  /** Ação de uma tecla, ou null se ela não faz nada. */
  acao(code) { return this.porTecla[code] || null; }

  /** Rótulo pronto para a tela ("W", "ESPAÇO", "SHIFT"). */
  rotulo(id) { return rotuloTecla(this.mapa[id]); }

  /**
   * Reatribui uma tecla.
   *
   * Se a tecla já pertencia a outra ação, as duas TROCAM. Roubar sem
   * devolver deixaria a ação anterior sem tecla nenhuma — e é assim que
   * se perde o pulo sem perceber, três reatribuições depois.
   */
  definir(id, code) {
    if (!ACAO_POR_ID[id] || !code || PROIBIDAS.has(code)) return false;
    const antiga = this.mapa[id];
    const dono = this.acao(code);
    if (dono === id) return false;
    if (dono) this.mapa[dono] = antiga;
    this.mapa[id] = code;
    this._indexar();
    this._salvar();
    return true;
  }

  /** Volta todas as teclas ao padrão de fábrica. */
  reset() {
    for (const a of ACOES) this.mapa[a.id] = a.padrao;
    this._indexar();
    this._salvar();
  }
}
