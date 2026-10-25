import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';

async function sourceModule(relative) {
  const source = await readFile(new URL(relative, import.meta.url), 'utf8');
  let { outputText } = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  });
  for (const name of ['three', '@dimforge/rapier3d-compat']) {
    outputText = outputText.replaceAll(`from '${name}'`, `from '${import.meta.resolve(name)}'`);
  }
  return import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
}

const { VehicleController } = await sourceModule('../src/physics/VehicleController.ts');
const { car_2 } = await sourceModule('../src/assets/cars/data/car_2.ts');
const neutral = { throttle: 0, brake: 0, steer: 0, handbrake: false, reset: false };
await RAPIER.init();

for (const brake of ['brake', 'handbrake']) {
  test(`F1: sudden ${brake} keeps all wheels grounded through a full stop`, () => {
    for (const initialSpeed of [5, 15, 40, 60, car_2.maxSpeed]) {
      for (const throttle of [0, 1]) {
        const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
        world.timestep = 1 / 60;
        world.createCollider(RAPIER.ColliderDesc.cuboid(500, .1, 500)
          .setTranslation(0, -.1, 0).setCollisionGroups(0x00010002));
        const vehicle = new VehicleController(world, car_2, {
          position: new THREE.Vector3(0, 2, 0), quaternion: new THREE.Quaternion(),
        });
        const step = control => { vehicle.update(control, world.timestep); world.step(); };
        try {
          for (let i = 0; i < 180; i++) step(neutral);
          assert.equal(vehicle.wheelsInContact(), 4);
          vehicle.body.setLinvel({ x: 0, y: 0, z: initialSpeed }, true);
          step(neutral);
          const control = { ...neutral, throttle,
            brake: brake === 'brake' ? 1 : 0, handbrake: brake === 'handbrake' };
          const forward = new THREE.Vector3();
          const label = `${brake}, ${initialSpeed * 3.6} km/h, throttle=${throttle}`;
          let stopped = false;
          for (let i = 0; i < 360; i++) {
            step(control);
            assert.equal(vehicle.wheelsInContact(), 4, `${label}: wheels must stay on the ground`);
            vehicle.getForward(forward);
            const pitch = Math.asin(Math.abs(forward.y)) * 180 / Math.PI;
            assert.ok(pitch < 6, `${label}: excessive pitch ${pitch}°`);
            if (vehicle.speedKmh < 2) { stopped = true; break; }
          }
          assert.ok(stopped, `${label}: braking must still stop the car`);
        } finally {
          vehicle.dispose();
          world.free();
        }
      }
    }
  });
}
