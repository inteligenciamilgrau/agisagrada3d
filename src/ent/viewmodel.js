import * as THREE from '../../vendor/three.module.js';
import { voxMaterial, VX } from './voxel.js';

const POS_REPOUSO = new THREE.Vector3(0.26, -0.22, -0.52);

const POS_ADS = new THREE.Vector3(0, -0.22, -0.45);   // [CODM-FIX] arma ABAIXO do centro: o slide fica abaixo da linha de visao (nao tapa o alvo)

export class ViewModel {
  constructor(camera, scene) {
    this.cam = camera;

    if (!camera.parent) scene.add(camera);

    this.root = new THREE.Group();
    this.root.position.copy(POS_REPOUSO);
    this.root.visible = false;

    camera.add(this.root);

    this._montar();

    this.t = 0;
    this.coice = 0;      // 0..1, decai depois do tiro
    this.balanco = 0;
    this.ads = 0;        // 0..1, quão erguida a arma está no zoom de mira
    this.transicao = 1;  // [CODM] 0..1 da entrada em 1a pessoa (arma sobe da borda)
    this._adsQuero = false;
  }

  _montar() {
    const g = new THREE.Group();
    g.scale.setScalar(0.36);
    this.root.add(g);

    const bloco = (w, h, d, x, y, z, mat) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w * VX, h * VX, d * VX), mat);
      m.position.set(x * VX, y * VX, z * VX);
      g.add(m);
      return m;
    };

    const pele = voxMaterial(0xd9a066);
    const manga = voxMaterial(0x6b4423);          // jaqueta de couro do Bob
    const ferro = voxMaterial(0x2a2f38, { metal: 0.45, aspereza: 0.5 });
    const escuro = voxMaterial(0x16191f, { metal: 0.3, aspereza: 0.6 });
    const dourado = voxMaterial(0xffb020, { metal: 0.7, aspereza: 0.28, emissivo: 0.55 });

    bloco(4, 4, 12, 0, -3, 4, manga);

    bloco(4.4, 4.4, 4, 0, -1.4, -2, pele);

    bloco(5, 7, 3, 0, -0.5, -4.5, ferro);

    bloco(4, 3.4, 3, 0, 2.6, -4.5, escuro);

    bloco(3, 3, 12, 0, 0.9, -9.5, escuro);

    bloco(1.4, 1.6, 2, 0, 3.7, -8, escuro);

    bloco(5.4, 1.4, 3.4, 0, -2.2, -4.5, dourado);

    bloco(2.6, 3, 2.6, 0, -3.8, -4, escuro);
  }

  set visible(v) { this.root.visible = v; }
  get visible() { return this.root.visible; }

  darCoice() { this.coice = 1; }

  setAds(on) { this._adsQuero = !!on; }

  setTransicao(t) { this.transicao = t; }   // [CODM] 0..1 conforme a câmera chega aos olhos

  update(dt, vel = 0) {
    if (!this.root.visible) return;
    this.t += dt;
    this.coice = Math.max(0, this.coice - dt * 5.5);

    this.balanco = damp(this.balanco, Math.min(1, vel / 5), 6, dt);
    const b = this.balanco;
    const bx = Math.sin(this.t * 7.5) * 0.014 * b;
    const by = Math.abs(Math.cos(this.t * 7.5)) * 0.016 * b;

    this.ads = damp(this.ads, this._adsQuero ? 1 : 0, 16, dt);
    const a = this.ads;
    const pos = new THREE.Vector3().lerpVectors(POS_REPOUSO, POS_ADS, a);

    const c = this.coice * this.coice;
    const recVisual = c * (1 - a * 0.7);   // [FIXO] no ADS o coice e minimo: a mira/camera ficam paradas no centro
    this.root.position.set(
      pos.x + bx,
      pos.y - by + recVisual * 0.03 - (1 - this.transicao) * 0.15,
      pos.z + recVisual * 0.06,
    );
    this.root.rotation.x = recVisual * 0.25 + a * 0.17;
    this.root.rotation.z = Math.sin(this.t * 3.7) * 0.02 * b * (1 - a);
  }
}

function damp(a, b, lambda, dt) {
  return b + (a - b) * Math.exp(-lambda * dt);
}
