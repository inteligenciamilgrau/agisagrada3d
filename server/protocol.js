/**
 * Protocolo de mensagens do multiplayer.
 * As mensagens são JSON com um campo `t` (tipo). Versões de cliente e
 * servidor precisam bater (NET.version).
 */

export const T = {
  // cliente -> servidor
  HELLO: 'hello',          // { t, v, nick, modo }
  INPUT: 'input',          // { t, seq, yaw, pitch, moveX, moveZ, run, jump, fire, ads, car?, heli?, up?, down?, heliYaw? }
  READY: 'ready',          // { t }
  START: 'start',          // { t } host inicia a partida (todos os humanos prontos)
  INVITE: 'invite',        // { t, alvoId } chamar um jogador online para a sua sala
  ACEITAR: 'aceitar',      // { t, deId } aceitar o convite de deId
  RECUSAR: 'recusar',      // { t, deId } recusar o convite de deId
  LEAVE: 'leave',          // { t }
  CHAT: 'chat',            // { t, msg }
  RESPAWN_NOW: 'respawnNow', // { t } morto pediu para renascer na hora (DM)
  CYCLE: 'cycle',          // { t } host alterna o ciclo dia/noite da partida

  // servidor -> cliente
  WELCOME: 'welcome',      // { t, id, salaId, modo, cfg }
  LOBBY: 'lobby',          // { t, salaId, jogadores: [{id,nick,pronto,host,bot}], hostId, podeIniciar, state, countdown, online: [{id,nick,pronto,host,salaId,modo,estado,bot?}] }
  INVITE_FIM: 'inviteFim', // { t, id, nick, aceitou, motivo? } resultado do convite p/ quem chamou
  GAME_START: 'gameStart', // { t, modo, seed, jogadores: [...] }
  SNAPSHOT: 'snap',        // { t, seq, players: [...], zone?, loot?, kills?, vivos? }
  SPAWN: 'spawn',          // { t, id, x, y, z, yaw }
  DAMAGE: 'damage',        // { t, alvo, por, dmg, hp, direcao:{x,z} }
  DEATH: 'death',          // { t, id, por, arma }
  KILL: 'kill',            // { t, id, por, arma }  (id = quem morreu)
  RESPAWN: 'respawn',      // { t, id, x, y, z, yaw, invuln }
  PLAYER_LEFT: 'left',     // { t, id }
  ZONE: 'zone',            // { t, x, z, r, proxX, proxZ, proxR, tempo }
  LOOT_LIST: 'lootList',   // { t, itens: [{id,x,z,tipo}] }
  LOOT_TAKEN: 'lootTaken', // { t, id, porId }
  WINNER: 'winner',        // { t, id, nick }
  ERROR: 'error',          // { t, msg }
  PING: 'ping',            // { t, agora }  (cliente responde pong)
  PONG: 'pong',            // { t, agora }
  BOT_SAIU: 'botSaiu',     // { t, id }
  CAR_JOIN: 'carJoin',     // { t, id, carId }
  CAR_LEAVE: 'carLeave',   // { t, id }
  CAR_BOOM: 'carBoom',     // { t, id, x, z } — carro destruído (explode no cliente)
  MISSIL_FIRE: 'missilFire', // { t, id, x, y, z, dx, dy, dz, v } — míssil disparado do heli
  MISSIL: 'missil',        // { t, id, x, y, z } — explosão do míssil
};

/** Envia uma mensagem JSON segura (limite de tamanho). */
export function send(ws, obj) {
  if (ws.readyState !== 1) return false;
  const s = JSON.stringify(obj);
  if (s.length > 65536) return false;   // 64 KB — comporta o LOOT_LIST completo do BR
  ws.send(s);
  return true;
}

/** Cria um jogador do lobby (estado de espera). */
/** Paleta de roupas compartilhada (espelha PALETA do cliente). */
const CORES_ROUPA = [0xe8453c, 0x2f9e5f, 0x3a6fd8, 0xe0a323, 0x9c4fd8, 0xd84f8f, 0x23b0c9, 0x8a6f4f, 0x5a6b8a, 0xc9c23a];

export function lobbyPlayer(id, nick, opts = {}) {
  return {
    id,
    nick,
    pronto: !!opts.pronto,
    host: !!opts.host,
    bot: !!opts.bot,
    ping: 0,
    cor: opts.cor ?? CORES_ROUPA[Math.abs(id) % CORES_ROUPA.length],
    token: opts.token || null,
    token: opts.token || null,
  };
}
