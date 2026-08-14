import { LAKE, BRIDGE } from '../world/terrain.js';
import { HERCILIO } from '../world/brasil.js';
import { CORCOVADO } from '../world/landmarks.js';

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
    this.modoMp = false;   // [MP-MAPA] minimapa limpo e mais barato no multiplayer
  }

  /** [MP-MAPA] Liga/desliga o modo multiplayer (chamado pelo match.js). */
  setModoMp(v) {
    this.modoMp = !!v;
  }

  /**
   * @param {object} view {x, z, yaw}
   * @param {object} marks {pickup:{x,z}|null, deliver:{x,z}|null, heli:{x,z}|null, zone:{x,z,r}|null}
   * @param {object} ents {cars, peds}
   */
  draw(dt, view, marks, ents) {
    /*
     * Redesenhar o radar são ~250 formas em canvas 2D. A 60fps isso é CPU
     * jogada fora: a 20fps o movimento do mapa é indistinguível.
     * O tempo acumulado é repassado à animação para o pulso não desacelerar.
     */
    this._acc += dt;
    if (this._acc < 1 / (this.modoMp ? 8 : 20)) return;   // [MP-MAPA] MP desenha a 8 fps (era 20)
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
    // [MP-MAPA] no MP o lago e as duas pontes aparecem SEMPRE (referência do mapa)
    if (this.modoMp || this._near(LAKE.minX, LAKE.minZ, px, pz, 420) || this._near(LAKE.maxX, LAKE.maxZ, px, pz, 420)) {
      quad(LAKE.minX, LAKE.minZ, LAKE.maxX, LAKE.maxZ, '#173d52');
      quad(BRIDGE.x - BRIDGE.halfW, BRIDGE.z0, BRIDGE.x + BRIDGE.halfW, BRIDGE.z3, '#5a5148');
      quad(HERCILIO.x - HERCILIO.halfW, HERCILIO.z0, HERCILIO.x + HERCILIO.halfW, HERCILIO.z3, '#6b6258');   // [MP-MAPA] 2ª ponte: Hercílio Luz
    }

    // ---- quarteirões
    const R2 = (RANGE + 50) * (RANGE + 50);
    if (!this.modoMp) {   // [MP-MAPA] sem quarteirões/prédios no MP
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
    }   // [MP-MAPA] fim: sem construções no MP

    // ---- pessoas e carros
    if (ents && !this.modoMp) {   // [MP-MAPA] sem peds/cars do solo no minimapa do MP
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

    // ---- outros jogadores (multiplayer) — pontos vermelhos
    if (marks.players && marks.players.length) {
      // [MINIMAPA] inimigos com tom forte: blip maior, vermelho vivo com glow
      // pulsante e triangulo apontando a direcao do olhar (yaw) do inimigo.
      const plPulse = 0.8 + Math.sin(this.pulse) * 0.2;
      const rBlip = 7.5 * plPulse;
      for (const pl of marks.players) {
        const dx = pl.x - px, dz = pl.z - pz;
        if (dx * dx + dz * dz > RANGE * RANGE) continue;
        const sx = TX(pl.x, pl.z), sy = TY(pl.x, pl.z);

        // halo vermelho pulsante (ajuda a enxergar de relance)
        ctx.save();
        ctx.shadowColor = '#ff2a2a';
        ctx.shadowBlur = this.modoMp ? 0 : 16 * plPulse;   // [MP-MAPA] sem blur caro no MP
        ctx.beginPath();
        ctx.arc(sx, sy, rBlip, 0, Math.PI * 2);
        ctx.fillStyle = '#ff2a2a';
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.strokeStyle = 'rgba(0,0,0,.6)';
        ctx.lineWidth = 1.6;
        ctx.stroke();

        // triangulo ambar: direcao para onde o inimigo esta olhando
        if (pl.yaw != null && !this.modoMp) {   // [MP-MAPA] sem setinha de direção no MP
          const ddx = -Math.sin(pl.yaw), ddz = -Math.cos(pl.yaw);
          const sx2 = -ddx * c + ddz * s;
          const sy2 = -ddx * s - ddz * c;
          const ang = Math.atan2(sx2, -sy2);
          ctx.translate(sx, sy);
          ctx.rotate(ang);
          ctx.beginPath();
          ctx.moveTo(0, -11.5);
          ctx.lineTo(4.5, -3.5);
          ctx.lineTo(-4.5, -3.5);
          ctx.closePath();
          ctx.fillStyle = '#ffd24d';
          ctx.fill();
        }
        ctx.restore();
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
    if (marks.helis && marks.helis.length) {
      // clampToEdge=true: os helis ficam espalhados pela cidade (100-700 m dos
      // spawns) e somiam do radar quando fora de alcance — agora grudam na
      // borda com a setinha, como portais e jogadores
      for (const h of marks.helis) {
        this._blip(ctx, TX, TY, h, h.playerId != null ? '#ffd24d' : '#25d0ff', 5, '🚁', px, pz, true);
      }
    } else if (marks.heli) this._blip(ctx, TX, TY, marks.heli, '#25d0ff', 5, '🚁', px, pz, false);
    if (marks.pickup) this._blip(ctx, TX, TY, marks.pickup, '#ffb020', pulseR, 'C', px, pz, true);
    if (marks.deliver) this._blip(ctx, TX, TY, marks.deliver, '#3ddc84', pulseR, 'E', px, pz, true);

    // ---- [BR] círculo da zona do battle royale no radar
    if (marks.zone) {
      const rp = Math.max(5, marks.zone.r * this.scale);
      ctx.beginPath();
      ctx.arc(TX(marks.zone.x, marks.zone.z), TY(marks.zone.x, marks.zone.z), rp, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,77,77,.15)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,77,77,.95)';
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    // [MP-MAPA] Cristo Redentor sempre visível no MP (na borda quando longe)
    if (this.modoMp) {
      const ccx = TX(CORCOVADO.x, CORCOVADO.z), ccy = TY(CORCOVADO.x, CORCOVADO.z);
      const dc = Math.hypot(ccx - this.cx, ccy - this.cy);
      let sx = ccx, sy = ccy;
      if (dc > this.R - 10) {
        const k = (this.R - 10) / (dc || 1);
        sx = this.cx + (ccx - this.cx) * k;
        sy = this.cy + (ccy - this.cy) * k;
      }
      const rp = 5 + Math.sin(this.pulse) * 1.2;
      ctx.save();
      ctx.beginPath();
      ctx.arc(sx, sy, rp, 0, Math.PI * 2);
      ctx.fillStyle = '#f5c542';
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,.55)';
      ctx.lineWidth = 1.6;
      ctx.stroke();
      ctx.strokeStyle = 'rgba(30,20,0,.85)';
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(sx, sy - 4); ctx.lineTo(sx, sy + 4);
      ctx.moveTo(sx - 4, sy); ctx.lineTo(sx + 4, sy);
      ctx.stroke();
      ctx.restore();
    }

    ctx.restore();

    // ---- seta do jogador, sempre no centro apontando para cima
    if (!this.modoMp) {   // [MP-MAPA] sem o triângulo de direção do player no MP
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
    }   // [MP-MAPA] fim: sem triângulo do player

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
    ctx.shadowBlur = this.modoMp ? 0 : 12;   // [MP-MAPA] sem blur caro no MP
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
