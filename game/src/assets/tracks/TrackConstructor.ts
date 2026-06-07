/**
 * TrackConstructor — construit un circuit jouable à partir d'une TrackDefinition :
 *  - route (ruban extrudé le long d'une CatmullRomCurve3) + collider trimesh
 *  - barrières latérales + colliders trimesh
 *  - sol + ciel/brouillard (via Lighting), décor (arbres/rochers placeholder)
 *  - ligne de départ/arrivée, points de spawn et table de progression
 *
 * Conçu pour être remplacé par un GLB unique (Track_Road/Track_Wall/...) sans
 * changer le reste du code (voir README).
 */
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import type { TrackDefinition } from './types';
import type { VehicleSpawn } from '../../physics/VehicleController';
import { AssetLoader } from '../../utils/AssetLoader';

export interface BuiltTrack {
  group: THREE.Group;
  curve: THREE.CatmullRomCurve3;
  /** Longueur approximative de la boucle (m). */
  length: number;
  /** Spawn de départ (sur la ligne de départ, orienté vers l'avant). */
  spawn: VehicleSpawn;
  /** Progression [0..1] du point le plus proche sur la ligne centrale. */
  getProgress(point: THREE.Vector3): number;
  dispose(): void;
}

const UP = new THREE.Vector3(0, 1, 0);

export class TrackConstructor {
  constructor(
    private readonly world: RAPIER.World,
    private readonly scene: THREE.Scene,
    private readonly assetLoader?: AssetLoader,
  ) { }

  async build(def: TrackDefinition): Promise<BuiltTrack> {
    // Quand un modèle GLB est fourni, les maillages visuels procéduraux sont
    // masqués (le GLB remplace le visuel) sauf si showProceduralTrack est activé.
    const useGLB = !!def.modelPath;
    const showTrackVisuals = !useGLB || !!def.showProceduralTrack;

    const group = new THREE.Group();
    group.name = `track_${def.id}`;

    const curve = new THREE.CatmullRomCurve3(
      def.centerline.map((p) => new THREE.Vector3(p.x, p.y, p.z)),
      true,
      'catmullrom',
      0.5,
    );
    const length = curve.getLength();

    // Corps fixe portant tous les colliders du circuit.
    const trackBody = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());

    const N = def.segments;
    const half = def.roadWidth / 2;
    const samples: THREE.Vector3[] = [];
    const tangents: THREE.Vector3[] = [];
    const leftEdge: THREE.Vector3[] = [];
    const rightEdge: THREE.Vector3[] = [];

    for (let i = 0; i < N; i++) {
      const u = i / N;
      const p = curve.getPointAt(u);
      const t = curve.getTangentAt(u).normalize();
      const normal = new THREE.Vector3().crossVectors(UP, t).normalize(); // pointe vers la gauche
      samples.push(p);
      tangents.push(t);
      leftEdge.push(p.clone().addScaledVector(normal, half));
      rightEdge.push(p.clone().addScaledVector(normal, -half));
    }

    // --- Route ---
    this.buildRoad(group, trackBody, leftEdge, rightEdge, def, showTrackVisuals);

    // --- Barrières ---
    this.buildBarrier(group, trackBody, leftEdge, def.barrierHeight, 0x3344ff, showTrackVisuals);
    this.buildBarrier(group, trackBody, rightEdge, def.barrierHeight, 0xff3344, showTrackVisuals);

    // --- Sol ---
    this.buildGround(group, trackBody, def, !useGLB);

    // --- Décor (ignoré quand le GLB fournit l'environnement) ---
    if (!useGLB) {
      this.buildDecorations(group, def);
    }

    this.buildLights(group, def);

    // --- Ligne de départ / arrivée ---
    const startU = def.startU ?? 0;
    this.buildStartLine(group, curve, startU, def.roadWidth);

    // --- Spawn ---
    const sp = curve.getPointAt(startU);
    const st = curve.getTangentAt(startU).normalize();
    const yaw = Math.atan2(st.x, st.z);
    const spawnQuat = new THREE.Quaternion().setFromAxisAngle(UP, yaw);
    const spawn: VehicleSpawn = {
      position: new THREE.Vector3(sp.x, sp.y + 1.2, sp.z),
      quaternion: spawnQuat,
    };

    // --- Modèle GLB (environnement visuel) ---
    if (useGLB && this.assetLoader) {
      const gltf = await this.assetLoader.tryLoadGLB(def.modelPath!);
      if (gltf) {
        const modelGroup = gltf.scene.clone();
        const scale = def.modelScale ?? 1;
        modelGroup.scale.setScalar(scale);
        modelGroup.traverse((obj) => {
          if ((obj as THREE.Mesh).isMesh) {
            obj.castShadow = true;
            obj.receiveShadow = true;
          }
        });
        group.add(modelGroup);
      } else {
        // Fallback : afficher le visuel procédural si le GLB est absent.
        this.buildRoad(group, trackBody, leftEdge, rightEdge, def, true);
        this.buildBarrier(group, trackBody, leftEdge, def.barrierHeight, 0x3344ff, true);
        this.buildBarrier(group, trackBody, rightEdge, def.barrierHeight, 0xff3344, true);
        this.buildGround(group, trackBody, def, true);
        this.buildDecorations(group, def);
      }
    }

    this.scene.add(group);

    // Table de progression (recherche du plus proche échantillon).
    const getProgress = (point: THREE.Vector3): number => {
      let best = 0;
      let bestDist = Infinity;
      for (let i = 0; i < N; i++) {
        const dx = samples[i].x - point.x;
        const dz = samples[i].z - point.z;
        const d = dx * dx + dz * dz;
        if (d < bestDist) {
          bestDist = d;
          best = i;
        }
      }
      return best / N;
    };

    const dispose = (): void => {
      this.scene.remove(group);
      group.traverse((o) => {
        const light = o as THREE.Light;
        if (light.isLight) {
          light.dispose();
          return;
        }
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          m.geometry?.dispose();
          const mat = m.material;
          if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
          else mat?.dispose();
        }
      });
      this.world.removeRigidBody(trackBody);
    };

    return { group, curve, length, spawn, getProgress, dispose };
  }

  private buildRoad(
    group: THREE.Group,
    body: RAPIER.RigidBody,
    left: THREE.Vector3[],
    right: THREE.Vector3[],
    def: TrackDefinition,
    visible: boolean,
  ): void {
    const N = left.length;
    const positions: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];

    for (let i = 0; i < N; i++) {
      const y = left[i].y + 0.02;
      positions.push(left[i].x, y, left[i].z);
      positions.push(right[i].x, right[i].y + 0.02, right[i].z);
      const v = i / N;
      uvs.push(0, v * 40, 1, v * 40);
    }
    for (let i = 0; i < N; i++) {
      const j = (i + 1) % N;
      const li = 2 * i;
      const ri = 2 * i + 1;
      const lj = 2 * j;
      const rj = 2 * j + 1;
      indices.push(li, ri, lj);
      indices.push(ri, rj, lj);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    geo.computeVertexNormals();

    const mat = new THREE.MeshStandardMaterial({
      color: 0x080808,
      roughness: 0.98,
      metalness: 0.0,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    if (visible) group.add(mesh);

    // Collider trimesh dérivé du maillage de la route.
    const collider = RAPIER.ColliderDesc.trimesh(
      new Float32Array(positions),
      new Uint32Array(indices),
    )
      .setFriction(def.roadFriction)
      .setRestitution(0);
    this.world.createCollider(collider, body);
  }

  private buildBarrier(
    group: THREE.Group,
    body: RAPIER.RigidBody,
    edge: THREE.Vector3[],
    height: number,
    color: number,
    visible: boolean,
  ): void {
    const N = edge.length;
    const positions: number[] = [];
    const indices: number[] = [];
    for (let i = 0; i < N; i++) {
      positions.push(edge[i].x, edge[i].y, edge[i].z); // bas
      positions.push(edge[i].x, edge[i].y + height, edge[i].z); // haut
    }
    for (let i = 0; i < N; i++) {
      const j = (i + 1) % N;
      const bi = 2 * i;
      const ti = 2 * i + 1;
      const bj = 2 * j;
      const tj = 2 * j + 1;
      indices.push(bi, ti, bj);
      indices.push(ti, tj, bj);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();

    const mat = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.5,
      metalness: 0.2,
      emissive: new THREE.Color(color).multiplyScalar(0.15),
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    if (visible) group.add(mesh);

    const collider = RAPIER.ColliderDesc.trimesh(
      new Float32Array(positions),
      new Uint32Array(indices),
    )
      .setFriction(0.2)
      .setRestitution(0.15);
    this.world.createCollider(collider, body);
  }

  private buildGround(
    group: THREE.Group,
    body: RAPIER.RigidBody,
    def: TrackDefinition,
    visible: boolean,
  ): void {
    const size = def.groundSize;
    const geo = new THREE.PlaneGeometry(size, size, 1, 1);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshStandardMaterial({ color: def.groundColor, roughness: 1.0, metalness: 0.0 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.y = -0.02;
    mesh.receiveShadow = true;
    if (visible) group.add(mesh);

    // Collider sol : pavé fin (plus robuste qu'un demi-espace pour le raycast).
    const collider = RAPIER.ColliderDesc.cuboid(size / 2, 0.1, size / 2)
      .setTranslation(0, -0.12, 0)
      .setFriction(0.7);
    this.world.createCollider(collider, body);
  }

  private buildLights(group: THREE.Group, def: TrackDefinition): void {
    if (!def.lights?.length) return;

    const lightsGroup = new THREE.Group();
    lightsGroup.name = 'lights';
    for (const spec of def.lights) {
      if (spec.type !== 'point') continue;
      const light = new THREE.PointLight(spec.color, spec.intensity, spec.distance ?? 0, spec.decay ?? 2);
      light.position.set(spec.position.x, spec.position.y, spec.position.z);
      lightsGroup.add(light);
    }
    group.add(lightsGroup);
  }

  private buildDecorations(group: THREE.Group, def: TrackDefinition): void {
    if (def.decorations.length === 0) return;

    const trunkGeo = new THREE.CylinderGeometry(0.25, 0.35, 2.2, 6);
    const foliageGeo = new THREE.ConeGeometry(1.4, 3.5, 7);
    const rockGeo = new THREE.IcosahedronGeometry(1.0, 0);
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5a3b22, roughness: 1 });
    const foliageMat = new THREE.MeshStandardMaterial({ color: 0x2f6b2f, roughness: 1 });
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x6b6b70, roughness: 1 });

    const deco = new THREE.Group();
    deco.name = 'decorations';
    for (const d of def.decorations) {
      const s = d.scale ?? 1;
      let obj: THREE.Object3D;
      if (d.type === 'rock') {
        const rock = new THREE.Mesh(rockGeo, rockMat);
        rock.position.y = 0.5 * s;
        rock.scale.setScalar(s);
        rock.castShadow = true;
        obj = rock;
      } else {
        const tree = new THREE.Group();
        const trunk = new THREE.Mesh(trunkGeo, trunkMat);
        trunk.position.y = 1.1;
        const foliage = new THREE.Mesh(foliageGeo, foliageMat);
        foliage.position.y = 3.95;
        trunk.castShadow = true;
        foliage.castShadow = true;
        tree.add(trunk, foliage);
        tree.scale.setScalar(s);
        obj = tree;
      }
      obj.position.set(d.position.x, d.position.y, d.position.z);
      obj.rotation.y = d.rotationY ?? 0;
      deco.add(obj);
    }
    group.add(deco);
  }

  private buildStartLine(
    group: THREE.Group,
    curve: THREE.CatmullRomCurve3,
    startU: number,
    roadWidth: number,
  ): void {
    const p = curve.getPointAt(startU);
    const t = curve.getTangentAt(startU).normalize();
    const yaw = Math.atan2(t.x, t.z);

    // Damier noir/blanc en plan posé sur la route.
    const cols = 8;
    const rows = 2;
    const cellW = roadWidth / cols;
    const cellL = 1.2;
    const lineGroup = new THREE.Group();
    const white = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 });
    const black = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.6 });
    const cellGeo = new THREE.PlaneGeometry(cellW, cellL);
    cellGeo.rotateX(-Math.PI / 2);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const mat = (r + c) % 2 === 0 ? white : black;
        const cell = new THREE.Mesh(cellGeo, mat);
        cell.position.set((c - cols / 2 + 0.5) * cellW, 0.04, (r - rows / 2 + 0.5) * cellL);
        lineGroup.add(cell);
      }
    }
    lineGroup.position.copy(p);
    lineGroup.rotation.y = yaw;
    group.add(lineGroup);
  }
}
