/**
 * Protocolo de mensagens do multiplayer (espelho do servidor).
 * A versão precisa bater com NET.version do servidor (server/config.js).
 */
export const NET_VERSION = 1;

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
  CYCLE: 'cycle',          // { t } host alterna o ciclo dia/noite da partida

  // servidor -> cliente
  WELCOME: 'welcome',      // { t, id, salaId, modo, cfg }
  LOBBY: 'lobby',          // { t, salaId, jogadores:[{id,nick,pronto,host,bot,ping}], hostId, podeIniciar, state, countdown, online:[{id,nick,pronto,host,salaId,modo,estado,bot?}] }
  INVITE_FIM: 'inviteFim', // { t, id, nick, aceitou, motivo? } resultado do convite p/ quem chamou
  GAME_START: 'gameStart', // { t, modo, seed, jogadores:[{id,nick,bot}] }
  SNAPSHOT: 'snap',        // { t, seq, players:[...], zone?, loot?, kills?, vivos? }
  SPAWN: 'spawn',          // { t, id, x, y, z, yaw }
  DAMAGE: 'damage',        // { t, alvo, por, dmg, hp, direcao:{x,z} }
  DEATH: 'death',          // { t, id, por, arma }
  KILL: 'kill',            // { t, id, por, arma }
  RESPAWN: 'respawn',      // { t, id, x, y, z, yaw, invuln }
  PLAYER_LEFT: 'left',     // { t, id }
  ZONE: 'zone',            // { t, x, z, r, proxX, proxZ, proxR, tempo }
  LOOT_LIST: 'lootList',   // { t, itens:[{id,x,z,tipo}] }
  LOOT_TAKEN: 'lootTaken', // { t, id, porId }
  WINNER: 'winner',        // { t, id, nick }
  ERROR: 'error',          // { t, msg }
  PING: 'ping',            // { t, agora }
  PONG: 'pong',            // { t, agora }
  BOT_SAIU: 'botSaiu',     // { t, id }
  CAR_JOIN: 'carJoin',     // { t, id, carId }
  CAR_LEAVE: 'carLeave',   // { t, id }
  CAR_BOOM: 'carBoom',     // { t, id, x, z } — carro destruído (explode)
  MISSIL_FIRE: 'missilFire', // { t, id, x, y, z, dx, dy, dz, v, alvo } — míssil disparado do heli
  MISSIL: 'missil',        // { t, id, x, y, z } — explosão do míssil
};

/** Envia JSON seguro (espelho do send() do servidor). */
export function enviar(ws, obj) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return false;
  const s = JSON.stringify(obj);
  if (s.length > 8192) return false;
  ws.send(s);
  return true;
}
