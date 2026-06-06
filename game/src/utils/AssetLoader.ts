/**
 * AssetLoader — chargement d'assets glTF/GLB avec LoadingManager (progression)
 * et support DRACO. Fournit un fallback gracieux : si un GLB est absent, on
 * laisse l'appelant générer un placeholder procédural.
 *
 * Conventions des modèles (voir README) :
 *  - Échelle en mètres, axe Y vers le haut, origine au sol/centre.
 *  - Voitures : meshes de roues nommées Wheel_FL, Wheel_FR, Wheel_RL, Wheel_RR.
 *  - Circuits : meshes Track_Road, Track_Wall, Track_Decoration_*.
 */
import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';

export type ProgressCallback = (loaded: number, total: number, url: string) => void;

export class AssetLoader {
  readonly manager: THREE.LoadingManager;
  private readonly gltfLoader: GLTFLoader;
  private readonly cache = new Map<string, GLTF>();

  constructor(onProgress?: ProgressCallback) {
    this.manager = new THREE.LoadingManager();
    if (onProgress) {
      this.manager.onProgress = (url, loaded, total) => onProgress(loaded, total, url);
    }

    const draco = new DRACOLoader();
    // CDN officiel des décodeurs Draco (évite de bundler les binaires).
    draco.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');

    this.gltfLoader = new GLTFLoader(this.manager);
    this.gltfLoader.setDRACOLoader(draco);
  }

  /** Charge un GLB. Rejette si le fichier est introuvable. */
  async loadGLB(url: string): Promise<GLTF> {
    if (this.cache.has(url)) return this.cache.get(url)!;
    const gltf = await this.gltfLoader.loadAsync(url);
    this.cache.set(url, gltf);
    return gltf;
  }

  /** Tente de charger un GLB ; renvoie null en cas d'échec (asset optionnel). */
  async tryLoadGLB(url: string | undefined): Promise<GLTF | null> {
    if (!url) return null;
    try {
      return await this.loadGLB(url);
    } catch {
      console.warn(`[AssetLoader] GLB introuvable, fallback placeholder: ${url}`);
      return null;
    }
  }
}
