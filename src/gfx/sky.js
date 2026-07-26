import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { DAY, QUALITY, CAMERA } from '../config.js';
import { clamp, invLerp, formatClock } from '../utils.js';
import { starTexture } from './textures.js';

/**
 * O shader de céu de Preetham (addon Sky) devolve radiância na casa de 5 a 10
 * em espaço linear — ordens de grandeza acima de qualquer superfície da cena.
 * Isso arrebenta a faixa dinâmica: o ACES comprime tudo e a imagem inteira
 * vira branco leitoso.
 *
 * Em vez de compensar com uma exposição minúscula (o que apagaria o chão),
 * escalamos a saída do próprio céu para perto de 1.0. Assim exposição,
 * intensidade do sol e mapa de ambiente voltam a ter valores naturais, e o
 * azul do céu é preservado porque a escala é linear.
 */
const SKY_SCALE = 0.16;
const SKY_PATCH_TARGET = 'gl_FragColor = vec4( retColor, 1.0 );';

function makeSky() {
  const sky = new Sky();
  sky.material.onBeforeCompile = (shader) => {
    shader.uniforms.skyScale = { value: SKY_SCALE };
    if (!shader.fragmentShader.includes(SKY_PATCH_TARGET)) {
      console.warn('[sky] shader do Sky mudou; brilho do céu não foi reescalado');
      return;
    }
    shader.fragmentShader = 'uniform float skyScale;\n' + shader.fragmentShader.replace(
      SKY_PATCH_TARGET,
      'gl_FragColor = vec4( retColor * skyScale, 1.0 );',
    );
  };
  return sky;
}

/**
 * [13] Ciclo dia/noite completo: espalhamento atmosférico de Rayleigh/Mie,
 * sol e lua com sombras, estrelas, névoa e mapa de ambiente (reflexos) que
 * acompanham a hora do dia.
 */
export class SkySystem {
  constructor(graphics) {
    this.g = graphics;
    this.scene = graphics.scene;
    this.hour = DAY.startHour;
    this.nightFactor = 0;
    this._envTimer = 99;
    this._paused = false;
    /** [13] 'ciclo' | 'dia' | 'noite' */
    this.cycleMode = 'ciclo';
    /** Segundos entre regenerações do mapa de ambiente (perfil de qualidade). */
    this.envUpdateInterval = 4;

    // ---------------------------------------------------------- domo do céu
    // O domo precisa caber DENTRO do far plane da câmera (CAMERA.far), senão
    // é recortado e o céu some. Ele acompanha a câmera e nunca escreve profundidade.
    this.sky = makeSky();
    this.sky.scale.setScalar(2000);          // meia-extensão 1000 << far 2600
    this.sky.material.depthTest = false;
    this.sky.material.depthWrite = false;
    this.sky.renderOrder = -1000;
    this.sky.frustumCulled = false;
    this.scene.add(this.sky);

    const u = this.sky.material.uniforms;
    u.turbidity.value = 5.5;
    u.rayleigh.value = 2.0;
    u.mieCoefficient.value = 0.006;
    u.mieDirectionalG.value = 0.82;

    this.sunDir = new THREE.Vector3(0, 1, 0);

    // ---------------------------------------------------------- luz do sol/lua
    this.sun = new THREE.DirectionalLight(0xfff2e0, 3.2);
    this.sun.castShadow = true;                       // [44]
    this.sun.shadow.mapSize.set(QUALITY.shadowMapSize, QUALITY.shadowMapSize);
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 620;
    const R = QUALITY.shadowRadius;
    this.sun.shadow.camera.left = -R;
    this.sun.shadow.camera.right = R;
    this.sun.shadow.camera.top = R;
    this.sun.shadow.camera.bottom = -R;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.035;
    this._shadowRadius = R;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    // Luz de preenchimento discreta: o grosso do ambiente vem do mapa de
    // ambiente gerado a partir do próprio céu, então o hemisférico só
    // completa o rebote do chão — mais que isso lava a cena.
    this.hemi = new THREE.HemisphereLight(0xa8ccff, 0x6b6152, QUALITY.hemiIntensity);
    this.scene.add(this.hemi);

    // ---------------------------------------------------------- estrelas
    this.stars = this._makeStars();
    this.scene.add(this.stars);

    // ---------------------------------------------------------- lua
    const moonMat = new THREE.MeshBasicMaterial({
      color: 0xfdf6e0, fog: false, transparent: true, depthTest: false,
    });
    this.moon = new THREE.Mesh(new THREE.SphereGeometry(22, 24, 16), moonMat);
    this.moon.renderOrder = -998;
    this.moon.frustumCulled = false;
    this.scene.add(this.moon);

    // ---------------------------------------------------------- névoa
    this.scene.fog = new THREE.Fog(0xbdd6ee, QUALITY.fogNear, QUALITY.fogFar);

    /** Distância de renderização em vigor (ver `setRenderDistance`). */
    this.distMax = CAMERA.far;
    this.distLua = 1300;

    this.update(0, new THREE.Vector3());
  }

  /**
   * Ajusta o céu à distância de renderização escolhida.
   *
   * O domo, as estrelas e a lua vivem em raios fixos (1000, 1400 e
   * 1300 m). Encurtar o far plane sem mexer neles recorta o céu — e o
   * que aparece atrás do mundo é o vazio do buffer, não azul. Por isso
   * os três encolhem junto, sempre com folga dentro do far.
   *
   * A NÉVOA não é ajustada aqui. `update()` reescreve `scene.fog` a cada
   * quadro a partir de `QUALITY.fogNear/fogFar` (a cor muda com a hora do
   * dia), então mexer no objeto direto seria apagado no quadro seguinte.
   * Quem manda na névoa é `QUALITY`, e quem escreve lá é o `game.js`.
   *
   * @param {number} dist  far plane pedido
   */
  setRenderDistance(dist) {
    this.distMax = dist;

    // domo: meia-extensão = escala/2, mantida em 70% do far
    this.sky.scale.setScalar(dist * 1.4);
    // estrelas: nasceram num raio de 1400
    this.stars.scale.setScalar((dist * 0.62) / 1400);
    this.distLua = dist * 0.5;
  }

  _makeStars() {
    const N = 1400;
    const R = 1400;                          // também dentro do far plane
    const pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      // hemisfério superior apenas
      const u = Math.random() * Math.PI * 2;
      const v = Math.acos(Math.random() * 0.92 + 0.02);
      pos[i * 3] = R * Math.sin(v) * Math.cos(u);
      pos[i * 3 + 1] = R * Math.cos(v) * 0.9 + 60;
      pos[i * 3 + 2] = R * Math.sin(v) * Math.sin(u);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));

    // tamanho em pixels (sem atenuação) deixa a estrela nítida a qualquer distância
    const mat = new THREE.PointsMaterial({
      map: starTexture(),
      size: 3.2,
      sizeAttenuation: false,
      transparent: true,
      opacity: 0,
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
    });
    const pts = new THREE.Points(geo, mat);
    pts.renderOrder = -999;
    pts.frustumCulled = false;
    return pts;
  }

  setPaused(p) { this._paused = p; }

  /**
   * [13] Modo do ciclo: 'ciclo' anda a hora normalmente, 'dia' e 'noite'
   * congelam numa hora fixa. Útil para gravar sempre com a mesma luz.
   */
  setCycleMode(mode) {
    this.cycleMode = mode;
    if (mode === 'dia') this.setHour(DAY.fixedDayHour);
    else if (mode === 'noite') this.setHour(DAY.fixedNightHour);
  }

  get cycleFrozen() { return this.cycleMode === 'dia' || this.cycleMode === 'noite'; }

  /** Resolução e alcance da sombra, definidos pelo perfil de qualidade. */
  setShadowQuality(mapSize, radius) {
    const s = this.sun.shadow;
    if (s.mapSize.width !== mapSize) {
      s.mapSize.set(mapSize, mapSize);
      // o mapa antigo precisa ser descartado para o three recriar no tamanho novo
      if (s.map) { s.map.dispose(); s.map = null; }
    }
    s.camera.left = -radius;
    s.camera.right = radius;
    s.camera.top = radius;
    s.camera.bottom = -radius;
    s.camera.updateProjectionMatrix();
    this._shadowRadius = radius;
  }

  /**
   * Pula direto para uma hora (reinício e modos fixos de iluminação).
   * Recalcula o estado do sol na hora: quem chama costuma ler `nightFactor`
   * logo em seguida para acender a cidade, e esperar o próximo quadro deixaria
   * a iluminação um passo atrasada.
   */
  setHour(h) {
    this.hour = h;
    this._envTimer = 99;
    this._refreshSunState();
  }

  /** Direção do sol e fator de noite derivados da hora atual. */
  _refreshSunState() {
    const phi = ((this.hour - 6) / 12) * Math.PI;      // 6h nasce, 18h se põe
    this.sunDir.set(Math.cos(phi), Math.sin(phi), 0.28).normalize();
    this.nightFactor = 1 - clamp(invLerp(-0.14, 0.16, this.sunDir.y), 0, 1);
  }

  update(dt, focus) {
    // [13] em 'dia' ou 'noite' o relógio fica parado na hora escolhida
    if (!this._paused && !this.cycleFrozen) {
      this.hour = (this.hour + dt * (24 / DAY.duration)) % 24;
    }

    // ------------------------------------------------ posição do sol
    this._refreshSunState();
    const elev = this.sunDir.y;
    const n = this.nightFactor;      // 1 = noite fechada, 0 = dia claro
    const dusk = 1 - Math.abs(clamp(invLerp(-0.25, 0.35, elev), 0, 1) * 2 - 1); // pico no nascer/pôr

    // ------------------------------------------------ atmosfera
    const u = this.sky.material.uniforms;
    u.sunPosition.value.copy(this.sunDir);
    // rayleigh alto = céu mais azul; no nascer/pôr do sol a turbidez sobe
    // e o mie espalha o laranja no horizonte
    u.turbidity.value = 3.4 + dusk * 7.0;
    u.rayleigh.value = elev > 0 ? 2.4 + dusk * 1.4 : 0.4;
    u.mieCoefficient.value = 0.004 + dusk * 0.013;

    this.sky.position.copy(focus);
    this.stars.position.copy(focus);

    // ------------------------------------------------ luz principal
    const above = elev > -0.05;
    if (above) {
      this.sun.position.copy(this.sunDir).multiplyScalar(320).add(focus);
      const warm = new THREE.Color(0xff9a4d);
      const white = new THREE.Color(0xfff6e8);
      this.sun.color.copy(warm).lerp(white, clamp(invLerp(0.02, 0.42, elev), 0, 1));
      this.sun.intensity = clamp(elev * 5.4, 0, QUALITY.sunIntensity);
    } else {
      // luar: direção oposta, azulado e fraco
      this.sun.position.copy(this.sunDir).multiplyScalar(-320).add(focus);
      this.sun.color.setHex(0x9fb6e8);
      this.sun.intensity = 0.35;
    }
    this._snapShadow(focus);

    // ------------------------------------------------ preenchimento
    this.hemi.intensity = QUALITY.hemiIntensity * (1 - n * 0.62);
    this.hemi.color.setHex(0xa8ccff).lerp(new THREE.Color(0x24304a), n);
    this.hemi.groundColor.setHex(0x6b6152).lerp(new THREE.Color(0x0d1018), n);

    // ------------------------------------------------ estrelas e lua
    this.stars.material.opacity = clamp((n - 0.35) / 0.5, 0, 1) * 0.95;
    this.moon.visible = this.stars.material.opacity > 0.02;
    if (this.moon.visible) {
      this.moon.position.copy(this.sunDir).multiplyScalar(-this.distLua).add(focus);
      this.moon.material.opacity = this.stars.material.opacity;
    }

    // ------------------------------------------------ névoa segue o horizonte
    const dayFog = new THREE.Color(0xbdd6ee);
    const duskFog = new THREE.Color(0xd98a52);
    const nightFog = new THREE.Color(0x0c1220);
    const fogCol = dayFog.clone().lerp(duskFog, dusk * 0.75).lerp(nightFog, n);
    this.scene.fog.color.copy(fogCol);
    this.scene.fog.near = QUALITY.fogNear;
    this.scene.fog.far = QUALITY.fogFar - n * 260;

    this.g.setNightIntensity(n);

    // ------------------------------------------------ reflexos (PMREM)
    this._envTimer += dt;
    if (this._envTimer > this.envUpdateInterval) {
      this._envTimer = 0;
      this._updateEnvironment();
    }
  }

  /**
   * Mantém o frustum de sombra centrado no jogador e alinhado à grade de texels,
   * evitando o "chiado" das bordas de sombra quando a câmera se move.
   */
  _snapShadow(focus) {
    const texel = (this._shadowRadius * 2) / this.sun.shadow.mapSize.width;
    const sx = Math.round(focus.x / texel) * texel;
    const sz = Math.round(focus.z / texel) * texel;
    this.sun.target.position.set(sx, 0, sz);
    this.sun.target.updateMatrixWorld();
    this.sun.shadow.camera.updateProjectionMatrix();
  }

  /** Gera o mapa de ambiente a partir do próprio céu — reflexos corretos na hora certa. */
  _updateEnvironment() {
    const tmp = new THREE.Scene();
    const sky = makeSky();                  // mesma escala de brilho do domo
    sky.scale.setScalar(1000);
    const su = sky.material.uniforms;
    const cu = this.sky.material.uniforms;
    su.turbidity.value = cu.turbidity.value;
    su.rayleigh.value = cu.rayleigh.value;
    su.mieCoefficient.value = cu.mieCoefficient.value;
    su.mieDirectionalG.value = cu.mieDirectionalG.value;
    su.sunPosition.value.copy(this.sunDir);
    tmp.add(sky);

    const rt = this.g.pmrem.fromScene(tmp);
    // libera o render target anterior inteiro, não só a textura — senão
    // o mapa de ambiente vaza memória de GPU a cada regeneração
    if (this._envRT) this._envRT.dispose();
    this._envRT = rt;
    this.scene.environment = rt.texture;
    // à noite os reflexos do céu quase somem
    this.scene.environmentIntensity = QUALITY.envIntensity * (1 - this.nightFactor * 0.86);

    sky.geometry.dispose();
    sky.material.dispose();
  }

  get clockText() { return formatClock(this.hour); }
  get isNight() { return this.nightFactor > 0.5; }
}
