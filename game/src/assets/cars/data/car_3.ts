import type { VehicleConfig } from '../types';
import { car_1 } from './car_1';

/** Trackmania 2020 France, with dimensions and wheel anchors matched to the GLB. */
export const car_3: VehicleConfig = {
  ...car_1,
  id: 'car_3',
  name: 'Trackmania France',
  color: 0x2455c7,
  chassisHalfExtents: { x: 0.80, y: 0.30, z: 1.95 },
  centerOfMassOffset: { x: 0, y: -0.20, z: 0 },
  wheelRadius: 0.386,
  wheelConnections: [
    { x: -0.895, y: 0.074, z: 1.598, steering: true, powered: false },
    { x: 0.896, y: 0.074, z: 1.598, steering: true, powered: false },
    { x: -0.907, y: 0.074, z: -1.562, steering: false, powered: true },
    { x: 0.908, y: 0.074, z: -1.562, steering: false, powered: true },
  ],
  modelPath: '/models/cars/trackmania-france/trackmania-france.glb',
  // The export includes a 1/85 scale. This gives a car about 4.01 × 2.27 m.
  modelScale: 0.9,
  // Center the body on Z and align the wheel centers with the resting suspension.
  modelOffset: { x: -0.00047, y: -0.57927, z: -0.28976 },
  wheelAnimation: 'steer-only',
  steerWheelMeshNames: ['Wheel_FL', 'Wheel_FR'],
};
