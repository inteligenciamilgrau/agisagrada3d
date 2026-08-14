/**
 * Sala MULTIPLAYER (mata-mata em equipes verde x amarelo).
 * Respawm após 3s, spawn protegido, limite de kills.
 */

import { Room } from './room.js';
import { T, send } from '../protocol.js';
import { buildWorld } from '../world/world.js';
import { WORLD_EDGE, HALF } from '../config.js';
import { WEAPONS } from '../weapons.js';
import { makeRng, rngRange, rngPick, dist2D, findFreeSpot, temEspacoLivre } from '../util.js';

const TEAM_COLORS = [0x3fbf4f, 0xe8c33a];   // verde, amarelo

export class DMRoom extends Room {
  constructor(salaId, manager, cycle) {
    super(salaId, manager, 'dm', cycle);
    this.world = buildWorld();
    this.spawns = this._makeSpawns();
    this.respawnQueue = new Map();   // id -> tempo restante
  }

    _makeSpawns() {
    // [SPAWN-REGRA] Podem nascer em toda a cidade: ruas e praças.
    // Nunca dentro de construções nem em becos (gaps estreitos entre prédios).
    // Critério: espaço livre >= 5m em TODAS as direções — rua de 18m e praça passam;
    // becos (largura < ~5m) e prédios são rejeitados.
    const pts = [];
    const rng = makeRng(20260725);
    const L = WORLD_EDGE - 12;                 // 244: rua externa da borda
    for (let i = 0; i < 12; i++) {
      const ang = (i / 12) * Math.PI * 2;
      const x = Math.cos(ang), z = Math.sin(ang);
      const m = Math.max(Math.abs(x), Math.abs(z));
      pts.push([Math.round((x / m) * L), Math.round((z / m) * L)]);
    }
    // dentro da cidade: grade fina cobre ruas, cruzamentos e praças
    for (let x = -HALF + 10; x <= HALF - 10; x += 4) {
      for (let z = -HALF + 10; z <= HALF - 10; z += 4) {
        if (temEspacoLivre(this.world.col, x, z, 5)) pts.push([x, z]);
      }
    }
    // amostras extras espalhadas (praças grandes / áreas abertas)
    for (let k = 0; k < 120; k++) {
      const x = Math.round(rngRange(rng, -HALF + 8, HALF - 8));
      const z = Math.round(rngRange(rng, -HALF + 8, HALF - 8));
      if (temEspacoLivre(this.world.col, x, z, 5)) pts.push([x, z]);
    }
    const out = [];
    for (const [x, z] of pts) {
      out.push({ x, z, y: this.world.col.groundHeightAt(x, z) });
    }
    return out;
  }

    _spawnPoint(p) {
    // [borda] nunca renasce no mesmo local: sorteia entre os pontos LIVRES
    // (longe de qualquer player vivo); se todos ocupados, usa qualquer um.
    const ocupado = (sp) => {
      for (const q of this._all()) {
        if (q === p || !q.body || q.hp <= 0) continue;
        if (dist2D(q.body.pos.x, q.body.pos.z, sp.x, sp.z) < 40) return true;
      }
      return false;
    };
    const livres = this.spawns.filter((sp) => !ocupado(sp));
    const pool = livres.length ? livres : this.spawns;
    return pool[Math.floor(Math.random() * pool.length)];
  }

  _spawn(p) {
    super._spawn(p);
    p.team = (Math.abs(p.id) % 2) === 0 ? 0 : 1;
    p.arma = 'pistola';
  }

  _step(dt) {
    // respawns pendentes
    for (const [id, t] of [...this.respawnQueue]) {
      const novo = t - dt;
      if (novo <= 0) {
        this.respawnQueue.delete(id);
        const p = this.players.get(id) || this.bots.get(id);
        if (p) this._spawn(p);
      } else {
        this.respawnQueue.set(id, novo);
      }
    }

    // processa jogadores humanos
    for (const p of this.players.values()) {
      if (p.body) {
        if (p.invuln > 0) p.invuln -= dt;
        // inputs chegam via _onInput (websocket); aqui só decai invuln
      }
    }
    for (const b of this.bots.values()) {
      if (b.think) b.think(dt, this);
      if (b.body && b.invuln > 0) b.invuln -= dt;
    }

    // fim de partida por limite de kills
    for (const p of this._all()) {
      if (p.kills >= this.cfg.killLimit) {
        this._endGame(p);
        return;
      }
    }
    if (this.elapsed >= this.cfg.timeLimit) {
      const best = [...this._all()].sort((a, b) => b.kills - a.kills)[0];
      this._endGame(best);
    }
  }

  _onKill(morto, por) {
    // agenda respawn (DM tem respawn)
    if (this.state === 'playing') {
      this.respawnQueue.set(morto.id, this.cfg.respawnTime);
      this._sendTo(morto, T.RESPAWN, { id: morto.id, t: this.cfg.respawnTime });
    }
  }

  /** [respawn] Morto pediu para voltar já (botão "VOLTAR PARA A PARTIDA"). */
  _respawnAgora(p) {
    if (!p || p.hp > 0 || this.state !== 'playing') return;
    this.respawnQueue.delete(p.id);
    this._spawn(p);
  }

  _endGame(vencedor) {
    this.state = 'ended';
    this._bcast(T.WINNER, { id: vencedor.id, nick: vencedor.nick, kills: vencedor.kills });
    this._log('fim: ' + vencedor.nick + ' venceu com ' + vencedor.kills + ' kills');
    // fecha a sala após 10s
    // [REVIEW-30S] sala fica viva 35s apos o fim: os players continuam na cena
    // (snapshots rodando) para o cliente exibir a revisão da partida por 30s
    setTimeout(() => {
      this.manager.remove(this.salaId);
      this.stop();
    }, 35_000);
  }
}
