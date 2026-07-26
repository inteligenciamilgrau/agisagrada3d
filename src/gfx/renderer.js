import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
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
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.shadowMap.autoUpdate = true;

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
  }

  /**
   * Resolução de renderização do perfil. O `renderScale` MULTIPLICA a densidade
   * nativa (0.62 = 38% dos pixels), que é o ganho de FPS mais direto que existe.
   * O teto de 2 evita explodir a conta em telas de altíssimo DPI.
   */
  _pixelRatioFor(preset) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    return Math.max(0.5, dpr * preset.renderScale);
  }

  buildComposer() {
    const w = window.innerWidth, h = window.innerHeight;
    if (this.composer) this.composer.dispose();

    const composer = new EffectComposer(this.renderer);
    composer.setPixelRatio(this._pixelRatioFor(this.preset));
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
    if (this.preset.bloom) {
      /*
       * O bloom é o passe mais caro do pipeline: 5 níveis de mip, cada um com
       * desfoque horizontal e vertical, tudo em tela cheia. É fill-rate puro,
       * e era o motivo de MÉDIA e ALTA custarem quase o mesmo.
       * Rodar em resolução reduzida é praticamente invisível (o resultado já é
       * borrado por natureza) e devolve muito quadro por segundo.
       */
      const bs = this.preset.bloomScale ?? 0.5;
      const bloom = new UnrealBloomPass(
        new THREE.Vector2(Math.max(64, w * bs), Math.max(64, h * bs)),
        QUALITY.bloomStrength, QUALITY.bloomRadius, QUALITY.bloomThreshold,
      );
      composer.addPass(bloom);
      this.bloomPass = bloom;
    } else {
      this.bloomPass = null;
    }

    composer.addPass(new OutputPass());

    if (this.preset.smaa) composer.addPass(new SMAAPass(w, h));

    this.composer = composer;
  }

  /**
   * Aplica um perfil de qualidade. Mexe em coisas que exigem recompilar
   * shaders (sombras) e recriar o pipeline (passes), então só deve ser
   * chamado quando o jogador troca de perfil — nunca por frame.
   */
  applyPreset(preset, scene) {
    this.preset = preset;

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
