import type { VehicleConfig } from '../types';
import { car_1 } from './car_1';

const SIZE_SCALE = 0.85;

/** Trackmania 2020 France, with dimensions and wheel anchors matched to the GLB. */
export const car_3: VehicleConfig = {
  ...car_1,
  id: 'car_3',
  name: 'Trackmania France',
  previewScale: 0.88,
  color: 0x2455c7,
  chassisHalfExtents: { x: 0.80 * SIZE_SCALE, y: 0.30 * SIZE_SCALE, z: 1.95 * SIZE_SCALE },
  centerOfMassOffset: { x: 0, y: -0.20 * SIZE_SCALE, z: 0 },
  suspensionRestLength: car_1.suspensionRestLength * SIZE_SCALE,
  maxSuspensionTravel: car_1.maxSuspensionTravel * SIZE_SCALE,
  wheelRadius: 0.386 * SIZE_SCALE,
  wheelConnections: [
    { x: -0.895, y: 0.074, z: 1.598, steering: true, powered: false },
    { x: 0.896, y: 0.074, z: 1.598, steering: true, powered: false },
    { x: -0.907, y: 0.074, z: -1.562, steering: false, powered: true },
    { x: 0.908, y: 0.074, z: -1.562, steering: false, powered: true },
  ].map(wheel => ({
    ...wheel,
    x: wheel.x * SIZE_SCALE,
    y: wheel.y * SIZE_SCALE,
    z: wheel.z * SIZE_SCALE,
  })),
  modelPath: '/models/cars/trackmania-france/trackmania-france.glb',
  // The export includes a 1/85 scale. This gives a car about 3.18 × 1.80 m.
  modelScale: 0.84 * SIZE_SCALE,
  // Keep all four tires on the road instead of lifting the front axle visually.
  modelPitch: 0,
  // Center the body on Z and align the wheel centers with the resting suspension.
  modelOffset: { x: -0.00044 * SIZE_SCALE, y: -0.582 * SIZE_SCALE, z: -0.27044 * SIZE_SCALE },
  driverHelmet: {
    position: { x: 0, y: 0.23 * SIZE_SCALE, z: -0.42 * SIZE_SCALE },
    radius: 0.16 * SIZE_SCALE,
  },
  wheelAnimation: 'full',
  alignVisualSteeringToTrajectory: true,
  wheelMeshNames: ['Wheel_FL', 'Wheel_FR', 'Wheel_RL', 'Wheel_RR'],
};
