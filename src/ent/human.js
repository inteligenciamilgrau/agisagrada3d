import * as THREE from '../../vendor/three.module.js';
import { mergeGeometries } from '../../vendor/jsm/utils/BufferGeometryUtils.js';
import { PALETTE } from '../config.js';
import { clamp, damp, rngPick, rngRange } from '../utils.js';
import { numberTexture } from '../gfx/textures.js';

/**
 * [18] Personagem com braços e pernas articulados.
 * Corpo, cabeça e cabelo viram uma malha só com cores por vértice (1 material
 * por pessoa); apenas os membros ficam separados, porque precisam girar.
 */

const HIP_Y = 0.92;
const THIGH = 0.45;
const SHIN = 0.43;
const SHOULDER_Y = 1.38;
const SHOULDER_X = 0.205;
const UPPER_ARM = 0.32;
const FOREARM = 0.30;

/** Pinta todos os vértices de uma geometria com uma cor. */
function paint(geo, hex) {
  const c = new THREE.Color(hex);
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

function box(w, h, d, x, y, z, hex) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  return paint(g, hex);
}

function sphere(r, x, y, z, hex, sy = 1, sz = 1) {
  const g = new THREE.SphereGeometry(r, 12, 9);
  g.scale(1, sy, sz);
  g.translate(x, y, z);
  return paint(g, hex);
}

/**
 * Cápsula (cilindro com pontas arredondadas) — o formato real de um braço
 * ou perna. `len` é o trecho reto; a altura total fica len + 2r, então quem
 * usa escolhe r e len de modo a manter a MESMA altura do segmento (os pivôs
 * das dobradiças não se mexem). sx/sz achatam levemente a seção — membro
 * humano não é um cilindro perfeito. cap/rad controlam a suavidade.
 */
function capsule(r, len, x, y, z, hex, sx = 1, sz = 1, cap = 4, rad = 10) {
  const g = new THREE.CapsuleGeometry(r, len, cap, rad);
  g.scale(sx, 1, sz);
  g.translate(x, y, z);
  return paint(g, hex);
}

export class Human {
  /**
   * @param {object} opts {rng, shirt, pants, skin, hair, scale, number}
   */
  constructor(opts = {}) {
    const rng = opts.rng || Math.random;
    /*
     * Cada pessoa são 10 malhas (tronco + 4 segmentos de braço + 4 de perna +
     * número). Se todas lançarem sombra, o passe de sombra explode: medido em
     * 414 draw calls só de pedestres, contra ~100 do mundo inteiro.
     *
     * Por padrão só o TRONCO lança sombra — a silhueta no chão continua sendo
     * de uma pessoa. O jogador usa `fullShadow` porque está sempre em primeiro
     * plano e é uma entidade só.
     */
    this.fullShadow = opts.fullShadow === true;
    this.falling = false;   // pose de queda (braços erguidos) — MP
    this.shirt = opts.shirt ?? rngPick(rng, PALETTE.shirt);
    this.pants = opts.pants ?? rngPick(rng, PALETTE.pants);
    this.skin = opts.skin ?? rngPick(rng, PALETTE.skin);
    this.hair = opts.hair ?? rngPick(rng, PALETTE.hair);
    const shoe = 0x22252b;

    this.root = new THREE.Group();
    this.pivot = new THREE.Group();          // usado para o bobbing vertical
    this.root.add(this.pivot);

    // um único material por pessoa — as cores vêm dos vértices
    this.material = new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.78, metalness: 0.03,
      emissive: 0xffffff, emissiveIntensity: 0,
    });
    // [NOITE-ROUPA] brilho noturno usa a COR do vertice (vColor): a noite a
    // roupa mantem a cor original em vez de escurecer ou ficar lavada de branco
    this.material.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\n\ttotalEmissiveRadiance = vColor * emissive;'
      );
    };

    /*
     * ------------------------------------------------------------ tronco
     * Alturas ABSOLUTAS, porque o empilhamento aqui é fácil de errar: com
     * offsets relativos o peito subia até 1.58 enquanto a cabeça começava em
     * 1.45, e a camiseta cobria o queixo e a boca.
     *
     *   0.83 ── 1.05   quadril (calça)
     *   1.02 ── 1.30   abdômen (camiseta)
     *   1.22 ── 1.44   peito (camiseta)   <- topo NO ombro, nunca acima
     *   1.40 ── 1.51   pescoço (pele)
     *   1.47 ── 1.77   cabeça (pele)      <- começa acima do peito
     */
    const CHEST_TOP = 1.44;
    const HEAD_Y = 1.62, HEAD_R = 0.125, HEAD_SY = 1.18;

    const bodyParts = [
      box(0.34, 0.22, 0.23, 0, 0.94, 0, this.pants),                // quadril
      box(0.40, 0.28, 0.24, 0, 1.16, 0, this.shirt),                // abdômen
      box(0.44, 0.22, 0.26, 0, CHEST_TOP - 0.11, 0, this.shirt),    // peito
      sphere(0.095, SHOULDER_X, SHOULDER_Y, 0, this.shirt),
      sphere(0.095, -SHOULDER_X, SHOULDER_Y, 0, this.shirt),
      box(0.10, 0.11, 0.10, 0, 1.455, 0, this.skin),                // pescoço
    ];

    this.body = new THREE.Mesh(mergeGeometries(bodyParts, false), this.material);
    this.body.castShadow = true;               // [44]
    this.body.receiveShadow = true;
    this.pivot.add(this.body);

    /*
     * [FPS] A CABEÇA virou um grupo próprio, girando no pescoço (antes era
     * fundida no tronco). É o que deixa o Bob — e qualquer NPC — OLHAR para
     * onde a mira aponta: `lookPitch`/`lookYaw` são preenchidos pelo jogo a
     * cada quadro com a inclinação da câmera + o desvio fixo da mira acima
     * do ombro, e a cabeça acompanha suavemente. Ao atirar, o coice sobe a
     * mira e a cabeça sobe junto.
     */
    const HEAD_PIVOT_Y = 1.47;                 // base do pescoço
    const headParts = [
      sphere(HEAD_R, 0, HEAD_Y - HEAD_PIVOT_Y, 0.006, this.skin, HEAD_SY, 1.04),
    ];
    const hairGeo = new THREE.SphereGeometry(HEAD_R * 1.06, 12, 9, 0, Math.PI * 2, 0, Math.PI * 0.58);
    hairGeo.scale(1, HEAD_SY * 0.96, 1.04);
    hairGeo.translate(0, HEAD_Y + 0.02 - HEAD_PIVOT_Y, 0);
    headParts.push(paint(hairGeo, this.hair));

    this.head = new THREE.Group();
    this.head.position.y = HEAD_PIVOT_Y;
    const headMesh = new THREE.Mesh(mergeGeometries(headParts, false), this.material);
    headMesh.castShadow = this.fullShadow;     // só o jogador projeta a cabeça
    headMesh.receiveShadow = true;
    this.head.add(headMesh);
    this.pivot.add(this.head);

    // [FPS] foco da mira, em radianos (preenchido de fora pelo jogo)
    this.lookPitch = 0;    // + = olhando para cima
    this.lookYaw = 0;      // + = virando a cabeça para a direita (lado da mira)

    // ------------------------------------------------------------ braços
    this.armL = this._makeArm(1);
    this.armR = this._makeArm(-1);
    this.pivot.add(this.armL.group, this.armR.group);

    // ------------------------------------------------------------ pernas
    this.legL = this._makeLeg(1, shoe);
    this.legR = this._makeLeg(-1, shoe);
    this.pivot.add(this.legL.group, this.legR.group);

    // ------------------------------------------------------------ [55] número nas costas
    if (opts.number != null) {
      this.number = String(opts.number);
      const plane = new THREE.PlaneGeometry(0.30, 0.15);
      const mat = new THREE.MeshStandardMaterial({
        map: numberTexture(this.number), roughness: 0.9, metalness: 0,
      });
      this.numberMesh = new THREE.Mesh(plane, mat);
      this.numberMesh.rotation.y = Math.PI;                 // olha para -Z (costas)
      // centralizado nas costas do peito (que agora vai de 1.22 a 1.44)
      this.numberMesh.position.set(0, 1.33, -0.131);
      this.numberMesh.castShadow = false;
      this.pivot.add(this.numberMesh);
    }

    const s = opts.scale ?? 1;
    this.root.scale.setScalar(s);
    this.height = 1.75 * s;

    this.phase = rngRange(rng, 0, Math.PI * 2);
    this._air = 0;      // [ANIM-REVISADA] 0 = chão, 1 = no ar (pulo/queda)
    this._jumpT = 0;     // [ANIM-REVISADA] impulso do pulo (segundos restantes)
    this._jumpSide = 1;  // [ANIM] perna de impulso: 1 = direita atras, -1 = esquerda (alterna)
    this._jumpPrev = 0;  // [ANIM] borda de subida do pulo (detecta novo pulo)
    this.carrying = false;
    this.armGesture = 0;
    this.aiming = false;    // [27] mirando: braços erguidos à frente com a arma
    this.aimAmt = 0;          // [ADS-BLEND] fator de transição suave da pose de tiro (0..1)
    this.weapon = null;     // arma presa à mão direita (antebraço)
  }

  _makeArm(side) {
    const group = new THREE.Group();
    group.position.set(side * SHOULDER_X, SHOULDER_Y, 0);

    /*
     * Braço em CÁPSULA, não caixa: o ombro rola em vez de dobrar em quina e
     * a manga da jaqueta ganha volume arredondado. O raio + trecho reto são
     * escolhidos para a altura total (len + 2r) bater exatamente com o
     * UPPER_ARM/FOREARM antigos — as dobradiças (ombro/cotovelo) não se
     * mexem, e a mecânica de animação/arma continua idêntica.
     */
    const upper = new THREE.Mesh(
      capsule(0.056, 0.208, 0, -UPPER_ARM / 2, 0, this.shirt, 1, 0.9, 2, 6),
      this.material,
    );
    upper.castShadow = this.fullShadow;
    group.add(upper);

    const fore = new THREE.Group();
    fore.position.y = -UPPER_ARM;
    const foreGeos = [
      capsule(0.048, 0.204, 0, -FOREARM / 2, 0, this.skin, 1, 0.9, 2, 6),
    ];
    const hand = sphere(0.062, 0, -FOREARM - 0.03, 0, this.skin, 0.85, 1);
    const foreMesh = new THREE.Mesh(mergeGeometries([foreGeos[0], hand], false), this.material);
    foreMesh.castShadow = this.fullShadow;
    fore.add(foreMesh);
    group.add(fore);

    return { group, fore };
  }

  _makeLeg(side, shoeColor) {
    const group = new THREE.Group();
    group.position.set(side * 0.105, HIP_Y, 0);

    // coxa em cápsula (calça justa) — altura total = THIGH, igual à caixa antiga
    const thigh = new THREE.Mesh(
      capsule(0.077, 0.296, 0, -THIGH / 2, 0, this.pants, 0.94, 1.02, 3, 8),
      this.material,
    );
    thigh.castShadow = this.fullShadow;
    group.add(thigh);

    const shinGroup = new THREE.Group();
    shinGroup.position.y = -THIGH;
    // canela em cápsula + bota com bico arredondado (bola achatada na ponta)
    const shinGeo = capsule(0.064, 0.302, 0, -SHIN / 2, 0, this.pants, 0.94, 1.02, 3, 8);
    const footGeo = new THREE.BoxGeometry(0.135, 0.085, 0.27).translate(0, -SHIN - 0.042, 0.055);
    paint(footGeo, shoeColor);
    const toe = sphere(0.065, 0, -SHIN - 0.042, 0.128, shoeColor, 0.52, 0.95);
    const shinMesh = new THREE.Mesh(mergeGeometries([shinGeo, footGeo, toe], false), this.material);
    shinMesh.castShadow = this.fullShadow;
    shinGroup.add(shinMesh);
    group.add(shinGroup);

    return { group, shin: shinGroup };
  }

  /**
   * [27] Prende a arma na mão direita (antebraço). Ela aponta para onde
   * o braço aponta: erguida na posição de tiro, abaixada ao lado do
   * corpo quando o personagem só anda.
   */
  setWeapon(weapon) {
    this.weapon = weapon;
    this.armR.fore.add(weapon);
    weapon.visible = !this.carrying;
  }

  /**
   * [18] Anima a caminhada. `speed` em m/s; 0 = parado (respiração leve).
   */
  update(dt, speed, opts = {}) {
    const moving = speed > 0.15;
    if (this.weapon) this.weapon.visible = !this.carrying;
    this.armR.group.rotation.y = 0;   // [FPS] braços viram na horizontal só quando mirando
    this.armL.group.rotation.y = 0;

    // [ANIM-REVISADA] "ar" (0 no chão → 1 no ar, transição suave) + impulso do pulo.
    // O ar vem do chamador: o jogador local sabe quando pulou; os remotos são
    // detectados pela altura (y) acima do piso no snapshot.
    const airAlvo = opts.air ?? (this._air ?? 0);
    this._air = damp(this._air ?? 0, airAlvo, 14, dt);
    const ar = this._air;
    if (this._jumpT > 0) this._jumpT -= dt;

    const cadence = moving ? clamp(speed * 2.2, 2.0, 9.5) : 1.6;
    this.phase += dt * cadence;
    // amplitude da passada: caminhada ~0.42, corrida ~0.70 (passos maiores correndo)
    const amp = moving ? clamp(0.40 + Math.max(0, speed - 3) * 0.035, 0.40, 0.70) : 0.0;
    const s = Math.sin(this.phase);

    // ===== pose NO CHÃO: caminhada/corrida com impulso do pé =====
    // A coxa alterna (frente/trás). O joelho dobra no BALANÇO (pé sobe) e
    // estica no APOIO — e o pé COMPENSA a rotação da coxa, ficando plantado
    // no chão e "empurrando" o solo enquanto o corpo avança (o impulso).
    const cL = s * amp, cR = -s * amp;
    const jL = Math.max(0, s) * amp * 1.1 + Math.max(0, -s) * amp * 0.85 + 0.04;
    const jR = Math.max(0, -s) * amp * 1.1 + Math.max(0, s) * amp * 0.85 + 0.04;
    let bL = -s * amp * 0.85 - 0.06, bR = s * amp * 0.85 - 0.06;
    let fL = -0.25 - Math.max(0, -s) * amp * 0.5;
    let fR = -0.25 - Math.max(0, s) * amp * 0.5;
    // [ANIM] tronco inclina SÓ na corrida de verdade (shift) — caminhar
    // inclinado parece patinação. Suavizado (damp) p/ ligar/desligar.
    const leanAlvo = (opts.run && moving) ? 1 : 0;
    this._lean = damp(this._lean ?? 0, leanAlvo, 8, dt);
    const lean = this._lean * 0.03;   // [ANIM] inclinação mínima — só correndo
    const bob = moving ? Math.abs(Math.cos(this.phase)) * 0.05 * amp : 0;

    // ===== pose NO AR: impulso do pulo =====
    // A perna de trás estica (acabou de EMPURRAR o solo) e a da frente fica
    // com o joelho levemente dobrado — o gesto natural de saltar.
    const imp = this._jumpT > 0 ? Math.min(1, this._jumpT / 0.18) : 0;
    // [ANIM] perna de impulso ALTERNA a cada pulo (nao usa sempre a direita);
    // a perna de tras vai pouco para tras (sem abrir as pernas)
    if (this._jumpT > 0 && !this._jumpPrev) this._jumpSide = (this._jumpSide === 1 ? -1 : 1);
    this._jumpPrev = this._jumpT > 0 ? 1 : 0;
    const pR = this._jumpSide > 0;   // true: R e a perna de tras (empurra o solo)
    const af = -0.35 * imp + -0.85 * (1 - imp);   // coxa da FRENTE: levanta com joelho dobrado
    const at = 0.6 * imp + 0.22 * (1 - imp);      // coxa de TRAS: pouco atras (nao abre)
    const jf = 0.7;                               // joelho da frente (pe apontando p/ baixo)
    const jt = 0.12 * imp + 0.85 * (1 - imp);     // joelho de tras: estica no empurrao, dobra no ar
    const aCL = pR ? af : at;
    const aCR = pR ? at : af;
    const aJL = pR ? jf : jt;
    const aJR = pR ? jt : jf;

    // ===== blend chão ↔ ar (pernas) =====
    const k = ar, kk = 1 - k;
    this.legL.group.rotation.x = cL * kk + aCL * k;
    this.legR.group.rotation.x = cR * kk + aCR * k;
    this.legL.shin.rotation.x = jL * kk + aJL * k;
    this.legR.shin.rotation.x = jR * kk + aJR * k;

    // ===== braços =====
    if (this.carrying) {
      this.armL.group.rotation.x = -1.25;
      this.armR.group.rotation.x = -1.25;
      this.armL.group.rotation.z = 0.22;
      this.armR.group.rotation.z = -0.22;
      this.armL.fore.rotation.x = -0.55;
      this.armR.fore.rotation.x = -0.55;
    } else if (this.armGesture > 0) {
      const w = Math.sin(this.phase * 3.2) * 0.5;
      this.armL.group.rotation.x = -s * amp * 0.8;
      this.armL.group.rotation.z = 0;
      this.armL.fore.rotation.x = -0.25;
      this.armR.group.rotation.x = -2.5;
      this.armR.group.rotation.z = -0.35 + w * 0.3;
      this.armR.fore.rotation.x = -0.4 + w;
    } else if (this.falling) {
      // queda grande (de prédio): braços erguidos, pernas abertas
      this.armL.group.rotation.x = -2.4;
      this.armR.group.rotation.x = -2.4;
      this.armL.group.rotation.z = 0.55;
      this.armR.group.rotation.z = -0.55;
      this.armL.fore.rotation.x = -0.3;
      this.armR.fore.rotation.x = -0.3;
      this.legL.group.rotation.x = 0.18;
      this.legR.group.rotation.x = -0.18;
      this.legL.shin.rotation.x = 0.3;
      this.legR.shin.rotation.x = 0.3;
    } else {
      // chão: braços contrabalançam com cotovelo pendular;
      // no ar: braços de equilíbrio erguidos
      // [ANIM] no ar os braços NÃO sobem: ficam na pose de tiro (arma à frente),
      // pois o player pode pular e atirar ao mesmo tempo
      this.armL.group.rotation.x = bL * kk + -1.45 * k;
      this.armR.group.rotation.x = bR * kk + -1.45 * k;
      this.armL.group.rotation.z = 0.06 * kk + -0.30 * k;
      this.armR.group.rotation.z = -0.06 * kk + 0.10 * k;
      this.armL.fore.rotation.x = fL * kk + -0.12 * k;
      this.armR.fore.rotation.x = fR * kk + -0.12 * k;

      if (this.aimAmt > 0.001) {
        const a = this.aimAmt, k2 = 1 - a;
        const apAim = clamp(this.lookPitch, -0.7, 0.7);
        const ayAim = clamp(this.lookYaw, -0.5, 0.5);
        this.armR.group.rotation.x = this.armR.group.rotation.x * k2 + (-1.45 - apAim) * a;
        this.armR.group.rotation.y = ayAim * a;
        this.armR.group.rotation.z = this.armR.group.rotation.z * k2 + 0.10 * a;
        this.armR.fore.rotation.x = this.armR.fore.rotation.x * k2 + -0.12 * a;
        this.armL.group.rotation.x = this.armL.group.rotation.x * k2 + (-1.45 - apAim * 0.85) * a;
        this.armL.group.rotation.y = ayAim * 0.85 * a;
        this.armL.group.rotation.z = this.armL.group.rotation.z * k2 + -0.30 * a;
        this.armL.fore.rotation.x = this.armL.fore.rotation.x * k2 + -0.12 * a;
      }
    }

    // ===== corpo: bobbing 1x por passo, bamboleio e lean de corrida =====
    this.pivot.position.y = bob * kk + (0.07 + ar * 0.03) * k;
    this.pivot.rotation.z = (moving ? Math.sin(this.phase) * 0.03 * amp : 0) * kk;
    this.pivot.rotation.x = lean * kk;

    // ===== cabeça =====
    const hp = clamp(this.lookPitch, -1.1, 1.1);
    const hy = clamp(this.lookYaw, -0.5, 0.5);
    this.head.rotation.x = damp(this.head.rotation.x, -hp * 0.85, 14, dt);
    this.head.rotation.y = damp(this.head.rotation.y, hy, 14, dt);
  }

  setPose(kind) {
    if (kind === 'panic') {
      this.armL.group.rotation.x = -2.7;
      this.armR.group.rotation.x = -2.7;
      this.armL.group.rotation.z = 0.5;
      this.armR.group.rotation.z = -0.5;
    }
  }

  get position() { return this.root.position; }

  setNight(n) {
    // [NOITE-ROUPA] a noite a roupa mantem a cor do dia: o shader usa
    // vColor * emissive (uniform jah escalado por emissiveIntensity no JS)
    this.material.emissiveIntensity = n * 1.1;
  }

  dispose() {
    // as texturas de número são compartilhadas via cache — quem descarta
    // é o dono do cache, não a pessoa que morreu
    this.root.traverse((o) => {
      if (o.isMesh) o.geometry.dispose();
    });
    if (this.numberMesh) this.numberMesh.material.dispose();
    this.material.dispose();
  }
}
