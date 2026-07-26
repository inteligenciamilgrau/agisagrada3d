import { PLAN_ITEMS, PHASES, liberada, proximaFase } from '../story/story.js';

/**
 * ============================================================
 *  O Plano da AGI Sagrada (tecla T)
 * ============================================================
 *
 * O placar da campanha: oito peças, o que já foi conquistado e qual é
 * o próximo passo. No jogo 2D era um quadro de planejamento; aqui é a
 * mesma ideia, porque ela resolve um problema real do mundo aberto —
 * o jogador que voltou depois de dois dias precisa saber, em um
 * segundo, onde parou e para onde ir.
 */
export class PlanScreen {
  constructor(estado) {
    this.estado = estado;
    this.el = document.getElementById('plan-screen');
    this.grid = document.getElementById('plan-grid');
    this.proximo = document.getElementById('plan-next');
    this.aberto = false;
    this.recentes = new Set();     // peças ganhas agora: piscam uma vez

    document.getElementById('plan-close').addEventListener('click', () => this.fechar());
  }

  /** Marca uma peça como conquistada e guarda para destacar. */
  conquistar(chave) {
    if (!chave || this.estado.conquistas[chave]) return;
    this.estado.conquistas[chave] = true;
    this.recentes.add(chave);
  }

  _render() {
    this.grid.innerHTML = '';
    for (const item of PLAN_ITEMS) {
      const tem = this.estado.conquistas[item.key];
      const novo = this.recentes.has(item.key);
      const d = document.createElement('div');
      d.className = 'plan-item' + (tem ? ' got' : '') + (novo ? ' fresh' : '');
      d.innerHTML =
        `<div class="plan-check">✔</div>` +
        `<div class="plan-icon">${item.icon}</div>` +
        `<div class="plan-label">${item.label}</div>` +
        `<div class="plan-sub">${item.sub}</div>`;
      this.grid.appendChild(d);
    }

    // ---- para onde ir agora
    const feitas = PLAN_ITEMS.filter((i) => this.estado.conquistas[i.key]).length;
    const prox = proximaFase(this.estado);
    let txt = `<b>${feitas} de ${PLAN_ITEMS.length}</b> peças conquistadas. `;

    if (prox) {
      txt += `Próximo passo: <b>${prox.flag} ${prox.title}</b> — ${prox.place}.<br>`;
      txt += `O portal está marcado no mapa: <b>${prox.portal.label}</b>.`;
    } else {
      const final = PHASES.find((f) => f.final);
      txt += liberada(final, this.estado) && !this.estado.fasesVencidas[final.key]
        ? `Tudo pronto. <b>O CURUPIRA espera no Labs IMG.</b>`
        : `<b>A AGI Sagrada nunca esteve numa fortaleza. Estava na comunidade.</b>`;
    }
    this.proximo.innerHTML = txt;
  }

  abrir() {
    this._render();
    this.el.classList.remove('hidden');
    this.aberto = true;
  }

  fechar() {
    this.el.classList.add('hidden');
    this.aberto = false;
    this.recentes.clear();     // o brilho de "novo" só aparece uma vez
  }

  alternar() { this.aberto ? this.fechar() : this.abrir(); }
}
