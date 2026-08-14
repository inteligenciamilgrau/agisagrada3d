/**
 * netStatus — badge de conexão (ping / estado) no canto da tela.
 */
export function criarNetStatus() {
  const el = document.getElementById('net-status');
  if (!el) return { setPing() {}, setEstado() {} };

  const pingEl = document.getElementById('ns-ping');

  function setPing(ms) {
    if (ms == null || !pingEl) return;
    // nunca passa de 3 dígitos: o badge não pode ficar largo na tela
    const msC = Math.max(0, Math.min(999, Math.round(ms)));
    pingEl.textContent = `${msC}ms`;
    pingEl.className = msC < 80 ? 'ns-ok' : msC < 200 ? 'ns-meio' : 'ns-ruim';
  }

  function setEstado(estado) {
    const nomes = { off: 'desconectado', conectando: 'conectando…', aberto: 'online', erro: 'erro' };
    el.dataset.estado = estado;
    const se = el.querySelector('.ns-estado');
    if (se) se.textContent = nomes[estado] || estado;
  }

  return { setPing, setEstado };
}
