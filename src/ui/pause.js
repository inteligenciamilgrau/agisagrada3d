/**
 * pause — tela de PAUSA única para os três modos (solo, DM e BR).
 *
 * Os handlers são trocáveis: quem está no comando (Game no solo, Match
 * no multiplayer) chama `ligar()` com os seus botões, e a mesma tela
 * atende — RETOMAR / OPÇÕES / CONTROLES / SAIR — sem duplicar
 * listeners no DOM (o `wire` roda uma única vez).
 *
 * A pausa chega por três caminhos iguais em qualquer modo:
 *   - tecla Pause/Break;
 *   - tecla ESC;
 *   - botão voltar da barra de navegação do Android (popstate).
 */
const $ = (id) => document.getElementById(id);

let wired = false;
const h = { retomar: null, opcoes: null, controles: null, sair: null };

function wire() {
  const btn = (id, cb) => {
    const el = $(id);
    if (el) el.addEventListener('click', () => cb && cb());
  };
  btn('pause-retomar', () => h.retomar && h.retomar());
  btn('pause-opcoes', () => h.opcoes && h.opcoes());
  btn('pause-controles', () => h.controles && h.controles());
  btn('pause-sair', () => h.sair && h.sair());
}

export function criarPausa() {
  const el = $('pause-screen');
  if (!wired) { wire(); wired = true; }

  return {
    ligar(handlers) { Object.assign(h, handlers); },
    mostrar() { if (el) el.classList.remove('hidden'); },
    esconder() { if (el) el.classList.add('hidden'); },
    aberto() { return !!el && !el.classList.contains('hidden'); },
  };
}
