/**
 * Lobby — lista de jogadores, pronto/iniciar, contagem regressiva.
 */
export function criarLobby() {
  const tela = document.getElementById('lobby-screen');
  const lista = document.getElementById('lobby-list');
  const modoEl = document.getElementById('lobby-modo');
  const cd = document.getElementById('lobby-countdown');
  const nick = document.getElementById('mp-nick');
  const btnPronto = document.getElementById('mp-pronto');
  const btnIniciar = document.getElementById('mp-iniciar');
  const btnSair = document.getElementById('mp-sair');
  const codigoEl = document.getElementById('lobby-codigo');
  const onlineList = document.getElementById('lobby-online-list');
  const inviteEl = document.getElementById('lobby-invite');
  const inviteMsg = document.getElementById('lobby-invite-msg');
  const btnAceitar = document.getElementById('invite-aceitar');
  const btnRecusar = document.getElementById('invite-recusar');
  const toastEl = document.getElementById('lobby-toast');
  const alertaEl = document.getElementById('lobby-alerta');
  const cg = document.getElementById('convite-global');
  const cgMsg = document.getElementById('cg-msg');
  const cgAceitar = document.getElementById('cg-aceitar');
  const cgRecusar = document.getElementById('cg-recusar');

  if (!tela) return { mostrar() {}, esconder() {}, atualizar() {}, onReady() {}, onStart() {}, onLeave() {}, nick() { return ''; } };

  let estado = 'lobby';
  let pronto = false;
  let meuId = null;
  let conviteDe = null;   // { id, nick } do convite pendente
  let toastTimer = null;
  let vistos = new Set();  // ids de jogadores humanos já vistos (p/ notificar quem entra)
  let _cdEnd = 0, _cdTimer = null;
  function _sincCd() {
    const rest = Math.max(0, Math.ceil((_cdEnd - Date.now()) / 1000));
    if (cd) cd.textContent = rest;
  }

  function mostrar(modoLabel) {
    tela.classList.remove('hidden');
    modoEl.textContent = modoLabel || '';
    cd.style.display = 'none';
    pronto = false;
    // convite/banner de sessão anterior não podem reaparecer (fantasma)
    conviteDe = null;
    if (inviteEl) inviteEl.classList.add('hidden');
    if (cg) cg.classList.add('hidden');
    vistos = new Set();
    limparAlerta();
  }

  function esconder() {
    tela.classList.add('hidden');
    if (_cdTimer) { clearInterval(_cdTimer); _cdTimer = null; }
  }

  /** Mostra o código da sala atual (só informativo). */
  function setSala(codigo) {
    if (codigoEl) codigoEl.textContent = codigo || '—';
  }

  /** Guarda meu id (para saber se sou host / esconder meu próprio CHAMAR). */
  function setMeuId(id) {
    meuId = id;
  }

  /** Banner de convite recebido: "Fulano quer jogar com você". */
  function mostrarConvite(de) {
    conviteDe = de || null;
    if (!conviteDe) {
      if (cg) cg.classList.add('hidden');
      if (inviteEl) inviteEl.classList.add('hidden');
      return;
    }
    if (cg && cgMsg) {
      cgMsg.textContent = `${de.nick} está te convidando para uma partida!`;
      cg.classList.remove('hidden');
    } else if (inviteEl && inviteMsg) {
      inviteMsg.textContent = `${de.nick} quer jogar com você!`;
      inviteEl.classList.remove('hidden');
    }
  }

  /** Aviso curto no lobby (convite aceito/recusado, erros). */
  function aviso(msg, ms = 4000) {
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.add('hidden'), ms);
  }

  /** Alerta PERSISTENTE de conexão: fica visível até reconectar ou limpar. */
  function alerta(msg, tipo = 'erro') {
    if (!alertaEl) return;
    alertaEl.textContent = msg;
    alertaEl.className = 'lobby-alerta ' + (tipo || 'erro');
    alertaEl.classList.remove('hidden');
  }
  function limparAlerta() {
    if (!alertaEl) return;
    alertaEl.classList.add('hidden');
    alertaEl.textContent = '';
  }

  function atualizar(data) {
    estado = data.state || 'lobby';
    // notificação de quem ENtrou na sala (só humanos, não eu, não bots)
    const hums = (data.jogadores || []).filter((j) => !j.bot && j.id !== meuId);
    if (vistos.size === 0) {
      hums.forEach((j) => vistos.add(j.id));
    } else {
      for (const j of hums) {
        if (!vistos.has(j.id)) {
          vistos.add(j.id);
          aviso(`${j.nick} entrou na sala!`, 3500);
        }
      }
    }
    lista.innerHTML = '';
    for (const j of data.jogadores || []) {
      const li = document.createElement('li');
      if (j.bot) li.className = 'lb-bot';
      const status = j.bot ? '<span class="lb-bot">🤖 bot</span>'
        : j.pronto ? '<span class="lb-pronto">✔ pronto</span>'
        : '<span class="lb-pronto" style="color:#8aa0b5">—</span>';
      const host = j.host ? '<span class="lb-host">👑 host</span>' : '';
      li.innerHTML = `<span>${esc(j.nick || '?')}</span>${status}${host}`;
      lista.appendChild(li);
    }
    if (estado === 'countdown') {
      // número grande no círculo (CSS .lobby-cd) — fácil de visualizar
      cd.style.display = 'flex';
      if (data.countdownEnd) {
        _cdEnd = data.countdownEnd;
        _sincCd();
        if (!_cdTimer) _cdTimer = setInterval(_sincCd, 250);
      } else {
        cd.textContent = data.countdown || 0;
      }
    } else {
      cd.style.display = 'none';
      if (_cdTimer) { clearInterval(_cdTimer); _cdTimer = null; }
    }
    // jogadores online (outras salas) — cada um com CHAMAR
    if (onlineList) {
      onlineList.innerHTML = '';
      const online = data.online || [];
      if (online.length === 0) {
        const li = document.createElement('li');
        li.className = 'lb-vazio';
        li.textContent = 'ninguém online agora — jogue com bots';
        onlineList.appendChild(li);
      }
      for (const j of online) {
        if (j.id === meuId) continue;                 // eu mesmo
        const naMinhaSala = j.salaId === data.salaId; // se já está na minha sala, mostra badge sem CHAMAR
        const li = document.createElement('li');
        const estadoTxt = j.estado === 'lobby' ? 'na sala' : (j.estado === 'countdown' ? 'contagem…' : 'em partida');
        // deixa claro quem é jogador de verdade e quem é bot (na lista online
        // só entram humanos; a etiqueta evita confusão com o CHAMAR)
        const tipo = j.bot ? '🤖 bot' : '👤 jogador';
        const podeChamar = !j.bot && !naMinhaSala && j.estado === 'lobby';
        li.innerHTML = `<span class="lb-on-nick">${esc(j.nick || '?')}</span>` +
          `<span class="lb-on-tipo ${j.bot ? 'lb-on-bot' : ''}">${tipo}</span>` +
          `<span class="lb-on-sala">${j.modo === 'br' ? 'BR' : 'DM'} · ${estadoTxt}${naMinhaSala ? ' · na sua sala' : ''}</span>` +
          (podeChamar ? `<button type="button" class="lb-chamar" data-id="${j.id}">CHAMAR</button>` : '');
        onlineList.appendChild(li);
        if (podeChamar) {
          li.querySelector('.lb-chamar').addEventListener('click', () => {
            onInviteCb && onInviteCb(j.id, j.nick);
          });
        }
      }
    }
    // botões
    // sincroniza o PRONTO com o servidor: quem aceita um convite ganha um
    // player NOVO (pronto zerado) — sem isso o botão fica invertido
    const meuJ = (data.jogadores || []).find((j) => j.id === meuId);
    if (meuJ) pronto = !!meuJ.pronto;
    const eu = data.jogadores || [];
    btnPronto.disabled = estado !== 'lobby';
    btnPronto.textContent = pronto ? 'PRONTO ✔' : 'MARCAR PRONTO';
    btnPronto.classList.toggle('verde', pronto);
    // INICIAR PARTIDA: só quem é o HOST vê (e só habilita com todos prontos)
    btnIniciar.style.display = meuId != null && meuId === data.hostId ? '' : 'none';
    btnIniciar.disabled = !data.podeIniciar;
  }

  btnPronto.addEventListener('click', () => { pronto = !pronto; onReadyCb && onReadyCb(); });
  btnIniciar.addEventListener('click', () => onStartCb && onStartCb());
  btnSair.addEventListener('click', () => onLeaveCb && onLeaveCb());
  const _aceitar = () => {
    const de = conviteDe;
    if (!de) return;
    onAceitarCb && onAceitarCb(de.id);
    mostrarConvite(null);
  };
  const _recusar = () => {
    const de = conviteDe;
    if (!de) return;
    onRecusarCb && onRecusarCb(de.id);
    mostrarConvite(null);
  };
  btnAceitar && btnAceitar.addEventListener('click', _aceitar);
  btnRecusar && btnRecusar.addEventListener('click', _recusar);
  cgAceitar && cgAceitar.addEventListener('click', _aceitar);
  cgRecusar && cgRecusar.addEventListener('click', _recusar);

  let onReadyCb = null, onStartCb = null, onLeaveCb = null;
  let onInviteCb = null, onAceitarCb = null, onRecusarCb = null;

  return {
    mostrar, esconder, atualizar, setSala, setMeuId, mostrarConvite, aviso, alerta, limparAlerta,
    nick: () => nick ? nick.value.trim() || 'Jogador' : 'Jogador',
    setNick: (v) => { if (nick) nick.value = v; },
    onReady: (fn) => { onReadyCb = fn; },
    onStart: (fn) => { onStartCb = fn; },
    onLeave: (fn) => { onLeaveCb = fn; },
    onInvite: (fn) => { onInviteCb = fn; },
    onAceitar: (fn) => { onAceitarCb = fn; },
    onRecusar: (fn) => { onRecusarCb = fn; },
  };
}

function esc(s) {
  return String(s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
}
