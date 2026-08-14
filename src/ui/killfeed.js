/**
 * Killfeed — notificações de abates no canto superior direito.
 */
export function criarKillfeed(rootId = 'killfeed') {
  const el = document.getElementById(rootId);
  if (!el) return { add() {}, limpar() {} };

  const MAX = 5;

  function add(mortoNick, porNick, arma = 'pistola', vcMorreu = false) {
    const div = document.createElement('div');
    div.className = 'kf-item' + (vcMorreu ? ' kf-vc' : '');
    const armas = { pistola: '🔫', metralhadora: '🔫', sniper: '🎯', shotgun: '💥' };
    div.innerHTML =
      `<span class="kf-por">${esc(porNick || '?')}</span>` +
      `<span class="kf-arma">${armas[arma] || '🔫'}</span>` +
      `<span class="kf-morto">${esc(mortoNick || '?')}</span>`;
    el.appendChild(div);
    while (el.children.length > MAX) el.removeChild(el.firstChild);
    setTimeout(() => { if (div.parentNode) div.parentNode.removeChild(div); }, 4000);
  }

  function limpar() { el.innerHTML = ''; }

  return { add, limpar };
}

function esc(s) {
  return String(s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
}
