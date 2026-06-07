/**
 * car_1 — "Comet RS" : voiture légère et nerveuse, placeholder Three.js procédural.
 */
import type { VehicleConfig } from '../types';

export const car_1: VehicleConfig = {
  id: 'car_1',
  name: 'Comet RS',
  color: 0x0a84ff,
  mass: 1000,
  chassisHalfExtents: { x: 0.85, y: 0.38, z: 1.95 },
  suspensionRestLength: 0.28,
  suspensionStiffness: 32,
  suspensionDamping: 4.0,
  maxSuspensionTravel: 0.28,
  wheelConnections: [
    { x: -0.85, y: -0.25, z: 1.35, steering: true, powered: false },
    { x: 0.85, y: -0.25, z: 1.35, steering: true, powered: false },
    { x: -0.85, y: -0.25, z: -1.35, steering: false, powered: true },
    { x: 0.85, y: -0.25, z: -1.35, steering: false, powered: true },
  ],
  wheelRadius: 0.38,
  wheelFriction: 2.2,
  lateralFriction: 1.1,
  maxSteering: 0.82,
  engineForce: 8000,
  brakeForce: 160,
  handbrakeForce: 420,
  maxSpeed: 82,
  centerOfMassOffset: { x: 0, y: -0.32, z: 0 },
};
