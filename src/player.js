import * as THREE from 'three';
import { PLAYER, CURB_H } from './config.js';
import { clamp, damp, dampAngle } from './utils.js';
import { VoxelFigure } from './ent/voxel.js';
import { HUMANOIDES } from './ent/voxeldef.js';
import { Loro } from './ent/loro.js';
import { SaciBot } from './ent/sacibot.js';

/**
 * [14] Jogador em terceira pessoa. [11] WASD relativo à câmera,
 * [30] Shift corre, [36] espaço pula, [31] colide com prédios/postes/árvores.
 *
 * O jogador é o **Bob "Indiana" Milgrau**: boneco voxel com jaqueta de
 * couro, fedora, óculos e o Prompt Mágico na mão. Ele usa o mesmo
 * `VoxelFigure` dos inimigos e expõe a mesma API do antigo `Human`
 * (`root`, `pivot`, `update`, `carrying`), então nada em volta mudou.
 */
export class Player {
  constructor(scene, collision) {
    this.col = collision;

    this.human = new VoxelFigure(HUMANOIDES.bob);
    this.human.root.name = 'player';
    scene.add(this.human.root);

    // o Loro Estocástico voa junto — mascote da comunidade, não enfeite
    this.loro = new Loro(scene);
    // o Saci-Bot só entra depois que o Ilon cai (peça INVESTIMENTO)
    this.saci = new SaciBot(scene);

    this.pos = new THREE.Vector3(0, CURB_H, 0);
    this.vy = 0;
    this.yaw = 0;
    this.speed = 0;
    this.grounded = true;
    this.inWater = false;
    this.visible = true;

    // [50] pacote que aparece nas mãos
    this.pack = this._makePackage();
    this.pack.visible = false;
    this.human.pivot.add(this.pack);

    this._move = new THREE.Vector3();

    /** Avisos para quem faz barulho (ver `game.js`). */
    this.onPulo = null;
    this.onPousar = null;
  }

  _makePackage() {
    const g = new THREE.Group();
    const box = new THREE.Mesh(
      new THREE.BoxGeometry(0.34, 0.28, 0.30),
      new THREE.MeshStandardMaterial({ color: 0xc08a4a, roughness: 0.9, metalness: 0.02 }),
    );
    box.castShadow = true;
    g.add(box);
    // fita adesiva cruzada
    const tapeMat = new THREE.MeshStandardMaterial({ color: 0xe8dcc0, roughness: 0.7 });
    const t1 = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.06, 0.02), tapeMat);
    t1.position.z = 0.152;
    g.add(t1);
    const t2 = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.30, 0.02), tapeMat);
    t2.position.z = 0.152;
    g.add(t2);
    const t3 = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.06, 0.02), tapeMat);
    t3.position.y = 0.142; t3.rotation.x = Math.PI / 2;
    g.add(t3);

    g.position.set(0, 1.16, 0.36);      // à frente do peito, entre as mãos
    return g;
  }

  setCarrying(on) {
    this.human.carrying = on;
    this.pack.visible = on;
  }

  setVisible(v) {
    this.visible = v;
    this.human.root.visible = v;
    this.loro.visible = v;
    if (!v) this.saci.root.visible = false;
    else if (this.saci.ativo) this.saci.root.visible = true;
  }

  /**
   * Esconde só o CORPO, mantendo o Loro em cena.
   *
   * É o que a primeira pessoa precisa: dentro da fase a câmera fica na
   * cabeça do Bob, então o corpo dele atrapalharia — mas o papagaio
   * continua voando ao lado, visível, que é metade da graça.
   */
  setCorpoVisivel(v) {
    this.human.root.visible = v;
  }

  teleport(x, z, y = null) {
    this.pos.set(x, y ?? this.col.groundHeightAt(x, z), z);
    this.vy = 0;
    this.human.root.position.copy(this.pos);
    // os companheiros reaparecem junto, sem atravessar o mapa voando até lá
    this.loro._iniciado = false;
    this.saci.reposicionar();
  }

  /** Altura do piso sob o jogador (calçada, ponte, laje de prédio ou água). */
  _floorAt(x, z) {
    // a altura atual desempata plataformas empilhadas (estrada em espiral)
    let g = this.col.groundHeightAt(x, z, this.pos.y);
    // [46] permite andar em laje quando desce de helicóptero
    const roof = this.col.roofHeightAt(x, z);
    if (roof > g && this.pos.y >= roof - 0.35) g = roof;
    return g;
  }

  update(dt, input, camYaw, frozen = false) {
    if (frozen) {
      this.human.update(dt, 0);
      this.loro.update(dt, this.pos, this.yaw, 0);
      this.saci.update(dt, this.pos, this.yaw);
      return;
    }

    // ------------------------------------------------ direção relativa à câmera
    const fx = -Math.sin(camYaw), fz = -Math.cos(camYaw);
    const rx = -fz, rz = fx;

    const ax = input.axes;
    let dx = fx * ax.forward + rx * ax.strafe;
    let dz = fz * ax.forward + rz * ax.strafe;
    const mag = Math.hypot(dx, dz);
    if (mag > 0.001) { dx /= mag; dz /= mag; }

    this.inWater = this.col.isInWater(this.pos.x, this.pos.z);

    // [30] Shift corre
    let maxSpeed = input.running ? PLAYER.runSpeed : PLAYER.walkSpeed;
    if (this.inWater) maxSpeed *= 0.45;

    /*
     * A velocidade é PROPORCIONAL à deflexão do comando.
     *
     * No teclado isso não muda nada — W está apertado ou não, e a
     * magnitude é sempre 1. Quem ganha é o analógico da tela: empurrar
     * o polegar um terço do caminho faz o Bob andar devagar, que é a
     * única coisa que separa um analógico de um direcional de quatro
     * setas desenhado em círculo.
     */
    const wanted = maxSpeed * Math.min(1, mag);
    this.speed = damp(this.speed, wanted, PLAYER.accel / Math.max(1, maxSpeed), dt);

    /*
     * [11][14] O MOUSE define para onde o jogador olha, não o movimento.
     * O corpo acompanha a câmera mesmo parado, então WASD vira deslocamento
     * relativo: A e D andam de lado sem virar as costas, e o tiro sai sempre
     * na direção em que o personagem está encarando.
     *
     * A frente da câmera no chão é (-sin, -cos) e o personagem olha para +Z,
     * logo a rotação do corpo é o yaw da câmera + PI.
     */
    this.yaw = dampAngle(this.yaw, camYaw + Math.PI, PLAYER.turnSmooth, dt);
    if (mag > 0.001) this._move.set(dx, 0, dz);

    // ------------------------------------------------ [36] pulo e gravidade
    if (this.grounded && input.jumping && !this.inWater) {
      this.vy = PLAYER.jumpSpeed;
      this.grounded = false;
      if (this.onPulo) this.onPulo();
    }
    this.vy -= PLAYER.gravity * dt;

    // ------------------------------------------------ integra e resolve colisão
    if (this.speed > 0.01 && mag > 0.001) {
      this.pos.x += this._move.x * this.speed * dt;
      this.pos.z += this._move.z * this.speed * dt;
    }
    const yAntes = this.pos.y;
    this.pos.y += this.vy * dt;
    /*
     * A velocidade de queda tem que ser lida AQUI.
     *
     * Logo abaixo, o assentamento no piso (a correção do deck do Pão de
     * Açúcar) zera `vy` antes que a checagem de pouso rode — e com ela
     * some a única informação que separa descer um meio-fio de despencar
     * de 40 m. Guardar antes é o que deixa o baque ter peso.
     */
    const quedaAgora = Math.max(0, -this.vy);

    /*
     * ASSENTA NO PISO ANTES DE RESOLVER OS SÓLIDOS.
     *
     * Sem isto, cair rápido sobre uma laje joga o jogador para FORA dela.
     * A sequência do bug: descendo a 30 m/s ele afunda meio metro num
     * quadro só e termina abaixo do topo da caixa que sustenta a laje;
     * `resolveCircle` ignora sólidos com topo abaixo dos pés, mas com
     * tolerância de 6 cm — muito menos que o meio metro percorrido. A
     * caixa volta a valer, ele é empurrado horizontalmente para fora do
     * deck e cai lá embaixo, atravessando o chão que estava pisando.
     *
     * Foi assim que se perdia o deck do Pão de Açúcar chegando de cima.
     * É o mesmo bug que o helicóptero já teve ao pousar em laje, e a
     * correção é a mesma: primeiro assenta em quem estava por baixo,
     * depois resolve os sólidos.
     *
     * A condição "já vinha por cima" é necessária: sem ela, esbarrar na
     * lateral de uma laje teleportaria o jogador para cima dela.
     */
    const pisoAntes = this._floorAt(this.pos.x, this.pos.z);
    if (yAntes >= pisoAntes - 0.05 && this.pos.y < pisoAntes) {
      this.pos.y = pisoAntes;
      this.vy = 0;
    }

    // [31] prédios, postes, árvores e guarda-corpos empurram o jogador
    this.col.resolveCircle(this.pos, PLAYER.radius);

    const floor = this._floorAt(this.pos.x, this.pos.z);
    if (this.pos.y <= floor) {
      /*
       * A força do baque vem da velocidade de QUEDA lida antes de zerar.
       * Descer um meio-fio e despencar de 40 m produzem o mesmo evento
       * "encostou no chão"; só a velocidade separa os dois.
       */
      this.pos.y = floor;
      this.vy = 0;
      // só conta como pouso quem vinha CAINDO: andando no plano a
      // gravidade também empurra para baixo todo quadro, e sem este
      // limiar cada passo viraria um baque
      if (!this.grounded && quedaAgora > 1.2 && this.onPousar) {
        this.onPousar(Math.min(1, quedaAgora / 22));
      }
      this.grounded = true;
    } else {
      this.grounded = false;
    }

    // ------------------------------------------------ malha
    this.human.root.position.copy(this.pos);
    this.human.root.rotation.y = this.yaw;
    this.human.update(dt, this.grounded ? this.speed : this.speed * 0.35);
    this.loro.update(dt, this.pos, this.yaw, this.speed);
    this.saci.update(dt, this.pos, this.yaw);

    // afunda um pouco na água
    if (this.inWater) this.human.root.position.y -= 0.12;
  }

  /**
   * [60] MODO DEUS: voo livre pelo mapa.
   *
   * É o mesmo corpo do jogador — só a integração muda: sem gravidade, sem
   * colisão e sem pulo. Os controles copiam os do helicóptero de propósito
   * (`Espaço` sobe, `Shift` desce), porque é o que a mão já sabe fazer.
   *
   * O único limite que sobra é o chão: voar POR DENTRO do terreno deixaria a
   * câmera dentro da rocha, sem referência nenhuma de para onde voltar.
   */
  updateFly(dt, input, camYaw) {
    const fx = -Math.sin(camYaw), fz = -Math.cos(camYaw);
    const rx = -fz, rz = fx;

    const ax = input.axes;
    let dx = fx * ax.forward + rx * ax.strafe;
    let dz = fz * ax.forward + rz * ax.strafe;
    const mag = Math.hypot(dx, dz);
    if (mag > 0.001) { dx /= mag; dz /= mag; }

    const turbo = input.boosting ? PLAYER.flyBoost : 1;
    const wanted = PLAYER.flySpeed * turbo * Math.min(1, mag);
    this.speed = damp(this.speed, wanted, 8, dt);
    if (mag > 0.001) this._move.set(dx, 0, dz);

    this.pos.x += this._move.x * this.speed * dt;
    this.pos.z += this._move.z * this.speed * dt;

    // descer é comando próprio: no toque, o analógico no talo quer dizer
    // "para a frente, depressa", não "afunda"
    const sobe = (input.jumping ? 1 : 0) - (input.descer ? 1 : 0);
    this.vy = damp(this.vy, sobe * PLAYER.flyUpSpeed * turbo, 8, dt);
    this.pos.y += this.vy * dt;

    const floor = this._floorAt(this.pos.x, this.pos.z);
    if (this.pos.y < floor) { this.pos.y = floor; this.vy = Math.max(0, this.vy); }
    if (this.pos.y > 430) { this.pos.y = 430; this.vy = Math.min(0, this.vy); }

    this.yaw = dampAngle(this.yaw, camYaw + Math.PI, PLAYER.turnSmooth, dt);
    this.grounded = false;
    this.inWater = false;

    this.human.root.position.copy(this.pos);
    this.human.root.rotation.y = this.yaw;
    this.human.update(dt, 0);              // pernas paradas: está flutuando
    this.loro.update(dt, this.pos, this.yaw, PLAYER.flySpeed * 0.3);
    this.saci.update(dt, this.pos, this.yaw);
  }

  /** Ponto que a câmera acompanha (altura dos ombros). */
  focusPoint(out = new THREE.Vector3()) {
    return out.set(this.pos.x, this.pos.y + 1.48, this.pos.z);
  }

  get position() { return this.pos; }
}
