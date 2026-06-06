/**
 * PhysicsWorld — initialise Rapier (WASM) et encapsule le monde de simulation.
 * Rapier doit être initialisé une seule fois (await RAPIER.init()).
 */
import RAPIER from '@dimforge/rapier3d-compat';
import { PHYSICS_CONFIG } from '../config';

let initialized = false;

/** Initialise le moteur Rapier (charge le WASM). Idempotent. */
export async function initPhysics(): Promise<void> {
  if (initialized) return;
  await RAPIER.init();
  initialized = true;
}

export class PhysicsWorld {
  readonly world: RAPIER.World;

  constructor(gravity: { x: number; y: number; z: number } = PHYSICS_CONFIG.gravity) {
    if (!initialized) {
      throw new Error('initPhysics() doit être appelé avant de créer un PhysicsWorld.');
    }
    this.world = new RAPIER.World(gravity);
    this.world.timestep = PHYSICS_CONFIG.fixedTimeStep;
  }

  setGravity(g: { x: number; y: number; z: number }): void {
    this.world.gravity = new RAPIER.Vector3(g.x, g.y, g.z);
  }

  step(): void {
    this.world.step();
  }

  dispose(): void {
    this.world.free();
  }
}

export { RAPIER };
