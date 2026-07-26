import { dist2D } from '../utils.js';

const $ = (id) => document.getElementById(id);

/** Respostas genéricas por "personalidade" do NPC. */
const SMALLTALK = [
  ['Oi! Quem é?', 'Tô indo pro trabalho, falo depois.', 'Essa cidade não para nunca, né?'],
  ['Fala!', 'Cara, o trânsito hoje tá impossível.', 'Já viu o Cristo daqui? Vista absurda.'],
  ['Alô? Acho que você errou o número.', 'Hmm... quem te deu meu número?', 'Tô ocupado agora.'],
  ['E aí!', 'Tô esperando o sinal abrir há uns 10 minutos.', 'Bora tomar um açaí depois?'],
];

/**
 * [56] Celular: o jogador aperta C, digita o número que viu nas costas de
 * um NPC [55] e troca mensagens com ele. O NPC responde de acordo com o
 * papel dele na missão.
 */
export class Phone {
  constructor(peds) {
    this.peds = peds;
    this.open = false;
    this.threads = new Map();       // número -> [{from,text}]
    this.current = null;
    this.getContext = null;         // injetado pelo jogo
    this.onOpenChange = null;

    this.el = {
      root: $('phone'),
      contacts: $('phone-contacts'),
      chat: $('phone-chat'),
      list: $('phone-list'),
      number: $('phone-number'),
      call: $('phone-call'),
      back: $('phone-back'),
      title: $('phone-title'),
      who: $('chat-who'),
      log: $('chat-log'),
      input: $('chat-input'),
      send: $('chat-send'),
    };

    this._bind();
  }

  _bind() {
    this.el.call.addEventListener('click', () => {
      const num = this.el.number.value.trim();
      if (num) this.openThread(num);
    });
    this.el.number.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') this.el.call.click();
    });

    this.el.send.addEventListener('click', () => this._send());
    this.el.input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') this._send();
    });

    this.el.back.addEventListener('click', () => this.showContacts());

    /*
     * Fechar sem teclado.
     *
     * O celular só saía com C ou ESC — teclas que não existem num
     * celular de verdade, e ali o jogador ficava preso dentro da tela de
     * mensagens. Agora a barrinha de baixo e o vazio em volta do
     * aparelho fecham, que é o gesto que a mão já faz em qualquer app.
     */
    $('phone-home').addEventListener('click', () => this.close());
    this.el.root.addEventListener('pointerdown', (e) => {
      if (e.target === this.el.root) this.close();
    });
  }

  // ------------------------------------------------------------------ abrir/fechar
  toggle() { this.open ? this.close() : this.show(); }

  show() {
    this.open = true;
    this.el.root.classList.remove('hidden');
    this.showContacts();
    this._renderList();
    setTimeout(() => this.el.number.focus(), 40);
    if (this.onOpenChange) this.onOpenChange(true);
  }

  close() {
    this.open = false;
    this.el.root.classList.add('hidden');
    this.el.number.blur();
    this.el.input.blur();
    if (this.onOpenChange) this.onOpenChange(false);
  }

  showContacts() {
    this.current = null;
    this.el.contacts.classList.remove('hidden');
    this.el.chat.classList.add('hidden');
    this.el.back.classList.remove('on');
    this.el.title.textContent = 'Mensagens';
    this._renderList();
  }

  // ------------------------------------------------------------------ conversas
  openThread(number) {
    number = String(number).trim();
    this.current = number;
    if (!this.threads.has(number)) this.threads.set(number, []);

    this.el.contacts.classList.add('hidden');
    this.el.chat.classList.remove('hidden');
    this.el.back.classList.add('on');
    this.el.title.textContent = number;

    const ped = this.peds.byNumber(number);
    this.el.who.textContent = ped
      ? 'Cidadão #' + number + ' — online'
      : 'Número desconhecido — pode não existir';

    this._renderLog();
    setTimeout(() => this.el.input.focus(), 40);
  }

  _send() {
    const text = this.el.input.value.trim();
    if (!text || !this.current) return;
    this.el.input.value = '';

    const thread = this.threads.get(this.current);
    thread.push({ from: 'me', text });
    this._renderLog();

    const ped = this.peds.byNumber(this.current);
    if (!ped) {
      setTimeout(() => {
        thread.push({ from: 'sys', text: 'Número inexistente ou fora de área.' });
        this._renderLog();
      }, 700);
      return;
    }

    // o NPC acena quando recebe mensagem — dá pra achar ele na multidão
    ped.human.armGesture = 1;
    setTimeout(() => { if (ped.alive) ped.human.armGesture = 0; }, 6000);

    // "digitando..."
    thread.push({ from: 'typing', text: 'digitando...' });
    this._renderLog();

    setTimeout(() => {
      const i = thread.findIndex((m) => m.from === 'typing');
      if (i >= 0) thread.splice(i, 1);
      thread.push({ from: 'them', text: this._reply(ped, text) });
      this._renderLog();
      if (!this.open) return;
    }, 700 + Math.random() * 900);
  }

  /** Resposta contextual: quem tem o pacote dá dica de onde está. */
  _reply(ped, text) {
    const t = text.toLowerCase();
    const ctx = this.getContext ? this.getContext() : {};
    const pos = ped.human.root.position;

    const bearing = () => {
      if (!ctx.player) return 'por aqui';
      const dx = pos.x - ctx.player.x, dz = pos.z - ctx.player.z;
      const dist = Math.round(Math.hypot(dx, dz));
      const dir = Math.abs(dx) > Math.abs(dz)
        ? (dx > 0 ? 'leste' : 'oeste')
        : (dz > 0 ? 'sul' : 'norte');
      return `uns ${dist} metros pro ${dir}`;
    };

    // ---- quem está com o objeto [5]
    if (ped.hasPackage) {
      if (/onde|cad[êe]|local|lugar|tá|ta /.test(t)) {
        return `Tô ${bearing()} daí. Levanta a mão que eu te vejo! 📦`;
      }
      if (/pacote|encomenda|entrega|objeto/.test(t)) {
        return 'O pacote tá comigo sim! Vem buscar que eu te entrego na mão.';
      }
      return `Tô com um pacote pra você. ${bearing()[0].toUpperCase() + bearing().slice(1)}.`;
    }

    // ---- quem espera a entrega [6]
    if (ped.isTarget) {
      if (/onde|cad[êe]|local/.test(t)) {
        return `Te espero ${bearing()}. Não demora que eu tenho compromisso!`;
      }
      if (/chegando|indo|caminho|j[áa] vou/.test(t)) {
        return 'Show! Tô de olho na rua aqui. 👀';
      }
      return 'Ei, esse pacote é meu! Traz logo que eu pago o café ☕';
    }

    // ---- conversa fiada
    if (/oi|ol[áa]|e a[íi]|bom dia|boa noite|fala/.test(t)) {
      return SMALLTALK[ped.mood][0];
    }
    if (/pacote|entrega|encomenda/.test(t)) {
      return 'Pacote? Não é comigo não. Tenta outro número.';
    }
    if (/obrigad|valeu|vlw/.test(t)) {
      return 'Disponha! 🙌';
    }
    if (/\?$/.test(t)) {
      return SMALLTALK[ped.mood][2];
    }
    return SMALLTALK[ped.mood][1];
  }

  // ------------------------------------------------------------------ render
  _renderLog() {
    if (!this.current) return;
    const thread = this.threads.get(this.current) || [];
    this.el.log.innerHTML = '';
    for (const m of thread) {
      const d = document.createElement('div');
      d.className = 'bubble ' + (m.from === 'me' ? 'me' : m.from === 'sys' ? 'sys' : m.from === 'typing' ? 'them typing' : 'them');
      d.textContent = m.text;
      this.el.log.appendChild(d);
    }
    this.el.log.scrollTop = this.el.log.scrollHeight;
  }

  _renderList() {
    const ctx = this.getContext ? this.getContext() : {};
    this.el.list.innerHTML = '';

    const entries = [];
    // conversas já iniciadas
    for (const num of this.threads.keys()) {
      entries.push({ num, tag: this._tagFor(num, ctx) });
    }
    // pessoas por perto, para o jogador não precisar decorar números
    if (ctx.player) {
      const near = this.peds.peds
        .filter((p) => p.alive)
        .map((p) => ({ p, d: dist2D(p.human.root.position.x, p.human.root.position.z, ctx.player.x, ctx.player.z) }))
        .filter((e) => e.d < 45)
        .sort((a, b) => a.d - b.d)
        .slice(0, 6);
      for (const e of near) {
        if (!entries.find((x) => x.num === String(e.p.number))) {
          entries.push({ num: String(e.p.number), tag: this._tagFor(String(e.p.number), ctx), dist: e.d });
        }
      }
    }

    if (!entries.length) {
      const d = document.createElement('div');
      d.className = 'phone-hint';
      d.textContent = 'Chegue perto de alguém para ver o número dele aqui.';
      this.el.list.appendChild(d);
      return;
    }

    for (const e of entries) {
      const item = document.createElement('div');
      item.className = 'phone-item';

      const av = document.createElement('div');
      av.className = 'av';
      av.style.background = `hsl(${(Number(e.num) * 37) % 360} 65% 62%)`;
      av.textContent = e.num.slice(0, 2);
      item.appendChild(av);

      const info = document.createElement('div');
      const nm = document.createElement('div');
      nm.className = 'nm';
      nm.textContent = 'Cidadão #' + e.num;
      const nb = document.createElement('div');
      nb.className = 'nb';
      nb.textContent = e.dist != null ? Math.round(e.dist) + ' m daqui' : 'conversa salva';
      info.appendChild(nm);
      info.appendChild(nb);
      item.appendChild(info);

      if (e.tag) {
        const tag = document.createElement('div');
        tag.className = 'tag ' + e.tag.cls;
        tag.textContent = e.tag.text;
        item.appendChild(tag);
      }

      item.addEventListener('click', () => this.openThread(e.num));
      this.el.list.appendChild(item);
    }
  }

  _tagFor(num, ctx) {
    if (ctx.pickupNumber && String(ctx.pickupNumber) === num) return { cls: 'pick', text: 'PACOTE' };
    if (ctx.deliverNumber && String(ctx.deliverNumber) === num) return { cls: 'drop', text: 'ENTREGA' };
    return null;
  }

  /** Mensagem automática do NPC (usada quando uma missão começa). */
  push(number, text) {
    number = String(number);
    if (!this.threads.has(number)) this.threads.set(number, []);
    this.threads.get(number).push({ from: 'them', text });
    if (this.open && this.current === number) this._renderLog();
  }

  reset() {
    this.threads.clear();
    this.current = null;
    if (this.open) this.close();
  }
}
