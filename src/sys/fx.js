import * as THREE from '../../vendor/three.module.js';
import { puffTexture } from '../gfx/textures.js';

const MAX_PARTICLES = 1600;
const MAX_DEBRIS = 220;
/** Ficam sempre acesas na cena, então cada uma custa em TODO fragmento: poucas. */
const MAX_LIGHTS = 3;
const MAX_RINGS = 6;

/**
 * [24][26][35] Explosões: bola de fogo, fumaça, estilhaços, onda de choque e
 * um clarão de luz real. Tudo em pools — nenhuma alocação durante o jogo.
 */
const _M = new THREE.Matrix4(); // [perf F3-4] temps reutilizados (zero alocacao por frame)
const _Q = new THREE.Quaternion();
const _E = new THREE.Euler();
const _S = new THREE.Vector3();
const _OFF = new THREE.Matrix4().makeScale(0.0001, 0.0001, 0.0001);

export class FX {
  constructor(scene) {
    this.scene = scene;
    this._buildParticles();
    this._buildDebris();
    this._buildRings();
    this._buildLights();
    this.decals = [];
  }

  // ------------------------------------------------------------------ partículas
  _buildParticles() {
    const geo = new THREE.BufferGeometry();
    this.pPos = new Float32Array(MAX_PARTICLES * 3);
    this.pCol = new Float32Array(MAX_PARTICLES * 3);
    this.pSize = new Float32Array(MAX_PARTICLES);
    this.pAlpha = new Float32Array(MAX_PARTICLES);
    geo.setAttribute('position', new THREE.BufferAttribute(this.pPos, 3));
    geo.setAttribute('aColor', new THREE.BufferAttribute(this.pCol, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.pSize, 1));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.pAlpha, 1));
    geo.setDrawRange(0, MAX_PARTICLES);

    const mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: puffTexture() } },
      vertexShader: `
        attribute vec3 aColor;
        attribute float aSize;
        attribute float aAlpha;
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          vColor = aColor;
          vAlpha = aAlpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          float distZ = -mv.z;
          gl_PointSize = (distZ > 0.001) ? aSize * (420.0 / distZ) : 0.0;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform sampler2D map;
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          if (vAlpha <= 0.001) discard;
          vec4 t = texture2D(map, gl_PointCoord);
          gl_FragColor = vec4(vColor, 1.0) * t * vAlpha;
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    this.scene.add(this.points);

    this.particles = [];
    for (let i = 0; i < MAX_PARTICLES; i++) {
      this.particles.push({ life: 0, maxLife: 1, vx: 0, vy: 0, vz: 0, drag: 1, grow: 0, size: 1, fade: 1 });
      this.pAlpha[i] = 0;
    }
    this._pCursor = 0;
  }

  _emit(x, y, z, opts) {
    const i = this._pCursor;
    this._pCursor = (this._pCursor + 1) % MAX_PARTICLES;
    const p = this.particles[i];
    p.life = 0;
    p.maxLife = opts.life;
    p.vx = opts.vx; p.vy = opts.vy; p.vz = opts.vz;
    p.drag = opts.drag ?? 2.2;
    p.grow = opts.grow ?? 0;
    p.size = opts.size;
    p.gravity = opts.gravity ?? 0;
    this.pPos[i * 3] = x; this.pPos[i * 3 + 1] = y; this.pPos[i * 3 + 2] = z;
    this.pCol[i * 3] = opts.r; this.pCol[i * 3 + 1] = opts.g; this.pCol[i * 3 + 2] = opts.b;
    this.pSize[i] = opts.size;
    this.pAlpha[i] = 1;
  }

  // ------------------------------------------------------------------ estilhaços
  _buildDebris() {
    const geo = new THREE.BoxGeometry(0.28, 0.28, 0.28);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x2a2c30, roughness: 0.75, metalness: 0.55, flatShading: true,
    });
    this.debrisMesh = new THREE.InstancedMesh(geo, mat, MAX_DEBRIS);
    this.debrisMesh.frustumCulled = false;
    this.debrisMesh.castShadow = true;
    this.scene.add(this.debrisMesh);

    this.debris = [];
    const off = new THREE.Matrix4().makeScale(0.0001, 0.0001, 0.0001);
    for (let i = 0; i < MAX_DEBRIS; i++) {
      this.debris.push({
        life: 0, maxLife: 1,
        p: new THREE.Vector3(), v: new THREE.Vector3(),
        rot: new THREE.Euler(), av: new THREE.Vector3(), scale: 1,
      });
      this.debrisMesh.setMatrixAt(i, off);
    }
    this.debrisMesh.instanceMatrix.needsUpdate = true;
    this._dCursor = 0;
  }

  // ------------------------------------------------------------------ onda de choque
  _buildRings() {
    this.rings = [];
    for (let i = 0; i < MAX_RINGS; i++) {
      const m = new THREE.Mesh(
        new THREE.RingGeometry(0.7, 1, 32),
        new THREE.MeshBasicMaterial({
          color: 0xffd9a0, transparent: true, opacity: 0,
          side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending,
        }),
      );
      m.rotation.x = -Math.PI / 2;
      m.visible = false;
      m.renderOrder = 4;
      this.scene.add(m);
      this.rings.push({ mesh: m, life: 0, maxLife: 1, size: 1 });
    }
    this._rCursor = 0;
  }

  _buildLights() {
    this.lights = [];
    for (let i = 0; i < MAX_LIGHTS; i++) {
      const l = new THREE.PointLight(0xffa040, 0, 60, 1.7);
      // Sempre visível de propósito: alternar `visible` mudaria a contagem de
      // luzes da cena e recompilaria todos os shaders a cada explosão, que é
      // exatamente o momento em que o jogo não pode engasgar.
      // Quando não está em uso, a luz fica com intensidade 0.
      l.visible = true;
      this.scene.add(l);
      this.lights.push({ light: l, life: 0, maxLife: 1, power: 0, active: false });
    }
    this._lCursor = 0;
  }

  // ------------------------------------------------------------------ API
  /**
   * Explosão completa.
   * @param {THREE.Vector3} pos
   * @param {number} scale 1 = pessoa, 1.8 = carro
   */
  /**
   * [63] Rastro do míssil: fumaça clara que fica parada no ar marcando o
   * caminho, mais um sopro quente logo atrás do motor.
   */
  trail(x, y, z) {
    this._emit(x, y, z, {
      vx: (Math.random() - 0.5) * 1.4,
      vy: 0.5 + Math.random() * 1.0,
      vz: (Math.random() - 0.5) * 1.4,
      life: 0.7 + Math.random() * 0.7,
      size: 0.55 + Math.random() * 0.6,
      grow: 2.6, drag: 2.4,
      r: 0.62, g: 0.60, b: 0.58,
    });
    if (Math.random() < 0.5) {
      this._emit(x, y, z, {
        vx: 0, vy: 0.4, vz: 0,
        life: 0.12 + Math.random() * 0.1,
        size: 0.5, grow: 1.6, drag: 5,
        r: 3.0, g: 1.6, b: 0.5,
      });
    }
  }

  explode(pos, scale = 1) {
    const { x, y, z } = pos;

    // núcleo incandescente
    for (let i = 0; i < Math.floor(26 * scale); i++) {
      const a = Math.random() * Math.PI * 2;
      const e = Math.random() * Math.PI - Math.PI / 2;
      const sp = (5 + Math.random() * 13) * scale;
      this._emit(x, y + 0.5 * scale, z, {
        vx: Math.cos(a) * Math.cos(e) * sp,
        vy: Math.abs(Math.sin(e)) * sp * 0.9 + 3,
        vz: Math.sin(a) * Math.cos(e) * sp,
        life: 0.35 + Math.random() * 0.45,
        size: (1.4 + Math.random() * 2.2) * scale,
        grow: 3.5 * scale,
        drag: 3.4,
        r: 3.2, g: 1.5 + Math.random() * 0.7, b: 0.28,
      });
    }
    // fumaça escura que sobe
    for (let i = 0; i < Math.floor(22 * scale); i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = (1.5 + Math.random() * 5) * scale;
      this._emit(x, y + 0.7 * scale, z, {
        vx: Math.cos(a) * sp,
        vy: 2.2 + Math.random() * 4.5,
        vz: Math.sin(a) * sp,
        life: 1.1 + Math.random() * 1.5,
        size: (2.2 + Math.random() * 3.4) * scale,
        grow: 4.2 * scale,
        drag: 1.1,
        r: 0.16, g: 0.14, b: 0.13,
      });
    }
    // faíscas rápidas
    for (let i = 0; i < Math.floor(18 * scale); i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = (10 + Math.random() * 22) * scale;
      this._emit(x, y + 0.4, z, {
        vx: Math.cos(a) * sp,
        vy: 4 + Math.random() * 12,
        vz: Math.sin(a) * sp,
        life: 0.5 + Math.random() * 0.7,
        size: 0.55 * scale,
        drag: 0.8,
        gravity: -16,
        r: 3.4, g: 2.2, b: 0.7,
      });
    }

    this.spawnDebris(pos, Math.floor(10 * scale), scale);
    this.shockwave(pos, scale);
    this.flash(pos, scale);
  }

  spawnDebris(pos, count, scale = 1) {
    for (let i = 0; i < count; i++) {
      const d = this.debris[this._dCursor];
      this._dCursor = (this._dCursor + 1) % MAX_DEBRIS;
      const a = Math.random() * Math.PI * 2;
      const sp = (5 + Math.random() * 12) * scale;
      d.life = 0;
      d.maxLife = 1.6 + Math.random() * 1.8;
      d.p.set(pos.x, pos.y + 0.6, pos.z);
      d.v.set(Math.cos(a) * sp, 6 + Math.random() * 11, Math.sin(a) * sp);
      d.rot.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
      d.av.set((Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14);
      d.scale = (0.5 + Math.random() * 0.9) * scale;
    }
  }

  shockwave(pos, scale = 1) {
    const r = this.rings[this._rCursor];
    this._rCursor = (this._rCursor + 1) % MAX_RINGS;
    r.life = 0;
    r.maxLife = 0.55;
    r.size = 11 * scale;
    r.mesh.position.set(pos.x, pos.y + 0.25, pos.z);
    r.mesh.visible = true;
    r.mesh.scale.setScalar(0.1);
    r.mesh.material.opacity = 0.9;
  }

  flash(pos, scale = 1) {
    const l = this.lights[this._lCursor];
    this._lCursor = (this._lCursor + 1) % MAX_LIGHTS;
    l.life = 0;
    l.maxLife = 0.45;
    l.power = 900 * scale;
    l.active = true;
    l.light.position.set(pos.x, pos.y + 1.2, pos.z);
  }

  /**
   * Faíscas de impacto de bala. [37]
   * `esc` (0..1) escala quantidade/vida/tamanho: o brilho do cano da arma
   * usa 0.1 — 90% menos partículas e menos lag no tiro.
   */
  impact(pos, normal, color = null, esc = 1) {
    const c = color || { r: 3.0, g: 2.0, b: 0.8 };
    const n = Math.max(1, Math.round(9 * esc));
    for (let i = 0; i < n; i++) {
      const sp = 3 + Math.random() * 9;
      this._emit(pos.x, pos.y, pos.z, {
        vx: normal.x * sp + (Math.random() - 0.5) * 5,
        vy: normal.y * sp + (Math.random() - 0.5) * 5 + 1,
        vz: normal.z * sp + (Math.random() - 0.5) * 5,
        life: (0.18 + Math.random() * 0.25) * esc,
        size: 0.34 * Math.max(esc, 0.5),
        drag: 3.5,
        gravity: -12,
        r: c.r, g: c.g, b: c.b,
      });
    }
  }

  /** Poeira levantada (aterrissagem do helicóptero, derrapagem). */
  dust(pos, amount = 6, spread = 3) {
    for (let i = 0; i < amount; i++) {
      const a = Math.random() * Math.PI * 2;
      this._emit(pos.x + Math.cos(a) * spread, pos.y + 0.2, pos.z + Math.sin(a) * spread, {
        vx: Math.cos(a) * 4, vy: 0.7 + Math.random(), vz: Math.sin(a) * 4,
        life: 0.7 + Math.random() * 0.7,
        size: 2.2 + Math.random() * 2,
        grow: 3,
        drag: 1.7,
        r: 0.42, g: 0.38, b: 0.32,
      });
    }
  }

  // ------------------------------------------------------------------ update
  update(dt) {
    // ---- partículas
    let anyP = false;
    for (let i = 0; i < MAX_PARTICLES; i++) {
      if (this.pAlpha[i] <= 0.001) continue;
      const p = this.particles[i];
      p.life += dt;
      const t = p.life / p.maxLife;
      if (t >= 1) { this.pAlpha[i] = 0; anyP = true; continue; }

      const drag = Math.exp(-p.drag * dt);
      p.vx *= drag; p.vz *= drag;
      p.vy = p.vy * drag + (p.gravity || 0) * dt;

      this.pPos[i * 3] += p.vx * dt;
      this.pPos[i * 3 + 1] += p.vy * dt;
      this.pPos[i * 3 + 2] += p.vz * dt;

      this.pSize[i] = p.size + p.grow * t;
      this.pAlpha[i] = (1 - t) * (1 - t);
      anyP = true;
    }
    if (anyP) {
      this.points.geometry.attributes.position.needsUpdate = true;
      this.points.geometry.attributes.aSize.needsUpdate = true;
      this.points.geometry.attributes.aAlpha.needsUpdate = true;
      this.points.geometry.attributes.aColor.needsUpdate = true;
    }

    // ---- estilhaços
    const m = _M, q = _Q, e = _E, s = _S, off = _OFF; // [perf F3-4] temps do modulo
    let anyD = false;
    for (let i = 0; i < MAX_DEBRIS; i++) {
      const d = this.debris[i];
      if (d.life >= d.maxLife) continue;
      d.life += dt;
      anyD = true;
      if (d.life >= d.maxLife) { this.debrisMesh.setMatrixAt(i, off); continue; }

      d.v.y -= 20 * dt;
      d.p.addScaledVector(d.v, dt);
      if (d.p.y < 0.14) { d.p.y = 0.14; d.v.y *= -0.35; d.v.x *= 0.7; d.v.z *= 0.7; }
      d.rot.x += d.av.x * dt; d.rot.y += d.av.y * dt; d.rot.z += d.av.z * dt;

      const fade = 1 - Math.max(0, (d.life / d.maxLife - 0.7) / 0.3);
      e.set(d.rot.x, d.rot.y, d.rot.z);
      q.setFromEuler(e);
      s.setScalar(d.scale * fade);
      m.compose(d.p, q, s);
      this.debrisMesh.setMatrixAt(i, m);
    }
    if (anyD) this.debrisMesh.instanceMatrix.needsUpdate = true;

    // ---- ondas de choque
    for (const r of this.rings) {
      if (!r.mesh.visible) continue;
      r.life += dt;
      const t = r.life / r.maxLife;
      if (t >= 1) { r.mesh.visible = false; continue; }
      r.mesh.scale.setScalar(0.4 + t * r.size);
      r.mesh.material.opacity = (1 - t) * 0.8;
    }

    // ---- clarões (apagam pela intensidade, nunca pela visibilidade)
    for (const l of this.lights) {
      if (!l.active) continue;
      l.life += dt;
      const t = l.life / l.maxLife;
      if (t >= 1) { l.active = false; l.light.intensity = 0; continue; }
      l.light.intensity = l.power * (1 - t) * (1 - t);
    }
  }
}
