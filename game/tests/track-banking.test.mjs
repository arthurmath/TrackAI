import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
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
const { trackBankAngle, trackLateral, trackOrientation } = banking.module;
const { module: { TrackConstructor } } = await sourceModule('../src/assets/tracks/TrackConstructor.ts', {
  './TrackBanking': banking.url,
  // No canvas or scenery is needed to test the real road and barrier colliders.
  './RacewayCircuit': moduleUrl('export const buildRacewayCircuit = () => {}; export const createRacewayAsphalt = () => {};'),
  './SunsetEnvironment': moduleUrl('export const buildSunsetEnvironment = () => {};'),
  './MountainEnvironment': moduleUrl('export const buildMountainEnvironment = () => {};'),
  './StadiumEnvironment': moduleUrl('export const tuneStadiumMaterials = () => {};'),
});
await RAPIER.init();

const near = (actual, expected, tolerance = 1e-6) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`);

test('banking smoothly enters and exits, including an interval crossing the finish line', () => {
  const banks = [{ startU: 0.9, endU: 0.1, angle: 24 }];
  near(trackBankAngle(0.85, banks), 0);
  near(trackBankAngle(0.9, banks), 0);
  near(trackBankAngle(0, banks), THREE.MathUtils.degToRad(24));
  near(trackBankAngle(0.1, banks), 0);
  near(trackBankAngle(0.15, banks), 0);
  near(trackBankAngle(0.92, banks), THREE.MathUtils.degToRad(12));
  near(trackBankAngle(0.92, [{ ...banks[0], angle: -24 }]), THREE.MathUtils.degToRad(-12));
});

test('the road keeps its full width and an orthonormal frame on an uphill bank', () => {
  const tangent = new THREE.Vector3(0.3, 0.4, 0.8).normalize();
  const lateral = trackLateral(tangent, Math.PI / 6);
  near(lateral.length(), 1);
  near(lateral.dot(tangent), 0);
  const orientation = trackOrientation(tangent, Math.PI / 6);
  const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(orientation);
  const across = new THREE.Vector3(1, 0, 0).applyQuaternion(orientation);
  assert.ok(forward.distanceTo(tangent) < 1e-6);
  assert.ok(across.distanceTo(lateral) < 1e-6);
});

async function buildTrack(banks) {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  const definition = {
    id: 'bank-test', name: 'Bank test', accentColor: 0x65a854,
    centerline: Array.from({ length: 12 }, (_, i) => ({
      x: Math.cos(i / 12 * Math.PI * 2) * 80,
      y: 12,
      z: Math.sin(i / 12 * Math.PI * 2) * 80,
    })),
    roadWidth: 12, barrierHeight: 1.2, segments: 400,
    banking: banks, roadFriction: 1, gravity: { x: 0, y: -9.81, z: 0 },
    groundSize: 250, groundColor: 0x5c8051, decorations: [], lighting: {},
  };
  const track = await new TrackConstructor(world, new THREE.Scene()).build(definition);
  world.step();
  return { track, world };
}

test('the rendered banking matches the Rapier collision surface and both barriers', async () => {
  const { track, world } = await buildTrack([{ startU: 0.2, endU: 0.4, angle: 30 }]);
  try {
    const positions = track.group.getObjectByName('track-road').geometry.getAttribute('position');
    const i = 120;
    const left = new THREE.Vector3().fromBufferAttribute(positions, i * 2);
    const right = new THREE.Vector3().fromBufferAttribute(positions, i * 2 + 1);
    near(left.distanceTo(right), 12, 1e-5);
    near(left.y - right.y, 6, 1e-5);
    for (const fraction of [0.1, 0.5, 0.9]) {
      const point = left.clone().lerp(right, fraction);
      const hit = world.castRay(new RAPIER.Ray({ x: point.x, y: 30, z: point.z }, { x: 0, y: -1, z: 0 }), 40, true);
      assert.ok(hit);
      near(30 - hit.timeOfImpact, point.y, 0.02);
    }
    // Both guardrails begin at the actual banked edges, rather than at center height.
    for (const edge of [left, right]) {
      const center = left.clone().add(right).multiplyScalar(0.5);
      const inward = center.sub(edge).setY(0).normalize();
      const origin = edge.clone().addScaledVector(inward, 1);
      origin.y = edge.y + 0.85;
      const hit = world.castRay(new RAPIER.Ray(origin, inward.clone().negate()), 2, true);
      assert.ok(hit && hit.timeOfImpact > 0.95 && hit.timeOfImpact < 1.05);
    }
  } finally {
    track.dispose();
    world.free();
  }
});

test('circuits without banking retain a level road cross-section', async () => {
  const { track, world } = await buildTrack(undefined);
  try {
    const positions = track.group.getObjectByName('track-road').geometry.getAttribute('position');
    for (let i = 0; i < positions.count; i += 2) near(positions.getY(i), positions.getY(i + 1));
  } finally {
    track.dispose();
    world.free();
  }
});
