/**
 * AssetLoader — chargement d'assets glTF/GLB/OBJ avec LoadingManager (progression)
 * et support DRACO. Fournit un fallback gracieux : si un modèle est absent, on
 * laisse l'appelant générer un placeholder procédural.
 *
 * Conventions des modèles (voir README) :
 *  - Échelle en mètres, axe Y vers le haut, origine au sol/centre.
 *  - Voitures : meshes de roues nommées Wheel_FL, Wheel_FR, Wheel_RL, Wheel_RR.
 *  - Circuits : meshes Track_Road, Track_Wall, Track_Decoration_*.
 */
import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';

export type ProgressCallback = (loaded: number, total: number, url: string) => void;

export class AssetLoader {
  readonly manager: THREE.LoadingManager;
  private readonly gltfLoader: GLTFLoader;
  private readonly objLoader: OBJLoader;
  private readonly gltfCache = new Map<string, GLTF>();
  private readonly objCache = new Map<string, THREE.Group>();

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
    this.objLoader = new OBJLoader(this.manager);
  }

  /** Charge un GLB. Rejette si le fichier est introuvable. */
  async loadGLB(url: string): Promise<GLTF> {
    if (this.gltfCache.has(url)) return this.gltfCache.get(url)!;
    const gltf = await this.gltfLoader.loadAsync(url);
    this.gltfCache.set(url, gltf);
    return gltf;
  }

  /** Charge un OBJ. Rejette si le fichier est introuvable. */
  async loadOBJ(url: string): Promise<THREE.Group> {
    if (this.objCache.has(url)) return this.objCache.get(url)!;
    const obj = await this.objLoader.loadAsync(url);
    this.objCache.set(url, obj);
    return obj;
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

  /** Tente de charger un GLB ou OBJ selon l'extension ; renvoie null en cas d'échec. */
  async tryLoadModel(url: string | undefined): Promise<THREE.Object3D | null> {
    if (!url) return null;
    try {
      if (url.toLowerCase().endsWith('.obj')) {
        return await this.loadOBJ(url);
      }
      const gltf = await this.loadGLB(url);
      return gltf.scene;
    } catch {
      console.warn(`[AssetLoader] Modèle introuvable, fallback placeholder: ${url}`);
      return null;
    }
  }
}
