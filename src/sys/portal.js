import * as THREE from 'three';
import { PHASES, liberada } from '../story/story.js';
import { CORCOVADO, PAO } from '../world/landmarks.js';
import { HERCILIO } from '../world/brasil.js';
import { CABLE } from '../config.js';

/**
 * Altura de referência para achar o chão de cada portal.
 *
 * `groundHeightAt` recebe um `refY` para desempatar plataformas
 * empilhadas, e várias delas RECUSAM referências distantes: a do
 * mirante do Cristo devolve `null` se o pedido vier de mais de 6 m de
 * distância vertical, justamente para não teleportar quem passa por
 * baixo. Perguntar de uma altura genérica fazia o mirante recusar, a
 * busca cair no terreno lá embaixo e o portal do Trunfo nascer
 * ENTERRADO no pé do morro — inalcançável, com a campanha travada na
 * fase 1.
 *
 * Então cada portal diz de onde perguntar.
 */
const REF_Y = {
  mirante: () => CORCOVADO.topY - 1,                  // piso do mirante do Cristo
  topo: () => PAO.topY - 3 + CABLE.rise,              // deck da estação do Pão de Açúcar
  ponte: () => HERCILIO.deckY,                        // tabuleiro da Hercílio Luz
};

/**
 * ============================================================
 *  Portais das fases
 * ============================================================
 *
 * O mapa-múndi do jogo 2D virou uma viagem de verdade: cada fase tem um
 * portal num ponto do mundo aberto, e chegar até lá é dirigir (ou voar).
 * Os pontos são os marcos que a cidade já tem — o mirante do Cristo, o
 * Museu do Olho, o Pelourinho, a Hercílio Luz, o Pão de Açúcar.
 *
 * Um portal trancado aparece cinza e diz o que falta. Deixar visível o
 * que ainda não dá para jogar é de propósito: é o que faz o jogador
 * querer voltar.
 */

const RAIO_ATIVACAO = 6.5;

export class PortalSystem {
  constructor(scene, col, estado) {
    this.scene = scene;
    this.col = col;
    this.estado = estado;
    this.portais = [];
    this.perto = null;
    this.t = 0;

    this.el = document.createElement('div');
    this.el.id = 'portal-prompt';
    this.el.className = 'hidden';
    document.body.appendChild(this.el);

    this._construir();
  }

  _construir() {
    for (const fase of PHASES) {
      const d = fase.portal;
      // ao nível do chão (2 m) quando a fase não pede um marco alto
      const ref = REF_Y[d.y] ? REF_Y[d.y]() : 2;
      const y = this.col.groundHeightAt(d.x, d.z, ref) ?? 0;

      const g = new THREE.Group();
      g.position.set(d.x, y, d.z);
      this.scene.add(g);

      /*
       * Feixe de luz. Era de 90 m — alto demais: virava um poste de luz
       * atravessando a cidade inteira e competia com os prédios.
       *
       * 26 m basta: continua sendo visto de longe, do carro ou do
       * helicóptero, porque o que marca de verdade é o BLIP NO RADAR e
       * o anel pulsante no chão. O feixe é confirmação visual de perto,
       * não o meio de encontrar.
       */
      const matFeixe = new THREE.MeshBasicMaterial({
        color: 0xffb020, transparent: true, opacity: 0.2,
        side: THREE.DoubleSide, depthWrite: false,
        blending: THREE.AdditiveBlending, toneMapped: false,
      });
      const feixe = new THREE.Mesh(
        new THREE.CylinderGeometry(1.1, 1.9, 26, 16, 1, true), matFeixe,
      );
      feixe.position.y = 13;
      g.add(feixe);

      const matAnel = new THREE.MeshBasicMaterial({
        color: 0xffb020, transparent: true, opacity: 0.8,
        side: THREE.DoubleSide, depthWrite: false,
        blending: THREE.AdditiveBlending, toneMapped: false,
      });
      const anel = new THREE.Mesh(new THREE.RingGeometry(2.2, 3.1, 32), matAnel);
      anel.rotation.x = -Math.PI / 2;
      anel.position.y = 0.12;
      g.add(anel);

      this.portais.push({ fase, grupo: g, feixe, anel, matFeixe, matAnel, x: d.x, y, z: d.z });
    }
  }

  _cor(p) {
    if (this.estado.fasesVencidas[p.fase.key]) return 0x3ddc84;   // já venceu
    if (!liberada(p.fase, this.estado)) return 0x6b7280;          // trancada
    return 0xffb020;                                              // disponível
  }

  update(dt, jogador) {
    this.t += dt;
    let maisPerto = null, melhorD = Infinity;

    for (const p of this.portais) {
      const cor = this._cor(p);
      p.matFeixe.color.setHex(cor);
      p.matAnel.color.setHex(cor);

      const pulso = 1 + Math.sin(this.t * 2.6) * 0.1;
      p.anel.scale.set(pulso, pulso, 1);
      p.matAnel.opacity = 0.5 + Math.sin(this.t * 2.6) * 0.25;
      p.feixe.rotation.y += dt * 0.35;

      const d = Math.hypot(jogador.x - p.x, jogador.z - p.z);
      const dy = Math.abs(jogador.y - p.y);
      if (d < RAIO_ATIVACAO && dy < 12 && d < melhorD) { melhorD = d; maisPerto = p; }
    }

    this.perto = maisPerto;
    this._prompt(maisPerto);
    return maisPerto;
  }

  _prompt(p) {
    if (!p) { this.el.classList.add('hidden'); return; }
    const venceu = this.estado.fasesVencidas[p.fase.key];
    const aberta = liberada(p.fase, this.estado);

    let sub;
    if (!aberta) {
      const faltam = p.fase.requires.filter((k) => !this.estado.conquistas[k]).length;
      sub = `trancada — faltam ${faltam} peças do Plano`;
    } else if (venceu) {
      sub = '<kbd>F</kbd> jogar de novo';
    } else {
      sub = '<kbd>F</kbd> entrar';
    }

    this.el.innerHTML =
      `<div class="pp-title">${p.fase.flag} ${p.fase.portal.label}</div>` +
      `<div class="pp-sub">${sub}</div>`;
    this.el.classList.remove('hidden');
  }

  /**
   * Marcadores para o minimapa. `proxima` destaca a fase que o Plano
   * está apontando — é o que transforma "existe um portal ali" em
   * "é PARA LÁ que você vai agora".
   */
  marcadores(faseProxima) {
    return this.portais.map((p) => ({
      x: p.x, z: p.z,
      venceu: !!this.estado.fasesVencidas[p.fase.key],
      aberta: liberada(p.fase, this.estado),
      proxima: !!faseProxima && faseProxima.key === p.fase.key,
    }));
  }

  /** O portal em que o jogador pode entrar agora (ou null). */
  get disponivel() {
    if (!this.perto) return null;
    return liberada(this.perto.fase, this.estado) ? this.perto : null;
  }

  esconder() { this.el.classList.add('hidden'); }

  set visivel(v) {
    for (const p of this.portais) p.grupo.visible = v;
    if (!v) this.esconder();
  }
}
