/**
 * CarConstructor — construit la représentation visuelle d'une voiture à partir
 * d'une VehicleConfig : placeholder Three.js procédural, ou modèle GLB/OBJ
 * chargé via AssetLoader (même principe que TrackConstructor).
 */
import * as THREE from 'three';
import type { VehicleConfig } from './types';
import type { WheelTransform } from '../../physics/VehicleController';
import { AssetLoader } from '../../utils/AssetLoader';

const DEFAULT_WHEEL_NAMES = ['Wheel_FL', 'Wheel_FR', 'Wheel_RL', 'Wheel_RR'];

/** Crée un pivot au centre géométrique de la roue pour braquer sur place. */
function createSteerPivot(wheel: THREE.Object3D): THREE.Object3D {
  const parent = wheel.parent;
  if (!parent) return wheel;

  wheel.updateWorldMatrix(true, false);
  const center = new THREE.Box3().setFromObject(wheel).getCenter(new THREE.Vector3());
  parent.worldToLocal(center);

  const pivot = new THREE.Object3D();
  pivot.position.copy(center);
  pivot.quaternion.copy(wheel.quaternion);

  const offset = wheel.position.clone().sub(center);
  parent.remove(wheel);
  parent.add(pivot);
  pivot.add(wheel);
  wheel.position.copy(offset);
  wheel.quaternion.identity();

  return pivot;
}

export class VehicleView {
  readonly group = new THREE.Group();
  private readonly wheelMeshes: THREE.Object3D[] = [];
  private readonly wheelBaseRotations: THREE.Euler[] = [];
  private readonly steerPhysicsIndices: number[] = [];
  private readonly steerWheelIndices = new Set<number>();
  private readonly wheelAnimation: 'full' | 'steer-only' | 'none';
  private readonly bodyMaterial: THREE.MeshStandardMaterial;

  constructor(config: VehicleConfig) {
    this.wheelAnimation = config.wheelAnimation ?? 'full';
    config.wheelConnections.forEach((wc, i) => {
      if (wc.steering) this.steerWheelIndices.add(i);
    });
    const he = config.chassisHalfExtents;

    this.bodyMaterial = new THREE.MeshStandardMaterial({
      color: config.color,
      metalness: 0.6,
      roughness: 0.35,
    });

    const body = new THREE.Mesh(new THREE.BoxGeometry(he.x * 2, he.y * 1.2, he.z * 2), this.bodyMaterial);
    body.position.y = 0.05;
    body.castShadow = true;
    body.receiveShadow = true;
    this.group.add(body);

    const cabin = new THREE.Mesh(
      new THREE.BoxGeometry(he.x * 1.5, he.y * 1.1, he.z * 1.0),
      new THREE.MeshStandardMaterial({ color: 0x10131a, metalness: 0.3, roughness: 0.2 }),
    );
    cabin.position.set(0, he.y * 1.0 + 0.1, -0.1);
    cabin.castShadow = true;
    this.group.add(cabin);

    const nose = new THREE.Mesh(
      new THREE.BoxGeometry(he.x * 1.6, he.y * 0.4, 0.3),
      new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0x222222 }),
    );
    nose.position.set(0, 0.0, he.z);
    this.group.add(nose);

    const wheelGeo = new THREE.CylinderGeometry(config.wheelRadius, config.wheelRadius, 0.3, 18);
    wheelGeo.rotateZ(Math.PI / 2);
    const wheelMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.8, metalness: 0.1 });
    for (let i = 0; i < config.wheelConnections.length; i++) {
      const wheel = new THREE.Mesh(wheelGeo, wheelMat);
      wheel.castShadow = true;
      const pivot = new THREE.Object3D();
      pivot.add(wheel);
      this.group.add(pivot);
      this.wheelMeshes.push(pivot);
    }
  }

  replaceWithModel(
    model: THREE.Object3D,
    wheelNames: string[],
    steerWheelMeshNames?: string[],
  ): void {
    this.group.clear();
    this.wheelMeshes.length = 0;
    this.wheelBaseRotations.length = 0;
    this.steerPhysicsIndices.length = 0;
    model.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    this.group.add(model);
    if (this.wheelAnimation === 'none') return;

    if (this.wheelAnimation === 'steer-only') {
      const names = steerWheelMeshNames ?? wheelNames.filter((_, i) => this.steerWheelIndices.has(i));
      const physicsIndices = [...this.steerWheelIndices].sort((a, b) => a - b);
      for (let i = 0; i < names.length; i++) {
        const wheel = model.getObjectByName(names[i]);
        if (!wheel) continue;
        const pivot = createSteerPivot(wheel);
        this.wheelMeshes.push(pivot);
        this.wheelBaseRotations.push(pivot.rotation.clone());
        this.steerPhysicsIndices.push(physicsIndices[i] ?? i);
      }
      return;
    }

    for (const name of wheelNames) {
      const w = model.getObjectByName(name);
      if (w) {
        this.wheelMeshes.push(w);
        this.wheelBaseRotations.push(w.rotation.clone());
      }
    }
  }

  update(position: THREE.Vector3, quaternion: THREE.Quaternion, wheels: WheelTransform[]): void {
    this.group.position.copy(position);
    this.group.quaternion.copy(quaternion);
    for (let i = 0; i < this.wheelMeshes.length; i++) {
      const pivot = this.wheelMeshes[i];
      const physIdx = this.wheelAnimation === 'steer-only'
        ? (this.steerPhysicsIndices[i] ?? i)
        : i;
      if (physIdx >= wheels.length) continue;
      const w = wheels[physIdx];
      if (this.wheelAnimation === 'full') {
        pivot.position.copy(w.position);
        pivot.rotation.set(0, w.steering, 0);
        const wheelMesh = pivot.children[0];
        if (wheelMesh) wheelMesh.rotation.x = w.roll;
      } else if (this.wheelAnimation === 'steer-only') {
        const base = this.wheelBaseRotations[i];
        pivot.rotation.set(base.x, base.y + w.steering, base.z);
      }
    }
  }

  dispose(): void {
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.geometry?.dispose();
        const mat = m.material;
        if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
        else mat?.dispose();
      }
    });
  }
}

export class CarConstructor {
  constructor(private readonly assetLoader?: AssetLoader) {}

  async build(config: VehicleConfig): Promise<VehicleView> {
    const view = new VehicleView(config);
    const useModel = !!config.modelPath;

    if (useModel && this.assetLoader) {
      const model = await this.assetLoader.tryLoadModel(config.modelPath!);
      if (model) {
        const modelRoot = model.clone();
        const scale = config.modelScale ?? 1;
        modelRoot.scale.setScalar(scale);
        if (config.modelRotation) {
          modelRoot.rotation.set(
            config.modelRotation.x,
            config.modelRotation.y,
            config.modelRotation.z,
          );
        }
        if (config.modelOffset) {
          modelRoot.position.set(
            config.modelOffset.x,
            config.modelOffset.y,
            config.modelOffset.z,
          );
        }
        const overrideMat = config.modelColor !== undefined
          ? new THREE.MeshStandardMaterial({
              color: config.modelColor,
              metalness: 0.55,
              roughness: 0.35,
            })
          : null;
        modelRoot.traverse((obj) => {
          if ((obj as THREE.Mesh).isMesh) {
            const mesh = obj as THREE.Mesh;
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            if (overrideMat) mesh.material = overrideMat;
          }
        });
        const wheelNames = config.wheelMeshNames ?? DEFAULT_WHEEL_NAMES;
        view.replaceWithModel(modelRoot, wheelNames, config.steerWheelMeshNames);
      }
    }

    return view;
  }
}
