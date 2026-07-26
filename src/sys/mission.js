import * as THREE from 'three';
import { GAME } from '../config.js';
import { dist2D, rngInt, makeRng } from '../utils.js';

function iconTexture(emoji, color) {
  const S = 128;
  const c = document.createElement('canvas');
  c.width = S; c.height = S;
  const x = c.getContext('2d');
  x.beginPath();
  x.arc(S / 2, S / 2, S * 0.42, 0, Math.PI * 2);
  x.fillStyle = color;
  x.fill();
  x.lineWidth = 7;
  x.strokeStyle = 'rgba(0,0,0,.35)';
  x.stroke();
  x.font = '62px "Segoe UI Emoji", sans-serif';
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.fillText(emoji, S / 2, S / 2 + 4);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * [5] Uma pessoa no mapa carrega o objeto que o jogador precisa buscar.
 * [6] Ao pegar, ele leva para outra pessoa.
 * [7] Cada entrega vale 10 pontos e +30 segundos.
 */
export class MissionSystem {
  constructor(scene, peds, seed = 991) {
    this.scene = scene;
    this.peds = peds;
    this.rng = makeRng(seed);

    this.state = 'collect';
    this.carrier = null;     // quem está com o pacote
    this.receiver = null;    // quem vai receber
    this.deliveries = 0;
    this.score = 0;

    this.onPickup = null;
    this.onDeliver = null;

    this._buildMarker();
  }

  _buildMarker() {
    this.marker = new THREE.Group();
    this.marker.visible = false;
    this.scene.add(this.marker);

    /*
     * Feixe baixo, terminando pouco acima da cabeça da pessoa. Um pilar de
     * dezenas de metros tapava a cidade e poluía a tela; quem indica o alvo
     * de longe é o ícone (que ignora profundidade e aparece através de tudo)
     * e o minimapa [10].
     */
    const BEAM_H = 2.8;
    const beamGeo = new THREE.CylinderGeometry(0.55, 0.55, BEAM_H, 14, 1, true);
    this.beamMat = new THREE.MeshBasicMaterial({
      color: 0xffb020, transparent: true, opacity: 0.30,
      side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    this.beam = new THREE.Mesh(beamGeo, this.beamMat);
    this.beam.position.y = BEAM_H / 2;
    this.marker.add(this.beam);

    // base pulsante no chão
    const ringGeo = new THREE.RingGeometry(0.85, 1.25, 28);
    this.ringMat = new THREE.MeshBasicMaterial({
      color: 0xffb020, transparent: true, opacity: 0.75,
      side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    this.ring = new THREE.Mesh(ringGeo, this.ringMat);
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.08;
    this.marker.add(this.ring);

    // ícone flutuante
    this.iconPickup = iconTexture('📦', '#ffb020');
    this.iconDeliver = iconTexture('🏁', '#3ddc84');
    this.icon = new THREE.Sprite(new THREE.SpriteMaterial({
      map: this.iconPickup, transparent: true, depthTest: false, toneMapped: false,
    }));
    // um pouco maior para compensar o feixe curto: é ele que marca o alvo de longe
    this.icon.scale.set(1.8, 1.8, 1);
    this.icon.position.y = 3.4;
    this.icon.renderOrder = 20;
    this.marker.add(this.icon);

    this._t = 0;
  }

  // ------------------------------------------------------------------ ciclo
  start() {
    this.state = 'collect';
    this.score = 0;
    this.deliveries = 0;
    this._clearFlags();
    this._pickCarrier();
  }

  _clearFlags() {
    for (const p of this.peds.peds) {
      p.hasPackage = false;
      p.isTarget = false;
    }
  }

  _randomPed(exclude = null) {
    const list = this.peds.peds.filter((p) => p.alive && p !== exclude);
    if (!list.length) return null;
    return list[rngInt(this.rng, 0, list.length - 1)];
  }

  _pickCarrier() {
    this.carrier = this._randomPed();
    this.receiver = null;
    if (this.carrier) {
      this.carrier.hasPackage = true;
      this.carrier.human.armGesture = 1;      // acena para ser encontrado
    }
    this._styleMarker('collect');
  }

  _pickReceiver() {
    this.receiver = this._randomPed(this.carrier);
    if (this.receiver) {
      this.receiver.isTarget = true;
      this.receiver.human.armGesture = 1;
    }
    this._styleMarker('deliver');
  }

  _styleMarker(mode) {
    const collect = mode === 'collect';
    const color = collect ? 0xffb020 : 0x3ddc84;
    this.beamMat.color.setHex(color);
    this.ringMat.color.setHex(color);
    this.icon.material.map = collect ? this.iconPickup : this.iconDeliver;
    this.icon.material.needsUpdate = true;
  }

  /** Alvo atual (para HUD e minimapa). */
  get target() {
    return this.state === 'collect' ? this.carrier : this.receiver;
  }

  get targetPosition() {
    const t = this.target;
    return t && t.alive ? t.human.root.position : null;
  }

  /** Se o portador/destinatário morrer, a missão se reorganiza sozinha. */
  validate() {
    if (this.state === 'collect' && (!this.carrier || !this.carrier.alive)) {
      this._pickCarrier();
    } else if (this.state === 'deliver' && (!this.receiver || !this.receiver.alive)) {
      this._pickReceiver();
    }
  }

  /**
   * @param {THREE.Vector3} playerPos
   * @param {boolean} flying [51] voando alto o alcance é bem maior
   */
  update(dt, playerPos, flying) {
    this.validate();
    this._t += dt;

    const target = this.target;
    if (!target || !target.alive) {
      this.marker.visible = false;
      return null;
    }

    // ---- marcador acompanha a pessoa
    const p = target.human.root.position;
    this.marker.visible = true;
    this.marker.position.set(p.x, 0.1, p.z);
    this.icon.position.y = 3.4 + Math.sin(this._t * 2.4) * 0.14;
    const s = 1 + Math.sin(this._t * 3.2) * 0.12;
    this.ring.scale.set(s, s, 1);
    this.ringMat.opacity = 0.55 + Math.sin(this._t * 3.2) * 0.2;

    // ---- alcance de interação
    const range = flying ? GAME.airPickupRange : GAME.pickupRange;
    const dHoriz = dist2D(playerPos.x, playerPos.z, p.x, p.z);
    const dVert = Math.abs(playerPos.y - p.y);
    const inRange = flying
      ? dHoriz < range && dVert < 120         // [51] pega/entrega mesmo voando por cima
      : dHoriz < range && dVert < 4;

    if (!inRange) return { distance: dHoriz, inRange: false };

    if (this.state === 'collect') {
      // [5] pegou o objeto
      target.hasPackage = false;
      target.human.armGesture = 0;
      this.carrier = target;
      this.state = 'deliver';
      this._pickReceiver();
      const ev = { type: 'pickup', ped: target, distance: dHoriz, inRange: true };
      if (this.onPickup) this.onPickup(ev);
      return ev;
    }

    // [6][7] entregou
    target.isTarget = false;
    target.human.armGesture = 0;
    this.deliveries++;
    this.score += GAME.deliveryPoints;
    this.state = 'collect';
    this._pickCarrier();
    const ev = {
      type: 'deliver', ped: target, distance: dHoriz, inRange: true,
      points: GAME.deliveryPoints, timeBonus: GAME.deliveryTimeBonus,
    };
    if (this.onDeliver) this.onDeliver(ev);
    return ev;
  }

  get pickupNumber() {
    return this.state === 'collect' && this.carrier ? this.carrier.number : null;
  }

  get deliverNumber() {
    return this.state === 'deliver' && this.receiver ? this.receiver.number : null;
  }

  reset() {
    this.state = 'collect';
    this.score = 0;
    this.deliveries = 0;
    this.carrier = null;
    this.receiver = null;
    this.marker.visible = false;
  }
}
