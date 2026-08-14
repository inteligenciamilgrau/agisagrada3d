import { PLAYER, GAME } from '../config.js';
import { formatTime, clamp } from '../utils.js';

const $ = (id) => document.getElementById(id);

/**
 * HUD: corações [33], pontos e tempo [7][8], velocímetro [28],
 * mira a 2/5 do topo [42] e avisos contextuais.
 */
export class HUD {
  constructor() {
    this.el = {
      hud: $('hud'),
      hearts: $('hearts'),
      score: $('score'),
      timer: $('timer'),
      timerBox: $('timer-box'),
      deliveries: $('deliveries'),
      objective: $('objective'),
      objTitle: $('objective-title'),
      objText: $('objective-text'),
      objIcon: $('objective-icon'),
      objDist: $('objective-dist'),
      speedo: $('speedo'),
      speedoCanvas: $('speedo-canvas'),
      speedoValue: $('speedo-value'),
      gear: $('gear'),
      heliPanel: $('heli-panel'),
      heliAlt: $('heli-alt'),
      heliSpd: $('heli-spd'),
      prompt: $('prompt'),
      toasts: $('toasts'),
      carrying: $('carrying'),
      crosshair: $('crosshair'),
      redDot: $('red-dot'),
      hitmarker: $('hitmarker'),
      clock: $('clock'),
      daynight: $('daynight'),
      perfbox: $('perfbox'),
      fps: $('fps'),
      presetTag: $('preset-tag'),
      godTag: $('god-tag'),
    };

    this.sctx = this.el.speedoCanvas.getContext('2d');
    this._heartCount = -1;
    this._shownSpeed = 0;
    this._fpsAcc = 0;
    this._fpsFrames = 0;
    this._lastScore = -1;
    this._lastDeliveries = -1;
    this._lastClockText = null;
    this._lastIsNight = null;
  }

  /** Contador de FPS, atualizado 4x por segundo para o número não tremer. */
  tickFPS(dt) {
    this._fpsAcc += dt;
    this._fpsFrames++;
    if (this._fpsAcc < 0.25) return;
    const fps = Math.round(this._fpsFrames / this._fpsAcc);
    this._fpsAcc = 0;
    this._fpsFrames = 0;
    this.el.fps.textContent = fps;
    this.el.perfbox.classList.toggle('warn', fps < 45 && fps >= 25);
    this.el.perfbox.classList.toggle('bad', fps < 25);
  }

  setPreset(label) {
    this.el.presetTag.textContent = label;
  }

  show(on) {
    this.el.hud.classList.toggle('hidden', !on);
  }

  // ------------------------------------------------------------------ [33] corações
  setHearts(n) {
    if (n === this._heartCount) return;
    const prev = this._heartCount;
    this._heartCount = n;
    this.el.hearts.innerHTML = '';
    for (let i = 0; i < PLAYER.maxHearts; i++) {
      const d = document.createElement('div');
      d.className = 'heart' + (i < n ? '' : ' empty');
      // [34] o coração perdido pisca
      if (prev >= 0 && i === n && prev > n) d.classList.add('pulse');
      this.el.hearts.appendChild(d);
    }
  }

  /** [34] Flash vermelho ao levar dano. */
  damageFlash() {
    this.el.hud.classList.remove('hurt');
    void this.el.hud.offsetWidth;           // reinicia a animação
    this.el.hud.classList.add('hurt');
  }

  // ------------------------------------------------------------------ números
  setScore(v) {
    if (v === this._lastScore) return;              // [perf F3-4] HUD so quando muda
    this._lastScore = v;
    this.el.score.textContent = v;
  }
  setDeliveries(v) {
    if (v === this._lastDeliveries) return;
    this._lastDeliveries = v;
    this.el.deliveries.textContent = v;
  }

  /** [8] Tempo restante — pode estar desativado. */
  setTimer(seconds, enabled) {
    if (!enabled) {
      this.el.timer.textContent = '∞';
      this.el.timerBox.classList.add('off');
      this.el.timerBox.classList.remove('urgent');
      return;
    }
    this.el.timerBox.classList.remove('off');
    this.el.timer.textContent = formatTime(seconds);
    this.el.timerBox.classList.toggle('urgent', seconds <= 30);
  }

  setClock(text, isNight) {
    if (text === this._lastClockText && isNight === this._lastIsNight) return;  // [perf F3-4]
    this._lastClockText = text;
    this._lastIsNight = isNight;
    this.el.clock.textContent = text;
    this.el.daynight.textContent = isNight ? '🌙' : '☀️';
  }

  // ------------------------------------------------------------------ [5][6] objetivo
  setObjective(mode, text, distance) {
    const deliver = mode === 'deliver';
    this.el.objective.classList.toggle('deliver', deliver);
    this.el.objTitle.textContent = deliver ? 'ENTREGAR' : 'COLETAR';
    this.el.objIcon.textContent = deliver ? '🏁' : '📦';
    this.el.objText.textContent = text;
    this.el.objDist.textContent = distance == null ? '' : Math.round(distance) + ' m';
  }

  // ------------------------------------------------------------------ [50]
  setCarrying(on) {
    this.el.carrying.classList.toggle('hidden', !on);
  }

  // ------------------------------------------------------------------ dicas
  setPrompt(html) {
    if (!html) {
      this.el.prompt.classList.add('hidden');
      return;
    }
    this.el.prompt.innerHTML = html;
    this.el.prompt.classList.remove('hidden');
  }

  toast(text, kind = 'pts') {
    const d = document.createElement('div');
    d.className = 'toast ' + kind;
    d.textContent = text;
    this.el.toasts.appendChild(d);
    setTimeout(() => d.remove(), 1500);
  }

  // ------------------------------------------------------------------ mira
  hitMarker() {
    const h = this.el.hitmarker;
    h.classList.remove('show');
    void h.offsetWidth;
    h.classList.add('show');
  }

  recoil() {
    // [FPS] sem pulso: a mira fica parada mesmo ao atirar (sniper)
  }

  setOnTarget(on) {
    this.el.crosshair.classList.toggle('on-target', on);
  }

  setCrosshairVisible(v) {
    this.el.crosshair.style.opacity = v ? '1' : '0';
  }

  /** [heli] Mira do helicóptero fica no centro da tela (o míssil vai para onde o jogador olha). */
  setCrosshairCenter(on) {
    this.el.crosshair.classList.toggle('center', !!on);
  }

  /** [FPS] Zoom de mira: a mira desliza do canto (62%, 2/5) para o centro. */
  setAds(on) {
    this.el.crosshair.classList.toggle('ads', on);
    // [CODM-FIX] Red Dot óptico: ponto vermelho no centro durante o ADS,
    // renderizado por cima da arma 3D — a mira nunca é obstruída pelo slide
    this.el.redDot.style.opacity = on ? '1' : '0';
  }


  // ------------------------------------------------------------------ [28] velocímetro
  showSpeedo(on) {
    this.el.speedo.classList.toggle('hidden', !on);
  }

  showHeliPanel(on) {
    this.el.heliPanel.classList.toggle('hidden', !on);
  }

  /** [60] Selo do modo Deus, para não restar dúvida de que está ligado. */
  setGod(on) {
    this.el.godTag.classList.toggle('hidden', !on);
  }

  setHeli(alt, speedKmh, tooHigh) {
    this.el.heliAlt.textContent = Math.round(alt);
    this.el.heliSpd.textContent = Math.round(speedKmh);
    this.el.heliPanel.classList.toggle('too-high', tooHigh);
  }

  /**
   * [28] Ponteiro analógico até 120 km/h, desenhado no canvas.
   * @param {number} speedMs velocidade em m/s (pode ser negativa em ré)
   */
  setSpeed(speedMs, dt) {
    const kmh = Math.abs(speedMs) * 3.6;
    this._shownSpeed += (kmh - this._shownSpeed) * clamp(dt * 9, 0, 1);
    const v = this._shownSpeed;
    const MAX = 120;

    const ctx = this.sctx;
    const S = 300, cx = S / 2, cy = S / 2, R = 122;
    ctx.clearRect(0, 0, S, S);

    // fundo
    ctx.beginPath();
    ctx.arc(cx, cy, R + 16, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(8,12,20,.72)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.14)';
    ctx.lineWidth = 2;
    ctx.stroke();

    const A0 = Math.PI * 0.75, A1 = Math.PI * 2.25;   // 270° de escala
    const angleFor = (k) => A0 + (clamp(k, 0, MAX) / MAX) * (A1 - A0);

    // trilho
    ctx.beginPath();
    ctx.arc(cx, cy, R, A0, A1);
    ctx.strokeStyle = 'rgba(255,255,255,.10)';
    ctx.lineWidth = 13;
    ctx.stroke();

    // preenchimento (verde -> amarelo -> vermelho)
    const grad = ctx.createLinearGradient(0, 0, S, S);
    grad.addColorStop(0, '#3ddc84');
    grad.addColorStop(0.55, '#ffb020');
    grad.addColorStop(1, '#ff4d4d');
    ctx.beginPath();
    ctx.arc(cx, cy, R, A0, angleFor(v));
    ctx.strokeStyle = grad;
    ctx.lineWidth = 13;
    ctx.lineCap = 'round';
    ctx.stroke();

    // marcações de 0 a 120 de 10 em 10
    for (let k = 0; k <= MAX; k += 10) {
      const a = angleFor(k);
      const major = k % 20 === 0;
      const r0 = R - (major ? 22 : 15);
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
      ctx.lineTo(cx + Math.cos(a) * (R - 9), cy + Math.sin(a) * (R - 9));
      ctx.strokeStyle = major ? 'rgba(255,255,255,.85)' : 'rgba(255,255,255,.35)';
      ctx.lineWidth = major ? 3 : 1.6;
      ctx.stroke();

      if (major) {
        ctx.save();
        ctx.fillStyle = 'rgba(255,255,255,.6)';
        ctx.font = 'bold 16px "Segoe UI", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(k), cx + Math.cos(a) * (R - 38), cy + Math.sin(a) * (R - 38));
        ctx.restore();
      }
    }

    // ponteiro
    const a = angleFor(v);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(a);
    ctx.beginPath();
    ctx.moveTo(-14, 0);
    ctx.lineTo(0, -6);
    ctx.lineTo(R - 18, 0);
    ctx.lineTo(0, 6);
    ctx.closePath();
    ctx.fillStyle = '#ff4d4d';
    ctx.shadowColor = '#ff4d4d';
    ctx.shadowBlur = 12;
    ctx.fill();
    ctx.restore();

    ctx.beginPath();
    ctx.arc(cx, cy, 11, 0, Math.PI * 2);
    ctx.fillStyle = '#1a1f28';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.3)';
    ctx.lineWidth = 2;
    ctx.stroke();

    $('speedo-value').textContent = Math.round(v);
    this.el.gear.textContent = speedMs < -0.4 ? 'R' : Math.abs(speedMs) < 0.4 ? 'N' : 'D';
  }

  reset() {
    this._heartCount = -1;
    this._shownSpeed = 0;
    this.setHearts(PLAYER.maxHearts);
    this.setScore(0);
    this.setDeliveries(0);
    this.setTimer(GAME.totalTime, true);
    this.setCarrying(false);
    this.showSpeedo(false);
    this.showHeliPanel(false);
    this.setGod(false);
    this.setPrompt(null);
    this.el.crosshair.classList.remove('ads');   // [FPS] reset devolve a mira ao canto
  }
}
