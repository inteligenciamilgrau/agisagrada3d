import { ACOES, GRUPOS, PROIBIDAS, rotuloTecla } from '../keys.js';

const $ = (id) => document.getElementById(id);

/**
 * ============================================================
 *  Tela de controles
 * ============================================================
 *
 * A lista de teclas saiu da abertura e veio para cá.
 *
 * Na tela inicial ela ocupava vinte linhas antes do botão de jogar —
 * uma parede de atalhos que ninguém decora de uma vez e que empurrava
 * o INICIAR JOGO para fora da tela em 720p. Aqui ela é o assunto
 * principal da página, cabe inteira e, de quebra, ficou EDITÁVEL:
 * clicar numa tecla e apertar outra troca as duas.
 */
export class KeysScreen {
  constructor(binds) {
    this.binds = binds;
    this.el = $('keys-screen');
    this.lista = $('keys-list');
    this.aguardando = null;          // id da ação esperando uma tecla
    /** O jogo escuta para reescrever as dicas que citam teclas. */
    this.onMudou = null;

    $('keys-close').addEventListener('click', () => this.fechar());
    $('keys-reset').addEventListener('click', () => {
      this.binds.reset();
      this.aguardando = null;
      this.render();
      if (this.onMudou) this.onMudou();
    });

    /*
     * Captura ANTES de todo mundo (terceiro argumento `true`) e corta a
     * propagação: enquanto a tela espera uma tecla, essa tecla não pode
     * também atirar, abrir o celular ou trocar o perfil gráfico.
     */
    window.addEventListener('keydown', (e) => this._capturar(e), true);

    this.render();
  }

  get aberto() { return !this.el.classList.contains('hidden'); }

  abrir() {
    this.aguardando = null;
    this.render();
    this.el.classList.remove('hidden');
  }

  fechar() {
    this.aguardando = null;
    this.el.classList.add('hidden');
  }

  _capturar(e) {
    if (!this.aguardando) return;
    e.preventDefault();
    e.stopPropagation();

    // ESC desiste da troca (e não fecha a tela: seria perder o lugar)
    if (e.code === 'Escape') { this.aguardando = null; this.render(); return; }
    if (PROIBIDAS.has(e.code)) {
      this._avisar(`${rotuloTecla(e.code)} é reservada — escolha outra`);
      return;
    }

    this.binds.definir(this.aguardando, e.code);
    this.aguardando = null;
    this.render();
    if (this.onMudou) this.onMudou();
  }

  _avisar(texto) {
    const el = $('keys-note');
    el.textContent = texto;
    el.classList.add('alerta');
    clearTimeout(this._avisoT);
    this._avisoT = setTimeout(() => {
      el.classList.remove('alerta');
      el.textContent = this._dicaPadrao();
    }, 2200);
  }

  _dicaPadrao() {
    return 'Clique numa tecla e aperte a nova. Se ela já estiver em uso, as duas trocam de lugar.';
  }

  render() {
    this.lista.innerHTML = '';
    const nota = $('keys-note');
    if (!nota.classList.contains('alerta')) nota.textContent = this._dicaPadrao();

    for (const grupo of GRUPOS) {
      const acoes = ACOES.filter((a) => a.grupo === grupo);
      if (!acoes.length) continue;

      const h = document.createElement('div');
      h.className = 'keys-group';
      h.textContent = grupo;
      this.lista.appendChild(h);

      for (const a of acoes) {
        const linha = document.createElement('div');
        linha.className = 'keys-row';

        const nome = document.createElement('span');
        nome.className = 'keys-name';
        nome.textContent = a.nome;

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'keys-bind';
        if (this.aguardando === a.id) {
          btn.classList.add('esperando');
          btn.textContent = 'APERTE...';
        } else {
          btn.textContent = this.binds.rotulo(a.id);
          if (this.binds.code(a.id) !== a.padrao) btn.classList.add('trocada');
        }
        btn.addEventListener('click', () => {
          this.aguardando = this.aguardando === a.id ? null : a.id;
          this.render();
        });

        linha.append(nome, btn);
        this.lista.appendChild(linha);
      }
    }
  }
}
