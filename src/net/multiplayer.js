/**
 * Orquestrador do modo multijogador.
 * Fluxo: modeSelect -> ClientNet (hello) -> lobby -> ready/start -> Match.
 */
import { ClientNet } from '../net/client.js';
import { Match } from '../net/match.js';
import { criarLobby } from '../ui/lobby.js';
import { NET_VERSION, T } from '../net/protocol.js';
import { NET } from '../config.js';
import { Settings } from '../settings.js';   // [DIA-NOITE] ler a config de tempo salva do jogador

/** URL do servidor: sobrescreva com window.__MP_SERVER__ no index.html. */
export function serverUrl() {
  if (window.__MP_SERVER__) return window.__MP_SERVER__;
  const host = location.hostname;
  if (host === 'localhost' || host === '127.0.0.1') return 'ws://localhost:3000/ws';
  if (NET.wsUrl && !NET.wsUrl.includes('SEU-SERVIDOR')) return NET.wsUrl;
  return (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws'; // mesma origem (Render ou outro host)
}

let net = null;
let match = null;
let lobby = null;
let gameRef = null;
let watchdog = null;  // conexão aberta sem WELCOME = cache/versão antiga

// [FIX] sair da partida (pausa ou overlay) encerra a sessão MP completa: fecha o
// WebSocket e anula match/net — nada de partida fantasma rodando por baixo do solo.
window.addEventListener('mp-sair', () => sairMultiplayer());

// [DIA-NOITE] host mudou o clima nas opcoes durante o MP -> manda o modo exato ao servidor
window.addEventListener('mp-cycle', (e) => {
  const mode = e && e.detail;
  if (!mode) return;
  if (match && match._pedirCycle) match._pedirCycle(mode);
  else if (net && net.host) net.enviar({ t: T.CYCLE, mode });
});

// [ROUPA] lê a cor ativa do seletor (#mp-roupa) — 0xe8453c se não houver
// [DIA-NOITE] config de tempo do jogador (ciclo | dia | noite) — salva nas opções [13].
// Quem CRIA a sala (host) define o clima da partida; os demais seguem via snap.

function tokenSessao() {
  try {
    let t = localStorage.getItem('mp-token');
    if (!t) { t = Math.random().toString(36).slice(2) + Date.now().toString(36); localStorage.setItem('mp-token', t); }
    return t;
  } catch { return ''; }
}

function lerCycle() {
  try { return new Settings().get('cycleMode') || 'ciclo'; } catch { return 'ciclo'; }
}

function lerCorRoupa() {
  const ativa = document.querySelector('#mp-roupa .mp-cor.ativa');
  const v = ativa ? ativa.getAttribute('data-cor') : '0xe8453c';
  return parseInt(v, 16) || 0xe8453c;
}
// [ROUPA] clique nas bolinhas do seletor (uma ativa por vez)
document.querySelectorAll('#mp-roupa .mp-cor').forEach((b) => {
  b.addEventListener('click', () => {
    document.querySelectorAll('#mp-roupa .mp-cor').forEach((x) => x.classList.remove('ativa'));
    b.classList.add('ativa');
  });
});

export function iniciarMultiplayer(game, modo, nick) {
  gameRef = game;
  if (!lobby) lobby = criarLobby();

  lobby.setNick(nick);
  lobby.mostrar(modo === 'br' ? 'BATTLE ROYALE' : 'MULTIPLAYER');
  lobby.onReady(() => net && net.enviar({ t: T.READY }));
  // INICIAR PARTIDA: comando explícito do host (só funciona com todos prontos)
  lobby.onStart(() => net && net.enviar({ t: T.START }));
  lobby.onLeave(() => sairMultiplayer());
  lobby.onInvite((alvoId, nick) => {
    if (!net) return;
    net.enviar({ t: T.INVITE, alvoId });
    lobby.aviso(`Chamando ${nick}…`);
  });
  lobby.onAceitar((deId) => net && net.enviar({ t: T.ACEITAR, deId }));
  lobby.onRecusar((deId) => net && net.enviar({ t: T.RECUSAR, deId }));

  const url = serverUrl();
  // diagnóstico de "todo mundo é host": todos precisam conectar no MESMO
  // servidor — se a página é remota e a URL aponta para localhost, cada
  // jogador cai no PRÓPRIO PC e ninguém se vê
  console.log('[MP] conectando em', url);
  const el = document.getElementById('lobby-srv');
  if (el) {
    el.textContent = 'Servidor: ' + url.replace(/^wss?:\/\//, '');
    const host = location.hostname;
    if (url.includes('localhost') && host !== 'localhost' && host !== '127.0.0.1') {
      el.textContent += ' ⚠ site remoto apontando para localhost — configure NET.wsUrl';
    }
  }

  // [ROUPA] cor da camisa escolhida no seletor do lobby (enviada no HELLO)
  net = new ClientNet(url);
  net.cor = lerCorRoupa();   // [ROUPA] cor da camisa escolhida no seletor (enviada no HELLO)
  net._onMsg = onMsg;
  net._onStatus = (estado) => {
    if (!lobby) return;
    if (estado === 'aberto') {
      lobby.limparAlerta();
      clearTimeout(watchdog);
      // se o servidor não responder o WELCOME em 10s, o cliente quase sempre
      // é uma VERSÃO ANTIGA no cache (apontava para o host errado) — o lobby
      // ficava 'conectado mas mudo' para sempre sem este aviso
      watchdog = setTimeout(() => {
        if (!net.id) lobby.alerta('⚠ Conectado ao servidor, mas ele não respondeu. Quase sempre é VERSÃO ANTIGA no cache — recarregue com Ctrl+Shift+R (ou limpe os dados do site) e tente de novo.', 'erro');
      }, 10000);
      return;
    }
    const n = net.tentativas || 0;
    if (estado === 'erro' || estado === 'off') {
      if (n >= 2) {
        lobby.alerta('⚠ Não foi possível conectar ao servidor (' + n + 'ª tentativa). Confira se NET.wsUrl aponta para wss://…onrender.com/ws. No Render free o 1º acesso demora até 1 min (o servidor dorme após ~15 min sem uso).', 'erro');
      } else {
        lobby.alerta('⚠ Sem conexão com o servidor — reconectando…', 'erro');
      }
      return;
    }
    if (estado === 'conectando' && n > 0) {
      lobby.alerta('🔄 Servidor acordando… (Render free: 1º acesso pode demorar até 1 min)', 'aviso');
    }
  };
  net._onReplay = () => net.enviar({ t: T.HELLO, v: NET_VERSION, nick, modo, cor: net.cor, cycle: lerCycle(), token: tokenSessao() });
  net.conectar();   // o onopen do ClientNet já reenvia o HELLO (_onReplay)
}

function onMsg(msg) {
  switch (msg.t) {
    case T.WELCOME:
      clearTimeout(watchdog);
      net.id = msg.id;
      net.salaId = msg.salaId;
      net.modo = msg.modo;
      net.cfg = msg.cfg;
      net.host = !!msg.host;   // [DIA-NOITE] quem controla o tempo da partida
      lobby.setMeuId(msg.id);
      // mostra o código da sala atual (só informativo)
      lobby.setSala(msg.salaId);
      break;
    case T.INVITE:
      // alguém me chamou: banner com ACEITAR/RECUSAR
      lobby.mostrarConvite(msg.de || {});
      break;
    case T.INVITE_FIM:
      // resultado do convite que EU fiz
      if (msg.aceitou) lobby.aviso(`${msg.nick} aceitou o convite!`);
      else lobby.aviso(`${msg.nick} ${msg.motivo || 'recusou o convite'}`);
      break;
    case T.LOBBY:
      lobby.atualizar(msg);
      break;
    case T.GAME_START: {
      lobby.esconder();
      match = new Match(gameRef, net, {
        modo: msg.modo,
        jogadores: msg.jogadores || [],
        meuId: net.id,
        nick: net.nick || 'Jogador',
      });
      match.iniciar();
      break;
    }
    case T.WINNER:
      if (match && match._rodando) match.fimPartida(msg);   // [FIX] match morto não mostra vencedor
      break;
    case T.ERROR:
      lobby.mostrar('⚠ ' + (msg.msg || 'erro'));
      break;
    default:
      if (match && match._rodando && match.tratar) match.tratar(msg);   // [FIX] match morto não processa snapshots
  }
}

export function sairMultiplayer() {
  if (match) { match.sair(); match = null; }
  if (net) { net.sair(); net = null; }
  if (lobby) lobby.esconder();
}
