/**
 * Gerenciador de salas — cria salas DM e BR, emparelha jogadores.
 * Um servidor só, dois tipos de sala (como pedido: "servidor separando
 * multiplayer e BR" = salas separadas no mesmo processo).
 */

import { MODES } from '../config.js';
import { T, send } from '../protocol.js';

let idCounter = 1;

export class RoomManager {
  constructor() {
    this.rooms = new Map();   // salaId -> Room
  }

  create(modo, cycle) {
    const cfg = MODES[modo];
    if (!cfg) throw new Error('modo inválido: ' + modo);
    const salaId = makeCode();
    const Room = modo === 'br' ? this._brRoom : this._dmRoom;
    const room = new Room(salaId, this, cycle);
    this.rooms.set(salaId, room);
    return room;
  }

  /** Define as classes de sala (injetadas pelo index.js para evitar ciclos). */
  setRoomClasses({ dm, br }) {
    this._dmRoom = dm;
    this._brRoom = br;
  }

  find(modo) {
    for (const r of this.rooms.values()) {
      if (r.modo === modo && r.canJoin()) return r;
    }
    return null;
  }

  get(salaId) { return this.rooms.get(salaId); }

  remove(salaId) {
    this.rooms.delete(salaId);
  }

  /**
   * Registra um jogador na SUA PRÓPRIA sala (sempre cria). É assim que o
   * jogador vê os outros online (na lista global) e os CHAMA pelo convite:
   * quem aceita é movido para a sala de quem chamou.
   */
  join(client, nick, modo, cor, cycle, token) {
    // [fix] procura sala existente com vaga ANTES de criar nova:
    // sem isto, cada player criava a PRÓPRIA sala (19 bots cada) = servidor
    // com CPU dobrado (jogo travado) e cada um via bots/carros diferentes
    const room = this.find(modo) || this.create(modo, cycle);
    room.addClient(client, nick, cor, token);
    return room;
  }

  /** Todos os humanos conectados (lista "online" do lobby, entre salas). */
  online() {
    const out = [];
    for (const r of this.rooms.values()) {
      for (const p of r.players.values()) {
        out.push({
          id: p.id,
          nick: p.nick,
          pronto: p.pronto,
          host: p.host,
          salaId: r.salaId,
          modo: r.modo,
          estado: r.state,
        });
      }
    }
    return out;
  }

  /** A sala onde um jogador (humano) está, ou null. */

  findByToken(token) {
    if (!token) return null;
    for (const r of this.rooms.values()) {
      for (const p of r.players.values()) {
        if (p.token === token) return { room: r, player: p };
      }
    }
    return null;
  }

  salaDe(id) {
    for (const r of this.rooms.values()) {
      if (r.players.has(id)) return r;
    }
    return null;
  }

  /** Resumo das salas para debug/admin. */
  summary() {
    const out = [];
    for (const r of this.rooms.values()) {
      out.push({ sala: r.salaId, modo: r.modo, jogadores: r.players.size, bot: r.bots.size });
    }
    return out;
  }
}

/** Código curto de sala (ex: "AB12"). */
function makeCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let c = '';
  for (let i = 0; i < 4; i++) c += chars[Math.floor(Math.random() * chars.length)];
  return c;
}
