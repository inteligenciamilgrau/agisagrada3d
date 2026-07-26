import * as THREE from 'three';
import { MODELOS, montarModelo } from './voxeldef.js';

/**
 * ============================================================
 *  SACI-BOT — a conquista da Guilda dos Roboticistas
 * ============================================================
 *
 * Montado com os blueprints do Optimus roubados na Gigafábrica (Fase 2).
 * O roteiro do jogo 2D diz o que ele faz: *"teleporta em redemoinho e
 * ROUBA a arma dos chefões"* e *"quando você bate no chão, ele avança
 * no inimigo mais próximo"*.
 *
 * Ele e o Loro formam um par, e a regra é o PULO:
 *
 *   atirar NO CHÃO  -> o Saci some num redemoinho e reaparece atrás do
 *                      inimigo mais próximo
 *   atirar NO AR    -> o Loro mergulha
 *
 * Uma tecla, dois golpes, decididos pelos pés. É melhor que deixar o
 * Saci lutando sozinho: assim ele é uma arma que você aprende a usar,
 * e não um aliado que resolve a luta sem você.
 *
 * Ele só entra depois que o Ilon cai. Enquanto a peça INVESTIMENTO não
 * estiver no Plano, o Saci fica desligado.
 */

const ALVO_LADO = 1.6;         // fica à esquerda do Bob (o Loro fica à direita)
const ALVO_ALTURA = 0.1;
export const ALCANCE_SACI = 26;   // distância máxima do teleporte
/*
 * Recarga curta de propósito.
 *
 * Com 3,4 s o Saci parecia QUEBRADO: o jogador atira várias vezes por
 * segundo, e quase todo tiro no chão caía num no-op silencioso. Quem
 * está jogando não vê "recarregando", vê "não funciona". 1,6 s deixa o
 * golpe sair com frequência suficiente para se aprender a contar com
 * ele, sem virar automático.
 */
const RECARGA = 1.6;

export class SaciBot {
  constructor(scene) {
    const m = montarModelo(MODELOS.sacibot);
    this.root = m.root;
    this.corpo = m.corpo;
    scene.add(this.root);
    this.root.visible = false;

    // o redemoinho: um cone de partículas que aparece no teleporte
    const geo = new THREE.ConeGeometry(0.9, 2.6, 10, 1, true);
    this.redemoinho = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      color: 0xc8a86a, transparent: true, opacity: 0,
      side: THREE.DoubleSide, depthWrite: false,
      blending: THREE.AdditiveBlending, toneMapped: false,
    }));
    this.redemoinho.position.y = 1.3;
    this.root.add(this.redemoinho);

    this.alvoPos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.t = 0;
    this.recarga = 0;
    this.estado = 'segue';     // segue | some | bate | volta
    this.fase = 0;             // 0..1 dentro do estado
    this.presa = null;
    this.onAcerto = null;
    this.ativo = false;
    this._iniciado = false;
  }

  /** Liga o Saci (peça INVESTIMENTO conquistada). */
  ligar() {
    this.ativo = true;
    this.root.visible = true;
  }

  desligar() {
    this.ativo = false;
    this.root.visible = false;
    this.estado = 'segue';
    this.presa = null;
  }

  get podeAtacar() { return this.ativo && this.estado === 'segue' && this.recarga <= 0; }

  /** Manda o Saci em cima de um inimigo (atirar com os pés no chão). */
  atacar(foe) {
    if (!this.podeAtacar || !foe || !foe.vivo) return false;
    this.presa = foe;
    this.estado = 'some';
    this.fase = 0;
    return true;
  }

  /**
   * @param {THREE.Vector3} dono   posição do Bob (nos pés)
   * @param {number} yaw           rumo do Bob
   */
  update(dt, dono, yaw) {
    if (!this.ativo) return;
    this.t += dt;
    this.recarga = Math.max(0, this.recarga - dt);

    const sn = Math.sin(yaw), cs = Math.cos(yaw);
    const p = this.root.position;

    switch (this.estado) {
      case 'segue': {
        this.alvoPos.set(
          dono.x - sn * 0.6 - cs * ALVO_LADO,
          dono.y + ALVO_ALTURA + Math.sin(this.t * 2.4) * 0.12,
          dono.z - cs * 0.6 + sn * ALVO_LADO,
        );
        break;
      }

      case 'some': {
        // encolhe girando: some no redemoinho
        this.fase = Math.min(1, this.fase + dt * 4.5);
        this.corpo.scale.setScalar(Math.max(0.02, 1 - this.fase));
        this.redemoinho.material.opacity = Math.sin(this.fase * Math.PI) * 0.75;
        if (this.fase >= 1) {
          const alvo = this.presa;
          if (!alvo || !alvo.vivo) { this.estado = 'volta'; this.fase = 0; break; }
          // reaparece ATRÁS do inimigo — quem rouba não chega pela frente
          const a = alvo.root.position;
          const dx = a.x - dono.x, dz = a.z - dono.z;
          const n = Math.hypot(dx, dz) || 1;
          p.set(a.x + (dx / n) * 1.4, a.y + 0.1, a.z + (dz / n) * 1.4);
          this.estado = 'bate';
          this.fase = 0;
        }
        break;
      }

      case 'bate': {
        this.fase = Math.min(1, this.fase + dt * 4.0);
        this.corpo.scale.setScalar(Math.min(1, this.fase * 1.6));
        this.redemoinho.material.opacity = (1 - this.fase) * 0.75;
        if (this.presa) {
          const a = this.presa.root.position;
          this.root.rotation.y = Math.atan2(a.x - p.x, a.z - p.z);
        }
        if (this.fase >= 1) {
          if (this.presa && this.presa.vivo && this.onAcerto) this.onAcerto(this.presa);
          this.presa = null;
          this.estado = 'volta';
          this.fase = 0;
          this.recarga = RECARGA;
        }
        break;
      }

      case 'volta': {
        this.corpo.scale.setScalar(1);
        this.redemoinho.material.opacity = 0;
        this.alvoPos.set(
          dono.x - sn * 0.6 - cs * ALVO_LADO,
          dono.y + ALVO_ALTURA,
          dono.z - cs * 0.6 + sn * ALVO_LADO,
        );
        if (p.distanceTo(this.alvoPos) < 1.5) this.estado = 'segue';
        break;
      }
    }

    if (!this._iniciado) { p.copy(this.alvoPos); this._iniciado = true; }

    // ---- deslocamento: mola, como o Loro, mas mais dura (é robô)
    if (this.estado === 'segue' || this.estado === 'volta') {
      const k = this.estado === 'volta' ? 90 : 34, amort = 11;
      this.vel.x += ((this.alvoPos.x - p.x) * k - this.vel.x * amort) * dt;
      this.vel.y += ((this.alvoPos.y - p.y) * k - this.vel.y * amort) * dt;
      this.vel.z += ((this.alvoPos.z - p.z) * k - this.vel.z * amort) * dt;
      p.addScaledVector(this.vel, dt);
      this.root.rotation.y = yaw;
    }

    // ---- ele tem UMA perna: vive girando, como o Saci do folclore
    this.corpo.rotation.y += dt * (this.estado === 'some' ? 26 : 3.2);
    this.redemoinho.rotation.y -= dt * 9;
  }

  /** Reposiciona junto do dono (usado no teleporte de entrada de fase). */
  reposicionar() { this._iniciado = false; }

  dispose() { this.root.removeFromParent(); }
}
