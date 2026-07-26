import { CAST } from '../story/story.js';
import { HUMANOIDES, MODELOS } from '../ent/voxeldef.js';
import { VX } from '../ent/voxel.js';

/**
 * ============================================================
 *  Caixa de diálogo e cutscenes
 * ============================================================
 *
 * O roteiro do jogo 2D é uma lista de `[QUEM, 'fala']`. Este módulo
 * encena essa lista: escreve letra a letra, mostra o retrato de quem
 * fala e espera o Espaço.
 *
 * ---- OS RETRATOS ----
 * Nenhuma imagem entra no repositório. O retrato é o PRÓPRIO modelo
 * voxel projetado de frente num canvas 2D: as mesmas caixas, as mesmas
 * cores, vistas de face. Vale mais que desenhar retrato à mão porque
 * mexer no molde do personagem atualiza o retrato junto — os dois nunca
 * saem de sincronia, que é o mesmo motivo dos normal maps do projeto
 * saírem do mapa de altura.
 */

const RETRATO_PX = 132;
const _cacheRetrato = new Map();

/**
 * Lista de caixas de um personagem, em voxels, no referencial da
 * figura (y = 0 nos pés). Serve tanto para humanoide quanto para os
 * modelos livres (Loro, drone, dragão).
 */
function caixasDe(chave) {
  const h = HUMANOIDES[chave];
  if (h) {
    const caixas = [
      { w: 8, h: 12, d: 4, x: 0, y: 18, z: 0, cor: h.torso ?? 0x3355aa },
      { w: 4, h: 12, d: 4, x: -6, y: 17, z: 0, cor: h.bracos ?? h.torso ?? 0x3355aa },
      { w: 4, h: 12, d: 4, x: 6,  y: 17, z: 0, cor: h.bracos ?? h.torso ?? 0x3355aa },
      { w: 8, h: 8,  d: 8, x: 0, y: 28, z: 0, cor: h.cabecaCor ?? h.pele ?? 0xd9a066 },
    ];
    for (const e of h.extras || []) {
      // extras de braço saem do retrato: o busto corta na altura do peito
      if (e.em === 'bracoD' || e.em === 'bracoE') continue;
      caixas.push({ ...e, x: e.x || 0, y: e.y || 0, z: e.z || 0 });
    }
    return { caixas, escala: h.escala || 1 };
  }

  const m = MODELOS[chave];
  if (m) return { caixas: m.pecas.map((p) => ({ ...p, x: p.x || 0, y: p.y || 0, z: p.z || 0 })), escala: m.escala || 1 };
  return null;
}

/**
 * Projeta as caixas de frente (plano XY) num canvas.
 *
 * A ordem de desenho é por Z crescente: o que está atrás vai primeiro e
 * o que está na frente cobre. É pintor puro — sem profundidade real —
 * e num busto de frente isso basta.
 */
function desenharRetrato(chave, corAcento) {
  const c = document.createElement('canvas');
  c.width = c.height = RETRATO_PX;
  const x = c.getContext('2d');

  const dados = caixasDe(chave);
  if (!dados) {
    // quem não tem molde (SISTEMA, ???) fica com um bloco liso
    x.fillStyle = corAcento;
    x.globalAlpha = 0.22;
    x.fillRect(0, 0, RETRATO_PX, RETRATO_PX);
    return c;
  }

  const { caixas } = dados;

  // ---- enquadramento: só o busto (do peito para cima)
  const corte = HUMANOIDES[chave] ? 15 : -Infinity;
  const vis = caixas.filter((b) => (b.y + b.h / 2) > corte);

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const b of vis) {
    minX = Math.min(minX, b.x - b.w / 2); maxX = Math.max(maxX, b.x + b.w / 2);
    minY = Math.min(minY, Math.max(corte, b.y - b.h / 2)); maxY = Math.max(maxY, b.y + b.h / 2);
  }
  const larg = maxX - minX, alt = maxY - minY;
  const margem = 0.88;
  const esc = Math.min(RETRATO_PX / larg, RETRATO_PX / alt) * margem;
  const cx = RETRATO_PX / 2 - ((minX + maxX) / 2) * esc;
  const cy = RETRATO_PX / 2 + ((minY + maxY) / 2) * esc;

  // ---- fundo com a cor do personagem
  const g = x.createLinearGradient(0, 0, 0, RETRATO_PX);
  g.addColorStop(0, corAcento + '38');
  g.addColorStop(1, '#0a0f18');
  x.fillStyle = g;
  x.fillRect(0, 0, RETRATO_PX, RETRATO_PX);

  // ---- as caixas, de trás para a frente
  for (const b of [...vis].sort((a, bb) => a.z - bb.z)) {
    const y0 = Math.max(corte, b.y - b.h / 2);
    const px = cx + (b.x - b.w / 2) * esc;
    const py = cy - (b.y + b.h / 2) * esc;
    const pw = b.w * esc;
    const ph = (b.y + b.h / 2 - y0) * esc;

    const hex = '#' + (b.cor >>> 0).toString(16).padStart(6, '0');
    x.fillStyle = hex;
    x.fillRect(px, py, pw, ph);

    // luz por cima e sombra por baixo: dá volume sem precisar de 3D
    x.fillStyle = 'rgba(255,255,255,.16)';
    x.fillRect(px, py, pw, Math.max(1, ph * 0.16));
    x.fillStyle = 'rgba(0,0,0,.22)';
    x.fillRect(px, py + ph - Math.max(1, ph * 0.14), pw, Math.max(1, ph * 0.14));

    // contorno escuro: é o que faz ler como pixel art
    x.strokeStyle = 'rgba(0,0,0,.45)';
    x.lineWidth = 1;
    x.strokeRect(Math.round(px) + 0.5, Math.round(py) + 0.5, Math.round(pw), Math.round(ph));
  }
  return c;
}

function retrato(chave, corAcento) {
  const k = chave || '_';
  let c = _cacheRetrato.get(k);
  if (!c) {
    c = desenharRetrato(chave, corAcento);
    _cacheRetrato.set(k, c);
  }
  return c;
}

// ============================================================ a caixa
export class Dialogue {
  constructor() {
    this.el = document.getElementById('dialogue');
    this.elRetrato = document.getElementById('dlg-portrait');
    this.elNome = document.getElementById('dlg-name');
    this.elTexto = document.getElementById('dlg-text');
    this.elDica = document.getElementById('dlg-hint');

    this.ativo = false;
    this.onLetra = null;
    this.linhas = [];
    this.i = 0;
    this.escrito = 0;       // quantos caracteres já apareceram
    this.aoFim = null;
  }

  /**
   * @param {Array<[string,string]>} linhas
   * @param {Function} aoFim  chamado quando a última fala é dispensada
   */
  tocar(linhas, aoFim) {
    if (!linhas || !linhas.length) { if (aoFim) aoFim(); return; }
    this.linhas = linhas;
    this.i = 0;
    this.aoFim = aoFim;
    this.ativo = true;
    this.el.classList.remove('hidden');
    this._mostrar();
  }

  _mostrar() {
    const [quem, fala] = this.linhas[this.i];
    const c = CAST[quem] || { nome: quem, cor: '#8b949e', voxel: null };

    this.elNome.textContent = c.nome;
    this.elNome.style.color = c.cor;
    this.el.style.setProperty('--dlg-accent', c.cor);

    this.elRetrato.innerHTML = '';
    this.elRetrato.appendChild(retrato(c.voxel, c.cor));
    this.elRetrato.style.borderColor = c.cor;

    this.textoCheio = fala;
    this.escrito = 0;
    this.elTexto.textContent = '';
    this.elDica.classList.add('hidden');
  }

  update(dt) {
    if (!this.ativo) return;
    if (this.escrito < this.textoCheio.length) {
      // ~55 caracteres por segundo: rápido o bastante para não irritar,
      // devagar o bastante para dar ritmo de fala
      const antes = Math.floor(this.escrito);
      this.escrito = Math.min(this.textoCheio.length, this.escrito + dt * 55);
      const agora = Math.floor(this.escrito);
      this.elTexto.textContent = this.textoCheio.slice(0, agora);
      // um bipe por caractere revelado (o Audio limita a cadência)
      if (agora > antes && this.onLetra) this.onLetra();
      if (this.escrito >= this.textoCheio.length) this.elDica.classList.remove('hidden');
    }
  }

  /** Espaço: completa a linha ou avança. Devolve true se consumiu a tecla. */
  avancar() {
    if (!this.ativo) return false;
    if (this.escrito < this.textoCheio.length) {
      this.escrito = this.textoCheio.length;      // primeiro toque: revela tudo
      this.elTexto.textContent = this.textoCheio;
      this.elDica.classList.remove('hidden');
      return true;
    }
    this.i++;
    if (this.i >= this.linhas.length) { this.fechar(); return true; }
    this._mostrar();
    return true;
  }

  /** ESC: pula a cutscene inteira. */
  pular() {
    if (!this.ativo) return false;
    this.fechar();
    return true;
  }

  fechar() {
    this.ativo = false;
    this.el.classList.add('hidden');
    const cb = this.aoFim;
    this.aoFim = null;
    if (cb) cb();
  }

  /**
   * Encerra SEM disparar o `aoFim`.
   *
   * A diferença importa: `fechar()` significa "a fala acabou, siga o
   * roteiro" e chama o callback. No reinício de partida a cutscene é
   * descartada, e disparar o callback ali faria a fase avançar sozinha
   * — o jogador voltaria ao menu e a fase se daria por vencida.
   */
  cancelar() {
    this.aoFim = null;
    this.ativo = false;
    this.linhas = [];
    this.el.classList.add('hidden');
  }
}

export { retrato as retratoVoxel, RETRATO_PX };
