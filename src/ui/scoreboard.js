/**
 * Scoreboard — placar da partida (Tab no desktop / botão no celular).
 */
export function criarScoreboard() {
  const el = document.getElementById('scoreboard');
  const corpo = document.getElementById('sb-rows');
  if (!el || !corpo) return { atualizar() {}, alternar() {}, mostrar() {}, esconder() {} };

  let visivel = false;
  let dados = [];

  function atualizar(players) {
    dados = players || [];
    if (!visivel) return;
    render();
  }

  function render() {
    const ordenados = [...dados].sort((a, b) => (b.kills || 0) - (a.kills || 0));
    corpo.innerHTML = '';
    for (const p of ordenados) {
      const tr = document.createElement('tr');
      tr.className = p.local ? 'sb-local' : '';
      tr.innerHTML =
        `<td class="sb-nick">${p.bot ? '🤖 ' : ''}${esc(p.nick || '?')}${p.local ? ' <i>(você)</i>' : ''}</td>` +
        `<td>${p.kills || 0}</td><td>${p.deaths || 0}</td>`;
      corpo.appendChild(tr);
    }
  }

  function alternar() { visivel ? esconder() : mostrar(); }
  function mostrar() { visivel = true; render(); el.classList.remove('hidden'); }
  function esconder() { visivel = false; el.classList.add('hidden'); }

  return { atualizar, alternar, mostrar, esconder };
}

function esc(s) {
  return String(s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
}
