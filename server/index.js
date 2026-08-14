/**
 * Bob AGI Server — entrada do servidor.
 * HTTP (healthcheck) + WebSocket (salas DM/BR).
 *
 * Deploy: Render/Railway. Local: node index.js (porta 3000).
 * O cliente (GitHub Pages) conecta via wss://<servidor>/ws.
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { NET, MODES } from './config.js';
import { T, send } from './protocol.js';
import { RoomManager } from './rooms/manager.js';
import { DMRoom } from './rooms/dm.js';
import { BRRoom } from './rooms/br.js';
import { makeBot, pickBotName } from './bots/botIa.js';
import { makeRng } from './util.js';

const manager = new RoomManager();
manager.setRoomClasses({ dm: DMRoom, br: BRRoom });

// ------------------------------------------------------------------ HTTP
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..'); // raiz do jogo (index.html)

const MIME = {
  '.html':'text/html; charset=utf-8', '.js':'application/javascript; charset=utf-8',
  '.mjs':'application/javascript; charset=utf-8', '.css':'text/css; charset=utf-8',
  '.json':'application/json; charset=utf-8', '.svg':'image/svg+xml', '.png':'image/png',
  '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.gif':'image/gif', '.webp':'image/webp',
  '.ico':'image/x-icon', '.txt':'text/plain; charset=utf-8', '.woff2':'font/woff2',
  '.glb':'model/gltf-binary', '.gltf':'model/gltf+json', '.wasm':'application/wasm',
  '.mp3':'audio/mpeg', '.ogg':'audio/ogg'
};

function servir(req, res, url) {
  let p;
  try { p = decodeURIComponent(url); } catch { res.writeHead(400); res.end(); return; }
  const alvo = path.normalize(path.join(ROOT, p));
  if (alvo !== ROOT && !alvo.startsWith(ROOT + path.sep)) { res.writeHead(403); res.end(); return; }
  fs.stat(alvo, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); res.end('nao encontrado'); return; }
    const ext = path.extname(alvo).toLowerCase();
    res.writeHead(200, { 'content-type': MIME[ext] || 'application/octet-stream', 'cache-control': 'no-cache' });
    fs.createReadStream(alvo).pipe(res);
  });
}

const httpServer = http.createServer((req, res) => {
  const url = (req.url || '/').split('?')[0];
  if (url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      ok: true,
      salas: manager.summary(),
      jogadores: [...manager.rooms.values()].reduce((s2, r) => s2 + r.totalSlots, 0),
      uptime: Math.floor(process.uptime()),
      versao: NET.version,
    }));
    return;
  }
  if (url === '/' || url === '/index.html') { servir(req, res, '/index.html'); return; }
  if (req.method === 'GET' || req.method === 'HEAD') { servir(req, res, url); return; }
  res.writeHead(405); res.end();
});

// ------------------------------------------------------------------ WebSocket
const wss = new WebSocketServer({ server: httpServer, path: '/ws', maxPayload: NET.maxPayload });

wss.on('connection', (ws, req) => {
  const ip = req.socket.remoteAddress || '?';
  ws._room = null;
  ws._lastSeen = Date.now();
  ws._msgCount = 0;
  ws._msgWindow = Date.now();

  ws.on('message', (data) => {
    // anti-flood
    const now = Date.now();
    if (now - ws._msgWindow > 1000) { ws._msgWindow = now; ws._msgCount = 0; }
    if (++ws._msgCount > NET.maxMsgPerSec) {
      ws.close(4008, 'flood');
      return;
    }
    ws._lastSeen = now;

    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return;
    }
    handle(ws, msg);
  });

  ws.on('close', () => {
    if (ws._room && ws._playerId != null) {
      // [FIX-FANTASMA] se o player ja foi reutilizado por OUTRO ws (reconexao
      // com token), o close deste ws antigo NAO pode remove-lo da sala
      const p = ws._room.players.get(ws._playerId);
      if (!p || p.client === ws) ws._room.removePlayer(ws._playerId);
    }
    ws._room = null;
  });

  ws.on('error', () => { /* não derruba o servidor */ });
});

function handle(ws, msg) {
  switch (msg.t) {
    case T.HELLO: {
      // dedupe: o cliente envia HELLO no onopen e no replay (2x por conexão).
      // Sem isso o mesmo ws vira 2 players em 2 salas — o fantasma que
      // entope a lista ONLINE e faz o botão INICIAR sumir (meuId errado)
      if (ws._room || ws._playerId != null) break;
      // [FIX-FANTASMA] reconexao com o MESMO token = mesmo jogador voltando.
      // Reutiliza o player antigo (mesmo id/host/pronto) em vez de criar um
      // 2o player 'fantasma' que roubava o host e fazia o botao INICIAR sumir
      // (o dedupe acima so cobre HELLO duplicado no MESMO ws, nao reconexao).
      const token = typeof msg.token === 'string' && msg.token ? msg.token : null;
      const nick = sanitizeNick(msg.nick) || 'Jogador';
      const modo = msg.modo === 'br' ? 'br' : 'dm';
      const cor = Number.isInteger(msg.cor) ? (msg.cor | 0) : 0;   // [ROUPA] cor da camisa
      if (token) {
        const achou = manager.findByToken(token);
        if (achou) {
          const { room: salaAntiga, player } = achou;
          // atualiza nick/cor/ciclo (jogador pode ter mudado no seletor)
          player.nick = nick;
          player.cor = cor;
          if (['ciclo','dia','noite'].includes(msg.cycle)) player.cycle = msg.cycle;
          // substitui o ws antigo pelo novo (mesmo player, mesmo id)
          if (player.client && player.client !== ws) {
            try { player.client.close(4001, 'reconectado'); } catch {}
          }
          player.client = ws;
          ws._room = salaAntiga;
          ws._playerId = player.id;
          salaAntiga._sendTo(player, T.WELCOME, { id: player.id, salaId: salaAntiga.salaId, modo: salaAntiga.modo, cfg: salaAntiga.publicCfg(), host: player.host, cor: player.cor });
          salaAntiga._bcastLobby();
          console.log('[MP] reconexao: ' + nick + ' voltou como id ' + player.id + ' (host=' + player.host + ')');
          return;
        }
      }
      // [DIA-NOITE] config de tempo do host (ciclo | dia | noite) — define o clima da sala
      const cycle = ['ciclo', 'dia', 'noite'].includes(msg.cycle) ? msg.cycle : 'ciclo';
      if (msg.v !== NET.version) {
        send(ws, { t: T.ERROR, msg: 'Versão incompatível. Atualize o jogo.' });
        ws.close(4001, 'versao');
        return;
      }
      const room = manager.join(ws, nick, modo, cor, cycle, token);
      // bots preenchem as vagas — mas SEMPRE deixa 1 vaga livre: se outro
      // humano entrar, ele cai na MESMA sala (era o motivo de ninguém se
      // achar: os bots enchiam tudo e canJoin() ficava falso)
      const cfg = MODES[modo];
      const rng = makeRng(Date.now() & 0xffffffff);
      while (room.totalSlots < cfg.maxPlayers) {
        const bot = makeBot(pickBotName(rng));
        room.addBot(bot);
      }
      break;
    }
case T.INPUT: {
      const room = ws._room;
      const p = room && ws._playerId != null ? room.players.get(ws._playerId) : null;
      if (p && room.state === 'playing' && p.body) {
        room._applyInput(p, msg);
        if (msg.fire) {
          room.onShoot(p, {
            yaw: msg.yaw, pitch: msg.pitch,
            // direção da MIRA do cliente (NDC) — dano na mesma linha do tracer
            dir: msg.fdx != null ? { x: msg.fdx, y: msg.fdy, z: msg.fdz } : null,
            // origem da MIRA (a câmera) — o raycast bate na linha exata do centro da tela
            orig: msg.fpx != null ? { x: msg.fpx, y: msg.fpy, z: msg.fpz } : null,
            ponto: msg.fx != null ? { x: msg.fx, y: msg.fy, z: msg.fz } : null,
          });
        }
        if (room.modo === 'br' && msg.pickup) room.pickup(p);
      }
      break;
    }
    case T.READY: {
      if (ws._room && ws._playerId != null) ws._room.ready(ws._playerId);
      break;
    }
    case T.RESPAWN_NOW: {
      // morto apertou "VOLTAR PARA A PARTIDA": renasce na hora, sem esperar
      // o timer. Só salas com respawn (DM) implementam _respawnAgora
      const room = ws._room;
      const p = room && ws._playerId != null ? room.players.get(ws._playerId) : null;
      if (p && room._respawnAgora) room._respawnAgora(p);
      break;
    }
    case T.CYCLE: {
      // [DIA-NOITE] só o HOST controla o tempo da partida
      const room = ws._room;
      const p = room && ws._playerId != null ? room.players.get(ws._playerId) : null;
      if (p && p.host && room.cycleBy) room.cycleBy(msg.mode);
      break;
    }
    case T.START: {
      // host inicia: só quando TODOS os humanos marcaram pronto — com 1
      // humano (e bots) também inicia: "jogar sozinho com bots" é permitido
      if (ws._room && ws._playerId != null) ws._room.start(ws._playerId);
      break;
    }
    case T.INVITE: {
      // chamar um jogador online para a MINHA sala
      const room = ws._room;
      const p = room && ws._playerId != null ? room.players.get(ws._playerId) : null;
      const alvoId = msg.alvoId;
      if (!p || alvoId == null) break;
      const alvoRoom = manager.salaDe(alvoId);
      const alvo = alvoRoom && alvoRoom.players.get(alvoId);
      if (!alvo || !alvo.client) {
        send(ws, { t: T.INVITE_FIM, id: alvoId, aceitou: false, motivo: 'Jogador não encontrado' });
        break;
      }
      if (alvoRoom === room) {
        send(ws, { t: T.INVITE_FIM, id: alvoId, aceitou: false, motivo: 'Jogador já está na sua sala' });
        break;
      }
      // convida também quem está em partida — a notificação aparece durante o jogo
      // e o alvo decide se aceita (sai da partida atual e entra na sala de quem chamou)
      alvo.inviteDe = { id: p.id, nick: p.nick, salaId: room.salaId, modo: room.modo };
      send(alvo.client, { t: T.INVITE, de: { id: p.id, nick: p.nick, salaId: room.salaId, modo: room.modo } });
      break;
    }
    case T.ACEITAR: {
      // aceitou o convite: sai da própria sala e entra na sala de quem chamou
      const room = ws._room;
      const p = room && ws._playerId != null ? room.players.get(ws._playerId) : null;
      const deId = msg.deId;
      if (!p || !p.inviteDe || p.inviteDe.id !== deId) break;
      const convite = p.inviteDe;
      p.inviteDe = null;
      const salaDe = manager.get(convite.salaId);
      if (!salaDe || !salaDe.canJoin()) {
        send(ws, { t: T.ERROR, msg: 'A sala de ' + convite.nick + ' fechou ou encheu' });
        break;
      }
      if (salaDe !== room) {
        room.removePlayer(p.id);              // fecha a sala antiga se ficar vazia
        const novo = salaDe.addClient(ws, p.nick);
        // avisa quem chamou que o convite foi aceito
        const convid = salaDe.players.get(deId);
        if (convid && convid.client) {
          send(convid.client, { t: T.INVITE_FIM, id: novo ? novo.id : p.id, nick: p.nick, aceitou: true });
        }
      }
      break;
    }
    case T.RECUSAR: {
      const room = ws._room;
      const p = room && ws._playerId != null ? room.players.get(ws._playerId) : null;
      const deId = msg.deId;
      if (!p || !p.inviteDe || p.inviteDe.id !== deId) break;
      p.inviteDe = null;
      const de = manager.salaDe(deId);
      const convid = de && de.players.get(deId);
      if (convid && convid.client) {
        send(convid.client, { t: T.INVITE_FIM, id: p.id, nick: p.nick, aceitou: false, motivo: 'recusou o convite' });
      }
      break;
    }
    case T.PING: {
      send(ws, { t: T.PONG, agora: msg.agora });
      break;
    }
    case T.CHAT: {
      if (ws._room && ws._playerId != null && typeof msg.msg === 'string' && msg.msg.length <= 120) {
        const nick = ws._room.players.get(ws._playerId)?.nick || '?';
        ws._room._bcast(T.CHAT, { nick, msg: msg.msg });
      }
      break;
    }
    default:
      break;
  }
}

function sanitizeNick(n) {
  if (typeof n !== 'string') return null;
  n = n.replace(/[<>{}|\\/^`]/g, '').trim().slice(0, 14);
  return n || null;
}

// ------------------------------------------------------------------ timeouts (heartbeat)
setInterval(() => {
  const now = Date.now();
  for (const ws of wss.clients) {
    if (now - ws._lastSeen > NET.timeoutMs) {
      ws.close(4000, 'timeout');
    }
  }
}, 5000);

// simulação das salas (tick rate) — O LOOP DO JOGO
setInterval(() => {
  for (const room of manager.rooms.values()) {
    try {
      room.tick();
    } catch (e) {
      console.error('[tick erro]', e);
    }
  }
}, Math.round(1000 / NET.tickRate));

httpServer.listen(NET.port, () => {
  console.log('🕹️  Bob AGI Server');
  console.log('   modo:   ' + MODES.dm.label + ' / ' + MODES.br.label);
  console.log(`   porta:  ${NET.port}`);
  console.log('   ws:     /ws  |  health: /health');
});
