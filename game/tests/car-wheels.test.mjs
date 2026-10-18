import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

// Exercise the actual TypeScript view in Node; textures are omitted only for these
// geometry tests. The browser check covers the original textured materials.
async function sourceModule(relative, dependencies = {}) {
  const source = await readFile(new URL(relative, import.meta.url), 'utf8');
  let { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } });
  for (const [name, url] of Object.entries({ three: import.meta.resolve('three'), ...dependencies })) {
    outputText = outputText.replaceAll(`from '${name}'`, `from '${url}'`);
  }
  const url = `data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`;
  return { url, module: await import(url) };
}
const base = await sourceModule('../src/assets/cars/data/car_1.ts');
const { module: { car_3 } } = await sourceModule('../src/assets/cars/data/car_3.ts', { './car_1': base.url });
const { module: { car_2 } } = await sourceModule('../src/assets/cars/data/car_2.ts');
const { module: { CarConstructor } } = await sourceModule('../src/assets/cars/CarConstructor.ts');

async function geometryOnlyModel(relative) {
  const input = await readFile(new URL(relative, import.meta.url));
  const jsonLength = input.readUInt32LE(12);
  const gltf = JSON.parse(input.subarray(20, 20 + jsonLength).toString());
  gltf.materials = gltf.materials.map(m => ({ name: m.name }));
  gltf.extensionsUsed = gltf.extensionsUsed?.filter(name => !name.startsWith('KHR_materials_'));
  gltf.images = [];
  gltf.textures = [];
  const json = Buffer.from(JSON.stringify(gltf));
  const padded = Buffer.concat([json, Buffer.alloc((4 - json.length % 4) % 4, 0x20)]);
  const tail = input.subarray(20 + jsonLength);
  const header = Buffer.alloc(20);
  header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4);
  header.writeUInt32LE(20 + padded.length + tail.length, 8);
  header.writeUInt32LE(padded.length, 12); header.writeUInt32LE(0x4e4f534a, 16);
  const output = Buffer.concat([header, padded, tail]);
  return (await new GLTFLoader().parseAsync(output.buffer.slice(output.byteOffset, output.byteOffset + output.byteLength), '')).scene;
}
const modelPath = '../public/models/cars/trackmania-france/trackmania-france.glb';
const names = ['Wheel_FL', 'Wheel_FR', 'Wheel_RL', 'Wheel_RR'];
const identity = new THREE.Quaternion();
const origin = new THREE.Vector3();
const restWheels = () => car_3.wheelConnections.map(w => ({
  position: new THREE.Vector3(w.x, w.y - car_3.suspensionRestLength, w.z),
  steering: 0, roll: 0, radius: car_3.wheelRadius,
}));
async function build(config = car_3, path = modelPath) {
  const model = await geometryOnlyModel(path);
  return new CarConstructor({ tryLoadModel: async () => model }).build(config);
}
function sampleMeshes(root) {
  root.updateWorldMatrix(true, true);
  const samples = [];
  root.traverse(object => {
    if (!object.isMesh) return;
    const positions = object.geometry.getAttribute('position');
    // Include off-center vertices so rotation is observable for every material.
    for (let i = 0; i < positions.count; i += Math.max(1, Math.floor(positions.count / 15))) {
      samples.push({ object, index: i, position: new THREE.Vector3().fromBufferAttribute(positions, i).applyMatrix4(object.matrixWorld) });
    }
  });
  return samples;
}
function close(a, b, message) { assert.ok(a.distanceTo(b) < 1e-5, `${message}: ${a.toArray()} != ${b.toArray()}`); }
function verifySamples(samples, expected) {
  for (const sample of samples) {
    const actual = new THREE.Vector3().fromBufferAttribute(sample.object.geometry.getAttribute('position'), sample.index).applyMatrix4(sample.object.matrixWorld);
    close(actual, expected(sample.position.clone()), sample.object.material.name);
  }
}

test('each complete wheel includes tires, inner details and painted rims', async () => {
  const scene = await geometryOnlyModel(modelPath);
  for (const name of names) {
    const wheel = scene.getObjectByName(name);
    assert.ok(wheel, name);
    const materials = new Set();
    wheel.traverse(o => { if (o.isMesh) materials.add(o.material.name); });
    assert.deepEqual([...materials].sort(), ['Details', 'Skin', 'Wheels']);
    const tire = sampleMeshes(wheel).find(s => s.object.material.name === 'Wheels').object;
    const tireCenter = new THREE.Box3().setFromObject(tire).getCenter(new THREE.Vector3());
    close(tireCenter, wheel.getWorldPosition(new THREE.Vector3()), `${name} axle center`);
  }
});

test('front tires and rims steer and roll together; body stays fixed', async () => {
  const view = await build();
  const initial = sampleMeshes(view.group);
  const wheels = restWheels();
  view.update(origin, identity, wheels);
  view.group.updateWorldMatrix(true, true);
  verifySamples(initial, p => p); // No jump from import transforms or visual pitch.
  const wheel = view.group.getObjectByName('Wheel_FL');
  const center = view.group.getObjectByName('Wheel_FL_Steering').position.clone();
  const samples = sampleMeshes(wheel);
  const body = initial.filter(s => !names.some(name => {
    let o = s.object; while (o) { if (o.name === name) return true; o = o.parent; } return false;
  }));
  wheels[0].steering = .55;
  wheels[0].roll = .8;
  view.update(origin, identity, wheels);
  view.group.updateWorldMatrix(true, true);
  const rotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), .55)
    .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), .8));
  verifySamples(samples, p => p.sub(center).applyQuaternion(rotation).add(center));
  verifySamples(body, p => p);
});

test('all four wheels roll in both directions and follow suspension without orbiting', async () => {
  const view = await build();
  const wheels = restWheels();
  const samples = names.map(name => sampleMeshes(view.group.getObjectByName(name)));
  const centers = names.map(name => view.group.getObjectByName(`${name}_Steering`).position.clone());
  for (const roll of [.9, -.9, 0]) {
    wheels.forEach(w => { w.roll = roll; w.position.y += .07; });
    view.update(origin, identity, wheels);
    view.group.updateWorldMatrix(true, true);
    names.forEach((name, i) => {
      const center = centers[i];
      const delta = wheels[i].position.y - (car_3.wheelConnections[i].y - car_3.suspensionRestLength);
      const rotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), roll);
      verifySamples(samples[i], p => p.sub(center).applyQuaternion(rotation).add(center).add(new THREE.Vector3(0, delta, 0)));
    });
  }
});

test('training car and existing F1 steering still work', async () => {
  const view = await new CarConstructor().build(base.module.car_1);
  const wheels = restWheels(); wheels[0].roll = .4;
  view.update(origin, identity, wheels);
  const trainingWheel = sampleMeshes(view.group).find(s => s.object.geometry.type === 'CylinderGeometry').object;
  assert.equal(trainingWheel.rotation.x, .4);
  const f1 = await build(car_2, '../public/models/cars/f1/source/f1.glb');
  const samples = sampleMeshes(f1.group);
  wheels[0].steering = .5; wheels[1].steering = .5;
  f1.update(origin, identity, wheels); f1.group.updateWorldMatrix(true, true);
  const after = sampleMeshes(f1.group);
  assert.ok(after.some((s, i) => s.position.distanceTo(samples[i].position) > .01));
});

test('F1 merged axles roll around four independent centers and preserve the body', async () => {
  const f1 = await build(car_2, '../public/models/cars/f1/source/f1.glb');
  const wheelNames = ['Object_13_R', 'Object_13_L', 'Object_12_R', 'Object_12_L'];
  const wheels = car_2.wheelConnections.map(w => ({
    position: new THREE.Vector3(w.x, w.y - car_2.suspensionRestLength, w.z),
    steering: 0, roll: 0, radius: car_2.wheelRadius,
  }));
  const initial = sampleMeshes(f1.group);
  f1.update(origin, identity, wheels);
  f1.group.updateWorldMatrix(true, true);
  verifySamples(initial, p => p);
  const body = sampleMeshes(f1.group.getObjectByName('Object_2'));
  const samples = wheelNames.map(name => sampleMeshes(f1.group.getObjectByName(name)));
  const centers = wheelNames.map(name => f1.group.getObjectByName(`${name}_Steering`).position.clone());
  assert.ok(centers[0].x < centers[1].x);
  assert.ok(centers[2].x < centers[3].x);
  assert.ok(centers[0].z > centers[2].z);
  for (const roll of [.9, -.9, 0]) {
    wheels.forEach((wheel, i) => {
      wheel.roll = roll;
      wheel.steering = i < 2 ? .5 : 0;
      wheel.position.y += .03;
    });
    f1.update(origin, identity, wheels);
    f1.group.updateWorldMatrix(true, true);
    samples.forEach((wheelSamples, i) => {
      const center = centers[i];
      const delta = wheels[i].position.y - (car_2.wheelConnections[i].y - car_2.suspensionRestLength);
      const rotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), wheels[i].steering * car_2.visualSteerScale)
        .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), roll));
      verifySamples(wheelSamples, p => p.sub(center).applyQuaternion(rotation).add(center).add(new THREE.Vector3(0, delta, 0)));
    });
    verifySamples(body, p => p);
  }
});

test('rolling follows actual Rapier axle angles while driving and reversing', async () => {
  const rapierUrl = import.meta.resolve('@dimforge/rapier3d-compat');
  const RAPIER = (await import(rapierUrl)).default;
  await RAPIER.init();
  const { module: { VehicleController } } = await sourceModule('../src/physics/VehicleController.ts', { '@dimforge/rapier3d-compat': rapierUrl });
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = 1 / 60;
  world.createCollider(RAPIER.ColliderDesc.cuboid(100, .1, 100).setTranslation(0, -.1, 0).setCollisionGroups(0x00010002));
  const vehicle = new VehicleController(world, car_3, { position: new THREE.Vector3(0, 2, 0), quaternion: identity });
  const neutral = { throttle: 0, brake: 0, steer: 0, handbrake: false, reset: false };
  const step = (control, count) => { for (let i = 0; i < count; i++) { vehicle.update(control, world.timestep); world.step(); } };
  step(neutral, 240);
  assert.equal(vehicle.wheelsInContact(), 4);
  const wheels = [];
  vehicle.getWheelTransforms(wheels);
  const start = wheels.map(w => w.roll);
  step({ ...neutral, throttle: 1 }, 120);
  vehicle.getWheelTransforms(wheels);
  const forward = wheels.map((w, i) => w.roll - start[i]);
  assert.ok(vehicle.body.translation().z > 5);
  assert.ok(forward.every(r => r > 1), 'Forward motion should turn around +X for +Z travel.');
  vehicle.respawn({ position: new THREE.Vector3(0, 1, 0), quaternion: identity });
  step(neutral, 120);
  vehicle.getWheelTransforms(wheels);
  const stopped = wheels.map(w => w.roll);
  step({ ...neutral, brake: 1 }, 120);
  vehicle.getWheelTransforms(wheels);
  const reverse = wheels.map((w, i) => w.roll - stopped[i]);
  assert.ok(vehicle.body.translation().z < -2);
  assert.ok(reverse.every(r => r < -1));
  vehicle.dispose(); world.free();
});

test('F1 and Trackmania front wheels follow turn curvature as speed increases', async () => {
  const rapierUrl = import.meta.resolve('@dimforge/rapier3d-compat');
  const RAPIER = (await import(rapierUrl)).default;
  await RAPIER.init();
  const { module: { VehicleController } } = await sourceModule('../src/physics/VehicleController.ts', { '@dimforge/rapier3d-compat': rapierUrl });
  for (const config of [car_2, car_3]) {
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    world.timestep = 1 / 60;
    world.createCollider(RAPIER.ColliderDesc.cuboid(100, .1, 100).setTranslation(0, -.1, 0).setCollisionGroups(0x00010002));
    const vehicle = new VehicleController(world, config, { position: new THREE.Vector3(0, 2, 0), quaternion: identity });
    const view = await build(config, `../public${config.modelPath}`);
    const neutral = { throttle: 0, brake: 0, steer: 0, handbrake: false, reset: false };
    const wheels = [];
    try {
      for (let i = 0; i < 240; i++) { vehicle.update(neutral, world.timestep); world.step(); }
      assert.equal(vehicle.wheelsInContact(), 4);
      const wheelbase = Math.max(...config.wheelConnections.map(w => w.z)) - Math.min(...config.wheelConnections.map(w => w.z));
      const frontNames = config === car_2 ? ['Object_13_R_Steering', 'Object_13_L_Steering'] : ['Wheel_FL_Steering', 'Wheel_FR_Steering'];
      // Hold physical steering fixed: the same yaw rate at higher speed means
      // a wider turning radius, so the rendered wheels should straighten.
      for (const steer of [-.5, .5]) {
        for (const travel of [-1, 1]) {
          const yaw = Math.sign(steer) * .5;
          const angles = [];
          for (const speed of [0, 10, 30, 60]) {
            const orientation = new THREE.Quaternion().setFromEuler(new THREE.Euler(.2, .7, -.1));
            vehicle.body.setRotation(orientation, true);
            vehicle.body.setLinvel(new THREE.Vector3(0, 0, speed * travel).applyQuaternion(orientation), true);
            vehicle.body.setAngvel(new THREE.Vector3(0, yaw * travel, 0).applyQuaternion(orientation), true);
            for (let i = 0; i < 4; i++) vehicle.vehicle.setWheelSteering(i, i < 2 ? steer : 0);
            vehicle.getWheelTransforms(wheels);
            view.update(origin, identity, wheels);
            const commanded = steer * (config.visualSteerScale ?? 1);
            const expected = speed === 0 ? commanded : .2 * commanded + .8 * Math.atan(wheelbase * yaw / speed);
            frontNames.forEach((name, i) => {
              assert.ok(Math.abs(view.group.getObjectByName(name).rotation.y - expected) < 1e-6, `${config.id}, ${name}, ${speed} m/s`);
              assert.equal(wheels[i].steering, steer, 'Rendering must preserve physical steering');
            });
            assert.equal(wheels[2].visualSteering, 0);
            assert.equal(wheels[3].visualSteering, 0);
            angles.push(Math.abs(wheels[0].visualSteering));
          }
          assert.ok(angles[3] < angles[2] && angles[2] < angles[1] && angles[1] < angles[0]);
          assert.ok(angles[3] > angles[0] * .2 && angles[3] < angles[0] * .3,
            'Fast turns reduce steering while retaining a visible fraction of the commanded angle');
          vehicle.drifting = true;
          vehicle.getWheelTransforms(wheels);
          assert.equal(wheels[0].visualSteering, steer * (config.visualSteerScale ?? 1));
          vehicle.drifting = false;
        }
      }
    } finally {
      vehicle.dispose(); world.free(); view.dispose();
    }
  }
});
