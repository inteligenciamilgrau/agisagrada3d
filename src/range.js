import * as THREE from '../vendor/three.module.js';

// ---------------------------------------------------------------------------
// CAMPO DE TIRO [debug interno]
// Ativa com ?range=1 na URL (ex: https://tiroteio.duckdns.org/?range=1).
//
// Cria um alvo de papel a 25 m na frente do spawn e DOIS marcadores 3D:
//   VERDE  -> onde o CENTRO ÓPTICO da tela aponta AGORA (câmera FINAL do frame)
//   VERMELHO -> onde a última bala REALMENTE acertou (raycast do tiro)
//
// O overlay no canto mostra o desvio (em px de tela) de cada marcador contra o
// centro do alvo. Regra de ouro: com o alvo no centro da mira, desvio 0,0 =
// tiro 100% calibrado. Desvio grande = a bala não sai do eixo da mira.
// ---------------------------------------------------------------------------
export class CampoTiro {
  constructor(scene) {
    this.scene = scene;
    this.posAlvo = new THREE.Vector3();
    this._va = new THREE.Vector3();
    this._vb = new THREE.Vector3();
    this._vc = new THREE.Vector3();
    this._vd = new THREE.Vector3();
    this._ve = new THREE.Vector3();
    this._vf = new THREE.Vector3();
    this._va = new THREE.Vector3();
    this._vb = new THREE.Vector3();
    this._vc = new THREE.Vector3();
    this._vd = new THREE.Vector3();
    this._ve = new THREE.Vector3();
    this._vf = new THREE.Vector3();
    this._ultimoTiro = null;
    this._criarAlvo();
    this._criarMarcadores();
    this._criarOverlay();
  }

  _criarAlvo() {
    const g = new THREE.Group();
    const raios = [0.18, 0.36, 0.60, 0.88];
    const cores = [0xff3040, 0xffffff, 0xff3040, 0xffffff];
    for (let i = 0; i < raios.length; i++) {
      const aro = new THREE.Mesh(
        new THREE.RingGeometry(raios[i] - 0.10, raios[i], 48),
        new THREE.MeshBasicMaterial({ color: cores[i], side: THREE.DoubleSide, depthWrite: false }),
      );
      g.add(aro);
    }
    const moldura = new THREE.Mesh(
      new THREE.BoxGeometry(2.0, 2.0, 0.10),
      new THREE.MeshBasicMaterial({ color: 0x2a4a6a }),
    );
    moldura.position.z = -0.06;
    g.add(moldura);
    const haste = new THREE.Mesh(
      new THREE.CylinderGeometry(0.07, 0.07, 2.2),
      new THREE.MeshBasicMaterial({ color: 0x4a5a6a }),
    );
    haste.position.y = -2.1;
    g.add(haste);
    this.alvo = g;
    this.scene.add(g);
  }

  _criarMarcadores() {
    const geo = new THREE.SphereGeometry(0.10, 12, 12);
    this.marcaMira = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0x00ff44, depthTest: false }));
    this.marcaMira.visible = false;
    this.scene.add(this.marcaMira);
    this.marcaTiro = new THREE.Mesh(geo.clone(), new THREE.MeshBasicMaterial({ color: 0xff3040, depthTest: false }));
    this.marcaTiro.visible = false;
    this.scene.add(this.marcaTiro);
  }

  _criarOverlay() {
    const d = document.createElement('div');
    d.id = 'range-hud';
    d.style.cssText = 'display:none;';   // [CALIBRACAO] overlay de texto escondido (campo de tiro sem poluir a tela)
    document.body.appendChild(d);
    this.overlay = d;
  }

  /** Alvo a 25 m na direção do yaw, centro a 2.4 m do chão. */
  posicionar(px, pz, yaw) {
    this.posAlvo.set(px - Math.sin(yaw) * 25, 2.4, pz - Math.cos(yaw) * 25);
    this.alvo.position.copy(this.posAlvo);
    this.alvo.rotation.set(0, yaw, 0);
  }

  /**
   * Chamado TODO FRAME com a câmera FINAL (depois de ADS/FPP/FOV).
   * Verde = centro óptico da tela; overlay = desvio contra o centro do alvo.
   */
  update(camera, col, rotulo = '') {
    if (!camera || !this.overlay) return;
    camera.updateMatrixWorld();
    const ndc = this._va.set(0, 0, 0.5).unproject(camera);
    const dir = this._vb.copy(ndc).sub(camera.position).normalize();
    const o = camera.position;
    let t = 300;
    const hit = col ? col.raycast(o.x, o.y, o.z, dir.x, dir.y, dir.z, 300) : null;
    if (hit) t = hit.t;
    const p = this._vc.copy(o).addScaledVector(dir, t);
    this.marcaMira.position.copy(p);
    this.marcaMira.visible = true;

    const dAlvo = this._vd.copy(this.posAlvo).sub(o).length();
    const pm = this._projPx(p, camera, this._ve);
    const pa = this._projPx(this.posAlvo, camera, this._vf);
    const dx = pm.x - pa.x, dy = pm.y - pa.y;
    let txt = 'CAMPO DE TIRO [debug]\n';
    txt += `modo: ${rotulo}\n`;
    txt += `dist alvo: ${dAlvo.toFixed(1)} m\n`;
    txt += `MIRA (verde) vs ALVO: dx ${dx.toFixed(0)}px  dy ${dy.toFixed(0)}px\n`;
    txt += this._ultimoTiro || 'TIRO (vermelho): (ainda não atirou)\n';
    this.overlay.textContent = txt;
  }

  /** Chamado a cada TIRO: vermelho = onde a bala acertou + desvio vs alvo. */
  marcarImpacto(origin, direction, col, camera) {
    if (!col || !camera) return;
    const o = this._va.copy(origin);
    const dir = this._vb.copy(direction).normalize();
    let t = 300;
    const hit = col.raycast(o.x, o.y, o.z, dir.x, dir.y, dir.z, 300);
    if (hit) t = hit.t;
    const p = o.addScaledVector(dir, t);
    this.marcaTiro.position.copy(p);
    this.marcaTiro.visible = true;
    camera.updateMatrixWorld();
    const pi = this._projPx(p, camera, this._vc);
    const pa = this._projPx(this.posAlvo, camera, this._vd);
    const dx = pi.x - pa.x, dy = pi.y - pa.y;
    const fora = p.distanceTo(this.posAlvo);
    this._ultimoTiro = `TIRO (vermelho) vs ALVO: dx ${dx.toFixed(0)}px  dy ${dy.toFixed(0)}px  (fora ${fora.toFixed(2)} m)\n`;
  }

  _projPx(v, camera, out) {
    out.copy(v).project(camera);
    return { x: out.x * window.innerWidth / 2, y: -out.y * window.innerHeight / 2 };
  }
}
