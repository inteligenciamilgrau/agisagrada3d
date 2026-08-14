import * as THREE from '../../vendor/three.module.js';
import { EffectComposer } from '../../vendor/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from '../../vendor/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from '../../vendor/jsm/postprocessing/UnrealBloomPass.js';
import { SMAAPass } from '../../vendor/jsm/postprocessing/SMAAPass.js';
import { OutputPass } from '../../vendor/jsm/postprocessing/OutputPass.js';
import { QUALITY, CAMERA, NIGHT, PRESETS, DEFAULT_PRESET } from '../config.js';

/**
 * Pipeline gráfico: WebGL2 + PBR + tone mapping ACES + pós-processamento.
 * É essa combinação (e não voxel) que entrega o visual realista pedido.
 */
export class Graphics {
  constructor(canvas) {
    this.canvas = canvas;

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,             // SMAA cuida do serrilhado no pós
      powerPreference: 'high-performance',
      stencil: false,
    });

    // [MOBILE-FIX] three.js r152+ cria EffectComposer/Bloom/SMAA com HalfFloatType
    // SEM fallback: em drivers sem render-to-half-float (WebGL1/WebView antigo,
    // ex.: Samsung Internet) o framebuffer corrompe -> tela VERDE piscando ao
    // iniciar a partida. Detectamos e degradamos para 8 bits.
    // [S23-FIX] S23 FE (Exynos Xclipse RDNA2 da AMD) corrompe render target
    // HalfFloat em certas dimensoes -> 'explosao de vertices' + flicks verdes
    // (o fix even32/par era p/ Adreno e nao cobre o RDNA2). Detecta a GPU real
    // e, nos casos problematicos, usa o caminho 8 bits (sem bloom/SMAA) estavel.
    this._halfFloatOk = this._detectHalfFloat() && !this._gpuProblemaHalfFloat();
    if (!this._halfFloatOk && this._detectHalfFloat()) console.warn('[gfx] GPU com half-float corrompido: bloom/SMAA desligados (8 bits)');

    this.preset = PRESETS[DEFAULT_PRESET];
    this.renderer.setPixelRatio(this._pixelRatioFor(this.preset));
    this.renderer.setSize(window.innerWidth, window.innerHeight);

    // Pipeline de cor fisicamente correto.
    // O céu de Preetham (addon Sky) devolve radiância alta; por isso a
    // exposição fica em torno de 0.45, como nos exemplos do three.js.
    // Com 1.0 a cidade inteira estoura em branco.
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = QUALITY.exposure;

    // [44] sombras suaves
    this.renderer.shadowMap.enabled = this.preset.shadows;
    this.renderer.shadowMap.type = this.preset.shadowType === 'basic' ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap;
    /*
     * [perf] Sombra SOB DEMANDA: o game marca requestShadow() a cada 2
     * frames, em vez de o three re-renderizar o passe TODO frame.
     */
    this.renderer.shadowMap.autoUpdate = false;
    // [perf] resolucao dinamica (multiplicador sobre o renderScale do perfil)
    this._dynScale = 1;
    this._dynFloor = this.preset.dynFloor ?? 0.75;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(
      CAMERA.fov, window.innerWidth / window.innerHeight, CAMERA.near, CAMERA.far,
    );
    this.camera.position.set(0, 8, 20);
    /** Distância de renderização: encurta o far plane da câmera. */
    this.setFar = (dist) => {
      this.camera.far = dist;
      this.camera.updateProjectionMatrix();
    };

    this.pmrem = new THREE.PMREMGenerator(this.renderer);
    this.pmrem.compileEquirectangularShader();

    this.buildComposer();

    this._onResize = () => this.resize();
    window.addEventListener('resize', this._onResize);
    document.addEventListener('fullscreenchange', this._onResize);
    this.renderer.domElement.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this._ctxLostAt = performance.now();
      console.warn('[gfx] contexto WebGL perdido — tentando restaurar...');
    });
    this.renderer.domElement.addEventListener('webglcontextrestored', () => {
      const ago = performance.now() - (this._ctxLostAt || 0);
      if (ago > 2000) location.reload(); // recria shaders/composer do zero (canvas nao fica preto)
      else console.warn('[gfx] contexto restaurado em cascata - sem reload');
    });
  }

  /**
   * Resolução de renderização do perfil. O `renderScale` MULTIPLICA a densidade
   * nativa (0.62 = 38% dos pixels), que é o ganho de FPS mais direto que existe.
   * O teto de 2 evita explodir a conta em telas de altíssimo DPI.
   */
  /** true se o driver consegue renderizar em HalfFloatType (bloom/SMAA/composer). */
  _detectHalfFloat() {
    try {
      const gl = this.renderer.getContext();
      if (!gl || typeof gl.getExtension !== 'function') return false;
      if (this.renderer.capabilities && this.renderer.capabilities.isWebGL2) {
        return !!gl.getExtension('EXT_color_buffer_float');
      }
      return !!(gl.getExtension('OES_texture_half_float') &&
        (gl.getExtension('EXT_color_buffer_half_float') || gl.getExtension('WEBGL_color_buffer_float')));
    } catch (e) {
      return false;
    }
  }

  _gpuProblemaHalfFloat() {
    try {
      const gl = this.renderer.getContext();
      if (!gl) return false;
      const dbg = gl.getExtension('WEBGL_debug_renderer_info');
      const gpu = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) || '') : '';
      // Exynos Xclipse (RDNA2/AMD) no S23 FE: HalfFloat RT corrompe -> tela verde/vertices explodem
      if (/Xclipse|Exynos|RDNA|AMD/i.test(gpu)) return true;
      // fallback: Chrome Android generico (driver desconhecido)
      const ua = (navigator.userAgent || '');
      if (/Android/i.test(ua) && /Chrome/i.test(ua) && !/Edg|SamsungBrowser|OPR/i.test(ua)) {
        // so desliga se o renderer nao for um driver conhecido estavel
        if (!/Adreno|Mali/i.test(gpu)) return true;
      }
      return false;
    } catch (e) { return false; }
  }


  _pixelRatioFor(preset) {
    const dpr = Math.min(window.devicePixelRatio || 1, preset.pixelRatioCap ?? 2);
    return Math.max(0.5, dpr * preset.renderScale * (this._dynScale || 1));
  }

  /** [perf] Resolucao dinamica em tempo real (DRS). */
  setDynamicScale(f) {
    const next = Math.max(this._dynFloor, Math.min(1, f));
    if (Math.abs(next - this._dynScale) < 0.02) return;
    this._dynScale = next;
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setPixelRatio(this._pixelRatioFor(this.preset));
    this.renderer.setSize(w, h);
    this.composer.setPixelRatio(this._pixelRatioFor(this.preset));
    this.composer.setSize(w, h);
  }

  /** [perf] Escala dinamica atual (1 = teto do perfil). */
  get dynamicScale() { return this._dynScale; }

  /** [perf] Pede a re-renderizacao do mapa de sombras no proximo frame. */
  requestShadow() {
    this.renderer.shadowMap.needsUpdate = true;
  }

  buildComposer() {
    const w = window.innerWidth, h = window.innerHeight;
    if (this.composer) this.composer.dispose();

    const pr = this._pixelRatioFor(this.preset);
    let composer;
    if (this._halfFloatOk) {
      composer = new EffectComposer(this.renderer);
    } else {
      // [MOBILE-FIX] sem render-to-half-float: composer em UnsignedByteType
      // (o default HalfFloatType do r152+ corrompe e fica verde)
      const rt = new THREE.WebGLRenderTarget(
        Math.max(2, Math.round(w * pr)), Math.max(2, Math.round(h * pr)),
        { type: THREE.UnsignedByteType, depthBuffer: true, stencilBuffer: false },
      );
      composer = new EffectComposer(this.renderer, rt);
      console.warn('[gfx] driver sem half-float render target — bloom/SMAA desligados (fallback 8 bits)');
    }
    // [MOBILE-FIX] HalfFloatType corrompe com dimensao IMPAR no Adreno (Samsung).
    // O EffectComposer cria renderTarget1/2 HalfFloat no tamanho real (ex. 2340*1.5=3510
    // IMPAR no S23) e o UnrealBloomPass divide por 2 cinco vezes (nMips=5) sem arredondar
    // (1755 -> 877 -> 438 -> 219 IMPAR) -> framebuffer corrompido -> METADE DA TELA VERDE
    // piscando. Instala o override do setSize ANTES do primeiro setSize (senao o RT
    // principal ja nasce impar) e arredonda para multiplos de 32 em TODOS os níveis.
    const even32 = (v) => Math.max(2, Math.round(v / 32) * 32);
    const origComposerSetSize = composer.setSize.bind(composer);
    composer.setSize = (cw, ch) => origComposerSetSize(even32(cw), even32(ch));
    composer.setPixelRatio(pr);
    composer.setSize(w, h);

    /*
     * Sem SSAO de propósito. O SSAOPass do three renderiza um passe próprio de
     * normais/profundidade com `scene.overrideMaterial`, e nesta cena (cheia de
     * InstancedMesh e com um ShaderMaterial customizado nas partículas) o AO
     * resultante sai zerado — o que multiplica a imagem por preto e apaga a
     * tela inteira. Verificado: com SSAO o quadro é preto uniforme.
     * A oclusão de contato aqui vem das sombras direcionais.
     */
    composer.addPass(new RenderPass(this.scene, this.camera));

    // bloom: faz janelas acesas, postes, faróis e explosões "estourarem"
    if (this.preset.bloom && this._halfFloatOk) {
      /*
       * O bloom é o passe mais caro do pipeline: 5 níveis de mip, cada um com
       * desfoque horizontal e vertical, tudo em tela cheia. É fill-rate puro,
       * e era o motivo de MÉDIA e ALTA custarem quase o mesmo.
       * Rodar em resolução reduzida é praticamente invisível (o resultado já é
       * borrado por natureza) e devolve muito quadro por segundo.
       */
      const bs = this.preset.bloomScale ?? 0.5;
      // [MOBILE-FIX] dimensoes MULTIPLO DE 32: o bloom divide por 2 cinco
      // vezes (nMips=5); dimensao impar em half-float corrompe o framebuffer
      // em alguns Adreno (Samsung) -> tela verde piscando
      const bw = Math.max(64, Math.round((w * bs) / 32) * 32);
      const bh = Math.max(64, Math.round((h * bs) / 32) * 32);
      const bloom = new UnrealBloomPass(
        new THREE.Vector2(bw, bh),
        QUALITY.bloomStrength, QUALITY.bloomRadius, QUALITY.bloomThreshold,
      );
      // [MOBILE-FIX] o setSize ORIGINAL faz resx=round(w/2) e divide por 2 cinco vezes
      // sem arredondar; com base impar (S23: 3510px) os mips 1755->877->438->219 quebram
      // o framebuffer HalfFloat no Adreno. Aqui cada nivel e arredondado para PAR.
      {
        const origBloomSetSize = bloom.setSize.bind(bloom);
        bloom.setSize = (bw2, bh2) => {
          // par(x) arredonda para o PAR mais proximo (min 2)
          const par = (v) => Math.max(2, Math.round(v / 2) * 2);
          let resx = par(bw2 / 2);
          let resy = par(bh2 / 2);
          bloom.renderTargetBright.setSize(resx, resy);
          for (let i = 0; i < bloom.nMips; i++) {
            bloom.renderTargetsHorizontal[i].setSize(resx, resy);
            bloom.renderTargetsVertical[i].setSize(resx, resy);
            bloom.separableBlurMaterials[i].uniforms["invSize"].value.set(1 / resx, 1 / resy);
            resx = par(resx / 2);
            resy = par(resy / 2);
          }
          bloom.resolution.set(bw2, bh2);
        };
      }
      composer.addPass(bloom);
      this.bloomPass = bloom;
    } else {
      this.bloomPass = null;
    }

    composer.addPass(new OutputPass());

    if (this.preset.smaa && this._halfFloatOk) {
      const smaa = new SMAAPass(w, h);
      const origSmaaSetSize = smaa.setSize.bind(smaa);
      smaa.setSize = (sw, sh) => origSmaaSetSize(even32(sw), even32(sh));
      composer.addPass(smaa);
    }

    this.composer = composer;
  }

  /**
   * Aplica um perfil de qualidade. Mexe em coisas que exigem recompilar
   * shaders (sombras) e recriar o pipeline (passes), então só deve ser
   * chamado quando o jogador troca de perfil — nunca por frame.
   */
  applyPreset(preset, scene) {
    this.preset = preset;
    this._dynScale = 1;      // [perf] trocar de perfil reinicia a escala dinamica
    this._dynFloor = preset.dynFloor ?? 0.75;
    this.renderer.shadowMap.type = preset.shadowType === 'basic' ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap;

    this.renderer.setPixelRatio(this._pixelRatioFor(preset));
    this.renderer.setSize(window.innerWidth, window.innerHeight);

    const shadowsChanged = this.renderer.shadowMap.enabled !== preset.shadows;
    this.renderer.shadowMap.enabled = preset.shadows;

    this.buildComposer();

    // ligar/desligar sombra muda o shader de todo material iluminado
    if (shadowsChanged && scene) {
      scene.traverse((o) => {
        if (!o.material) return;
        if (Array.isArray(o.material)) o.material.forEach((m) => { m.needsUpdate = true; });
        else o.material.needsUpdate = true;
      });
    }
  }

  /** Bloom um pouco mais forte à noite — sem exagero, senão a cidade estoura. */
  setNightIntensity(t) {
    if (this.bloomPass) {
      this.bloomPass.strength = QUALITY.bloomStrength + t * NIGHT.bloomStrengthBoost;
      this.bloomPass.threshold = QUALITY.bloomThreshold - t * NIGHT.bloomThresholdDrop;
    }
    // abre um pouco a exposição à noite para a cidade não virar um breu
    this.renderer.toneMappingExposure = QUALITY.exposure + t * NIGHT.exposureBoost;
  }

  resize() {
    // guarda: o preview pode disparar 'resize' antes de a camera existir
    if (!this.camera) return;
    const w = window.innerWidth, h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
  }

  render() {
    this.composer.render();
  }

  dispose() {
    window.removeEventListener('resize', this._onResize);
    this.composer.dispose();
    this.pmrem.dispose();
    this.renderer.dispose();
  }
}
