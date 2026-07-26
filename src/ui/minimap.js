import { LAKE, BRIDGE } from '../world/terrain.js';

const RANGE = 165;            // metros visíveis do centro à borda

/**
 * [10] Minimapa com os pontos de coleta e de entrega.
 * O mapa gira junto com o jogador: o topo do radar é sempre a frente dele.
 */
export class Minimap {
  constructor(canvas, city, compassEl) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.city = city;
    this.compass = compassEl;

    this.W = canvas.width;
    this.H = canvas.height;
    this.cx = this.W / 2;
    this.cy = this.H / 2;
    this.R = this.W / 2 - 2;
    this.scale = this.R / RANGE;
    this.pulse = 0;
    this._acc = 0;
  }

  /**
   * @param {object} view {x, z, yaw}
   * @param {object} marks {pickup:{x,z}|null, deliver:{x,z}|null, heli:{x,z}|null}
   * @param {object} ents {cars, peds}
   */
  draw(dt, view, marks, ents) {
    /*
     * Redesenhar o radar são ~250 formas em canvas 2D. A 60fps isso é CPU
     * jogada fora: a 20fps o movimento do mapa é indistinguível.
     * O tempo acumulado é repassado à animação para o pulso não desacelerar.
     */
    this._acc += dt;
    if (this._acc < 1 / 20) return;
    const step = this._acc;
    this._acc = 0;

    this.pulse = (this.pulse + step * 2.6) % (Math.PI * 2);
    const ctx = this.ctx;
    const { x: px, z: pz, yaw } = view;
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const sc = this.scale;

    // world -> radar (frente do jogador para cima)
    const TX = (wx, wz) => this.cx + (-(wx - px) * c + (wz - pz) * s) * sc;
    const TY = (wx, wz) => this.cy - ((wx - px) * s + (wz - pz) * c) * sc;

    ctx.save();
    ctx.beginPath();
    ctx.arc(this.cx, this.cy, this.R, 0, Math.PI * 2);
    ctx.clip();

    // ---- asfalto de fundo
    ctx.fillStyle = '#22262d';
    ctx.fillRect(0, 0, this.W, this.H);

    const quad = (x0, z0, x1, z1, fill) => {
      ctx.beginPath();
      ctx.moveTo(TX(x0, z0), TY(x0, z0));
      ctx.lineTo(TX(x1, z0), TY(x1, z0));
      ctx.lineTo(TX(x1, z1), TY(x1, z1));
      ctx.lineTo(TX(x0, z1), TY(x0, z1));
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.fill();
    };

    // ---- [52] lago e ponte
    if (this._near(LAKE.minX, LAKE.minZ, px, pz, 420) || this._near(LAKE.maxX, LAKE.maxZ, px, pz, 420)) {
      quad(LAKE.minX, LAKE.minZ, LAKE.maxX, LAKE.maxZ, '#173d52');
      quad(BRIDGE.x - BRIDGE.halfW, BRIDGE.z0, BRIDGE.x + BRIDGE.halfW, BRIDGE.z3, '#5a5148');
    }

    // ---- quarteirões
    const R2 = (RANGE + 50) * (RANGE + 50);
    for (const b of this.city.blocks) {
      const dx = b.cx - px, dz = b.cz - pz;
      if (dx * dx + dz * dz > R2) continue;
      const half = 23;
      quad(b.cx - half, b.cz - half, b.cx + half, b.cz + half,
        b.type === 'park' ? '#2f4630' : b.type === 'heliport' ? '#4a3f2a' : '#363c45');
    }

    // ---- prédios
    ctx.fillStyle = '#5b6470';
    for (const bd of this.city.buildings) {
      const dx = bd.x - px, dz = bd.z - pz;
      if (dx * dx + dz * dz > R2) continue;
      quad(bd.x - bd.w / 2, bd.z - bd.d / 2, bd.x + bd.w / 2, bd.z + bd.d / 2, '#5b6470');
    }

    // ---- pessoas e carros
    if (ents) {
      ctx.fillStyle = 'rgba(190,200,215,.55)';
      for (const p of ents.peds.peds) {
        const pos = p.human.root.position;
        const dx = pos.x - px, dz = pos.z - pz;
        if (dx * dx + dz * dz > RANGE * RANGE) continue;
        ctx.fillRect(TX(pos.x, pos.z) - 1.5, TY(pos.x, pos.z) - 1.5, 3, 3);
      }
      ctx.fillStyle = 'rgba(255,255,255,.9)';
      for (const car of ents.cars.cars) {
        const pos = car.root.position;
        const dx = pos.x - px, dz = pos.z - pz;
        if (dx * dx + dz * dz > RANGE * RANGE) continue;
        ctx.fillRect(TX(pos.x, pos.z) - 2.5, TY(pos.x, pos.z) - 2.5, 5, 5);
      }
    }

    /*
     * ---- portais das fases ----
     * Grudam na BORDA quando estão fora de alcance, com a letra do
     * objetivo. O Plano da AGI diz "o portal está marcado no mapa"; sem
     * isto a frase era mentira, e o jogador rodava a cidade procurando
     * um feixe de luz que só se vê de perto.
     */
    const pulseR = 6 + Math.sin(this.pulse) * 2.2;
    for (const p of marks.portais || []) {
      const cor = p.venceu ? '#3ddc84' : (p.aberta ? '#ffb020' : '#6b7280');
      this._blip(ctx, TX, TY, p, cor, p.proxima ? pulseR : 5,
        p.proxima ? '★' : '◆', px, pz, true);
    }
    if (marks.heli) this._blip(ctx, TX, TY, marks.heli, '#25d0ff', 5, '🚁', px, pz, false);
    if (marks.pickup) this._blip(ctx, TX, TY, marks.pickup, '#ffb020', pulseR, 'C', px, pz, true);
    if (marks.deliver) this._blip(ctx, TX, TY, marks.deliver, '#3ddc84', pulseR, 'E', px, pz, true);

    ctx.restore();

    // ---- seta do jogador, sempre no centro apontando para cima
    ctx.save();
    ctx.translate(this.cx, this.cy);
    ctx.beginPath();
    ctx.moveTo(0, -11);
    ctx.lineTo(7.5, 8);
    ctx.lineTo(0, 4);
    ctx.lineTo(-7.5, 8);
    ctx.closePath();
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = 'rgba(0,0,0,.65)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fill();
    ctx.restore();

    // ---- cone de visão
    ctx.save();
    ctx.globalAlpha = 0.10;
    ctx.beginPath();
    ctx.moveTo(this.cx, this.cy);
    ctx.arc(this.cx, this.cy, this.R, -Math.PI / 2 - 0.62, -Math.PI / 2 + 0.62);
    ctx.closePath();
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.restore();

    /*
     * ---- a rosa dos ventos acompanha a rotação (norte = -Z)
     *
     * O raio vem do TAMANHO EM TELA do radar, não de um número fixo: no
     * celular ele encolhe para 104 px e um 96 cravado no código jogaria
     * o "N" a meio palmo de distância do mapa.
     */
    if (this.compass) {
      const raio = (this.compass.parentElement?.clientWidth || 210) / 2;
      const nx = -s * (raio - 9), ny = c * (raio - 9);
      this.compass.style.transform = `translate(-50%,-50%) translate(${nx}px, ${ny + raio}px)`;
    }
  }

  _near(x, z, px, pz, r) {
    return Math.abs(x - px) < r && Math.abs(z - pz) < r;
  }

  /** Blip que gruda na borda do radar quando o alvo está fora de alcance. */
  _blip(ctx, TX, TY, mark, color, radius, letter, px, pz, clampToEdge) {
    let sx = TX(mark.x, mark.z), sy = TY(mark.x, mark.z);
    const dx = sx - this.cx, dy = sy - this.cy;
    const d = Math.hypot(dx, dy);
    let onEdge = false;
    if (d > this.R - 12) {
      if (!clampToEdge) return;
      const k = (this.R - 12) / (d || 1);
      sx = this.cx + dx * k;
      sy = this.cy + dy * k;
      onEdge = true;
    }

    ctx.save();
    ctx.shadowColor = color;
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.arc(sx, sy, radius, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(0,0,0,.55)';
    ctx.lineWidth = 1.6;
    ctx.stroke();

    if (letter && letter.length === 1) {
      ctx.fillStyle = '#0a0f18';
      ctx.font = 'bold 9px "Segoe UI", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(letter, sx, sy + 0.5);
    }
    if (onEdge) {
      // pequena seta apontando para fora
      const a = Math.atan2(dy, dx);
      ctx.beginPath();
      ctx.moveTo(sx + Math.cos(a) * (radius + 8), sy + Math.sin(a) * (radius + 8));
      ctx.lineTo(sx + Math.cos(a + 2.5) * (radius + 3), sy + Math.sin(a + 2.5) * (radius + 3));
      ctx.lineTo(sx + Math.cos(a - 2.5) * (radius + 3), sy + Math.sin(a - 2.5) * (radius + 3));
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.fill();
    }
    ctx.restore();
  }
}
