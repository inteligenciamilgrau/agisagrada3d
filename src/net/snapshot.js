/**
 * SnapshotBuffer — interpolação de rede com atraso fixo + extrapolação.
 *
 * [REDE-FLUIDEZ] O problema do buffer antigo (só 2 snaps, sem delay): quando a
 * rede tem jitter, o alpha estoura e o avatar "pula" entre o último e o próximo
 * snap — teleporte. Agora o cliente NUNCA interpola no tempo real: sempre olha
 * DELAY_MS para trás (absorve jitter de até 120ms) e, se a rede atrasar mais,
 * EXTRAPOLA com a velocidade medida do último par de snaps (o avatar continua
 * andando em vez de congelar e depois saltar).
 */
const TICK_MS = 1000 / 30;   // 33.3ms — um tick do servidor
const DELAY_MS = 120;        // atraso fixo de interpolação (~4 ticks)
const MAX_EXTRA_MS = 50;   // [RAIO-FIX] extrapolacao maxima reduzida (100ms projetava o avatar p/ o lado errado)

function lerpAngulo(a, b, k) {
  if (a == null) return b ?? 0;
  if (b == null) return a;
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * k;
}

export class SnapshotBuffer {
  constructor() {
    this.fila = [];   // [{t, data, seq}] ordenado por tempo de chegada
  }

  push(snap, agoraMs = performance.now()) {
    this.fila.push({ t: agoraMs, data: snap, seq: snap.seq ?? 0 });
    // mantém só ~600ms de histórico
    const corte = agoraMs - 600;
    while (this.fila.length > 1 && this.fila[0].t < corte) this.fila.shift();
  }

  /** Índice do último snapshot com t <= (agora - DELAY_MS). */
  _achar(agoraMs) {
    const alvo = agoraMs - DELAY_MS;
    let i = this.fila.length - 1;
    while (i > 0 && this.fila[i].t > alvo) i--;
    return i;
  }

  /**
   * Posição interpolada para o tempo (agora - DELAY_MS).
   * Sem snapshot futuro → extrapola com a velocidade dos 2 últimos snaps.
   */
  ler(id, agoraMs = performance.now(), opts = {}) {
    if (this.fila.length === 0) return null;
    const i = this._achar(agoraMs);
    const a = this.fila[i];
    const b = this.fila[i + 1];
    const pa = a.data.players.find((p) => p.id === id);
    if (!pa) return null;

    if (!b) {
      // rede atrasou além do delay: extrapola com a velocidade medida
      const ant = this.fila[i - 1];
      if (ant) {
        const pAnt = ant.data.players.find((p) => p.id === id);
        if (pAnt && a.t > ant.t) {
          const dtS = Math.max(0.001, (a.t - ant.t) / 1000);
          // [RAIO-FIX] bot (IA vira brusco): extrapolar projeta o avatar na
          // direcao ANTIGA = parece raio eletrico. Sem extrapolacao p/ bots.
          const extra = opts.semExtra ? 0 : Math.min(MAX_EXTRA_MS / 1000, Math.max(0, (agoraMs - DELAY_MS - a.t) / 1000));
          return {
            ...pa,
            x: pa.x + ((pa.x - pAnt.x) / dtS) * extra,
            y: pa.y + ((pa.y - pAnt.y) / dtS) * extra,
            z: pa.z + ((pa.z - pAnt.z) / dtS) * extra,
          };
        }
      }
      return { ...pa };
    }

    const pb = b.data.players.find((p) => p.id === id);
    if (!pb) return { ...pa };
    const k = Math.max(0, Math.min(1, (agoraMs - DELAY_MS - a.t) / Math.max(1, b.t - a.t)));
    return {
      ...pb,
      x: pa.x + (pb.x - pa.x) * k,
      y: pa.y + (pb.y - pa.y) * k,
      z: pa.z + (pb.z - pa.z) * k,
      yaw: lerpAngulo(pa.yaw ?? 0, pb.yaw ?? 0, k),
      pitch: (pa.pitch ?? 0) + ((pb.pitch ?? 0) - (pa.pitch ?? 0)) * k,
    };
  }

    /**
   * [LOCAL] Interpolação suave entre os 2 snaps MAIS RECENTES (sem delay fixo).
   * O jogador local é movido pela PREDIÇÃO local (predictBody); este alvo
   * suavizado serve só para RECONCILIAÇÃO. O snap cru (ultimoPlayer) causava
   * micro-teleportes: a predição anda pra frente, o snap atrasado da rede puxa
   * pra trás a cada frame (degraus de 30Hz + latência) — luta sem fim.
   */
  ultimoLer(id, agoraMs = performance.now()) {
    if (this.fila.length === 0) return null;
    const b = this.fila[this.fila.length - 1];
    const pb = b.data.players.find((p) => p.id === id);
    if (!pb) return null;
    if (this.fila.length < 2) return { ...pb };
    const a = this.fila[this.fila.length - 2];
    const pa = a.data.players.find((p) => p.id === id);
    if (!pa) return { ...pb };
    const k = Math.max(0, Math.min(1, (agoraMs - a.t) / Math.max(1, b.t - a.t)));
    return {
      ...pb,
      x: pa.x + (pb.x - pa.x) * k,
      y: pa.y + (pb.y - pa.y) * k,
      z: pa.z + (pb.z - pa.z) * k,
      yaw: lerpAngulo(pa.yaw ?? 0, pb.yaw ?? 0, k),
      pitch: (pa.pitch ?? 0) + ((pb.pitch ?? 0) - (pa.pitch ?? 0)) * k,
    };
  }

  /** Player do snapshot MAIS RECENTE (sem delay) — usado para o jogador local. */
  ultimoPlayer(id) {
    const s = this.ultimo();
    return s && s.players ? (s.players.find((p) => p.id === id) || null) : null;
  }

  /** Compat: progresso entre os 2 últimos snaps (não é mais usado no ler). */
  alpha(agoraMs = performance.now()) {
    if (this.fila.length < 2) return 0;
    const a = this.fila[this.fila.length - 2];
    const b = this.fila[this.fila.length - 1];
    return Math.max(0, Math.min(1, (agoraMs - a.t) / Math.max(1, b.t - a.t)));
  }

  ultimo() { return this.fila.length ? this.fila[this.fila.length - 1].data : null; }

  anteriorSnap() {
    return this.fila.length > 1 ? this.fila[this.fila.length - 2].data : this.ultimo();
  }

  posicao(id) {
    const d = this.ler(id);
    return d ? { x: d.x, y: d.y, z: d.z } : null;
  }

  limpar() { this.fila = []; }
}
