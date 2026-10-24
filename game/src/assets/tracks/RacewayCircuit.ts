import * as THREE from 'three';

/** Local, repeatable materials: no downloads and no per-frame texture work. */
export function createRacewayAsphalt(): THREE.MeshStandardMaterial {
  const size = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const pixels = ctx.createImageData(size, size);
  let seed = 17;
  const random = (): number => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const grain = (random() - 0.5) * 24;
      // Broad, subtle rubber deposits in the racing lanes.
      const wear = Math.exp(-(((x / size - 0.34) / 0.065) ** 2))
        + Math.exp(-(((x / size - 0.65) / 0.065) ** 2));
      const value = 91 + grain - wear * 13 + Math.sin(y / size * Math.PI * 8) * 1.2;
      const i = (y * size + x) * 4;
      pixels.data[i] = value;
      pixels.data[i + 1] = value + 2;
      pixels.data[i + 2] = value + 3;
      pixels.data[i + 3] = 255;
    }
  }
  ctx.putImageData(pixels, 0, 0);
  // Fine aggregate and faint longitudinal resurfacing marks.
  for (let i = 0; i < 160; i++) {
    ctx.strokeStyle = `rgba(22,25,28,${0.02 + random() * 0.035})`;
    ctx.lineWidth = 0.5 + random() * 1.5;
    const x = random() * size;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x + random() * 2, size);
    ctx.stroke();
  }
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.anisotropy = 8;
  const bump = map.clone();
  bump.colorSpace = THREE.NoColorSpace;
  return new THREE.MeshStandardMaterial({
    color: 0xd0d3d6, map, bumpMap: bump, bumpScale: 0.025,
    roughness: 0.92, metalness: 0.02,
  });
}

type Profile = ReadonlyArray<readonly [offset: number, height: number]>;

/** Sweep a cross-section along the actual collision edge, including tight bends. */
function edgeRibbon(
  edge: THREE.Vector3[],
  centers: THREE.Vector3[],
  profile: Profile,
  material: THREE.Material,
  alternating = false,
): THREE.Mesh {
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const ivory = new THREE.Color(0xe4e5db);
  const graphite = new THREE.Color(0x333e43);
  let distance = 0;
  const point = (i: number, p: readonly [number, number]): THREE.Vector3 => {
    const normal = edge[i].clone().sub(centers[i]).normalize();
    return edge[i].clone().addScaledVector(normal, p[0]).add(new THREE.Vector3(0, p[1], 0));
  };
  for (let i = 0; i < edge.length; i++) {
    const j = (i + 1) % edge.length;
    const color = alternating && Math.floor(distance / 2.8) % 2 ? graphite : ivory;
    for (let p = 0; p < profile.length - 1; p++) {
      const vertices = [point(i, profile[p]), point(j, profile[p]), point(i, profile[p + 1]), point(j, profile[p + 1])];
      const base = positions.length / 3;
      vertices.forEach(v => {
        positions.push(v.x, v.y, v.z);
        colors.push(color.r, color.g, color.b);
      });
      indices.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
    }
    distance += edge[i].distanceTo(edge[j]);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  if (alternating) geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.receiveShadow = true;
  return mesh;
}

function signTexture(title: string, subtitle: string, chevrons = false): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#202d30';
  ctx.fillRect(0, 0, 1024, 256);
  ctx.fillStyle = '#e9aa51';
  ctx.fillRect(0, 235, 1024, 21);
  if (chevrons) {
    ctx.strokeStyle = '#f3eddb';
    ctx.lineWidth = 32;
    for (let i = 0; i < 4; i++) {
      const x = 100 + i * 235;
      ctx.beginPath();
      ctx.moveTo(x, 45); ctx.lineTo(x + 75, 120); ctx.lineTo(x, 195);
      ctx.stroke();
    }
  } else {
    ctx.fillStyle = '#e9aa51';
    ctx.font = '600 26px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(subtitle, 512, 53);
    ctx.fillStyle = '#f4f1e5';
    ctx.font = 'bold 100px sans-serif';
    ctx.fillText(title, 512, 165);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

export function buildRacewayCircuit(
  group: THREE.Group,
  centers: THREE.Vector3[],
  left: THREE.Vector3[],
  right: THREE.Vector3[],
  curve: THREE.CatmullRomCurve3,
  roadWidth: number,
  barrierHeight: number,
  startU: number,
  signage: { title: string; subtitle: string; chevrons: number[] },
): void {
  const details = new THREE.Group();
  details.name = 'raceway-circuit-furniture';
  const concrete = new THREE.MeshStandardMaterial({ color: 0xb4b6ad, roughness: 0.95, side: THREE.DoubleSide });
  const gravel = new THREE.MeshStandardMaterial({ color: 0x9c9b83, roughness: 1, side: THREE.DoubleSide });
  const steel = new THREE.MeshStandardMaterial({ color: 0x9aa7ab, metalness: 0.55, roughness: 0.38, side: THREE.DoubleSide });
  const dark = new THREE.MeshStandardMaterial({ color: 0x28383a, metalness: 0.4, roughness: 0.48 });
  const paint = new THREE.MeshStandardMaterial({ color: 0xf4f1df, roughness: 0.85, side: THREE.DoubleSide });
  const amber = new THREE.MeshStandardMaterial({ color: 0xe8a243, roughness: 0.65, side: THREE.DoubleSide });
  const curb = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.87, side: THREE.DoubleSide });
  const postPositions: THREE.Vector3[] = [];
  const reflectors: { position: THREE.Vector3; yaw: number }[] = [];

  for (const edge of [left, right]) {
    details.add(edgeRibbon(edge, centers, [[0.4, 0.026], [2.3, 0.026]], gravel));
    details.add(edgeRibbon(edge, centers, [[0, 0.032], [0.75, 0.032]], concrete));
    details.add(edgeRibbon(edge, centers, [[-0.85, 0.035], [-0.08, 0.085]], curb, true));
    details.add(edgeRibbon(edge, centers, [[-1.15, 0.038], [-0.98, 0.038]], paint));
    // Concrete foot and two metal rails occupy the original barrier plane.
    details.add(edgeRibbon(edge, centers, [[0, 0.03], [0, 0.29], [0.32, 0.29], [0.32, 0.03]], concrete));
    for (const height of [barrierHeight * 0.58, barrierHeight - 0.08]) {
      const rail = edgeRibbon(edge, centers, [[0, height - 0.07], [-0.035, height], [0, height + 0.07], [0.18, height + 0.07], [0.18, height - 0.07]], steel);
      rail.castShadow = true;
      details.add(rail);
    }
    let spacing = 4;
    let reflectSpacing = 10;
    for (let i = 0; i < edge.length; i++) {
      const step = edge[i].distanceTo(edge[(i + 1) % edge.length]);
      const outward = edge[i].clone().sub(centers[i]).normalize();
      if (spacing >= 4) {
        postPositions.push(edge[i].clone().addScaledVector(outward, 0.2));
        spacing = 0;
      }
      if (reflectSpacing >= 12) {
        reflectors.push({ position: edge[i].clone().addScaledVector(outward, -0.055), yaw: Math.atan2(outward.x, outward.z) });
        reflectSpacing = 0;
      }
      spacing += step;
      reflectSpacing += step;
    }
  }
  const dummy = new THREE.Object3D();
  const posts = new THREE.InstancedMesh(new THREE.BoxGeometry(0.13, barrierHeight, 0.13), dark, postPositions.length);
  postPositions.forEach((p, i) => {
    dummy.position.copy(p).y += barrierHeight / 2;
    dummy.updateMatrix();
    posts.setMatrixAt(i, dummy.matrix);
  });
  posts.castShadow = posts.receiveShadow = true;
  details.add(posts);
  const markers = new THREE.InstancedMesh(new THREE.BoxGeometry(0.16, 0.12, 0.035), amber, reflectors.length);
  reflectors.forEach(({ position, yaw }, i) => {
    dummy.position.copy(position).y += barrierHeight - 0.08;
    dummy.rotation.y = yaw;
    dummy.updateMatrix();
    markers.setMatrixAt(i, dummy.matrix);
  });
  details.add(markers);

  const box = (parent: THREE.Group, w: number, h: number, d: number, x: number, y: number, z: number, material: THREE.Material): void => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    mesh.position.set(x, y, z);
    mesh.castShadow = mesh.receiveShadow = true;
    parent.add(mesh);
  };
  const gantry = new THREE.Group();
  gantry.name = 'raceway-start-gantry';
  gantry.position.copy(curve.getPointAt(startU));
  const tangent = curve.getTangentAt(startU);
  gantry.rotation.y = Math.atan2(tangent.x, tangent.z);
  const span = roadWidth + 2.2;
  const beamHeight = 1.4;
  const beamCenterY = 6.2;
  const postHeight = beamCenterY - beamHeight / 2;
  for (const side of [-1, 1]) {
    box(gantry, 0.85, postHeight, 0.8, side * span / 2, postHeight / 2, 0, dark);
    box(gantry, 0.89, 0.16, 0.84, side * span / 2, 1.4, 0, amber);
    box(gantry, 1.25, 0.4, 1.2, side * span / 2, 0.2, 0, concrete);
  }
  box(gantry, span + 0.9, beamHeight, 0.65, 0, beamCenterY, 0, dark);
  const signMaterial = new THREE.MeshStandardMaterial({ map: signTexture(signage.title, signage.subtitle), roughness: 0.7 });
  for (const side of [-1, 1]) {
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(8.8, 2.2), signMaterial);
    sign.position.set(0, 6.35, side * 0.34);
    sign.rotation.y = side < 0 ? Math.PI : 0;
    gantry.add(sign);
  }
  // Small green start lamps under the overhead timing bridge.
  const lampMaterial = new THREE.MeshStandardMaterial({ color: 0xb8d99b, emissive: 0x87bb68, emissiveIntensity: 0.6 });
  for (let i = 0; i < 5; i++) box(gantry, 0.28, 0.16, 0.25, (i - 2) * 0.55, 5.25, 0, lampMaterial);
  details.add(gantry);

  // Outside-turn chevrons are oriented toward approaching drivers.
  const chevronMaterial = new THREE.MeshStandardMaterial({ map: signTexture('', '', true), roughness: 0.7, side: THREE.DoubleSide });
  for (const u of signage.chevrons) {
    const i = Math.floor(u * centers.length);
    const t = curve.getTangentAt(u);
    const ahead = curve.getTangentAt((u + 0.025) % 1);
    const turn = t.x * ahead.z - t.z * ahead.x;
    const edge = turn > 0 ? left : right;
    const outward = edge[i].clone().sub(centers[i]).normalize();
    const signGroup = new THREE.Group();
    signGroup.position.copy(edge[i]).addScaledVector(outward, 2.9);
    signGroup.rotation.y = Math.atan2(-t.x, -t.z);
    // The panel faces local +Z; recess the entire posts behind its arrow face.
    box(signGroup, 0.1, 1.9, 0.1, -1.5, 0.95, -0.12, dark);
    box(signGroup, 0.1, 1.9, 0.1, 1.5, 0.95, -0.12, dark);
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(4.6, 1.15), chevronMaterial);
    panel.position.y = 1.65;
    // Canvas points right; flip the UVs for a left bend without reversing the text.
    if (turn < 0) {
      const uv = panel.geometry.getAttribute('uv');
      for (let n = 0; n < uv.count; n++) uv.setX(n, 1 - uv.getX(n));
    }
    signGroup.add(panel);
    details.add(signGroup);
  }
  group.add(details);
}
