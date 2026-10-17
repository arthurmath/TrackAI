/**
 * CarConstructor — construit la représentation visuelle d'une voiture à partir
 * d'une VehicleConfig (placeholder Three.js procédural), ou modèle GLB
 * présent dans public/models/cars/ et chargé via AssetLoader.
 */
import * as THREE from 'three';
import type { VehicleConfig } from './types';
import type { WheelTransform } from '../../physics/VehicleController';
import { AssetLoader } from '../../utils/AssetLoader';

const DEFAULT_WHEEL_NAMES = ['Wheel_FL', 'Wheel_FR', 'Wheel_RL', 'Wheel_RR'];
const WORLD_UP = new THREE.Vector3(0, 1, 0);
// +Z is forward: a negative rotation around X raises the nose.
const MODEL_PITCH = -THREE.MathUtils.degToRad(1);
const PITCH_AXIS = new THREE.Vector3(1, 0, 0);

interface SplitBuffers {
  position: number[];
  normal: number[];
  uv: number[];
  index: number[];
}

/**
 * Sépare un mesh d'essieu fusionné (roue G + roue D) en deux meshes distincts.
 * Préserve position, normales et UV pour garder le même rendu que l'essieu arrière.
 */
function splitMergedAxleMesh(mesh: THREE.Mesh): THREE.Mesh[] {
  const pos = mesh.geometry.getAttribute('position');
  if (!pos) return [mesh];

  mesh.geometry.computeBoundingBox();
  const box = mesh.geometry.boundingBox!;
  const size = new THREE.Vector3();
  box.getSize(size);
  const depth = Math.max(size.y, size.z);
  if (size.x < depth * 1.2) return [mesh];

  const normalAttr = mesh.geometry.getAttribute('normal');
  const uvAttr = mesh.geometry.getAttribute('uv');
  const midX = (box.min.x + box.max.x) * 0.5;
  const left: SplitBuffers = { position: [], normal: [], uv: [], index: [] };
  const right: SplitBuffers = { position: [], normal: [], uv: [], index: [] };
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const uv = new THREE.Vector2();

  const readVec3 = (
    attr: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
    idx: number,
    target: THREE.Vector3,
  ) => {
    target.fromBufferAttribute(attr as THREE.BufferAttribute, idx);
    return target;
  };

  const appendVertex = (srcIndex: number, dest: SplitBuffers) => {
    readVec3(pos, srcIndex, a);
    dest.position.push(a.x, a.y, a.z);
    if (normalAttr) {
      readVec3(normalAttr, srcIndex, a);
      dest.normal.push(a.x, a.y, a.z);
    }
    if (uvAttr) {
      uv.fromBufferAttribute(uvAttr as THREE.BufferAttribute, srcIndex);
      dest.uv.push(uv.x, uv.y);
    }
  };

  const pushTri = (ia: number, ib: number, ic: number, dest: SplitBuffers) => {
    const base = dest.position.length / 3;
    appendVertex(ia, dest);
    appendVertex(ib, dest);
    appendVertex(ic, dest);
    dest.index.push(base, base + 1, base + 2);
  };

  const processTri = (ia: number, ib: number, ic: number) => {
    a.fromBufferAttribute(pos, ia);
    b.fromBufferAttribute(pos, ib);
    c.fromBufferAttribute(pos, ic);
    const cx = (a.x + b.x + c.x) / 3;
    if (cx < midX) pushTri(ia, ib, ic, left);
    else pushTri(ia, ib, ic, right);
  };

  const index = mesh.geometry.index;
  if (index) {
    for (let i = 0; i < index.count; i += 3) {
      processTri(index.getX(i), index.getX(i + 1), index.getX(i + 2));
    }
  } else {
    for (let i = 0; i < pos.count; i += 3) {
      processTri(i, i + 1, i + 2);
    }
  }

  if (left.position.length === 0 || right.position.length === 0) return [mesh];

  const parent = mesh.parent;
  const material = mesh.material;
  mesh.geometry.dispose();
  mesh.removeFromParent();

  const buildHalf = (data: SplitBuffers, suffix: string): THREE.Mesh => {
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(data.position, 3));
    if (data.normal.length > 0) {
      geom.setAttribute('normal', new THREE.Float32BufferAttribute(data.normal, 3));
    } else {
      geom.computeVertexNormals();
    }
    if (data.uv.length > 0) {
      geom.setAttribute('uv', new THREE.Float32BufferAttribute(data.uv, 2));
    }
    geom.setIndex(data.index);
    const half = new THREE.Mesh(geom, material);
    half.name = `${mesh.name}_${suffix}`;
    half.castShadow = mesh.castShadow;
    half.receiveShadow = mesh.receiveShadow;
    parent?.add(half);
    return half;
  };

  return [buildHalf(left, 'L'), buildHalf(right, 'R')];
}

/** Trie les meshes de roue de gauche à droite (X croissant en espace local). */
function sortWheelsLeftToRight(wheels: THREE.Object3D[]): THREE.Object3D[] {
  const ca = new THREE.Vector3();
  const cb = new THREE.Vector3();
  return [...wheels].sort((a, b) => {
    new THREE.Box3().setFromObject(a).getCenter(ca);
    new THREE.Box3().setFromObject(b).getCenter(cb);
    return ca.x - cb.x;
  });
}

/** Résout un nom de mesh en une ou plusieurs roues (sépare les essieux fusionnés). */
function resolveSteerWheels(model: THREE.Object3D, name: string): THREE.Object3D[] {
  const obj = model.getObjectByName(name);
  if (!obj) return [];
  if ((obj as THREE.Mesh).isMesh) {
    return sortWheelsLeftToRight(splitMergedAxleMesh(obj as THREE.Mesh));
  }
  return [obj];
}

interface SteerPivotSetup {
  pivot: THREE.Object3D;
  /** Axe de braquage (Y monde) exprimé dans l'espace local du parent du pivot. */
  steerAxis: THREE.Vector3;
}

/**
 * Crée un pivot au centre de la roue sans déplacer le mesh.
 * L'axe de braquage est toujours la verticale monde (Y), pas l'axe local Z du GLB.
 */
function createSteerPivot(wheel: THREE.Object3D): SteerPivotSetup {
  const parent = wheel.parent;
  if (!parent) {
    return { pivot: wheel, steerAxis: WORLD_UP.clone() };
  }

  wheel.updateWorldMatrix(true, false);
  parent.updateWorldMatrix(true, false);

  const pivotWorld = new THREE.Vector3();
  const mesh = wheel as THREE.Mesh;
  if (mesh.isMesh && mesh.geometry) {
    mesh.geometry.computeBoundingBox();
    pivotWorld.copy(mesh.geometry.boundingBox!.getCenter(new THREE.Vector3()));
    mesh.localToWorld(pivotWorld);
  } else {
    new THREE.Box3().setFromObject(wheel).getCenter(pivotWorld);
  }

  const meshWorldPos = new THREE.Vector3();
  wheel.getWorldPosition(meshWorldPos);
  const pivotLocal = parent.worldToLocal(pivotWorld.clone());
  const meshLocal = parent.worldToLocal(meshWorldPos.clone());

  const pivot = new THREE.Object3D();
  pivot.position.copy(pivotLocal);
  parent.remove(wheel);
  parent.add(pivot);
  pivot.add(wheel);
  // Préserver la position monde : origine du mesh = meshLocal, pivot = pivotLocal
  wheel.position.copy(meshLocal.sub(pivotLocal));
  wheel.quaternion.identity();
  wheel.rotation.set(0, 0, 0);

  const invParentWorld = new THREE.Matrix4().copy(parent.matrixWorld).invert();
  const steerAxis = WORLD_UP.clone().transformDirection(invParentWorld).normalize();

  return { pivot, steerAxis };
}

export class VehicleView {
  readonly group = new THREE.Group();
  private readonly wheelMeshes: THREE.Object3D[] = [];
  private readonly wheelBaseRotations: THREE.Euler[] = [];
  private readonly wheelBaseQuaternions: THREE.Quaternion[] = [];
  private readonly steerAxes: THREE.Vector3[] = [];
  private readonly steerPhysicsIndices: number[] = [];
  private readonly steerWheelIndices = new Set<number>();
  private readonly wheelAnimation: 'full' | 'steer-only' | 'none';
  private readonly visualSteerScale: number;
  private readonly bodyMaterial: THREE.MeshStandardMaterial;

  constructor(config: VehicleConfig) {
    this.wheelAnimation = config.wheelAnimation ?? 'full';
    this.visualSteerScale = config.visualSteerScale ?? 1;
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
    this.wheelBaseQuaternions.length = 0;
    this.steerAxes.length = 0;
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
      let physSlot = 0;
      for (const name of names) {
        const wheels = resolveSteerWheels(model, name);
        for (const wheel of wheels) {
          const { pivot, steerAxis } = createSteerPivot(wheel);
          this.wheelMeshes.push(pivot);
          this.wheelBaseQuaternions.push(pivot.quaternion.clone());
          this.steerAxes.push(steerAxis);
          this.steerPhysicsIndices.push(physicsIndices[physSlot] ?? physSlot);
          physSlot++;
        }
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
        const baseQ = this.wheelBaseQuaternions[i];
        const axis = this.steerAxes[i] ?? WORLD_UP;
        const steerQ = new THREE.Quaternion().setFromAxisAngle(axis, w.steering * this.visualSteerScale);
        pivot.quaternion.copy(baseQ).multiply(steerQ);
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
        // Pitch the complete visual around the rear axle, keeping its height.
        // Apply in chassis space, after each model's own import orientation.
        const rearWheels = config.wheelConnections.filter((wheel) => !wheel.steering);
        if (rearWheels.length > 0) {
          const rearAxle = new THREE.Vector3();
          for (const wheel of rearWheels) {
            rearAxle.add(new THREE.Vector3(
              wheel.x,
              wheel.y - config.suspensionRestLength,
              wheel.z,
            ));
          }
          rearAxle.divideScalar(rearWheels.length);
          const pitch = new THREE.Quaternion().setFromAxisAngle(PITCH_AXIS, MODEL_PITCH);
          modelRoot.position.sub(rearAxle).applyQuaternion(pitch).add(rearAxle);
          modelRoot.quaternion.premultiply(pitch);
        }
        // OBJ exports are often untextured; GLB materials (maps) must be preserved.
        const isUntexturedObj = config.modelPath!.toLowerCase().endsWith('.obj');
        const overrideMat = config.modelColor !== undefined && isUntexturedObj
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
