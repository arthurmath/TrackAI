import * as THREE from 'three';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { CarConstructor } from '../assets/cars/CarConstructor';
import type { VehicleConfig } from '../assets/cars/types';
import { TrackConstructor } from '../assets/tracks/TrackConstructor';
import type { TrackDefinition } from '../assets/tracks/types';
import { initPhysics, PhysicsWorld } from '../physics/PhysicsWorld';
import { Lighting } from '../rendering/Lighting';
import { AssetLoader } from '../utils/AssetLoader';
import { registerSpecularGlossinessExtension } from '../utils/GLTFGlossinessExtension';

const WIDTH = 1200;
const HEIGHT = 700;
const ASPECT = WIDTH / HEIGHT;
const carImages = new WeakMap<VehicleConfig, Promise<string>>();
const trackImages = new WeakMap<TrackDefinition, Promise<string>>();
let queue: Promise<void> = Promise.resolve();
let renderer: THREE.WebGLRenderer | undefined;
let releaseTimer: ReturnType<typeof setTimeout> | undefined;

/** A preview owns its assets: disposing a thumbnail never touches the race's cache. */
class PreviewResources {
  private readonly geometries = new Set<THREE.BufferGeometry>();
  private readonly materials = new Set<THREE.Material>();
  private readonly textures = new Set<THREE.Texture>();
  private readonly lights = new Set<THREE.Light>();
  private readonly instances = new Set<THREE.InstancedMesh>();

  collect(root: THREE.Object3D): void {
    root.traverse(object => {
      if (object instanceof THREE.Light) this.lights.add(object);
      if (!(object instanceof THREE.Mesh)) return;
      this.geometries.add(object.geometry);
      if (object instanceof THREE.InstancedMesh) this.instances.add(object);
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        this.materials.add(material);
        for (const value of Object.values(material)) {
          if (value instanceof THREE.Texture) this.textures.add(value);
        }
      }
    });
  }

  dispose(): void {
    this.lights.forEach(light => light.dispose());
    this.instances.forEach(mesh => mesh.dispose());
    this.geometries.forEach(geometry => geometry.dispose());
    this.materials.forEach(material => material.dispose());
    this.textures.forEach(texture => texture.dispose());
    const bitmaps = new Set<ImageBitmap>();
    this.textures.forEach(texture => {
      if (typeof ImageBitmap !== 'undefined' && texture.source.data instanceof ImageBitmap) {
        bitmaps.add(texture.source.data);
      }
    });
    bitmaps.forEach(bitmap => bitmap.close());
  }
}

/**
 * The game loader has a persistent model cache and no teardown method. These
 * overrides keep each preview independent and also release any Draco workers.
 */
class PreviewLoader extends AssetLoader {
  private readonly decoder = new DRACOLoader();
  private readonly previewGLTF = new GLTFLoader(this.manager);
  private readonly previewOBJ = new OBJLoader(this.manager);
  hasModel = false;

  constructor(private readonly resources: PreviewResources) {
    super();
    this.decoder.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');
    this.previewGLTF.setDRACOLoader(this.decoder);
    registerSpecularGlossinessExtension(this.previewGLTF);
  }

  override async loadGLB(url: string): Promise<GLTF> {
    const gltf = await this.previewGLTF.loadAsync(url);
    gltf.scenes.forEach(scene => this.resources.collect(scene));
    this.hasModel = true;
    return gltf;
  }

  override async loadOBJ(url: string): Promise<THREE.Group> {
    const model = await this.previewOBJ.loadAsync(url);
    this.resources.collect(model);
    this.hasModel = true;
    return model;
  }

  dispose(): void {
    this.decoder.dispose();
  }
}

function getRenderer(): THREE.WebGLRenderer {
  if (!renderer) {
    renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(WIDTH, HEIGHT, false);
    renderer.setPixelRatio(1);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.12;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.setClearColor(0x000000, 0);
  }
  return renderer;
}

function enqueue(render: (target: THREE.WebGLRenderer) => Promise<string>): Promise<string> {
  const result = queue.then(async () => {
    if (releaseTimer !== undefined) clearTimeout(releaseTimer);
    releaseTimer = undefined;
    // Let selection feedback paint before loading or building a detailed scene.
    await new Promise<void>(resolve => setTimeout(resolve, 0));
    try {
      return await render(getRenderer());
    } finally {
      renderer?.renderLists.dispose();
      releaseTimer = setTimeout(() => {
        renderer?.dispose();
        renderer?.forceContextLoss();
        renderer = undefined;
        releaseTimer = undefined;
      }, 1500);
    }
  });
  // A failed asset must not block later requests or create an unhandled queue rejection.
  queue = result.then(() => undefined, () => undefined);
  return result;
}

function cached<T extends object>(
  cache: WeakMap<T, Promise<string>>,
  key: T,
  render: (target: THREE.WebGLRenderer) => Promise<string>,
): Promise<string> {
  const existing = cache.get(key);
  if (existing) return existing;
  const result = enqueue(render);
  cache.set(key, result);
  // Leave retries possible after a temporary asset or WebGL failure.
  void result.catch(() => cache.delete(key));
  return result;
}

/** Fit all eight box corners, including their projected depth and elevation. */
function frameCamera(bounds: THREE.Box3, direction: THREE.Vector3, padding: number): THREE.OrthographicCamera {
  const center = bounds.getCenter(new THREE.Vector3());
  const radius = Math.max(bounds.getSize(new THREE.Vector3()).length(), 1);
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, radius * 8);
  camera.position.copy(center).addScaledVector(direction.normalize(), radius * 3);
  camera.lookAt(center);
  camera.updateMatrixWorld(true);
  const projected = new THREE.Box3();
  for (const x of [bounds.min.x, bounds.max.x]) {
    for (const y of [bounds.min.y, bounds.max.y]) {
      for (const z of [bounds.min.z, bounds.max.z]) {
        projected.expandByPoint(new THREE.Vector3(x, y, z).applyMatrix4(camera.matrixWorldInverse));
      }
    }
  }
  const size = projected.getSize(new THREE.Vector3());
  const middle = projected.getCenter(new THREE.Vector3());
  const halfHeight = Math.max(size.y, size.x / ASPECT) * padding / 2;
  camera.left = middle.x - halfHeight * ASPECT;
  camera.right = middle.x + halfHeight * ASPECT;
  camera.top = middle.y + halfHeight;
  camera.bottom = middle.y - halfHeight;
  camera.updateProjectionMatrix();
  return camera;
}

/** Real game vehicle, its configured model transforms and a transparent studio floor. */
export function getCarPreview(config: VehicleConfig): Promise<string> {
  return cached(carImages, config, async target => {
    const scene = new THREE.Scene();
    const resources = new PreviewResources();
    const loader = new PreviewLoader(resources);
    let environment: THREE.WebGLRenderTarget | undefined;
    try {
      let view = await new CarConstructor(loader).build(config);
      if (!loader.hasModel) {
        // Even a missing optional model must retain the game's procedural wheels.
        if (config.wheelAnimation && config.wheelAnimation !== 'full') {
          resources.collect(view.group);
          view = await new CarConstructor().build({ ...config, modelPath: undefined, wheelAnimation: 'full' });
        }
        view.update(new THREE.Vector3(), new THREE.Quaternion(), config.wheelConnections.map(point => ({
          position: new THREE.Vector3(point.x, point.y - config.suspensionRestLength, point.z),
          steering: 0,
          roll: 0,
          radius: config.wheelRadius,
        })));
      }
      scene.add(view.group);
      const bounds = new THREE.Box3().setFromObject(view.group);
      view.group.position.y -= bounds.min.y;
      bounds.setFromObject(view.group);
      const size = bounds.getSize(new THREE.Vector3());
      const center = bounds.getCenter(new THREE.Vector3());

      const studio = new RoomEnvironment();
      const pmrem = new THREE.PMREMGenerator(target);
      try {
        environment = pmrem.fromScene(studio, 0.04);
        scene.environment = environment.texture;
      } finally {
        studio.dispose();
        pmrem.dispose();
      }
      scene.add(new THREE.HemisphereLight(0xe3eeff, 0x62728a, 2));
      const key = new THREE.DirectionalLight(0xffffff, 4);
      key.position.copy(center).add(new THREE.Vector3(-4, 7, 6));
      key.target.position.copy(center);
      key.castShadow = true;
      key.shadow.mapSize.set(2048, 2048);
      const extent = Math.max(size.x, size.z) * 1.5;
      Object.assign(key.shadow.camera, { left: -extent, right: extent, top: extent, bottom: -extent, near: 0.1, far: 40 });
      key.shadow.normalBias = 0.015;
      key.shadow.bias = -0.0001;
      scene.add(key, key.target);
      const rim = new THREE.DirectionalLight(0x91bbff, 2.3);
      rim.position.set(5, 3, -5);
      scene.add(rim);
      const floor = new THREE.Mesh(new THREE.PlaneGeometry(extent * 4, extent * 4), new THREE.ShadowMaterial({ opacity: 0.28 }));
      floor.rotation.x = -Math.PI / 2;
      floor.position.set(center.x, -0.012, center.z);
      floor.receiveShadow = true;
      scene.add(floor);
      target.render(scene, frameCamera(bounds, new THREE.Vector3(1.1, 0.65, 1.35), 1.14));
      return target.domElement.toDataURL('image/png');
    } finally {
      resources.collect(scene);
      resources.dispose();
      environment?.dispose();
      loader.dispose();
      scene.clear();
    }
  });
}

/** Real circuit geometry and scenery, photographed above the whole course. */
export function getTrackPreview(definition: TrackDefinition): Promise<string> {
  return cached(trackImages, definition, async target => {
    const scene = new THREE.Scene();
    const resources = new PreviewResources();
    const loader = new PreviewLoader(resources);
    let physics: PhysicsWorld | undefined;
    try {
      await initPhysics();
      physics = new PhysicsWorld(definition.gravity);
      const lighting = new Lighting(scene);
      lighting.apply(definition.lighting);
      // A small overview needs readable asphalt even for a night race.
      // These lights belong only to the thumbnail, leaving race lighting intact.
      const sky = new THREE.Color(definition.lighting.skyColor);
      if (sky.getHSL({ h: 0, s: 0, l: 0 }).l < 0.15) {
        if (definition.id === 'track_2') {
          // Neutral fill and moonlight reveal Midnight's asphalt and surroundings.
          scene.add(new THREE.AmbientLight(0xffffff, 3));
          const moon = new THREE.DirectionalLight(0xc8d8ff, 5);
          moon.position.set(-80, 140, 60);
          scene.add(moon);
        } else {
          scene.add(new THREE.AmbientLight(0xb5c9ef, 1.8));
        }
      }
      const track = await new TrackConstructor(physics.world, scene, loader).build(definition);
      const bounds = new THREE.Box3().setFromPoints(track.curve.getPoints(240));
      bounds.expandByVector(new THREE.Vector3(definition.roadWidth * 1.4, 5, definition.roadWidth * 1.4));
      // Imported stadiums and venues are part of the choice, so frame their full footprint.
      if (loader.hasModel) bounds.union(new THREE.Box3().setFromObject(track.group));
      const center = bounds.getCenter(new THREE.Vector3());
      lighting.followTarget(center);
      const camera = frameCamera(bounds, new THREE.Vector3(0.48, 1.35, 0.85), 1.08);
      // Keep the configured atmosphere, adjusted for the distance of an aerial camera.
      if (scene.fog instanceof THREE.Fog) {
        const cameraDistance = camera.position.distanceTo(center);
        scene.fog.near += cameraDistance;
        scene.fog.far += cameraDistance;
      }
      target.render(scene, camera);
      return target.domElement.toDataURL('image/png');
    } finally {
      // The temporary world owns every collider; freeing it also handles partial builds.
      resources.collect(scene);
      resources.dispose();
      loader.dispose();
      physics?.dispose();
      scene.clear();
    }
  });
}
