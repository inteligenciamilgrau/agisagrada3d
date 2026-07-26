import * as THREE from 'three';
import { makeRng, rngRange, rngPick } from '../utils.js';

/**
 * Texturas 100% procedurais (canvas 2D) — nada é baixado, tudo é gerado
 * na abertura do jogo. Mantém o projeto sem assets externos e sem CORS.
 */

const cache = new Map();
function cached(key, factory) {
  if (!cache.has(key)) cache.set(key, factory());
  return cache.get(key);
}

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

function finish(canvas, { srgb = true, repeat = 1, aniso = 8 } = {}) {
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = aniso;
  if (repeat !== 1) t.repeat.set(repeat, repeat);
  return t;
}

/** Ruído granulado sobreposto — dá "sujeira" e quebra o look de plástico. */
function grain(ctx, w, h, amount, alpha = 0.05) {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * amount;
    d[i] = Math.max(0, Math.min(255, d[i] + n));
    d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n));
    d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + n));
  }
  ctx.putImageData(img, 0, 0);
  if (alpha > 0) {
    ctx.globalAlpha = alpha;
    for (let i = 0; i < 260; i++) {
      ctx.fillStyle = Math.random() > 0.5 ? '#000' : '#fff';
      const r = Math.random() * 26 + 3;
      ctx.beginPath();
      ctx.arc(Math.random() * w, Math.random() * h, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
}

// ------------------------------------------------------------------ asfalto
export function asphaltTexture() {
  return cached('asphalt', () => {
    const S = 512, c = makeCanvas(S, S), x = c.getContext('2d');
    x.fillStyle = '#3a3d42';
    x.fillRect(0, 0, S, S);
    // Manchas de reparo / remendos de asfalto.
    // O tom tem que vir de UM valor só: sorteando R, G e B separadamente cada
    // remendo ganha uma cor aleatória e a rua fica manchada de roxo e verde.
    for (let i = 0; i < 40; i++) {
      const v = 20 + Math.random() * 40;
      x.fillStyle = `rgba(${v | 0},${(v + 1) | 0},${(v + 4) | 0},.32)`;
      x.beginPath();
      x.ellipse(Math.random() * S, Math.random() * S, Math.random() * 70 + 12, Math.random() * 50 + 10, Math.random() * 3, 0, Math.PI * 2);
      x.fill();
    }
    // rachaduras
    x.strokeStyle = 'rgba(15,15,18,.5)';
    for (let i = 0; i < 22; i++) {
      x.lineWidth = Math.random() * 1.6 + 0.4;
      x.beginPath();
      let px = Math.random() * S, py = Math.random() * S;
      x.moveTo(px, py);
      for (let s = 0; s < 6; s++) {
        px += (Math.random() - 0.5) * 70; py += (Math.random() - 0.5) * 70;
        x.lineTo(px, py);
      }
      x.stroke();
    }
    grain(x, S, S, 34, 0.035);
    return finish(c, { repeat: 1, aniso: 16 });
  });
}

export function asphaltRoughness() {
  return cached('asphaltRough', () => {
    // faixa estreita de rugosidade: variação demais cria manchas espelhadas
    // que refletem o céu e deixam o asfalto roxo/azulado
    const S = 256, c = makeCanvas(S, S), x = c.getContext('2d');
    x.fillStyle = '#dcdcdc';
    x.fillRect(0, 0, S, S);
    for (let i = 0; i < 90; i++) {
      const g = 198 + Math.random() * 42;
      x.fillStyle = `rgb(${g},${g},${g})`;
      x.beginPath();
      x.ellipse(Math.random() * S, Math.random() * S, Math.random() * 40 + 6, Math.random() * 30 + 6, 0, 0, Math.PI * 2);
      x.fill();
    }
    grain(x, S, S, 20, 0);
    return finish(c, { srgb: false, aniso: 4 });
  });
}

// ------------------------------------------------------------------ [16] calçada
export function sidewalkTexture() {
  return cached('sidewalk', () => {
    const S = 512, c = makeCanvas(S, S), x = c.getContext('2d');
    x.fillStyle = '#b9b5ad';
    x.fillRect(0, 0, S, S);
    // placas de concreto 4x4 com junta escura
    const N = 4, cell = S / N;
    for (let i = 0; i < N; i++) {
      for (let j = 0; j < N; j++) {
        const v = 168 + Math.random() * 30;
        x.fillStyle = `rgb(${v},${v - 3},${v - 10})`;
        x.fillRect(i * cell + 2, j * cell + 2, cell - 4, cell - 4);
        // desgaste nas bordas
        x.strokeStyle = 'rgba(120,116,108,.5)';
        x.lineWidth = 2;
        x.strokeRect(i * cell + 3, j * cell + 3, cell - 6, cell - 6);
      }
    }
    x.strokeStyle = 'rgba(90,88,82,.85)';
    x.lineWidth = 3;
    for (let i = 0; i <= N; i++) {
      x.beginPath(); x.moveTo(i * cell, 0); x.lineTo(i * cell, S); x.stroke();
      x.beginPath(); x.moveTo(0, i * cell); x.lineTo(S, i * cell); x.stroke();
    }
    grain(x, S, S, 22, 0.03);
    return finish(c, { aniso: 16 });
  });
}

// ------------------------------------------------------------------ grama / terra
export function grassTexture() {
  return cached('grass', () => {
    const S = 512, c = makeCanvas(S, S), x = c.getContext('2d');
    x.fillStyle = '#4a6b33';
    x.fillRect(0, 0, S, S);
    for (let i = 0; i < 2600; i++) {
      const g = 40 + Math.random() * 60;
      x.strokeStyle = `rgb(${Math.floor(g * 0.75)},${Math.floor(g * 1.55)},${Math.floor(g * 0.6)})`;
      x.lineWidth = Math.random() * 1.8 + 0.5;
      const px = Math.random() * S, py = Math.random() * S;
      x.beginPath();
      x.moveTo(px, py);
      x.lineTo(px + (Math.random() - 0.5) * 7, py - Math.random() * 9);
      x.stroke();
    }
    for (let i = 0; i < 26; i++) {
      x.fillStyle = `rgba(${90 + Math.random() * 40},${80 + Math.random() * 30},${50},.18)`;
      x.beginPath();
      x.ellipse(Math.random() * S, Math.random() * S, Math.random() * 60 + 20, Math.random() * 45 + 15, 0, 0, Math.PI * 2);
      x.fill();
    }
    grain(x, S, S, 26, 0);
    return finish(c, { aniso: 16 });
  });
}

// ------------------------------------------------------------------ pedra / montanha
export function rockTexture() {
  return cached('rock', () => {
    const S = 512, c = makeCanvas(S, S), x = c.getContext('2d');
    x.fillStyle = '#6e6a63';
    x.fillRect(0, 0, S, S);
    for (let i = 0; i < 220; i++) {
      const v = 80 + Math.random() * 70;
      x.fillStyle = `rgba(${v},${v - 4},${v - 12},.5)`;
      x.beginPath();
      const px = Math.random() * S, py = Math.random() * S, r = Math.random() * 46 + 8;
      x.moveTo(px, py);
      for (let a = 0; a < 7; a++) {
        const ang = (a / 7) * Math.PI * 2;
        x.lineTo(px + Math.cos(ang) * r * (0.6 + Math.random() * 0.6),
                 py + Math.sin(ang) * r * (0.6 + Math.random() * 0.6));
      }
      x.closePath(); x.fill();
    }
    // vegetação nas fendas
    for (let i = 0; i < 120; i++) {
      x.fillStyle = `rgba(${40 + Math.random() * 30},${70 + Math.random() * 40},${30},.35)`;
      x.beginPath();
      x.arc(Math.random() * S, Math.random() * S, Math.random() * 14 + 3, 0, Math.PI * 2);
      x.fill();
    }
    grain(x, S, S, 30, 0.04);
    return finish(c, { aniso: 8 });
  });
}

// ------------------------------------------------------------------ [20] fachadas com janelas
const FACADE_CELL_W = 3.3;   // metros por coluna de janela
const FACADE_CELL_H = 3.6;   // metros por andar
export { FACADE_CELL_W, FACADE_CELL_H };

/**
 * Gera o trio de mapas de uma fachada: cor, emissivo (janelas acesas à noite)
 * e rugosidade (vidro liso vs concreto áspero).
 */
export function facadeTextures(variant) {
  return cached('facade' + variant, () => {
    const rng = makeRng(9000 + variant * 977);
    const COLS = 4, ROWS = 4, S = 512;
    const cellW = S / COLS, cellH = S / ROWS;

    const style = variant % 4;   // 0 concreto, 1 vidro, 2 tijolo, 3 misto
    const wallCol = style === 2
      ? rngPick(rng, ['#8c4a35', '#96543c', '#7d4230'])
      : rngPick(rng, ['#b6b0a6', '#a4a49e', '#c9c3b7', '#8f9299', '#9b958a']);
    const glassCol = rngPick(rng, ['#2b4a63', '#20384c', '#33566b', '#1c3040']);

    const col = makeCanvas(S, S), cx = col.getContext('2d');
    const emi = makeCanvas(S, S), ex = emi.getContext('2d');
    const rgh = makeCanvas(S, S), rx = rgh.getContext('2d');

    cx.fillStyle = wallCol; cx.fillRect(0, 0, S, S);
    ex.fillStyle = '#000'; ex.fillRect(0, 0, S, S);
    rx.fillStyle = '#d4d4d4'; rx.fillRect(0, 0, S, S);   // parede áspera

    // textura de tijolo
    if (style === 2) {
      cx.strokeStyle = 'rgba(0,0,0,.16)';
      cx.lineWidth = 1;
      for (let y = 0; y < S; y += 9) {
        cx.beginPath(); cx.moveTo(0, y); cx.lineTo(S, y); cx.stroke();
        const off = (y / 9) % 2 ? 0 : 11;
        for (let bx = off; bx < S; bx += 22) {
          cx.beginPath(); cx.moveTo(bx, y); cx.lineTo(bx, y + 9); cx.stroke();
        }
      }
    }

    // faixas horizontais de laje entre andares
    for (let r = 0; r <= ROWS; r++) {
      const y = r * cellH;
      cx.fillStyle = 'rgba(0,0,0,.13)';
      cx.fillRect(0, y - 3, S, 6);
      cx.fillStyle = 'rgba(255,255,255,.10)';
      cx.fillRect(0, y - 3, S, 2);
    }

    const winW = cellW * (style === 1 ? 0.82 : 0.58);
    const winH = cellH * (style === 1 ? 0.6 : 0.5);

    for (let r = 0; r < ROWS; r++) {
      for (let cI = 0; cI < COLS; cI++) {
        const px = cI * cellW + (cellW - winW) / 2;
        const py = r * cellH + (cellH - winH) / 2 + cellH * 0.06;

        // moldura / peitoril
        cx.fillStyle = 'rgba(0,0,0,.22)';
        cx.fillRect(px - 3, py - 3, winW + 6, winH + 6);
        cx.fillStyle = 'rgba(255,255,255,.14)';
        cx.fillRect(px - 3, py + winH + 1, winW + 6, 3);

        // vidro com degradê (reflexo do céu)
        const g = cx.createLinearGradient(px, py, px, py + winH);
        g.addColorStop(0, glassCol);
        g.addColorStop(0.45, '#0f1a24');
        g.addColorStop(1, '#33485c');
        cx.fillStyle = g;
        cx.fillRect(px, py, winW, winH);

        // caixilho
        cx.strokeStyle = 'rgba(230,230,235,.30)';
        cx.lineWidth = 1.5;
        cx.strokeRect(px, py, winW, winH);
        cx.beginPath();
        cx.moveTo(px + winW / 2, py); cx.lineTo(px + winW / 2, py + winH);
        cx.stroke();

        // vidro é liso -> rugosidade baixa
        rx.fillStyle = '#1e1e1e';
        rx.fillRect(px, py, winW, winH);

        // [13] janelas acesas à noite (padrão fixo por variante)
        if (rng() < 0.42) {
          const warm = rngPick(rng, ['#ffd9a0', '#ffc978', '#fff0d0', '#bfe0ff', '#ffe8b5']);
          ex.fillStyle = warm;
          ex.fillRect(px, py, winW, winH);
          // silhueta de móveis para não ficar um retângulo chapado
          ex.fillStyle = 'rgba(0,0,0,.42)';
          ex.fillRect(px + winW * rng() * 0.5, py + winH * 0.55, winW * 0.3, winH * 0.45);
        }
      }
    }

    grain(cx, S, S, 16, 0.025);

    const map = finish(col, { aniso: 16 });
    const emissive = finish(emi, { aniso: 4 });
    const roughness = finish(rgh, { srgb: false, aniso: 4 });
    return { map, emissive, roughness };
  });
}

// ------------------------------------------------------------------ [55] número nas costas
const numberCache = new Map();
export function numberTexture(text, bg = '#f2f2f2', fg = '#101418') {
  const key = text + bg;
  if (numberCache.has(key)) return numberCache.get(key);
  const W = 256, H = 128;
  const c = makeCanvas(W, H), x = c.getContext('2d');
  x.fillStyle = bg;
  x.fillRect(0, 0, W, H);
  x.strokeStyle = 'rgba(0,0,0,.18)';
  x.lineWidth = 6;
  x.strokeRect(3, 3, W - 6, H - 6);
  x.fillStyle = fg;
  x.font = 'bold 74px Arial Black, Arial, sans-serif';
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.fillText(String(text), W / 2, H / 2 + 4);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  numberCache.set(key, t);
  return t;
}

// ------------------------------------------------------------------ heliponto [43]
export function helipadTexture() {
  return cached('helipad', () => {
    const S = 512, c = makeCanvas(S, S), x = c.getContext('2d');
    x.fillStyle = '#3f4249';
    x.fillRect(0, 0, S, S);
    grain(x, S, S, 26, 0.04);
    // círculo externo
    x.strokeStyle = '#f2f2f2';
    x.lineWidth = 14;
    x.beginPath(); x.arc(S / 2, S / 2, S * 0.38, 0, Math.PI * 2); x.stroke();
    // H
    x.fillStyle = '#f2f2f2';
    x.fillRect(S * 0.34, S * 0.28, 34, S * 0.44);
    x.fillRect(S * 0.60, S * 0.28, 34, S * 0.44);
    x.fillRect(S * 0.34, S * 0.47, S * 0.30, 32);
    // faixas de alerta
    x.fillStyle = '#e8b219';
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      x.save();
      x.translate(S / 2 + Math.cos(a) * S * 0.455, S / 2 + Math.sin(a) * S * 0.455);
      x.rotate(a);
      x.fillRect(-6, -18, 12, 36);
      x.restore();
    }
    return finish(c, { aniso: 8 });
  });
}

// ------------------------------------------------------------------ água [52]
export function waterNormalTexture() {
  return cached('waterN', () => {
    const S = 512, c = makeCanvas(S, S), x = c.getContext('2d');
    // normal map "plano" com ondulações suaves desenhadas como gradientes
    x.fillStyle = '#8080ff';
    x.fillRect(0, 0, S, S);
    for (let i = 0; i < 90; i++) {
      const px = Math.random() * S, py = Math.random() * S;
      const r = Math.random() * 60 + 18;
      const g = x.createRadialGradient(px - r * 0.3, py - r * 0.3, 1, px, py, r);
      g.addColorStop(0, 'rgba(150,150,255,.55)');
      g.addColorStop(0.5, 'rgba(128,128,255,.15)');
      g.addColorStop(1, 'rgba(110,110,255,0)');
      x.fillStyle = g;
      x.beginPath(); x.arc(px, py, r, 0, Math.PI * 2); x.fill();
    }
    return finish(c, { srgb: false, aniso: 8 });
  });
}

// ------------------------------------------------------------------ céu noturno
export function starTexture() {
  return cached('star', () => {
    const S = 64, c = makeCanvas(S, S), x = c.getContext('2d');
    const g = x.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.25, 'rgba(255,255,255,.7)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g;
    x.fillRect(0, 0, S, S);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  });
}

/** Partícula de fumaça/fogo usada nas explosões. */
export function puffTexture() {
  return cached('puff', () => {
    const S = 128, c = makeCanvas(S, S), x = c.getContext('2d');
    const g = x.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.35, 'rgba(255,255,255,.55)');
    g.addColorStop(0.7, 'rgba(255,255,255,.16)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g;
    x.beginPath(); x.arc(S / 2, S / 2, S / 2, 0, Math.PI * 2); x.fill();
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  });
}

/** Halo usado nos postes e faróis à noite. */
export function glowTexture() {
  return cached('glow', () => {
    const S = 128, c = makeCanvas(S, S), x = c.getContext('2d');
    const g = x.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    g.addColorStop(0, 'rgba(255,240,200,.95)');
    g.addColorStop(0.2, 'rgba(255,225,160,.45)');
    g.addColorStop(0.55, 'rgba(255,210,140,.12)');
    g.addColorStop(1, 'rgba(255,200,120,0)');
    x.fillStyle = g;
    x.fillRect(0, 0, S, S);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  });
}

/** Sombra "fake" (blob) usada em objetos pequenos para reforçar o contato. */
export function blobShadowTexture() {
  return cached('blob', () => {
    const S = 128, c = makeCanvas(S, S), x = c.getContext('2d');
    const g = x.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    g.addColorStop(0, 'rgba(0,0,0,.55)');
    g.addColorStop(0.6, 'rgba(0,0,0,.22)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = g;
    x.fillRect(0, 0, S, S);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  });
}

// ==================================================================
//  [57][58][59] texturas dos marcos brasileiros
// ==================================================================

/**
 * Converte um mapa de ALTURA (canvas em tons de cinza) em normal map.
 *
 * Vale mais que desenhar o normal map à mão: a mesma função que pinta a
 * pedra, a telha ou o rebite serve de relevo, então desenho e relevo nunca
 * saem de sincronia.
 *
 * O canal verde sai com o sinal invertido em relação ao eixo Y do canvas
 * porque `CanvasTexture` sobe a imagem com `flipY`: o +Y do canvas vira o -V
 * da textura, e sem essa troca todo o relevo aparece afundado.
 */
function normalFromHeight(src, forca = 2.4) {
  const w = src.width, h = src.height;
  const sc = src.getContext('2d').getImageData(0, 0, w, h).data;
  const out = makeCanvas(w, h);
  const oc = out.getContext('2d');
  const img = oc.createImageData(w, h);
  const alt = (x, y) => sc[((((y % h) + h) % h) * w + (((x % w) + w) % w)) * 4] / 255;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (alt(x + 1, y) - alt(x - 1, y)) * forca;
      const dy = (alt(x, y + 1) - alt(x, y - 1)) * forca;
      let nx = -dx, ny = dy, nz = 1;
      const l = Math.hypot(nx, ny, nz);
      nx /= l; ny /= l; nz /= l;
      const i = (y * w + x) * 4;
      img.data[i] = (nx * 0.5 + 0.5) * 255;
      img.data[i + 1] = (ny * 0.5 + 0.5) * 255;
      img.data[i + 2] = (nz * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  oc.putImageData(img, 0, 0);
  return out;
}

/** Desenha as pedras do calçamento e devolve os canvas de cor e de altura. */
function _cobbleCanvases() {
  const S = 512;
  const cor = makeCanvas(S, S), cx = cor.getContext('2d');
  const alt = makeCanvas(S, S), ax = alt.getContext('2d');
  cx.fillStyle = '#4a453e'; cx.fillRect(0, 0, S, S);      // argamassa entre as pedras
  ax.fillStyle = '#202020'; ax.fillRect(0, 0, S, S);

  const rng = makeRng(4242);
  const N = 13, cell = S / N;
  for (let j = 0; j < N; j++) {
    // fiadas alternadas, como calçamento de paralelepípedo assentado à mão
    const desloc = (j % 2) * cell * 0.5;
    for (let i = -1; i <= N; i++) {
      const px = i * cell + desloc + rngRange(rng, -2.5, 2.5);
      const py = j * cell + rngRange(rng, -2.5, 2.5);
      const rw = cell * rngRange(rng, 0.78, 0.94);
      const rh = cell * rngRange(rng, 0.74, 0.92);
      const v = rngRange(rng, 108, 168);
      const quente = rngRange(rng, -8, 10);
      cx.fillStyle = `rgb(${(v + quente) | 0},${(v + quente * 0.6) | 0},${(v - 4) | 0})`;
      ax.fillStyle = '#d8d8d8';
      for (const [ctx2, raio] of [[cx, 4], [ax, 4]]) {
        ctx2.beginPath();
        ctx2.roundRect(px, py, rw, rh, raio);
        ctx2.fill();
      }
      // brilho de pedra polida pelo uso, no alto de cada bloco
      cx.fillStyle = `rgba(255,255,255,${rngRange(rng, 0.02, 0.09).toFixed(3)})`;
      cx.beginPath();
      cx.roundRect(px + rw * 0.14, py + rh * 0.12, rw * 0.55, rh * 0.4, 3);
      cx.fill();
    }
  }
  // borra o mapa de altura para as juntas virarem vale suave, não degrau
  ax.filter = 'blur(2px)';
  ax.drawImage(alt, 0, 0);
  ax.filter = 'none';
  grain(cx, S, S, 26, 0.05);
  return { cor, alt };
}

/** [59] Calçamento de pedra do Pelourinho. */
export function cobbleTexture() {
  return cached('cobble', () => finish(_cobbleCanvases().cor, { aniso: 16 }));
}
export function cobbleNormal() {
  return cached('cobbleN', () => {
    const t = new THREE.CanvasTexture(normalFromHeight(_cobbleCanvases().alt, 3.2));
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.NoColorSpace;
    t.anisotropy = 8;
    return t;
  });
}

/**
 * [59] Reboco colonial pintado, uma textura por cor.
 *
 * O que faz a casa parecer velha não é a cor: é a sujeira que escorre da
 * cimalha, a barra de umidade subindo do chão e a variação de mão de pintura.
 */
export function stuccoTexture(hex) {
  return cached('stucco:' + hex, () => {
    const S = 256, c = makeCanvas(S, S), x = c.getContext('2d');
    const base = new THREE.Color(hex);
    const rgb = (col) => `rgb(${(col.r * 255) | 0},${(col.g * 255) | 0},${(col.b * 255) | 0})`;
    x.fillStyle = rgb(base);
    x.fillRect(0, 0, S, S);

    const rng = makeRng(hex & 0xffff);
    // variação de mão de pintura
    for (let i = 0; i < 70; i++) {
      const t = rngRange(rng, -0.06, 0.06);
      const col = base.clone().offsetHSL(0, 0, t);
      x.fillStyle = rgb(col);
      x.globalAlpha = 0.35;
      x.beginPath();
      x.ellipse(rng() * S, rng() * S, rngRange(rng, 14, 60), rngRange(rng, 10, 44), rng() * 3, 0, Math.PI * 2);
      x.fill();
    }
    x.globalAlpha = 1;

    /*
     * Umidade e escorridos existem, mas de leve.
     *
     * Numa primeira versão eles estavam fortes (45% e 32% de opacidade) e a
     * fachada virava um gradeado de listras escuras — de longe as casas
     * pareciam pintadas de código de barras, não rebocadas. O desgaste tem
     * que ficar no limite de "só se nota de perto".
     */
    const umid = x.createLinearGradient(0, S, 0, S * 0.72);
    umid.addColorStop(0, 'rgba(72,68,58,.16)');
    umid.addColorStop(1, 'rgba(72,68,58,0)');
    x.fillStyle = umid;
    x.fillRect(0, 0, S, S);

    for (let i = 0; i < 9; i++) {
      const px = rng() * S;
      const larg = rngRange(rng, 2, 7);
      const comp = rngRange(rng, 20, S * 0.45);
      const g = x.createLinearGradient(0, 0, 0, comp);
      g.addColorStop(0, 'rgba(56,52,44,.10)');
      g.addColorStop(1, 'rgba(56,52,44,0)');
      x.fillStyle = g;
      x.fillRect(px, 0, larg, comp);
    }
    // reboco descascado, mostrando a caiação por baixo
    for (let i = 0; i < 10; i++) {
      x.fillStyle = `rgba(232,226,212,${rngRange(rng, 0.08, 0.18).toFixed(2)})`;
      x.beginPath();
      x.ellipse(rng() * S, rng() * S, rngRange(rng, 3, 12), rngRange(rng, 3, 10), rng() * 3, 0, Math.PI * 2);
      x.fill();
    }
    grain(x, S, S, 12, 0.015);
    return finish(c, { aniso: 8 });
  });
}

/** Telha-canal: fiadas de meias-canas alternando capa e bica. */
function _roofCanvases() {
  const S = 512;
  const cor = makeCanvas(S, S), cx = cor.getContext('2d');
  const alt = makeCanvas(S, S), ax = alt.getContext('2d');
  cx.fillStyle = '#8d4530'; cx.fillRect(0, 0, S, S);
  ax.fillStyle = '#303030'; ax.fillRect(0, 0, S, S);

  const rng = makeRng(777);
  const COLS = 10, w = S / COLS;
  for (let i = 0; i < COLS; i++) {
    const px = i * w;
    const v = rngRange(rng, 0.82, 1.12);
    // a canaleta: escura no vale, clara na crista
    const g = cx.createLinearGradient(px, 0, px + w, 0);
    g.addColorStop(0.0, `rgba(70,32,22,1)`);
    g.addColorStop(0.5, `rgb(${(168 * v) | 0},${(80 * v) | 0},${(54 * v) | 0})`);
    g.addColorStop(1.0, `rgba(70,32,22,1)`);
    cx.fillStyle = g;
    cx.fillRect(px, 0, w, S);

    const gh = ax.createLinearGradient(px, 0, px + w, 0);
    gh.addColorStop(0.0, '#2a2a2a');
    gh.addColorStop(0.5, '#e6e6e6');
    gh.addColorStop(1.0, '#2a2a2a');
    ax.fillStyle = gh;
    ax.fillRect(px, 0, w, S);
  }
  // emendas entre fiadas
  const FIADAS = 7, fh = S / FIADAS;
  for (let j = 1; j <= FIADAS; j++) {
    cx.fillStyle = 'rgba(38,18,12,.55)';
    cx.fillRect(0, j * fh - 3, S, 4);
    ax.fillStyle = 'rgba(0,0,0,.55)';
    ax.fillRect(0, j * fh - 3, S, 4);
  }
  // limo e telhas trocadas
  for (let i = 0; i < 60; i++) {
    cx.fillStyle = rng() > 0.55
      ? `rgba(86,96,58,${rngRange(rng, 0.1, 0.34).toFixed(2)})`
      : `rgba(40,22,16,${rngRange(rng, 0.08, 0.22).toFixed(2)})`;
    cx.beginPath();
    cx.ellipse(rng() * S, rng() * S, rngRange(rng, 6, 26), rngRange(rng, 5, 18), 0, 0, Math.PI * 2);
    cx.fill();
  }
  grain(cx, S, S, 18, 0.03);
  return { cor, alt };
}

/** [59] Telha colonial. */
export function roofTileTexture() {
  return cached('roofTile', () => finish(_roofCanvases().cor, { aniso: 16 }));
}
export function roofTileNormal() {
  return cached('roofTileN', () => {
    const t = new THREE.CanvasTexture(normalFromHeight(_roofCanvases().alt, 2.0));
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.NoColorSpace;
    t.anisotropy = 8;
    return t;
  });
}

/** [59] Azulejo português azul e branco, para as fachadas revestidas. */
export function azulejoTexture() {
  return cached('azulejo', () => {
    const S = 512, c = makeCanvas(S, S), x = c.getContext('2d');
    const N = 8, cell = S / N;
    for (let i = 0; i < N; i++) {
      for (let j = 0; j < N; j++) {
        const px = i * cell, py = j * cell;
        x.fillStyle = '#eef2f4';
        x.fillRect(px, py, cell, cell);
        // junta
        x.strokeStyle = 'rgba(150,160,168,.7)';
        x.lineWidth = 2;
        x.strokeRect(px + 1, py + 1, cell - 2, cell - 2);

        x.save();
        x.translate(px + cell / 2, py + cell / 2);
        x.strokeStyle = '#2a5f9e';
        x.fillStyle = '#336fb4';
        x.lineWidth = 2.4;
        // flor-de-lis estilizada: quatro pétalas e um miolo
        for (let k = 0; k < 4; k++) {
          x.rotate(Math.PI / 2);
          x.beginPath();
          x.moveTo(0, -cell * 0.1);
          x.quadraticCurveTo(cell * 0.22, -cell * 0.3, 0, -cell * 0.42);
          x.quadraticCurveTo(-cell * 0.22, -cell * 0.3, 0, -cell * 0.1);
          x.fill();
          x.stroke();
        }
        x.beginPath();
        x.arc(0, 0, cell * 0.08, 0, Math.PI * 2);
        x.fill();
        // cantos
        x.fillStyle = '#2a5f9e';
        for (const s of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
          x.beginPath();
          x.arc(s[0] * cell * 0.42, s[1] * cell * 0.42, cell * 0.055, 0, Math.PI * 2);
          x.fill();
        }
        x.restore();
      }
    }
    // craquelê e desgaste
    grain(x, S, S, 12, 0.04);
    return finish(c, { aniso: 16 });
  });
}

/** Chapa de aço rebitada da ponte, com corrosão. */
function _steelCanvases() {
  const S = 512;
  const cor = makeCanvas(S, S), cx = cor.getContext('2d');
  const alt = makeCanvas(S, S), ax = alt.getContext('2d');
  cx.fillStyle = '#9aa1a8'; cx.fillRect(0, 0, S, S);
  ax.fillStyle = '#808080'; ax.fillRect(0, 0, S, S);

  const rng = makeRng(9091);
  // chapas soldadas
  const PL = 4, pw = S / PL;
  for (let i = 0; i < PL; i++) {
    for (let j = 0; j < PL; j++) {
      const v = rngRange(rng, 0.92, 1.08);
      cx.fillStyle = `rgb(${(154 * v) | 0},${(161 * v) | 0},${(168 * v) | 0})`;
      cx.fillRect(i * pw + 2, j * pw + 2, pw - 4, pw - 4);
    }
  }
  cx.strokeStyle = 'rgba(70,76,82,.8)';
  cx.lineWidth = 3;
  for (let i = 0; i <= PL; i++) {
    cx.beginPath(); cx.moveTo(i * pw, 0); cx.lineTo(i * pw, S); cx.stroke();
    cx.beginPath(); cx.moveTo(0, i * pw); cx.lineTo(S, i * pw); cx.stroke();
  }

  // rebites nas bordas das chapas
  const rebite = (px, py) => {
    const g = cx.createRadialGradient(px - 1.5, py - 1.5, 0.5, px, py, 5);
    g.addColorStop(0, '#cfd6dc');
    g.addColorStop(1, '#5f666d');
    cx.fillStyle = g;
    cx.beginPath(); cx.arc(px, py, 4.6, 0, Math.PI * 2); cx.fill();
    ax.fillStyle = '#f0f0f0';
    ax.beginPath(); ax.arc(px, py, 4.2, 0, Math.PI * 2); ax.fill();
  };
  for (let i = 0; i <= PL; i++) {
    for (let t = 10; t < S; t += 22) {
      rebite(i * pw === 0 ? 8 : Math.min(i * pw - 7, S - 8), t);
      rebite(t, i * pw === 0 ? 8 : Math.min(i * pw - 7, S - 8));
    }
  }

  // ferrugem escorrendo dos rebites
  for (let i = 0; i < 40; i++) {
    const px = rng() * S, py = rng() * S;
    const comp = rngRange(rng, 12, 70);
    const g = cx.createLinearGradient(px, py, px, py + comp);
    g.addColorStop(0, `rgba(140,72,34,${rngRange(rng, 0.18, 0.45).toFixed(2)})`);
    g.addColorStop(1, 'rgba(140,72,34,0)');
    cx.fillStyle = g;
    cx.fillRect(px, py, rngRange(rng, 2, 7), comp);
  }
  ax.filter = 'blur(1.2px)';
  ax.drawImage(alt, 0, 0);
  ax.filter = 'none';
  grain(cx, S, S, 22, 0.04);
  return { cor, alt };
}

/** [57] Aço rebitado da Hercílio Luz. */
export function steelTexture() {
  return cached('steel', () => finish(_steelCanvases().cor, { aniso: 16 }));
}
export function steelNormal() {
  return cached('steelN', () => {
    const t = new THREE.CanvasTexture(normalFromHeight(_steelCanvases().alt, 2.6));
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.NoColorSpace;
    t.anisotropy = 8;
    return t;
  });
}

/** [58] Concreto aparente moldado, com marca de fôrma. */
export function concreteTexture() {
  return cached('concrete', () => {
    const S = 512, c = makeCanvas(S, S), x = c.getContext('2d');
    x.fillStyle = '#dcd8d0';
    x.fillRect(0, 0, S, S);
    const rng = makeRng(3131);
    // painéis de fôrma
    const N = 3, w = S / N;
    for (let i = 0; i < N; i++) {
      for (let j = 0; j < N; j++) {
        const v = rngRange(rng, 0.965, 1.03);
        x.fillStyle = `rgb(${(220 * v) | 0},${(216 * v) | 0},${(208 * v) | 0})`;
        x.fillRect(i * w + 1.5, j * w + 1.5, w - 3, w - 3);
      }
    }
    x.strokeStyle = 'rgba(168,164,156,.75)';
    x.lineWidth = 2;
    for (let i = 0; i <= N; i++) {
      x.beginPath(); x.moveTo(i * w, 0); x.lineTo(i * w, S); x.stroke();
      x.beginPath(); x.moveTo(0, i * w); x.lineTo(S, i * w); x.stroke();
    }
    // furos dos tirantes da fôrma
    for (let i = 0; i < N; i++) {
      for (let j = 0; j < N; j++) {
        for (const [fx, fy] of [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]]) {
          const px = (i + fx) * w, py = (j + fy) * w;
          const g = x.createRadialGradient(px, py, 0.5, px, py, 4);
          g.addColorStop(0, 'rgba(150,146,138,.9)');
          g.addColorStop(1, 'rgba(196,192,184,0)');
          x.fillStyle = g;
          x.beginPath(); x.arc(px, py, 4, 0, Math.PI * 2); x.fill();
        }
      }
    }
    // manchas de chuva
    for (let i = 0; i < 18; i++) {
      const px = rng() * S, comp = rngRange(rng, 30, S * 0.8);
      const g = x.createLinearGradient(0, 0, 0, comp);
      g.addColorStop(0, 'rgba(150,148,142,.20)');
      g.addColorStop(1, 'rgba(150,148,142,0)');
      x.fillStyle = g;
      x.fillRect(px, 0, rngRange(rng, 4, 16), comp);
    }
    grain(x, S, S, 14, 0.03);
    return finish(c, { aniso: 16 });
  });
}

/**
 * [58] Pele de vidro com caixilho.
 *
 * A grade dos montantes vai na TEXTURA e não em geometria: uma fachada de
 * cortina com barra modelada custaria milhares de caixas e, a essa distância,
 * daria exatamente a mesma imagem.
 */
export function curtainWallTexture(cols = 16, rows = 8, vidro = '#1d3d50', caixilho = '#c9ccd1') {
  return cached(`curtain:${cols}:${rows}:${vidro}:${caixilho}`, () => {
    const S = 512, c = makeCanvas(S, S), x = c.getContext('2d');
    x.fillStyle = vidro;
    x.fillRect(0, 0, S, S);
    const cw = S / cols, ch = S / rows;
    // reflexo do céu descendo em cada painel
    for (let i = 0; i < cols; i++) {
      for (let j = 0; j < rows; j++) {
        const g = x.createLinearGradient(i * cw, j * ch, i * cw + cw, j * ch + ch);
        const k = 0.10 + Math.random() * 0.28;
        g.addColorStop(0, `rgba(190,225,245,${k.toFixed(2)})`);
        g.addColorStop(0.55, 'rgba(120,170,200,0.05)');
        g.addColorStop(1, 'rgba(10,20,30,0.18)');
        x.fillStyle = g;
        x.fillRect(i * cw + 1, j * ch + 1, cw - 2, ch - 2);
      }
    }
    x.strokeStyle = caixilho;
    x.lineWidth = 3;
    for (let i = 0; i <= cols; i++) {
      x.beginPath(); x.moveTo(i * cw, 0); x.lineTo(i * cw, S); x.stroke();
    }
    for (let j = 0; j <= rows; j++) {
      x.beginPath(); x.moveTo(0, j * ch); x.lineTo(S, j * ch); x.stroke();
    }
    return finish(c, { aniso: 16 });
  });
}

export function disposeTextures() {
  cache.forEach((v) => {
    if (v && v.dispose) v.dispose();
    else if (v && v.map) { v.map.dispose(); v.emissive.dispose(); v.roughness.dispose(); }
  });
  cache.clear();
  numberCache.forEach((t) => t.dispose());
  numberCache.clear();
}
