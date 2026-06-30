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
  /** Affiche/masque la visualisation de debug de la ligne centrale (touche L). */
  setCenterlineVisible(visible: boolean): void;
  dispose(): void;
}

const UP = new THREE.Vector3(0, 1, 0);

/** Angle minimal (rad) entre segments de bord avant d'appliquer un chanfrein. */
const BEVEL_ANGLE_MIN = 0.02;

/** Angle au-delà duquel un sommet de bord est lissé (évite les pics résiduels). */
const SPIKE_ANGLE_MAX = (85 * Math.PI) / 180;

function horizontalDir(from: THREE.Vector3, to: THREE.Vector3, out: THREE.Vector3): number {
  out.subVectors(to, from);
  out.y = 0;
  const len = out.length();
  if (len > 1e-12) out.multiplyScalar(1 / len);
  return len;
}

/** Rayon de courbure estimé (m) à partir de trois points consécutifs. */
function estimateCurvatureRadius(
  prev: THREE.Vector3,
  curr: THREE.Vector3,
  next: THREE.Vector3,
): number {
  const a = prev.distanceTo(curr);
  const b = curr.distanceTo(next);
  const c = prev.distanceTo(next);
  if (a < 1e-6 || b < 1e-6) return Infinity;
  const cross = new THREE.Vector3()
    .subVectors(next, curr)
    .cross(new THREE.Vector3().subVectors(prev, curr));
  const area2 = cross.length();
  if (area2 < 1e-12) return Infinity;
  return (a * b * c) / (2 * area2);
}

function smoothCircular(values: number[], window: number): number[] {
  const N = values.length;
  const out = new Array<number>(N);
  for (let i = 0; i < N; i++) {
    let sum = 0;
    for (let k = -window; k <= window; k++) {
      sum += values[(i + k + N) % N];
    }
    out[i] = sum / (window * 2 + 1);
  }
  return out;
}

function cornerAngle(prev: THREE.Vector3, curr: THREE.Vector3, next: THREE.Vector3): number {
  const dIn = new THREE.Vector3().subVectors(curr, prev);
  const dOut = new THREE.Vector3().subVectors(next, curr);
  dIn.y = 0;
  dOut.y = 0;
  if (dIn.lengthSq() < 1e-12 || dOut.lengthSq() < 1e-12) return 0;
  dIn.normalize();
  dOut.normalize();
  return Math.acos(Math.max(-1, Math.min(1, dIn.dot(dOut))));
}

/** Aplatit les pics résiduels en moyennant les sommets trop anguleux. */
function flattenPolylineSpikes(polyline: THREE.Vector3[]): void {
  const N = polyline.length;
  const blend = new THREE.Vector3();
  for (let pass = 0; pass < 3; pass++) {
    for (let i = 0; i < N; i++) {
      const prev = polyline[(i - 1 + N) % N];
      const curr = polyline[i];
      const next = polyline[(i + 1) % N];
      if (cornerAngle(prev, curr, next) <= SPIKE_ANGLE_MAX) continue;
      blend.copy(prev).add(next).multiplyScalar(0.5);
      curr.lerp(blend, 0.75);
    }
  }
}

/**
 * Décale une polyligne fermée le long de la courbe. Sur le bord intérieur des
 * virages serrés (rayon < demi-largeur), l'offset est réduit puis lissé pour
 * éviter les auto-intersections qui créent des pics de barrière.
 */
function computeOffsetPolyline(
  center: THREE.Vector3[],
  tangents: THREE.Vector3[],
  halfWidth: number,
  side: 'left' | 'right',
): THREE.Vector3[] {
  const N = center.length;
  const sign = side === 'left' ? 1 : -1;
  const offsets = new Array<number>(N);
  const dIn = new THREE.Vector3();
  const dOut = new THREE.Vector3();
  const normal = new THREE.Vector3();

  for (let i = 0; i < N; i++) {
    const prev = center[(i - 1 + N) % N];
    const curr = center[i];
    const next = center[(i + 1) % N];

    let offset = halfWidth;
    const lenIn = horizontalDir(prev, curr, dIn);
    const lenOut = horizontalDir(curr, next, dOut);
    if (lenIn > 1e-6 && lenOut > 1e-6) {
      const turn = dIn.x * dOut.z - dIn.z * dOut.x;
      const isInnerEdge = side === 'left' ? turn < 0 : turn > 0;
      if (isInnerEdge) {
        const radius = estimateCurvatureRadius(prev, curr, next);
        if (radius < halfWidth * 1.1) {
          offset = Math.max(radius * 0.95, halfWidth * 0.2);
        }
      }
    }
    offsets[i] = offset;
  }

  const smoothed = smoothCircular(offsets, 10);
  const result: THREE.Vector3[] = new Array(N);
  for (let i = 0; i < N; i++) {
    normal.crossVectors(UP, tangents[i]).multiplyScalar(sign);
    result[i] = center[i].clone().addScaledVector(normal, smoothed[i]);
  }

  flattenPolylineSpikes(result);
  return result;
}

/**
 * Longueur de chanfrein pour un coin de barrière en fonction de l'angle entre
 * segments et des longueurs de bord adjacentes.
 */
function computeBevelLength(angle: number, lenIn: number, lenOut: number): number {
  if (angle < BEVEL_ANGLE_MIN) return 0;
  const maxBevel = Math.min(lenIn * 0.48, lenOut * 0.48, 4.0);
  const sharpness = Math.min(1, (angle - BEVEL_ANGLE_MIN) / (Math.PI / 8));
  return maxBevel * sharpness;
}

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
      'centripetal',
      0.5,
    );
    const length = curve.getLength();

    // Corps fixe portant tous les colliders du circuit.
    const trackBody = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());

    const N = def.segments;
    const half = def.roadWidth / 2;
    const samples: THREE.Vector3[] = [];
    const tangents: THREE.Vector3[] = [];
    for (let i = 0; i < N; i++) {
      const u = i / N;
      const p = curve.getPointAt(u);
      const t = curve.getTangentAt(u).normalize();
      samples.push(p);
      tangents.push(t);
    }

    const leftEdge = computeOffsetPolyline(samples, tangents, half, 'left');
    const rightEdge = computeOffsetPolyline(samples, tangents, half, 'right');

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

    // --- Debug : ligne centrale (masquée par défaut, bascule avec la touche L) ---
    const centerlineDebug = this.buildCenterlineDebug(curve, def.centerline);
    centerlineDebug.visible = false;
    group.add(centerlineDebug);
    const setCenterlineVisible = (visible: boolean): void => {
      centerlineDebug.visible = visible;
    };

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

    return { group, curve, length, spawn, getProgress, setCenterlineVisible, dispose };
  }

  /**
   * Construit la visualisation de debug de la ligne centrale : un tube fin qui
   * suit la courbe + une sphère sur chaque point de contrôle. Surélevé au-dessus
   * de la route pour rester visible. Sert à vérifier que le tracé est aligné
   * avec la route d'un modèle GLB (touche L en jeu).
   */
  private buildCenterlineDebug(
    curve: THREE.CatmullRomCurve3,
    controlPoints: TrackDefinition['centerline'],
  ): THREE.Group {
    const debug = new THREE.Group();
    debug.name = 'centerline-debug';

    // Tube le long de la courbe (magenta vif), légèrement surélevé.
    const tubeGeo = new THREE.TubeGeometry(curve, 400, 0.18, 6, true);
    const tubeMat = new THREE.MeshBasicMaterial({ color: 0xff00ff, depthTest: false });
    const tube = new THREE.Mesh(tubeGeo, tubeMat);
    tube.position.y = 0.6;
    tube.renderOrder = 999;
    debug.add(tube);

    // Sphères cyan sur chaque point de contrôle (avec leur index implicite par l'ordre).
    const sphereGeo = new THREE.SphereGeometry(0.5, 10, 8);
    const sphereMat = new THREE.MeshBasicMaterial({ color: 0x00ffff, depthTest: false });
    for (const p of controlPoints) {
      const s = new THREE.Mesh(sphereGeo, sphereMat);
      s.position.set(p.x, p.y + 0.6, p.z);
      s.renderOrder = 999;
      debug.add(s);
    }

    return debug;
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
      color: 0x222222,
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

    const inTrim: THREE.Vector3[] = new Array(N);
    const outTrim: THREE.Vector3[] = new Array(N);
    const dIn = new THREE.Vector3();
    const dOut = new THREE.Vector3();
    const trim = new THREE.Vector3();

    for (let i = 0; i < N; i++) {
      const prev = edge[(i - 1 + N) % N];
      const curr = edge[i];
      const next = edge[(i + 1) % N];

      const lenIn = horizontalDir(prev, curr, dIn);
      const lenOut = horizontalDir(curr, next, dOut);
      const angle = lenIn > 1e-6 && lenOut > 1e-6
        ? Math.acos(Math.max(-1, Math.min(1, dIn.dot(dOut))))
        : 0;
      const bevel = computeBevelLength(angle, lenIn, lenOut);

      trim.copy(curr).addScaledVector(dIn, -bevel);
      inTrim[i] = trim.clone();
      trim.copy(curr).addScaledVector(dOut, bevel);
      outTrim[i] = trim.clone();
    }

    let vtx = 0;
    const addVerticalQuad = (b0: THREE.Vector3, b1: THREE.Vector3): void => {
      const base = vtx;
      positions.push(b0.x, b0.y, b0.z);
      positions.push(b0.x, b0.y + height, b0.z);
      positions.push(b1.x, b1.y, b1.z);
      positions.push(b1.x, b1.y + height, b1.z);
      indices.push(base, base + 1, base + 2);
      indices.push(base + 1, base + 3, base + 2);
      vtx += 4;
    };

    for (let i = 0; i < N; i++) {
      const j = (i + 1) % N;
      addVerticalQuad(outTrim[i], inTrim[j]);
      if (inTrim[i].distanceToSquared(outTrim[i]) > 1e-10) {
        addVerticalQuad(inTrim[i], outTrim[i]);
      }
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
