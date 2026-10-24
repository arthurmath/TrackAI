import * as THREE from 'three';
import type { TrackDefinition } from './types';
import { trackBankAngle, trackLateral } from './TrackBanking';

type Instance = {
  x: number; y: number; z: number;
  sx: number; sy: number; sz: number;
  yaw: number; color: THREE.Color;
};

function seededRandom(seed: number): () => number {
  let value = seed;
  return () => {
    value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

function addInstances(
  parent: THREE.Group, name: string, geometry: THREE.BufferGeometry,
  material: THREE.Material, instances: Instance[], shadows = true,
): void {
  if (!instances.length) { geometry.dispose(); material.dispose(); return; }
  const mesh = new THREE.InstancedMesh(geometry, material, instances.length);
  const transform = new THREE.Object3D();
  mesh.name = name;
  for (let i = 0; i < instances.length; i++) {
    const item = instances[i];
    transform.position.set(item.x, item.y, item.z);
    transform.rotation.set(0, item.yaw, 0);
    transform.scale.set(item.sx, item.sy, item.sz);
    transform.updateMatrix();
    mesh.setMatrixAt(i, transform.matrix);
    mesh.setColorAt(i, item.color);
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.castShadow = shadows;
  mesh.receiveShadow = true;
  mesh.computeBoundingSphere();
  parent.add(mesh);
}

/** A road-height valley, close forest corridors and open alpine viewpoints. */
export function buildMountainEnvironment(
  group: THREE.Group,
  samples: THREE.Vector3[],
  roadWidth: number,
  groundSize: number,
  banking?: TrackDefinition['banking'],
): THREE.BufferGeometry {
  const environment = new THREE.Group();
  environment.name = 'alpine-forest-environment';
  group.add(environment);
  const rng = seededRandom(20261024);
  const bounds = new THREE.Box3().setFromPoints(samples);
  const center = bounds.getCenter(new THREE.Vector3());
  const half = roadWidth / 2;
  const radius = Math.max(...samples.map(p => Math.hypot(p.x - center.x, p.z - center.z)));
  const n = samples.length;
  const banks = samples.map((_, i) => trackBankAngle(i / n, banking));
  const laterals = samples.map((_, i) => trackLateral(
    samples[(i + 1) % n].clone().sub(samples[(i - 1 + n) % n]).normalize(), banks[i],
  ));
  const roadQuery = (x: number, z: number): { distance: number; y: number; u: number; bank: number } => {
    let distanceSq = Infinity;
    let y = 0;
    let progress = 0;
    let bank = 0;
    // Exact distance to every sampled segment, including the loop closure.
    for (let i = 0; i < n; i++) {
      const a = samples[i];
      const b = samples[(i + 1) % n];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const denominator = dx * dx + dz * dz;
      const t = denominator > 0 ? THREE.MathUtils.clamp(((x - a.x) * dx + (z - a.z) * dz) / denominator, 0, 1) : 0;
      const d = (x - a.x - t * dx) ** 2 + (z - a.z - t * dz) ** 2;
      if (d < distanceSq) {
        distanceSq = d;
        y = a.y + (b.y - a.y) * t;
        progress = (i + t) / n;
        bank = banks[i] + (banks[(i + 1) % n] - banks[i]) * t;
      }
    }
    return { distance: Math.sqrt(distanceSq), y, u: progress, bank };
  };
  const naturalHeight = (x: number, z: number): number => {
    const radial = Math.hypot(x - center.x, z - center.z);
    return 11 + 12 * Math.sin(x * 0.008 + z * 0.003)
      + 10 * Math.cos(z * 0.011 - x * 0.002)
      + 5 * Math.sin(x * 0.026 + z * 0.017)
      + THREE.MathUtils.smoothstep(radial, radius + 60, radius + 360) * 95;
  };
  const terrainHeight = (x: number, z: number): number => {
    const natural = naturalHeight(x, z);
    // Queries far outside the whole circuit need no polyline search.
    if (x < bounds.min.x - 170 || x > bounds.max.x + 170
      || z < bounds.min.z - 170 || z > bounds.max.z + 170) return natural;
    const road = roadQuery(x, z);
    const shelf = road.y - Math.abs(Math.sin(road.bank)) * half - 4.5;
    const blend = THREE.MathUtils.smoothstep(road.distance, half + 7, half + 140);
    return THREE.MathUtils.lerp(shelf, natural, blend);
  };
  const plantingHeight = (x: number, z: number, road = roadQuery(x, z)): number => {
    if (road.distance > half + 14) return terrainHeight(x, z);
    const progress = THREE.MathUtils.euclideanModulo(road.u, 1) * n;
    const index = Math.floor(progress);
    const t = progress - index;
    const p = samples[index].clone().lerp(samples[(index + 1) % n], t);
    const lateral = laterals[index].clone().lerp(laterals[(index + 1) % n], t).normalize();
    const side = (x - p.x) * lateral.x + (z - p.z) * lateral.z >= 0 ? 1 : -1;
    const edge = p.clone().addScaledVector(lateral, side * half);
    const horizontal = lateral.multiplyScalar(side).setY(0).normalize();
    const offset = (x - edge.x) * horizontal.x + (z - edge.z) * horizontal.z;
    if (offset < 0 || offset > 14) return terrainHeight(x, z);
    const outerX = edge.x + horizontal.x * 14;
    const outerZ = edge.z + horizontal.z * 14;
    const offsets = [0, 1.4, 5.5, 14];
    const heights = [edge.y - 0.08, edge.y - 0.22, edge.y - 1.6, terrainHeight(outerX, outerZ) - 0.1];
    for (let band = 0; band < 3; band++) {
      if (offset <= offsets[band + 1]) return THREE.MathUtils.lerp(
        heights[band], heights[band + 1], (offset - offsets[band]) / (offsets[band + 1] - offsets[band]),
      );
    }
    return heights[3];
  };

  const terrainGeometry = new THREE.PlaneGeometry(groundSize, groundSize, 240, 240);
  terrainGeometry.rotateX(-Math.PI / 2);
  const terrainPositions = terrainGeometry.getAttribute('position');
  const terrainColors: number[] = [];
  const grass = new THREE.Color(0x647d3f);
  const meadow = new THREE.Color(0xa1a363);
  const color = new THREE.Color();
  for (let i = 0; i < terrainPositions.count; i++) {
    const x = terrainPositions.getX(i);
    const z = terrainPositions.getZ(i);
    terrainPositions.setY(i, terrainHeight(x, z));
    const variation = THREE.MathUtils.clamp(0.4 + Math.sin(x * 0.035 + Math.cos(z * 0.018) * 2) * 0.24
      + Math.cos(z * 0.056 - x * 0.017) * 0.15, 0, 1);
    color.copy(grass).lerp(meadow, variation);
    terrainColors.push(color.r, color.g, color.b);
  }
  terrainGeometry.setAttribute('color', new THREE.Float32BufferAttribute(terrainColors, 3));
  terrainGeometry.computeVertexNormals();
  const terrain = new THREE.Mesh(terrainGeometry, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }));
  terrain.name = 'alpine-valley-terrain';
  terrain.receiveShadow = true;
  environment.add(terrain);

  // These exact strips join the banked road edges to the coarser valley mesh.
  // Their top is below the asphalt, with a narrow gravel verge then a grass bank.
  const embankmentPositions: number[] = [];
  const embankmentColors: number[] = [];
  const embankmentIndices: number[] = [];
  const gravel = new THREE.Color(0x8d8b70);
  const verge = new THREE.Color(0x728148);
  for (const side of [-1, 1]) {
    const start = embankmentPositions.length / 3;
    for (let i = 0; i <= n; i++) {
      const index = i % n;
      const p = samples[index];
      const lateral = laterals[index].clone().multiplyScalar(side);
      const edge = p.clone().addScaledVector(lateral, half);
      const horizontal = lateral.clone().setY(0).normalize();
      for (let band = 0; band < 4; band++) {
        const offset = [0, 1.4, 5.5, 14][band];
        const x = edge.x + horizontal.x * offset;
        const z = edge.z + horizontal.z * offset;
        const y = band === 0 ? edge.y - 0.08 : band === 1 ? edge.y - 0.22
          : band === 2 ? edge.y - 1.6 : terrainHeight(x, z) - 0.1;
        embankmentPositions.push(x, y, z);
        color.copy(band < 2 ? gravel : verge);
        color.multiplyScalar(0.93 + Math.sin(i * 0.17) * 0.06);
        embankmentColors.push(color.r, color.g, color.b);
      }
      if (i < n) for (let band = 0; band < 3; band++) {
        const a = start + i * 4 + band;
        embankmentIndices.push(a, a + 4, a + 1, a + 1, a + 4, a + 5);
      }
    }
  }
  const embankmentGeometry = new THREE.BufferGeometry();
  embankmentGeometry.setAttribute('position', new THREE.Float32BufferAttribute(embankmentPositions, 3));
  embankmentGeometry.setAttribute('color', new THREE.Float32BufferAttribute(embankmentColors, 3));
  embankmentGeometry.setIndex(embankmentIndices);
  embankmentGeometry.computeVertexNormals();
  const embankment = new THREE.Mesh(embankmentGeometry, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, side: THREE.DoubleSide }));
  embankment.name = 'alpine-road-embankments';
  embankment.receiveShadow = true;
  environment.add(embankment);

  // Separate irregular foothills and high rock ridges, with pale summit caps.
  for (let layer = 0; layer < 3; layer++) {
    const vertices: number[] = [];
    const colors: number[] = [];
    const indices: number[] = [];
    const count = 180;
    const baseRadius = radius + 150 + layer * 260;
    for (let i = 0; i <= count; i++) {
      const angle = i / count * Math.PI * 2;
      const irregular = 30 * Math.sin(angle * 7 + layer) + 18 * Math.cos(angle * 13 - layer);
      const crestRadius = baseRadius + 170 + irregular;
      const height = 175 + layer * 100 + 55 * Math.sin(angle * 5 + layer * 1.7)
        + 29 * Math.sin(angle * 17 - layer) + 17 * Math.cos(angle * 29);
      const radial = [baseRadius - 55, crestRadius - 85, crestRadius, crestRadius + 180];
      const heights = [12, height * 0.53, height, 5];
      for (let band = 0; band < 4; band++) {
        vertices.push(center.x + Math.cos(angle) * radial[band], heights[band], center.z + Math.sin(angle) * radial[band]);
        color.setHex(band === 0 ? 0x6e815e : band === 2 && height > 310 ? 0xe0e7df
          : layer === 0 ? 0x81917e : layer === 1 ? 0x939fa0 : 0xa3b1b9);
        color.multiplyScalar(0.94 + Math.sin(angle * 23 + layer) * 0.06);
        colors.push(color.r, color.g, color.b);
      }
      if (i < count) for (let band = 0; band < 3; band++) {
        const a = i * 4 + band;
        indices.push(a, a + 1, a + 4, a + 1, a + 5, a + 4);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    const mountains = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true, side: THREE.DoubleSide }));
    mountains.name = `alpine-mountain-range-${layer}`;
    environment.add(mountains);
  }

  const trunks: Instance[] = [];
  const pines: Instance[] = [];
  const crowns: Instance[] = [];
  const rocks: Instance[] = [];
  const shrubs: Instance[] = [];
  const palette = (values: number[]): THREE.Color => new THREE.Color(values[Math.floor(rng() * values.length)]);
  const forestAt = (u: number): boolean => (u > 0.13 && u < 0.34)
    || (u > 0.48 && u < 0.66) || (u > 0.76 && u < 0.90);
  const addTree = (x: number, z: number, scale: number, conifer: boolean): void => {
    const road = roadQuery(x, z);
    // Include crown radius in clearance, even where a different bend passes nearby.
    if (road.distance < half + (conifer ? 3.1 : 4.0) * scale + 1.6) return;
    const y = plantingHeight(x, z, road);
    const height = (conifer ? 18 : 14) * scale;
    trunks.push({ x, y: y + height * 0.33, z, sx: 0.35 * scale, sy: height * 0.66, sz: 0.35 * scale,
      yaw: rng() * Math.PI, color: palette([0x6c5840, 0x75634c, 0x82705a]) });
    if (conifer) {
      for (let tier = 0; tier < 4; tier++) {
        const radius = (3.1 - tier * 0.6) * scale;
        pines.push({ x, y: y + (6.5 + tier * 3.0) * scale, z, sx: radius,
          sy: (7.8 - tier * 1.05) * scale, sz: radius, yaw: rng() * Math.PI,
          color: palette([0x34573f, 0x3c6245, 0x4b7050, 0x52794e]) });
      }
    } else {
      for (let lobe = 0; lobe < 4; lobe++) {
        const angle = lobe * Math.PI * 2 / 3;
        const spread = lobe === 3 ? 0 : scale * 1.3;
        const radius = (lobe === 3 ? 2.7 : 2.3) * scale;
        crowns.push({ x: x + Math.cos(angle) * spread, y: y + height * (lobe === 3 ? 0.87 : 0.69),
          z: z + Math.sin(angle) * spread, sx: radius, sy: radius * 1.15, sz: radius,
          yaw: rng() * Math.PI, color: palette([0x56713e, 0x638246, 0x78934c, 0x486c42]) });
      }
    }
  };
  // Thick but intermittent corridors; the summit and long southern straight open up.
  for (let i = 0; i < n; i += 3) {
    const u = i / n;
    if (!forestAt(u)) continue;
    const p = samples[i];
    const lateral = laterals[i].clone().setY(0).normalize();
    for (const side of [-1, 1]) for (let row = 0; row < 3; row++) {
      if (rng() < 0.13) continue;
      const offset = half + 5.7 + row * 10 + rng() * 4;
      const jitter = (rng() - 0.5) * 5;
      addTree(p.x + lateral.x * offset * side + lateral.z * jitter,
        p.z + lateral.z * offset * side - lateral.x * jitter, 0.85 + rng() * 0.5, rng() < 0.81);
    }
  }
  // Smaller detached groves give depth beyond the close tree line.
  for (let i = 0; i < 2600; i++) {
    const x = bounds.min.x - 130 + rng() * (bounds.max.x - bounds.min.x + 260);
    const z = bounds.min.z - 130 + rng() * (bounds.max.z - bounds.min.z + 260);
    const road = roadQuery(x, z);
    if (road.distance < half + 26 || road.distance > 145) continue;
    const density = forestAt(road.u) ? 0.86 : 0.12;
    if (rng() > density) continue;
    addTree(x, z, 0.75 + rng() * 0.7, rng() < 0.86);
  }
  for (let i = 0; i < n; i += 3) {
    const p = samples[i];
    const lateral = laterals[i].clone().setY(0).normalize();
    for (const side of [-1, 1]) {
      const offset = half + 4 + rng() * 30;
      const x = p.x + lateral.x * offset * side;
      const z = p.z + lateral.z * offset * side;
      const road = roadQuery(x, z);
      const size = 0.7 + rng() * 1.7;
      const rockWidth = size * (1 + rng());
      if (road.distance < half + rockWidth + 1.5) continue;
      const y = plantingHeight(x, z, road);
      if (rng() < 0.45) rocks.push({ x, y: y + size * 0.3, z, sx: rockWidth, sy: size * 0.85, sz: size,
        yaw: rng() * Math.PI, color: palette([0x8e9588, 0x7a8378, 0x9ba094, 0x747e7a]) });
      else if (forestAt(i / n)) shrubs.push({ x, y: y + 0.7, z, sx: size, sy: size * 0.8, sz: size,
        yaw: rng() * Math.PI, color: palette([0x5c753d, 0x72844c, 0x4b6c43]) });
    }
  }
  addInstances(environment, 'alpine-tree-trunks', new THREE.CylinderGeometry(0.75, 1, 1, 6),
    new THREE.MeshStandardMaterial({ roughness: 1 }), trunks);
  addInstances(environment, 'alpine-pine-canopies', new THREE.ConeGeometry(1, 1, 7),
    new THREE.MeshStandardMaterial({ roughness: 1, flatShading: true }), pines);
  addInstances(environment, 'alpine-broadleaf-canopies', new THREE.IcosahedronGeometry(1, 1),
    new THREE.MeshStandardMaterial({ roughness: 1 }), crowns);
  addInstances(environment, 'alpine-roadside-rocks', new THREE.IcosahedronGeometry(1, 0),
    new THREE.MeshStandardMaterial({ roughness: 1, flatShading: true }), rocks);
  addInstances(environment, 'alpine-understory', new THREE.IcosahedronGeometry(1, 0),
    new THREE.MeshStandardMaterial({ roughness: 1 }), shrubs, false);
  return terrainGeometry;
}
