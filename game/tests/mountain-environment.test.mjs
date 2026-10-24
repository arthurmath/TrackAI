import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test, { after, before } from 'node:test';
import ts from 'typescript';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';

const moduleUrl = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
async function sourceModule(relative, dependencies = {}) {
  const source = await readFile(new URL(relative, import.meta.url), 'utf8');
  let { outputText } = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  });
  for (const [name, url] of Object.entries({
    three: import.meta.resolve('three'),
    '@dimforge/rapier3d-compat': import.meta.resolve('@dimforge/rapier3d-compat'),
    ...dependencies,
  })) outputText = outputText.replaceAll(`from '${name}'`, `from '${url}'`);
  const url = moduleUrl(outputText);
  return { url, module: await import(url) };
}
const banking = await sourceModule('../src/assets/tracks/TrackBanking.ts');
const mountain = await sourceModule('../src/assets/tracks/MountainEnvironment.ts', { './TrackBanking': banking.url });
const { module: { track_5 } } = await sourceModule('../src/assets/tracks/data/track_5.ts');
const { module: { TrackConstructor } } = await sourceModule('../src/assets/tracks/TrackConstructor.ts', {
  './TrackBanking': banking.url,
  './MountainEnvironment': mountain.url,
  // Only the canvas furniture is stubbed; the complete landscape and physics run.
  './RacewayCircuit': moduleUrl('export const buildRacewayCircuit = () => {}; export const createRacewayAsphalt = () => {};'),
  './SunsetEnvironment': moduleUrl('export const buildSunsetEnvironment = () => {};'),
  './StadiumEnvironment': moduleUrl('export const tuneStadiumMaterials = () => {};'),
});
await RAPIER.init();
let world;
let track;
let surfaces;
let samples;
before(async () => {
  world = new RAPIER.World(track_5.gravity);
  track = await new TrackConstructor(world, new THREE.Scene()).build({ ...track_5, roadStyle: undefined });
  surfaces = ['alpine-valley-terrain', 'alpine-road-embankments'].map(name => track.group.getObjectByName(name));
  samples = Array.from({ length: track_5.segments }, (_, i) => track.curve.getPointAt(i / track_5.segments));
  world.step();
});
after(() => { track?.dispose(); world?.free(); });

const visualHeight = (x, z) => {
  const ray = new THREE.Raycaster(new THREE.Vector3(x, 300, z), new THREE.Vector3(0, -1, 0), 0, 600);
  const hit = ray.intersectObjects(surfaces, false)[0];
  assert.ok(hit, `landscape ray at ${x},${z}`);
  return hit.point.y;
};
const physicalHeight = (x, z) => {
  const hit = world.castRay(new RAPIER.Ray({ x, y: 300, z }, { x: 0, y: -1, z: 0 }), 600, true);
  assert.ok(hit, `physics ray at ${x},${z}`);
  return 300 - hit.timeOfImpact;
};
const roadDistance = (x, z) => {
  let minimum = Infinity;
  for (let i = 0; i < samples.length; i++) {
    const a = samples[i];
    const b = samples[(i + 1) % samples.length];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const t = THREE.MathUtils.clamp(((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz), 0, 1);
    minimum = Math.min(minimum, (x - a.x - dx * t) ** 2 + (z - a.z - dz * t) ** 2);
  }
  return Math.sqrt(minimum);
};

test('the full mountain landscape contains finite geometry and instanced forests', () => {
  let meshCount = 0;
  track.group.traverse(object => {
    if (!object.isMesh) return;
    meshCount++;
    for (const value of object.geometry.getAttribute('position').array) assert.ok(Number.isFinite(value), object.name);
    if (object.isInstancedMesh) for (const value of object.instanceMatrix.array) assert.ok(Number.isFinite(value), object.name);
  });
  assert.ok(meshCount > 15);
  assert.ok(track.group.getObjectByName('alpine-tree-trunks').count > 1500);
  assert.ok(track.group.getObjectByName('alpine-roadside-rocks').count > 300);
  for (let i = 0; i < 3; i++) assert.ok(track.group.getObjectByName(`alpine-mountain-range-${i}`));
});

test('terrain stays below the asphalt at banked bends and all three jumps', () => {
  const road = track.group.getObjectByName('track-road').geometry.getAttribute('position');
  const locations = track_5.banking.map(bank => (bank.startU + bank.endU) / 2);
  for (const controlIndex of [24, 43, 59]) {
    const point = track_5.centerline[controlIndex];
    locations.push(track.getProgress(new THREE.Vector3(point.x, point.y, point.z)));
  }
  for (const u of locations) {
    const i = Math.round(u * track_5.segments) % track_5.segments;
    const left = new THREE.Vector3().fromBufferAttribute(road, i * 2);
    const right = new THREE.Vector3().fromBufferAttribute(road, i * 2 + 1);
    for (const fraction of [0.05, 0.5, 0.95]) {
      const point = left.clone().lerp(right, fraction);
      assert.ok(visualHeight(point.x, point.z) < point.y - 0.05, `terrain above asphalt at ${u}`);
      assert.ok(Math.abs(physicalHeight(point.x, point.z) - point.y) < 0.04, `asphalt collider at ${u}`);
    }
  }
});

test('the valley terrain and both road embankments have matching physical surfaces', () => {
  for (const [x, z] of [[0, 0], [350, 250], [-350, -90], [800, 150]]) {
    assert.ok(roadDistance(x, z) > track_5.roadWidth / 2 + 15);
    assert.ok(Math.abs(physicalHeight(x, z) - visualHeight(x, z)) < 0.03);
  }
  const positions = surfaces[1].geometry.getAttribute('position');
  const stride = (track_5.segments + 1) * 4;
  for (const side of [0, 1]) for (const u of [0.06, 0.19, 0.275, 0.53, 0.82]) {
    const i = Math.round(u * track_5.segments);
    const a = new THREE.Vector3().fromBufferAttribute(positions, side * stride + i * 4);
    const b = new THREE.Vector3().fromBufferAttribute(positions, side * stride + i * 4 + 1);
    const point = a.lerp(b, 0.5);
    assert.ok(Math.abs(physicalHeight(point.x, point.z) - point.y) < 0.03, `embankment collider ${side},${u}`);
  }
});

test('tree crowns and rocks stay clear of the road while close trees sit on the embankment', t => {
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const scale = new THREE.Vector3();
  const rotation = new THREE.Quaternion();
  const half = track_5.roadWidth / 2;
  let closeTrees = 0;
  for (const name of ['alpine-pine-canopies', 'alpine-broadleaf-canopies', 'alpine-roadside-rocks']) {
    const mesh = track.group.getObjectByName(name);
    for (let i = 0; i < mesh.count; i++) {
      mesh.getMatrixAt(i, matrix);
      matrix.decompose(position, rotation, scale);
      const crownRadius = Math.max(scale.x, scale.z);
      assert.ok(roadDistance(position.x, position.z) - crownRadius > half + 1.35, `${name} overlaps road`);
    }
  }
  const trunks = track.group.getObjectByName('alpine-tree-trunks');
  for (let i = 0; i < trunks.count && closeTrees < 60; i++) {
    trunks.getMatrixAt(i, matrix);
    matrix.decompose(position, rotation, scale);
    const distance = roadDistance(position.x, position.z);
    if (distance < half + 5.8 || distance > half + 11.5) continue;
    const base = position.y - scale.y / 2;
    const ground = visualHeight(position.x, position.z);
    assert.ok(Math.abs(base - ground) < 0.65, `tree base ${base}, embankment ${ground}`);
    closeTrees++;
  }
  assert.ok(closeTrees >= 40, 'forest trees reach the immediate roadside');
  t.diagnostic(`${closeTrees} close tree bases checked against the visible embankment`);
});
