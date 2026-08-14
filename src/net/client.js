/**
 * ClientNet — wrapper do WebSocket do multiplayer.
 * Reconexão automática, fila de mensagens, medição de latência (ping/pong).
 */
import { T, enviar } from './protocol.js';

export class ClientNet {
  /**
   * @param {string} url  ws:// ou wss:// (ex.: ws://localhost:3000/ws)
   */
  constructor(url) {
    this.url = url;
    this.ws = null;
    this.estado = 'off';        // off | conectando | aberto | erro
    this.id = null;             // id do jogador (preenchido no welcome)
    this.salaId = null;
    this.modo = null;
    this.cfg = null;
    this.rtt = 0;               // ms
    this._seqOut = 1;
    this._fila = [];
    this._pingT = 0;
    this._onMsg = null;         // (msg) => void
    this._onStatus = null;      // (estado) => void
    this._onReplay = null;        // () => void — reenvia hello na reconexao
    this._sairIntencional = false;
    this._reconT = null;
    this._recon = 0;      // quantas reconexões automáticas já rolaram (cold start do Render)
  }

  conectar() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return;
    this.estado = 'conectando';
    this._status();
    try {
      this.ws = new WebSocket(this.url);
    } catch (e) {
      this.estado = 'erro';
      this._status();
      return;
    }
    this.ws.onopen = () => {
      this.estado = 'aberto';
      this._recon = 0;
      if (this._onReplay) this._onReplay();
      // limpa reconexao pendente
      if (this._reconT) { clearTimeout(this._reconT); this._reconT = null; }
      this._status();
      for (const m of this._fila) enviar(this.ws, m);
      this._fila = [];
    };
    this.ws.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.t === T.PONG) {
        this.rtt = Math.max(2, Math.min(999, performance.now() - msg.agora));
      }
      if (this._onMsg) this._onMsg(msg);
    };
    this.ws.onclose = () => {
      this.estado = 'off';
      this._status();
      // reconecta sozinho se nao foi saida intencional (preview/celular pausam o JS)
      if (!this._sairIntencional && this.url) {
        clearTimeout(this._reconT);
        this._recon++;
        this._reconT = setTimeout(() => {
          this.conectar();
          if (this._onReplay) this._onReplay();
        }, 2500);
      }
    };
    this.ws.onerror = () => {
      this.estado = 'erro';
      this._status();
    };
    // heartbeat — mantém a conexão viva mesmo no lobby e mede a latência
    this._hb = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) this.enviar({ t: T.PING, agora: performance.now() });
    }, 5000);
  }

  /** Envia agora ou enfileira se ainda conectando. */
  enviar(obj) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return enviar(this.ws, obj);
    if (this.ws && this.ws.readyState === WebSocket.CONNECTING) {
      if (this._fila.length < 30) this._fila.push(obj);
    }
    return false;
  }

  /** Input de jogo — inclui seq para o servidor reordenar/descartar velhos. */
  input(dados) {
    this._seqOut++;
    this.enviar({ t: T.INPUT, seq: this._seqOut, ...dados });
  }

  ping(agora) { this.enviar({ t: T.PING, agora }); }

  sair() {
    this._sairIntencional = true;
    if (this._reconT) { clearTimeout(this._reconT); this._reconT = null; }
    if (this._hb) { clearInterval(this._hb); this._hb = null; }
    try { this.enviar({ t: T.LEAVE }); } catch {}
    if (this.ws) { try { this.ws.close(); } catch {} }
    this.ws = null;
    this.estado = 'off';
  }

  /** Quantas reconexões automáticas já aconteceram (para avisos de cold start). */
  get tentativas() { return this._recon; }
  _status() {
    if (this._onStatus) this._onStatus(this.estado);
  }
}
