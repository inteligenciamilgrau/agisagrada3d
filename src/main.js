import { Game } from './game.js';

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
  await game.build((label) => { note.textContent = label; });

  note.textContent = game.toque ? 'toque em INICIAR JOGO' : 'clique em INICIAR JOGO';
  startBtn.disabled = false;
  window.__cidade3d = game;        // útil para depurar no console

  let last = performance.now();
  let acc = 0, frames = 0;

  function frame(now) {
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
