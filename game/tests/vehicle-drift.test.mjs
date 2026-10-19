import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';

async function sourceModule(relative, dependencies = {}) {
  const source = await readFile(new URL(relative, import.meta.url), 'utf8');
  let { outputText } = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  });
  for (const [name, url] of Object.entries({
    three: import.meta.resolve('three'),
    '@dimforge/rapier3d-compat': import.meta.resolve('@dimforge/rapier3d-compat'),
    ...dependencies,
  })) {
    outputText = outputText.replaceAll(`from '${name}'`, `from '${url}'`);
  }
  const url = `data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`;
  return { url, module: await import(url) };
}

const { module: { InputManager } } = await sourceModule('../src/core/InputManager.ts');
const { module: { HumanController } } = await sourceModule('../src/controllers/HumanController.ts');
const { module: { VehicleController } } = await sourceModule('../src/physics/VehicleController.ts');
const base = await sourceModule('../src/assets/cars/data/car_1.ts');
const { module: { car_2 } } = await sourceModule('../src/assets/cars/data/car_2.ts');
const { module: { car_3 } } = await sourceModule('../src/assets/cars/data/car_3.ts', { './car_1': base.url });
const neutral = { throttle: 0, brake: 0, steer: 0, handbrake: false, reset: false };
await RAPIER.init();

test('keyboard acceleration and either brake stay active together, including aliases', () => {
  const previousWindow = globalThis.window;
  globalThis.window = new EventTarget();
  const input = new InputManager();
  const controller = new HumanController(input);
  const key = (type, code) => {
    const event = new Event(type);
    Object.defineProperty(event, 'code', { value: code });
    window.dispatchEvent(event);
  };
  try {
    for (const accelerator of ['ArrowUp', 'KeyZ', 'KeyW']) {
      for (const brake of ['ArrowDown', 'KeyS', 'Space']) {
        for (const direction of ['ArrowLeft', 'ArrowRight']) {
          [accelerator, brake, direction].forEach(code => key('keydown', code));
          const control = controller.sample();
          assert.equal(control.throttle, 1);
          assert.equal(control.brake, brake === 'Space' ? 0 : 1);
          assert.equal(control.handbrake, brake === 'Space');
          assert.equal(control.steer, direction === 'ArrowLeft' ? -1 : 1);
          [accelerator, brake, direction].forEach(code => key('keyup', code));
          assert.deepEqual(controller.sample(), neutral);
        }
      }
    }
  } finally {
    input.dispose();
    globalThis.window = previousWindow;
  }
});

function simulation(config, initialSpeed = 15) {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = 1 / 60;
  world.createCollider(RAPIER.ColliderDesc.cuboid(500, .1, 500)
    .setTranslation(0, -.1, 0).setCollisionGroups(0x00010002));
  const spawn = { position: new THREE.Vector3(0, 2, 0), quaternion: new THREE.Quaternion() };
  const vehicle = new VehicleController(world, config, spawn);
  const step = control => { vehicle.update(control, world.timestep); world.step(); };
  for (let i = 0; i < 180; i++) step(neutral);
  assert.equal(vehicle.wheelsInContact(), 4);
  vehicle.body.setLinvel({ x: 0, y: 0, z: initialSpeed }, true);
  step(neutral);
  return {
    vehicle, step,
    slip() {
      const local = new THREE.Vector3().copy(vehicle.body.linvel())
        .applyQuaternion(new THREE.Quaternion().copy(vehicle.body.rotation()).invert());
      // Keep angles above 90° observable instead of folding them backwards.
      return Math.atan2(local.x, local.z) * 180 / Math.PI;
    },
    rearLateralSpeed() {
      const body = vehicle.body;
      const inverse = new THREE.Quaternion().copy(body.rotation()).invert();
      const linear = new THREE.Vector3().copy(body.linvel()).applyQuaternion(inverse);
      const angular = new THREE.Vector3().copy(body.angvel()).applyQuaternion(inverse);
      const center = body.localCom();
      const rear = config.wheelConnections.filter(wheel => !wheel.steering);
      return rear.reduce((sum, wheel) => sum + Math.abs(linear.x
        + angular.y * (wheel.z - center.z) - angular.z * (wheel.y - config.suspensionRestLength - center.y)), 0) / rear.length;
    },
    dispose() { vehicle.dispose(); world.free(); },
  };
}

for (const config of [base.module.car_1, car_2, car_3]) {
  test(`${config.id}: holding either brake lets the drift angle keep growing with or without throttle`, () => {
    for (const steer of [-1, 1]) {
      for (const throttle of [0, 1]) {
        const baseline = simulation(config);
        for (let i = 0; i < 30; i++) baseline.step({ ...neutral, steer, throttle });
        const normalRearSlip = baseline.rearLateralSpeed();
        baseline.dispose();
        const outcomes = [];
        for (const brake of ['brake', 'handbrake']) {
          const sim = simulation(config);
          try {
            for (let i = 0; i < 30; i++) {
              sim.step({ ...neutral, steer, throttle,
                brake: brake === 'brake' ? 1 : 0, handbrake: brake === 'handbrake' });
            }
            // Measure chassis/velocity misalignment, not just wheel settings.
            const slip = sim.slip();
            const label = `${brake}, throttle=${throttle}, steer=${steer}, slip=${slip.toFixed(1)}°`;
            assert.ok(slip * steer > 12, label);
            // Le centre du châssis se déplace en biais dans un virage adhérent :
            // comparer la dérive au niveau de l'essieu, pas l'angle du châssis.
            assert.ok(sim.rearLateralSpeed() > normalRearSlip + .5, label);
            assert.ok(sim.vehicle.speedKmh > 10, 'Car must still be moving during the slide');
            assert.equal(sim.vehicle.wheelsInContact(), 4, 'Sliding must not rely on lifting the car');
            // Holding the brake must allow growth beyond the old 25° stabilization.
            for (let i = 0; i < 30; i++) {
              sim.step({ ...neutral, steer, throttle,
                brake: brake === 'brake' ? 1 : 0, handbrake: brake === 'handbrake' });
            }
            assert.ok(sim.slip() * steer > 35, `Sustained drift: ${sim.slip()}°`);
            assert.ok(sim.slip() * steer > slip * steer + 10, `Drift should keep growing: ${slip}° -> ${sim.slip()}°`);
            outcomes.push({ slip: sim.slip(), position: sim.vehicle.body.translation(), speed: sim.vehicle.speedKmh });
          } finally {
            sim.dispose();
          }
        }
        assert.ok(Math.abs(outcomes[0].slip - outcomes[1].slip) < .001);
        assert.ok(Math.abs(outcomes[0].speed - outcomes[1].speed) < .001);
        assert.ok(new THREE.Vector3().copy(outcomes[0].position).distanceTo(outcomes[1].position) < .001);
      }
    }
  });
}

test('a sustained drift retains momentum without throttle', () => {
  const initialSpeed = 25;
  for (const config of [base.module.car_1, car_2, car_3]) {
    for (const steer of [-1, 1]) {
      for (const brake of ['brake', 'handbrake']) {
        const sim = simulation(config, initialSpeed);
        try {
          for (let i = 0; i < 60; i++) {
            sim.step({ ...neutral, steer,
              brake: brake === 'brake' ? 1 : 0, handbrake: brake === 'handbrake' });
          }
          const velocity = sim.vehicle.body.linvel();
          const horizontalSpeed = Math.hypot(velocity.x, velocity.z);
          const label = `${config.id}, ${brake}, steer=${steer}`;
          assert.ok(horizontalSpeed > initialSpeed * .55, `${label}: retain over 55% of speed after one second`);
          assert.ok(sim.slip() * steer > 35, `${label}: momentum must be retained during a visible slide`);
          assert.equal(sim.vehicle.wheelsInContact(), 4);
        } finally {
          sim.dispose();
        }
      }
    }
  }
});

test('drift rotation is slower at high speed without capping the angle', () => {
  for (const steer of [-1, 1]) {
    for (const throttle of [0, 1]) {
      for (const brake of ['brake', 'handbrake']) {
        const peaks = [];
        for (const [initialSpeed, maxAllowedYaw] of [[25, 1.9], [40, 1.4]]) {
          const sim = simulation(car_3, initialSpeed);
          try {
            let maxYaw = 0;
            let halfSecondAngle;
            for (let i = 0; i < 60; i++) {
              sim.step({ ...neutral, throttle, steer,
                brake: brake === 'brake' ? 1 : 0, handbrake: brake === 'handbrake' });
              const up = new THREE.Vector3(0, 1, 0)
                .applyQuaternion(new THREE.Quaternion().copy(sim.vehicle.body.rotation()));
              maxYaw = Math.max(maxYaw, Math.abs(up.dot(sim.vehicle.body.angvel())));
              if (i === 29) halfSecondAngle = sim.slip() * steer;
            }
            const label = `${initialSpeed * 3.6} km/h, throttle=${throttle}, ${brake}, steer=${steer}`;
            assert.ok(maxYaw > .5 && maxYaw < maxAllowedYaw, `${label}: yaw=${maxYaw} rad/s`);
            assert.ok(sim.slip() * steer > 35, `${label}: slip=${sim.slip()}°`);
            assert.ok(sim.slip() * steer > halfSecondAngle + 15, `${label}: angle must keep growing`);
            peaks.push(maxYaw);
          } finally {
            sim.dispose();
          }
        }
        assert.ok(peaks[1] < peaks[0], 'Rotation should still slow at higher speed');
      }
    }
  }
});

test('high-speed drift responds promptly and keeps rotating with all cars and either brake', () => {
  for (const config of [base.module.car_1, car_2, car_3]) {
    for (const [initialSpeed, minHalfSecondHeading, minHeading] of [[40, 27, 60], [60, 23, 52]]) {
      for (const steer of [-1, 1]) {
        for (const throttle of [0, 1]) {
          for (const brake of ['brake', 'handbrake']) {
            const sim = simulation(config, initialSpeed);
            const label = `${config.id}, ${initialSpeed * 3.6} km/h, steer=${steer}, throttle=${throttle}, ${brake}`;
            try {
              let heading = 0;
              for (let i = 0; i < 60; i++) {
                sim.step({ ...neutral, steer, throttle,
                  brake: brake === 'brake' ? 1 : 0, handbrake: brake === 'handbrake' });
                const up = new THREE.Vector3(0, 1, 0)
                  .applyQuaternion(new THREE.Quaternion().copy(sim.vehicle.body.rotation()));
                // Integrate chassis rotation so tire slip alone cannot satisfy the test.
                heading -= steer * up.dot(sim.vehicle.body.angvel()) / 60 * 180 / Math.PI;
                if (i === 29) assert.ok(heading > minHalfSecondHeading, `${label}: response=${heading}°`);
                assert.equal(sim.vehicle.wheelsInContact(), 4, label);
              }
              assert.ok(heading > minHeading && heading < 80, `${label}: heading=${heading}°`);
              const velocity = sim.vehicle.body.linvel();
              assert.ok(Math.hypot(velocity.x, velocity.z) > initialSpeed * .65, `${label}: retain momentum`);
            } finally {
              sim.dispose();
            }
          }
        }
      }
    }
  }
});

test('steering while reversing keeps driving backwards without engaging drift', () => {
  for (const config of [base.module.car_1, car_2, car_3]) {
    for (const steer of [-1, 1]) {
      const sim = simulation(config, -5);
      try {
        for (let i = 0; i < 30; i++) sim.step({ ...neutral, brake: 1, steer });
        assert.ok(sim.vehicle.forwardSpeed < -5, `${config.id}, steer=${steer}: reverse must keep accelerating`);
        assert.equal(sim.vehicle.wheelsInContact(), 4);
      } finally {
        sim.dispose();
      }
    }
  }
});

test('drift rotation control does not affect an airborne car', () => {
  const sim = simulation(car_3, 25);
  try {
    sim.vehicle.body.setTranslation({ x: 0, y: 30, z: 0 }, true);
    sim.vehicle.body.setAngvel({ x: 0, y: 3, z: 0 }, true);
    sim.step({ ...neutral, throttle: 1, handbrake: true, steer: 1 });
    assert.equal(sim.vehicle.wheelsInContact(), 0);
    assert.ok(sim.vehicle.body.angvel().y > 2.9, 'Only normal angular damping should apply in the air');
  } finally {
    sim.dispose();
  }
});

test('holding either brake sustains the slide after releasing steering', () => {
  for (const brake of ['brake', 'handbrake']) {
    const held = simulation(car_3);
    const released = simulation(car_3);
    const braking = { ...neutral, throttle: 1,
      brake: brake === 'brake' ? 1 : 0, handbrake: brake === 'handbrake' };
    try {
      for (let i = 0; i < 30; i++) {
        held.step({ ...braking, steer: 1 });
        released.step({ ...braking, steer: 1 });
      }
      const initialAngle = held.slip();
      for (let i = 0; i < 20; i++) {
        held.step(braking);
        released.step({ ...neutral, throttle: 1 });
      }
      assert.ok(held.slip() > initialAngle + 5, `Holding ${brake}: ${initialAngle}° -> ${held.slip()}°`);
      assert.ok(Math.abs(released.slip()) < initialAngle, `Release should restore grip: ${released.slip()}°`);
    } finally {
      held.dispose();
      released.dispose();
    }
  }
});

test('drift remains visible at 36 and 90 km/h', () => {
  for (const initialSpeed of [10, 25]) {
    for (const throttle of [0, 1]) {
      for (const brake of ['brake', 'handbrake']) {
        const sim = simulation(car_3, initialSpeed);
        try {
          let maxSlip = 0;
          for (let i = 0; i < 60; i++) {
            sim.step({ ...neutral, throttle, steer: 1,
              brake: brake === 'brake' ? 1 : 0, handbrake: brake === 'handbrake' });
            if (sim.vehicle.speedKmh > 10) maxSlip = Math.max(maxSlip, Math.abs(sim.slip()));
          }
          assert.ok(maxSlip > 5, `${initialSpeed * 3.6} km/h, throttle=${throttle}: ${maxSlip}°`);
        } finally {
          sim.dispose();
        }
      }
    }
  }
});

test('straight braking stays straight for both brakes, with or without throttle', () => {
  for (const throttle of [0, 1]) {
    for (const brake of ['brake', 'handbrake']) {
      const sim = simulation(car_3);
      try {
        for (let i = 0; i < 30; i++) {
          sim.step({ ...neutral, throttle,
            brake: brake === 'brake' ? 1 : 0, handbrake: brake === 'handbrake' });
        }
        assert.ok(Math.abs(sim.slip()) < 1);
        assert.ok(Math.abs(sim.vehicle.body.angvel().y) < .05);
        if (throttle === 0) assert.ok(sim.vehicle.speedKmh < 54);
      } finally {
        sim.dispose();
      }
    }
  }
});

test('grip recovers after releasing either brake', () => {
  for (const brake of ['brake', 'handbrake']) {
    const sim = simulation(car_3);
    try {
      for (let i = 0; i < 30; i++) {
        sim.step({ ...neutral, throttle: 1, steer: 1,
          brake: brake === 'brake' ? 1 : 0, handbrake: brake === 'handbrake' });
      }
      assert.ok(Math.abs(sim.slip()) > 3);
      for (let i = 0; i < 120; i++) sim.step({ ...neutral, throttle: 1 });
      assert.ok(Math.abs(sim.slip()) < 3, `Grip should recover: ${sim.slip()}°`);
      assert.ok(sim.vehicle.speedKmh > 20);
    } finally {
      sim.dispose();
    }
  }
});

test('holding throttle and down from rest does not engage reverse', () => {
  const sim = simulation(car_3, 0);
  try {
    const start = sim.vehicle.body.translation().z;
    for (let i = 0; i < 60; i++) sim.step({ ...neutral, throttle: 1, brake: 1 });
    assert.ok(sim.vehicle.body.translation().z >= start - .01);
    assert.ok(sim.vehicle.forwardSpeed >= -.01);
  } finally {
    sim.dispose();
  }
});

test('space at rest holds the car without engaging reverse', () => {
  const sim = simulation(car_3, 0);
  try {
    const start = sim.vehicle.body.translation().z;
    for (let i = 0; i < 60; i++) sim.step({ ...neutral, handbrake: true });
    assert.ok(Math.abs(sim.vehicle.body.translation().z - start) < .01);
    assert.ok(Math.abs(sim.vehicle.body.linvel().z) < .01);
  } finally {
    sim.dispose();
  }
});

test('tire smoke requires either brake and stops emitting as soon as it is released', () => {
  for (const config of [base.module.car_1, car_2, car_3]) {
    for (const brake of ['brake', 'handbrake']) {
      const sim = simulation(config, 25);
      const sources = [];
      const braking = { ...neutral, throttle: 1, steer: 1,
        brake: brake === 'brake' ? 1 : 0, handbrake: brake === 'handbrake' };
      try {
        for (let i = 0; i < 15; i++) {
          sim.step({ ...neutral, throttle: 1, steer: 1 });
          sim.vehicle.getTireSmokeSources(sources);
          assert.ok(sources.every(source => source.intensity === 0), 'Turning alone must not emit smoke');
        }
        for (let i = 0; i < 15; i++) sim.step(braking);
        sim.vehicle.getTireSmokeSources(sources);
        assert.ok(sources.some(source => source.intensity > 0), `${config.id}: ${brake} should emit smoke`);
        // Une glisse résiduelle ne doit pas prolonger l'émission après relâchement.
        assert.ok(Math.abs(sim.slip()) > 3);
        sources.forEach(source => { source.emissionRemainder = 0.9; });
        sim.step({ ...neutral, throttle: 1, steer: 1 });
        sim.vehicle.getTireSmokeSources(sources);
        assert.ok(sources.every(source => source.intensity === 0 && source.emissionRemainder === 0));

        sim.vehicle.body.setTranslation({ x: 0, y: 30, z: 0 }, true);
        sim.step(braking);
        sim.vehicle.getTireSmokeSources(sources);
        assert.ok(sources.every(source => source.intensity === 0), 'Airborne braking must not emit smoke');
      } finally {
        sim.dispose();
      }
    }
  }
});

for (const config of [car_2, car_3]) {
  test(`${config.id}: rear axle stays planted in normal turns`, () => {
    for (const steer of [-1, 1]) {
      for (const initialSpeed of [2, 5, 15]) {
        const sim = simulation(config, initialSpeed);
        try {
          let totalSlip = 0;
          for (let i = 0; i < 60; i++) {
            sim.step({ ...neutral, steer });
            totalSlip += sim.rearLateralSpeed();
            assert.equal(sim.vehicle.wheelsInContact(), 4);
          }
          const meanSlip = totalSlip / 60;
          const limit = initialSpeed === 2 ? .025 : initialSpeed === 5 ? .07 : .6;
          assert.ok(meanSlip < limit, `${initialSpeed} m/s, steer=${steer}: rear slide ${meanSlip} m/s`);
        } finally {
          sim.dispose();
        }
      }
    }
  });

  test(`${config.id}: steering at rest does not rotate the car`, () => {
    const sim = simulation(config, 0);
    try {
      const start = new THREE.Vector3().copy(sim.vehicle.body.translation());
      for (let i = 0; i < 120; i++) sim.step({ ...neutral, steer: 1 });
      assert.ok(Math.abs(sim.vehicle.body.angvel().y) < .005);
      assert.ok(start.distanceTo(sim.vehicle.body.translation()) < .01);
    } finally {
      sim.dispose();
    }
  });
}

test('rear grip does not steer or stabilize an airborne car outside drift', () => {
  const sim = simulation(car_3, 15);
  try {
    sim.vehicle.body.setTranslation({ x: 0, y: 30, z: 0 }, true);
    sim.vehicle.body.setLinvel({ x: 4, y: 0, z: 15 }, true);
    sim.vehicle.body.setAngvel({ x: 0, y: 3, z: 0 }, true);
    sim.step({ ...neutral, steer: 1 });
    assert.equal(sim.vehicle.wheelsInContact(), 0);
    assert.ok(sim.vehicle.body.angvel().y > 2.9);
    assert.ok(sim.vehicle.body.linvel().x > 3.9);
  } finally {
    sim.dispose();
  }
});
