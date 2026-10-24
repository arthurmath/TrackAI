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
const { module: { track_5 } } = await sourceModule('../src/assets/tracks/data/track_5.ts');
const bank = await sourceModule('../src/assets/tracks/TrackBanking.ts');
const { trackBankAngle, trackOrientation } = bank.module;
const { module: { TrackConstructor } } = await sourceModule('../src/assets/tracks/TrackConstructor.ts', {
  './TrackBanking': bank.url,
  // Keep the actual road and colliders, without canvas textures or distant scenery.
  './RacewayCircuit': moduleUrl('export const buildRacewayCircuit = () => {}; export const createRacewayAsphalt = () => {};'),
  './SunsetEnvironment': moduleUrl('export const buildSunsetEnvironment = () => {};'),
  './MountainEnvironment': moduleUrl('export const buildMountainEnvironment = () => {};'),
  './StadiumEnvironment': moduleUrl('export const tuneStadiumMaterials = () => {};'),
});
const { module: { VehicleController } } = await sourceModule('../src/physics/VehicleController.ts');
const { module: { car_2 } } = await sourceModule('../src/assets/cars/data/car_2.ts');
const { module: { PHYSICS_CONFIG } } = await sourceModule('../src/config.ts');
await RAPIER.init();
const stableLandingSteps = Math.ceil((1 / 15) / PHYSICS_CONFIG.fixedTimeStep);

const curve = new THREE.CatmullRomCurve3(track_5.centerline.map(p => new THREE.Vector3(p.x, p.y, p.z)), true, 'centripetal', 0.5);
curve.arcLengthDivisions = track_5.segments * 2;
curve.updateArcLengths();
const length = curve.getLength();
const samples = curve.getSpacedPoints(1800).slice(0, -1);
function nearest(point) {
  let index = 0;
  let alpha = 0;
  let distanceSq = Infinity;
  samples.forEach((sample, i) => {
    const next = samples[(i + 1) % samples.length];
    const dx = next.x - sample.x;
    const dz = next.z - sample.z;
    const t = THREE.MathUtils.clamp(((point.x - sample.x) * dx + (point.z - sample.z) * dz) / (dx * dx + dz * dz), 0, 1);
    const d = (sample.x + t * dx - point.x) ** 2 + (sample.z + t * dz - point.z) ** 2;
    if (d < distanceSq) { distanceSq = d; index = i; alpha = t; }
  });
  return {
    u: (index + alpha) / samples.length,
    point: samples[index].clone().lerp(samples[(index + 1) % samples.length], alpha),
    distance: Math.sqrt(distanceSq),
  };
}

test('Alpine Wilds keeps a long lap but shortens the finishing straight to 300–400 m', t => {
  assert.ok(length > 4000 && length < 6000, `length ${length.toFixed(1)}m`);
  assert.ok(curve.getPointAt(0).distanceTo(curve.getPointAt(1)) < 1e-6);
  // CatmullRom rounds the ends slightly; measure the low-curvature acceleration zone.
  const straight = samples.filter((p, i) => {
    const tangent = curve.getTangentAt(i / samples.length);
    return p.x > -300 && p.x < 280 && Math.abs(p.z - 390) < 2 && Math.abs(tangent.z) < 0.035 && Math.abs(tangent.y) < 0.02;
  });
  const straightLength = straight.length * length / samples.length;
  assert.ok(straightLength > 300 && straightLength < 400, `straight ${straightLength.toFixed(1)}m`);
  t.diagnostic(`loop ${length.toFixed(1)}m, straight ${straightLength.toFixed(1)}m`);
});

test('the road has no self-crossing and leaves clearance between separate sections', t => {
  let minimum = Infinity;
  const local = Math.ceil(track_5.roadWidth * 4 / length * samples.length);
  for (let i = 0; i < samples.length; i++) {
    for (let j = i + local; j < samples.length; j++) {
      if (samples.length - j + i < local) continue;
      minimum = Math.min(minimum, Math.hypot(samples[i].x - samples[j].x, samples[i].z - samples[j].z));
    }
  }
  assert.ok(minimum > track_5.roadWidth + 4, `minimum nonlocal clearance ${minimum.toFixed(2)}m`);
  t.diagnostic(`minimum nonlocal centerline separation ${minimum.toFixed(2)}m`);
});

test('climbs remain driveable and bends remain wider than the road half-width', t => {
  let maxGrade = 0;
  let minRadius = Infinity;
  for (let i = 0; i < samples.length; i++) {
    const prev = samples[(i - 1 + samples.length) % samples.length];
    const curr = samples[i];
    const next = samples[(i + 1) % samples.length];
    const a = new THREE.Vector2(curr.x - prev.x, curr.z - prev.z);
    const b = new THREE.Vector2(next.x - curr.x, next.z - curr.z);
    maxGrade = Math.max(maxGrade, Math.abs(next.y - curr.y) / b.length());
    const twiceArea = Math.abs(a.cross(b));
    if (twiceArea > 1e-6) minRadius = Math.min(minRadius, a.length() * b.length() * a.clone().add(b).length() / (2 * twiceArea));
  }
  assert.ok(maxGrade < 0.4, `maximum grade ${(maxGrade * 100).toFixed(1)}%`);
  assert.ok(minRadius > track_5.roadWidth * 0.65, `minimum bend radius ${minRadius.toFixed(2)}m`);
  t.diagnostic(`maximum grade ${(maxGrade * 100).toFixed(1)}%, minimum bend radius ${minRadius.toFixed(2)}m`);
});

test('exactly two banked bends raise their outside edges', () => {
  assert.equal(track_5.banking.length, 2);
  for (const banking of track_5.banking) {
    for (const fraction of [0.2, 0.35, 0.5, 0.65, 0.8]) {
      const u = THREE.MathUtils.lerp(banking.startU, banking.endU, fraction);
      const before = curve.getTangentAt(u - 0.002);
      const after = curve.getTangentAt(u + 0.002);
      const turn = before.x * after.z - before.z * after.x;
      assert.ok(turn * trackBankAngle(u, [banking]) > 0, `counter-banked bend at ${u.toFixed(3)}`);
    }
  }
});

test('the start and spawn sit on the level acceleration straight', () => {
  const u = track_5.startU;
  const start = curve.getPointAt(u);
  const tangent = curve.getTangentAt(u);
  const behind = curve.getPointAt(u - (track_5.spawnOffset + 10) / length);
  assert.ok(Math.abs(tangent.z) < 0.01 && Math.abs(tangent.y) < 0.01);
  assert.ok(Math.abs(start.y - 12) < 0.01 && Math.abs(start.z - 390) < 0.01);
  assert.ok(Math.abs(behind.y - 12) < 0.01 && Math.abs(behind.z - 390) < 0.01);
  assert.equal(trackBankAngle(u, track_5.banking), 0);
});

const stopped = { throttle: 0, brake: 1, steer: 0, handbrake: true, reset: false };
const coast = { throttle: 0, brake: 0, steer: 0, handbrake: false, reset: false };
const signedDistance = (fromU, toU) => (THREE.MathUtils.euclideanModulo(toU - fromU + 0.5, 1) - 0.5) * length;

test('the final jump leaves a level positioning zone after the preceding bend', () => {
  const crestU = nearest(track_5.centerline[59]).u;
  const exitU = nearest(track_5.centerline[55]).u;
  assert.ok(signedDistance(exitU, crestU) > 110, 'the crest must be well beyond the corner exit');
  const direction = curve.getTangentAt(crestU).setY(0).normalize();
  // Measure the straight after the corner's transition and before the ramp.
  for (let distance = 60; distance <= 85; distance += 5) {
    const u = crestU - distance / length;
    const point = curve.getPointAt(u);
    const tangent = curve.getTangentAt(u);
    assert.ok(Math.abs(point.y - 18) < 0.3, 'the old jump location must remain level');
    assert.ok(Math.abs(tangent.y) < 0.03, 'leave time to accelerate before the ramp');
    assert.ok(tangent.setY(0).normalize().angleTo(direction) < 0.01, 'positioning zone must follow the jump axis');
  }
});

async function jumpSimulation(controlPointIndex, speed, approachDistance = 32) {
  const world = new RAPIER.World(track_5.gravity);
  world.timestep = PHYSICS_CONFIG.fixedTimeStep;
  const track = await new TrackConstructor(world, new THREE.Scene()).build({ ...track_5, roadStyle: undefined, scenery: undefined });
  const crestU = nearest(track_5.centerline[controlPointIndex]).u;
  const crestTangent = curve.getTangentAt(crestU).setY(0).normalize();
  let nextTurnMeters = Infinity;
  for (let distance = 2; distance <= 300; distance += 2) {
    const direction = curve.getTangentAt((crestU + distance / length) % 1).setY(0).normalize();
    if (THREE.MathUtils.radToDeg(crestTangent.angleTo(direction)) > 5) { nextTurnMeters = distance; break; }
  }
  const startU = crestU - approachDistance / length;
  const tangent = curve.getTangentAt(startU);
  const vehicle = new VehicleController(world, car_2, {
    position: curve.getPointAt(startU).add(new THREE.Vector3(0, 1.2, 0)),
    quaternion: trackOrientation(tangent),
  });
  const step = control => { vehicle.update(control, world.timestep); world.step(); };
  try {
    for (let i = 0; i < Math.round(1.5 / world.timestep); i++) step(stopped);
    assert.ok(vehicle.wheelsInContact() >= 2, 'settled on ramp approach');
    vehicle.body.setLinvel(tangent.multiplyScalar(speed), true);
    let inAir = 0;
    let maxAir = 0;
    let landed = 0;
    let flightStarted = false;
    let takeoffProgress = 0;
    let takeoffSpeed = 0;
    let currentTakeoffProgress = 0;
    let currentTakeoffSpeed = 0;
    let landingProgress = 0;
    for (let i = 0; i < Math.round(5 / world.timestep); i++) {
      step(coast);
      const contact = vehicle.wheelsInContact();
      if (contact === 0) {
        if (inAir === 0) {
          currentTakeoffProgress = nearest(vehicle.body.translation()).u;
          currentTakeoffSpeed = new THREE.Vector3().copy(vehicle.body.linvel()).length();
        }
        landed = 0;
        inAir++;
        if (inAir > maxAir) {
          maxAir = inAir;
          takeoffProgress = currentTakeoffProgress;
          takeoffSpeed = currentTakeoffSpeed;
        }
        if (inAir * world.timestep >= 0.05) flightStarted = true;
      } else {
        inAir = 0;
        if (flightStarted && contact >= 2) {
          if (landed === 0) landingProgress = nearest(vehicle.body.translation()).u;
          landed++;
        }
        // Ignore a short suspension bounce on the approach: complete the crest first.
        if (landed >= stableLandingSteps && signedDistance(crestU, nearest(vehicle.body.translation()).u) >= 15) break;
      }
    }
    const position = vehicle.body.translation();
    const projection = nearest(position);
    const landingTangent = curve.getTangentAt(projection.u).setY(0).normalize();
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(new THREE.Quaternion().copy(vehicle.body.rotation()));
    return {
      maxAirSeconds: maxAir * world.timestep,
      landed,
      distance: projection.distance,
      up: up.y,
      position,
      roadHeight: projection.point.y,
      landingAngle: THREE.MathUtils.radToDeg(crestTangent.angleTo(landingTangent)),
      takeoffMetersFromCrest: signedDistance(crestU, takeoffProgress),
      landingMetersFromCrest: signedDistance(crestU, landingProgress),
      landingMetersBeforeTurn: nextTurnMeters - signedDistance(crestU, projection.u),
      takeoffSpeedKmh: takeoffSpeed * 3.6,
    };
  } finally {
    vehicle.dispose();
    track.dispose();
    world.free();
  }
}

for (const [name, index] of [['col', 24], ['fougères', 43], ['retour', 59]]) {
  const speeds = [35, 40];
  if (name !== 'col') speeds.push(160 / 3.6, 200 / 3.6);
  if (name === 'retour') speeds.push(car_2.maxSpeed);
  for (const speed of speeds) {
    test(`the ${name} crest launches and lands the default F1 at ${Math.round(speed * 3.6)} km/h`, async t => {
      const result = await jumpSimulation(index, speed, name === 'retour' ? 20 : 32);
      assert.ok(result.maxAirSeconds > 0.12, `flight: ${JSON.stringify(result)}`);
      assert.ok(result.landed >= stableLandingSteps, `landing: ${JSON.stringify(result)}`);
      assert.ok(result.distance < track_5.roadWidth / 2, `road landing: ${JSON.stringify(result)}`);
      assert.ok(result.up > 0.7, `upright landing: ${JSON.stringify(result)}`);
      assert.ok(result.position.y > result.roadHeight - 0.1 && result.position.y < result.roadHeight + 2, `road contact height: ${JSON.stringify(result)}`);
      if (name !== 'col') {
        assert.ok(result.landingAngle < 5, `landing must remain in the straight ramp axis: ${JSON.stringify(result)}`);
        assert.ok(result.landingMetersBeforeTurn > 25, `landing needs a reaction margin before the turn: ${JSON.stringify(result)}`);
      }
      t.diagnostic(`airborne ${result.maxAirSeconds.toFixed(2)}s, landing ${result.distance.toFixed(2)}m from centerline, upright ${result.up.toFixed(3)}, takeoff ${result.takeoffSpeedKmh.toFixed(1)}km/h, landing before turn ${result.landingMetersBeforeTurn.toFixed(1)}m`);
    });
  }
}
