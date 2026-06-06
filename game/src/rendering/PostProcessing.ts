/**
 * PostProcessing — pipeline EffectComposer optionnel.
 *  - Bloom léger (UnrealBloomPass) pour les feux/reflets.
 *  - Motion blur radial (zoom blur) dont l'intensité dépend de la vitesse,
 *    pour renforcer la sensation de vitesse.
 * Tout est activable/désactivable via la config (perf).
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { GRAPHICS_CONFIG } from '../config';

/** Shader de flou radial (zoom blur) centré écran. */
const RadialBlurShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    strength: { value: 0.0 },
    center: { value: new THREE.Vector2(0.5, 0.5) },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float strength;
    uniform vec2 center;
    varying vec2 vUv;
    void main() {
      vec2 dir = vUv - center;
      vec4 sum = vec4(0.0);
      const int SAMPLES = 8;
      for (int i = 0; i < SAMPLES; i++) {
        float scale = 1.0 - strength * (float(i) / float(SAMPLES));
        sum += texture2D(tDiffuse, center + dir * scale);
      }
      gl_FragColor = sum / float(SAMPLES);
    }
  `,
};

export class PostProcessing {
  private composer: EffectComposer | null = null;
  private radialPass: ShaderPass | null = null;
  readonly enabled: boolean;

  constructor(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
    size: THREE.Vector2,
  ) {
    this.enabled = GRAPHICS_CONFIG.postProcessing;
    if (!this.enabled) return;

    this.composer = new EffectComposer(renderer);
    this.composer.setSize(size.x, size.y);
    this.composer.addPass(new RenderPass(scene, camera));

    if (GRAPHICS_CONFIG.bloom.enabled) {
      const bloom = new UnrealBloomPass(
        new THREE.Vector2(size.x, size.y),
        GRAPHICS_CONFIG.bloom.strength,
        GRAPHICS_CONFIG.bloom.radius,
        GRAPHICS_CONFIG.bloom.threshold,
      );
      this.composer.addPass(bloom);
    }

    if (GRAPHICS_CONFIG.motionBlur.enabled) {
      this.radialPass = new ShaderPass(RadialBlurShader);
      this.composer.addPass(this.radialPass);
    }

    this.composer.addPass(new OutputPass());
  }

  /** @param speed01 vitesse normalisée [0..1] pour moduler le flou. */
  setSpeed(speed01: number): void {
    if (this.radialPass) {
      this.radialPass.uniforms.strength.value =
        GRAPHICS_CONFIG.motionBlur.strength * 0.12 * Math.min(1, speed01);
    }
  }

  setSize(w: number, h: number): void {
    this.composer?.setSize(w, h);
  }

  render(_dt: number): void {
    this.composer?.render();
  }

  dispose(): void {
    this.composer?.dispose();
  }
}
