import { Game } from './game.js';
import { abrirModoSelect } from './modes/modeSelect.js';

/**
 * Ponto de entrada: constrói o mundo, libera a tela de abertura [39]
 * e roda o laço principal.
 */
export async function boot() {
  const canvas = document.getElementById('scene');
  const note = document.getElementById('loading-note');
  const startBtn = document.getElementById('start-btn');

  startBtn.disabled = true;

  const game = new Game(canvas);
  await game.build((label) => { note.textContent = label; try { document.title = 'BOOT: ' + label; } catch {} });

  note.textContent = game.toque ? 'toque em INICIAR JOGO' : 'clique em INICIAR JOGO';
  startBtn.disabled = false;

  const mpBtn = document.getElementById('mp-btn');
  if (mpBtn) {
    mpBtn.disabled = false;
    mpBtn.addEventListener('click', () => abrirModoSelect(game));
  }
  // QUALQUER interação na tela (botão ou toque no jogo) ativa o fullscreen
  document.addEventListener('pointerup', () => {
    if (game.toque && !document.fullscreenElement && document.documentElement.requestFullscreen) {
      document.documentElement.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
    }
  }, true);

  let last = performance.now();
  let acc = 0, frames = 0;
  let ativo = true;

  // o multiplayer para/retoma o laço do single (sem isto, dois laços
  // escreviam no mesmo canvas e a tela do MP ficava só com o céu)
  window.__pararLoopSingle = () => { ativo = false; };
  window.__retomarLoopSingle = () => {
    if (ativo) return;
    ativo = true;
    last = performance.now();
    requestAnimationFrame(frame);
  };

  function frame(now) {
    if (!ativo) return;               // parado pelo multiplayer: não re-agenda
    requestAnimationFrame(frame);

    // dt limitado: se a aba ficar em segundo plano, nada "teleporta"
    const dt = Math.min(0.05, Math.max(0.0001, (now - last) / 1000));
    last = now;

    game.update(dt);
    game.render();

    // contador de FPS discreto no título da aba
    acc += dt; frames++;
    if (acc >= 1) {
      document.title = `Cidade 3D IMG — ${Math.round(frames / acc)} fps`;
      acc = 0; frames = 0;
    }
  }
  requestAnimationFrame(frame);
}
