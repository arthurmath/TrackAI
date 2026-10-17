import * as THREE from 'three';

type Instance = {
  x: number;
  y: number;
  z: number;
  sx: number;
  sy: number;
  sz: number;
  yaw?: number;
  color: THREE.Color;
};

/** A repeatable landscape keeps visual landmarks in the same place on every lap. */
function seededRandom(seed: number): () => number {
  let value = seed;
  return () => {
    value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

function addInstances(
  parent: THREE.Group,
  name: string,
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  instances: Instance[],
  shadows = true,
): void {
  const mesh = new THREE.InstancedMesh(geometry, material, instances.length);
  mesh.name = name;
  const transform = new THREE.Object3D();
  instances.forEach((item, index) => {
    transform.position.set(item.x, item.y, item.z);
    transform.rotation.set(0, item.yaw ?? 0, 0);
    transform.scale.set(item.sx, item.sy, item.sz);
    transform.updateMatrix();
    mesh.setMatrixAt(index, transform.matrix);
    mesh.setColorAt(index, item.color);
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.castShadow = shadows;
  mesh.receiveShadow = true;
  mesh.computeBoundingSphere();
  parent.add(mesh);
}

function meadowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  const context = canvas.getContext('2d')!;
  const rng = seededRandom(1207);
  context.fillStyle = '#879464';
  context.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 19000; i++) {
    const light = 78 + Math.floor(rng() * 36);
    context.fillStyle = `rgba(${light + 20},${light + 29},${light - 7},${0.12 + rng() * 0.2})`;
    context.fillRect(rng() * 256, rng() * 256, 1 + rng() * 2, 1 + rng() * 4);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(90, 90);
  texture.anisotropy = 8;
  return texture;
}

function createGrassGeometry(): THREE.BufferGeometry {
  const rng = seededRandom(822);
  const vertices: number[] = [];
  const colors: number[] = [];
  for (let i = 0; i < 9; i++) {
    const angle = rng() * Math.PI * 2;
    const x = Math.cos(angle) * rng() * 0.45;
    const z = Math.sin(angle) * rng() * 0.45;
    const width = 0.035 + rng() * 0.045;
    const height = 0.28 + rng() * 0.62;
    const dx = Math.cos(angle) * width;
    const dz = Math.sin(angle) * width;
    vertices.push(x - dx, 0, z - dz, x + dx, 0, z + dz, x + dx * 3, height, z + dz * 3);
    colors.push(0.55, 0.61, 0.37, 0.55, 0.61, 0.37, 0.91, 0.9, 0.62);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  return geometry;
}

function leafGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.IcosahedronGeometry(1, 2);
  const vertices = geometry.getAttribute('position');
  for (let i = 0; i < vertices.count; i++) {
    const x = vertices.getX(i);
    const y = vertices.getY(i);
    const z = vertices.getZ(i);
    const scale = 1 + 0.11 * Math.sin(x * 13 + z * 7) * Math.sin(y * 11 - z * 5);
    vertices.setXYZ(i, x * scale, y * scale, z * scale);
  }
  geometry.computeVertexNormals();
  return geometry;
}

/** Shared park scenery for Sunset Oval and Midnight Circuit. Everything is visual; the driving surface stays flat. */
export function buildSunsetEnvironment(
  group: THREE.Group,
  samples: THREE.Vector3[],
  roadWidth: number,
): void {
  const environment = new THREE.Group();
  environment.name = 'sunset-nature';
  group.add(environment);
  const rng = seededRandom(20261017);
  const center = new THREE.Box3().setFromPoints(samples).getCenter(new THREE.Vector3());
  // Larger technical layouts need the same flat meadow beneath every corner.
  const flatRadius = Math.max(112, ...samples.map(p => Math.hypot(p.x - center.x, p.z - center.z) + roadWidth / 2 + 8));
  const clearance = roadWidth / 2 + 4;

  // Use the complete sampled polyline, including the closing segment, rather
  // than its control points so vegetation cannot encroach on a sweeping bend.
  const roadDistance = (x: number, z: number): number => {
    let min = Infinity;
    for (let i = 0; i < samples.length; i++) {
      const a = samples[i];
      const b = samples[(i + 1) % samples.length];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const segmentLength = dx * dx + dz * dz;
      const t = segmentLength > 0
        ? THREE.MathUtils.clamp(((x - a.x) * dx + (z - a.z) * dz) / segmentLength, 0, 1)
        : 0;
      min = Math.min(min, (x - a.x - t * dx) ** 2 + (z - a.z - t * dz) ** 2);
    }
    return Math.sqrt(min);
  };
  const terrainHeight = (x: number, z: number): number => {
    const radial = Math.hypot(x - center.x, z - center.z);
    const rise = THREE.MathUtils.smoothstep(radial, flatRadius, Math.max(235, flatRadius + 90));
    const waves = 0.5 + 0.24 * Math.sin(x * 0.022 + z * 0.008)
      + 0.18 * Math.cos(z * 0.028 - x * 0.009);
    return rise * (8 + waves * 48) - 0.012;
  };

  // The complete circuit stays level, with only a fine meadow texture.
  // Low-frequency vertex colours break up the large, otherwise uniform lawn.
  const terrainGeometry = new THREE.PlaneGeometry(700, 700, 140, 140);
  terrainGeometry.rotateX(-Math.PI / 2);
  const terrainPositions = terrainGeometry.getAttribute('position');
  const terrainColors: number[] = [];
  const richGrass = new THREE.Color(0x7c8e51);
  const dryGrass = new THREE.Color(0xb1ac78);
  const terrainColor = new THREE.Color();
  for (let i = 0; i < terrainPositions.count; i++) {
    const x = terrainPositions.getX(i);
    const z = terrainPositions.getZ(i);
    terrainPositions.setY(i, terrainHeight(x, z));
    const variation = THREE.MathUtils.clamp(0.42 + Math.sin(x * 0.048 + Math.sin(z * 0.029) * 2) * 0.2
      + Math.sin(z * 0.065 - x * 0.024) * 0.13, 0, 1);
    terrainColor.copy(richGrass).lerp(dryGrass, variation);
    // Keep the fine texture bright enough after multiplication by vertex colours.
    terrainColor.multiplyScalar(1.55);
    terrainColors.push(terrainColor.r, terrainColor.g, terrainColor.b);
  }
  terrainGeometry.setAttribute('color', new THREE.Float32BufferAttribute(terrainColors, 3));
  terrainGeometry.computeVertexNormals();
  const terrain = new THREE.Mesh(terrainGeometry, new THREE.MeshStandardMaterial({
    map: meadowTexture(), roughness: 1, vertexColors: true,
  }));
  terrain.name = 'sunset-meadow';
  terrain.receiveShadow = true;
  environment.add(terrain);

  // Layered silhouettes are single continuous ridges, rather than oversized cones.
  for (let layer = 0; layer < 2; layer++) {
    const positions: number[] = [];
    const indices: number[] = [];
    const count = 100;
    for (let i = 0; i <= count; i++) {
      const angle = i / count * Math.PI * 2;
      const radius = 280 + layer * 75;
      const ridge = 34 + layer * 18 + 13 * Math.sin(angle * 5 + layer * 2)
        + 8 * Math.sin(angle * 9 - layer) + 4 * Math.cos(angle * 17);
      positions.push(
        center.x + Math.cos(angle) * (radius - 70), 0, center.z + Math.sin(angle) * (radius - 70),
        center.x + Math.cos(angle) * radius, ridge, center.z + Math.sin(angle) * radius,
        center.x + Math.cos(angle) * (radius + 80), -3, center.z + Math.sin(angle) * (radius + 80),
      );
      if (i < count) {
        const a = i * 3;
        indices.push(a, a + 1, a + 3, a + 1, a + 4, a + 3,
          a + 1, a + 2, a + 4, a + 2, a + 5, a + 4);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    const ridge = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({
      color: layer === 0 ? 0x768775 : 0x8d9c96, roughness: 1, side: THREE.DoubleSide,
    }));
    ridge.name = `sunset-ridge-${layer}`;
    environment.add(ridge);
  }

  const trunks: Instance[] = [];
  const crowns: Instance[] = [];
  const pines: Instance[] = [];
  const shrubs: Instance[] = [];
  const rocks: Instance[] = [];
  const grass: Instance[] = [];
  const flowers: Instance[] = [];
  const broadleafPalette = [0x526f3d, 0x687c43, 0x7d8950, 0x3e6345, 0x85955a];
  const pinePalette = [0x3b5c49, 0x466b50, 0x567451];
  const colorFrom = (palette: number[]): THREE.Color => new THREE.Color(palette[Math.floor(rng() * palette.length)]);
  const clusters = Array.from({ length: 24 }, (_, i) => {
    const angle = i / 24 * Math.PI * 2 + rng() * 0.3;
    const radius = 95 + rng() * 91;
    return { x: center.x + Math.cos(angle) * radius, z: center.z + Math.sin(angle) * radius };
  });
  // Several small infield groves give depth through each turn without filling
  // the complete centre of the circuit or blocking sight lines at the barriers.
  clusters.push({ x: -8, z: -42 }, { x: 1, z: 14 }, { x: 10, z: -49 });

  for (let attempt = 0; attempt < 680; attempt++) {
    const cluster = clusters[Math.floor(rng() * clusters.length)];
    const angle = rng() * Math.PI * 2;
    const spread = Math.sqrt(rng()) * 24;
    const x = cluster.x + Math.cos(angle) * spread;
    const z = cluster.z + Math.sin(angle) * spread;
    const scale = 0.7 + rng() * 0.85;
    const conifer = rng() < 0.42;
    const crownRadius = (conifer ? 2.3 : 3.8) * scale;
    if (roadDistance(x, z) < clearance + crownRadius) continue;
    const y = terrainHeight(x, z);
    const height = (conifer ? 10 : 7.6) * scale;
    const trunkHeight = height * 0.67;
    trunks.push({ x, y: y + trunkHeight / 2, z,
      sx: 0.28 * scale, sy: trunkHeight, sz: 0.28 * scale,
      color: colorFrom([0x6c604a, 0x74634e, 0x83725a]), yaw: rng() * Math.PI });
    if (conifer) {
      for (let tier = 0; tier < 4; tier++) {
        const radius = (2.1 - tier * 0.39) * scale;
        const tierHeight = (4.5 - tier * 0.55) * scale;
        pines.push({ x, y: y + (3.1 + tier * 1.64) * scale, z,
          sx: radius, sy: tierHeight, sz: radius, yaw: rng() * Math.PI,
          color: colorFrom(pinePalette) });
      }
    } else {
      for (let lobe = 0; lobe < 5; lobe++) {
        const angle = lobe * Math.PI * 0.5 + rng() * 0.5;
        const radius = lobe === 4 ? 0 : 1.2 * scale;
        const size = (lobe === 4 ? 2.3 : 1.75 + rng() * 0.4) * scale;
        crowns.push({
          x: x + Math.cos(angle) * radius,
          y: y + height * (lobe === 4 ? 0.87 : 0.66) + rng() * scale * 0.5,
          z: z + Math.sin(angle) * radius,
          sx: size, sy: size * (0.9 + rng() * 0.25), sz: size * (0.85 + rng() * 0.15),
          yaw: rng() * Math.PI * 2, color: colorFrom(broadleafPalette),
        });
      }
    }
  }

  // Stones, low shrubs and tufts occupy distinct loose patches, with a clear
  // maintained verge separating the natural planting from the racing surface.
  for (let attempt = 0; attempt < 1900; attempt++) {
    const x = center.x + (rng() - 0.5) * 320;
    const z = center.z + (rng() - 0.5) * 320;
    const type = rng();
    const radius = type < 0.08 ? 0.8 + rng() * 1.1 : type < 0.28 ? 0.7 + rng() * 0.8 : 1.2;
    const distance = roadDistance(x, z);
    if (distance < clearance + radius * 1.12 || distance > 85) continue;
    const y = terrainHeight(x, z);
    if (type < 0.08) {
      rocks.push({ x, y: y + radius * 0.32, z,
        sx: radius, sy: radius * (0.4 + rng() * 0.35), sz: radius * (0.75 + rng() * 0.25),
        yaw: rng() * Math.PI, color: colorFrom([0x97988a, 0xb1aa94, 0x7d867b]) });
    } else if (type < 0.28) {
      shrubs.push({ x, y: y + radius * 0.45, z,
        sx: radius, sy: radius * 0.7, sz: radius * 0.8,
        yaw: rng() * Math.PI, color: colorFrom([0x6e8050, 0x7a8959, 0x899660]) });
    } else {
      grass.push({ x, y, z, sx: 0.7 + rng(), sy: 0.5 + rng() * 0.65, sz: 0.7 + rng(),
        yaw: rng() * Math.PI * 2, color: colorFrom([0xb8b485, 0xa6b278, 0xc0b58a]) });
      if (type > 0.82 && distance < 28) {
        for (let petal = 0; petal < 4; petal++) {
          const flowerX = x + (rng() - 0.5) * 0.6;
          const flowerZ = z + (rng() - 0.5) * 0.6;
          flowers.push({ x: flowerX, y: y + 0.3 + rng() * 0.25, z: flowerZ,
            sx: 0.09, sy: 0.055, sz: 0.09, color: colorFrom([0xf3dfaa, 0xeac567, 0xe4dcc1]) });
        }
      }
    }
  }

  const foliageMaterial = new THREE.MeshStandardMaterial({ roughness: 1 });
  const crownGeometry = leafGeometry();
  addInstances(environment, 'sunset-tree-trunks', new THREE.CylinderGeometry(0.7, 1, 1, 7),
    new THREE.MeshStandardMaterial({ roughness: 1 }), trunks);
  addInstances(environment, 'sunset-broadleaf-canopies', crownGeometry, foliageMaterial, crowns);
  addInstances(environment, 'sunset-pine-canopies', new THREE.ConeGeometry(1, 1, 10, 2), foliageMaterial, pines);
  addInstances(environment, 'sunset-low-shrubs', crownGeometry, foliageMaterial, shrubs);
  addInstances(environment, 'sunset-stones', new THREE.IcosahedronGeometry(1, 1),
    new THREE.MeshStandardMaterial({ roughness: 0.95 }), rocks);
  addInstances(environment, 'sunset-meadow-grass', createGrassGeometry(),
    new THREE.MeshStandardMaterial({ roughness: 1, side: THREE.DoubleSide, vertexColors: true }), grass, false);
  addInstances(environment, 'sunset-wildflowers', new THREE.IcosahedronGeometry(1, 0),
    new THREE.MeshStandardMaterial({ roughness: 1 }), flowers, false);
}
