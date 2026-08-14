/**
 * brHud — HUD do BATTLE ROYALE: zona que encolhe, vivos, loot restante.
 */
export function criarBrHud() {
  const el = document.getElementById('br-hud');
  if (!el) return { atualizar() {}, mostrar() {}, esconder() {} };

  const vivos = document.getElementById('br-vivos');
  const tempo = document.getElementById('br-tempo');
  const zona = document.getElementById('br-zona');
  const loot = document.getElementById('br-loot');

  function mostrar() { el.classList.remove('hidden'); }
  function esconder() { el.classList.add('hidden'); }

  function atualizar(snap, localId, localPos) {
    // zona
    const z = snap.zone;
    if (z) {
      const d = localPos && z ? Math.max(0, Math.hypot(localPos.x - z.x, localPos.z - z.z) - z.r) : 0;
      const dentro = d <= 0;
      zona.textContent = dentro ? '🟢 NA ZONA' : `🔴 ZONA: ${Math.round(d)}m`;
      zona.className = 'br-zona-val ' + (dentro ? 'ok' : 'fora');
      const min = Math.floor(z.tempo || 0), s = Math.round(((z.tempo || 0) - min) * 60);
      tempo.textContent = `⏱ ${min}:${String(Math.max(0, s)).padStart(2, '0')}`;
    }
    // vivos
    if (snap.vivos != null) vivos.textContent = `☠ ${snap.vivos}`;
    // loot restante
    if (snap.loot != null) loot.textContent = `📦 ${snap.loot}`;
  }

  return { atualizar, mostrar, esconder };
}
