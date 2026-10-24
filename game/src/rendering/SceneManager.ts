/**
 * SceneManager — encapsule la scène Three.js, le renderer WebGL et la caméra.
 * Gère le redimensionnement, le pixel ratio et les ombres.
 */
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { GRAPHICS_CONFIG, CAMERA_CONFIG } from '../config';

export class SceneManager {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  private readonly carEnvironment: THREE.WebGLRenderTarget;

  get carEnvironmentMap(): THREE.Texture {
    return this.carEnvironment.texture;
  }

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, GRAPHICS_CONFIG.maxPixelRatio));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    if (GRAPHICS_CONFIG.shadows) {
      this.renderer.shadowMap.enabled = true;
      this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    }

    this.scene = new THREE.Scene();

    // Match the garage's image-based lighting for reflective car paint. Keep it
    // off scene.environment so the circuit's materials retain their lighting.
    const studio = new RoomEnvironment();
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    try {
      this.carEnvironment = pmrem.fromScene(studio, 0.04);
    } finally {
      studio.dispose();
      pmrem.dispose();
    }

    this.camera = new THREE.PerspectiveCamera(
      CAMERA_CONFIG.baseFov,
      window.innerWidth / window.innerHeight,
      0.1,
      2000,
    );
    this.camera.position.set(0, 8, -16);

    this.resize();
    window.addEventListener('resize', this.resize);
  }

  resize = (): void => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
  };

  get size(): THREE.Vector2 {
    return this.renderer.getSize(new THREE.Vector2());
  }

  dispose(): void {
    window.removeEventListener('resize', this.resize);
    this.carEnvironment.dispose();
    this.renderer.dispose();
  }
}
