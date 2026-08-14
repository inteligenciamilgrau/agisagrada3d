/**
 * modeSelect — modal de seleção de modo na tela de abertura.
 * 3 cartões: MISSÕES (single), MULTIPLAYER (DM) e BATTLE ROYALE (BR).
 */
import { iniciarMultiplayer } from '../net/multiplayer.js';

export function abrirModoSelect(game) {
  const modal = document.getElementById('mode-select');
  if (!modal) return;
  modal.classList.remove('hidden');

  const nick = document.getElementById('mp-nick');
  const salvo = localStorage.getItem('bob3d-nick');
  if (salvo && nick) nick.value = salvo;
  if (nick) {
    nick.addEventListener('change', () => localStorage.setItem('bob3d-nick', nick.value.trim().slice(0, 14)));
  }

  const fechar = () => modal.classList.add('hidden');

  const btnMiss = document.getElementById('mp-missoes');
  const btnDm = document.getElementById('mp-dm');
  const btnBr = document.getElementById('mp-br');

  if (btnMiss) btnMiss.onclick = () => { fechar(); };
  if (btnDm) btnDm.onclick = () => {
    fechar();
    const n = nick ? nick.value.trim().slice(0, 14) || 'Jogador' : 'Jogador';
    iniciarMultiplayer(game, 'dm', n);
  };
  // [BR-OFF] battle royale desativado — botão vira tag "EM BREVE" (disabled no HTML)
  // btnBr.onclick não é registrado: o <button> tem disabled e pointer-events:none
  modal.querySelector('.mp-fechar')?.addEventListener('click', fechar);
}
