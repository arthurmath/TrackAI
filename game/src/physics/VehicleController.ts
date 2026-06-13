/**
 * VehicleController — véhicule par raycasting basé sur le
 * DynamicRayCastVehicleController de Rapier (modèle "raycast vehicle" AAA).
 *
 * Gère : châssis dynamique avec centre de gravité bas, 4 roues raycast,
 * moteur (courbe d'accélération), freinage, frein à main, braquage progressif
 * avec réduction à haute vitesse, et exposition des transforms pour le rendu.
 */
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import type { VehicleConfig } from '../assets/cars/types';
import type { ControlState } from '../controllers/Controller';

export interface WheelTransform {
  position: THREE.Vector3;
  /** Rotation de braquage (autour de Y, espace local châssis). */
  steering: number;
  /** Rotation de roulement (autour de l'axe X de la roue). */
  roll: number;
  radius: number;
}

export interface VehicleSpawn {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
}

// Groupes de collision (InteractionGroups = membership << 16 | filter).
// Les voitures entrent en collision avec le décor/piste mais PAS entre elles :
// en entraînement multi-agents, chaque voiture est un « fantôme » indépendant.
const GROUP_TRACK = 0x0001;
const GROUP_CAR = 0x0002;
/** Groupes des colliders voiture ET des rayons (suspension, capteurs). */
export const CAR_INTERACTION_GROUP = (GROUP_CAR << 16) | GROUP_TRACK;

export class VehicleController {
  readonly body: RAPIER.RigidBody;
  private readonly vehicle: RAPIER.DynamicRayCastVehicleController;
  private readonly collider: RAPIER.Collider;
  private readonly poweredWheels: number[] = [];
  private readonly steeredWheels: number[] = [];
  private currentSteering = 0;
  private spawn: VehicleSpawn;

  // Buffers réutilisés pour éviter les allocations par frame.
  private readonly _q = new THREE.Quaternion();
  private readonly _v = new THREE.Vector3();

  constructor(
    private readonly world: RAPIER.World,
    readonly config: VehicleConfig,
    spawn: VehicleSpawn,
  ) {
    this.spawn = { position: spawn.position.clone(), quaternion: spawn.quaternion.clone() };

    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(spawn.position.x, spawn.position.y, spawn.position.z)
      .setRotation({ x: spawn.quaternion.x, y: spawn.quaternion.y, z: spawn.quaternion.z, w: spawn.quaternion.w })
      .setCanSleep(false)
      .setLinearDamping(0.05)
      .setAngularDamping(0.4);
    this.body = world.createRigidBody(bodyDesc);

    const he = config.chassisHalfExtents;
    // Densité 0 : la masse est définie manuellement pour contrôler le centre de gravité.
    const colliderDesc = RAPIER.ColliderDesc.cuboid(he.x, he.y, he.z)
      .setDensity(0)
      .setFriction(0.6)
      .setRestitution(0.0)
      .setCollisionGroups(CAR_INTERACTION_GROUP);
    this.collider = world.createCollider(colliderDesc, this.body);

    // Masse + inertie d'un pavé + centre de gravité abaissé (anti-tonneau).
    const m = config.mass;
    const fx = he.x * 2;
    const fy = he.y * 2;
    const fz = he.z * 2;
    const inertia = {
      x: (1 / 12) * m * (fy * fy + fz * fz),
      y: (1 / 12) * m * (fx * fx + fz * fz),
      z: (1 / 12) * m * (fx * fx + fy * fy),
    };
    this.body.setAdditionalMassProperties(
      m,
      config.centerOfMassOffset,
      inertia,
      { x: 0, y: 0, z: 0, w: 1 },
      true,
    );

    // Création du contrôleur de véhicule raycast.
    this.vehicle = world.createVehicleController(this.body);
    // NB: l'API Rapier expose un setter nommé `setIndexForwardAxis` (assignation).
    this.vehicle.setIndexForwardAxis = 2; // +Z = avant
    this.vehicle.indexUpAxis = 1; // +Y = haut

    const direction = { x: 0, y: -1, z: 0 };
    const axle = { x: -1, y: 0, z: 0 };
    config.wheelConnections.forEach((w, i) => {
      this.vehicle.addWheel(
        { x: w.x, y: w.y, z: w.z },
        direction,
        axle,
        config.suspensionRestLength,
        config.wheelRadius,
      );
      this.vehicle.setWheelSuspensionStiffness(i, config.suspensionStiffness);
      this.vehicle.setWheelMaxSuspensionTravel(i, config.maxSuspensionTravel);
      this.vehicle.setWheelSuspensionCompression(i, config.suspensionDamping * 0.85);
      this.vehicle.setWheelSuspensionRelaxation(i, config.suspensionDamping);
      this.vehicle.setWheelFrictionSlip(i, config.wheelFriction);
      this.vehicle.setWheelSideFrictionStiffness(i, config.lateralFriction);
      if (w.powered) this.poweredWheels.push(i);
      if (w.steering) this.steeredWheels.push(i);
    });
  }

  /** Vitesse signée le long de l'axe avant (m/s). */
  get forwardSpeed(): number {
    return this.vehicle.currentVehicleSpeed();
  }

  get speedKmh(): number {
    return Math.abs(this.forwardSpeed) * 3.6;
  }

  /**
   * Applique les contrôles puis fait avancer la dynamique du véhicule.
   * Doit être appelé AVANT world.step().
   */
  update(control: ControlState, dt: number): void {
    const cfg = this.config;
    const speed = Math.abs(this.forwardSpeed);

    // --- Braquage progressif avec réduction à haute vitesse ---
    const speedFactor = 1 / (1 + speed * 0.01);
    const targetSteering = -control.steer * cfg.maxSteering * speedFactor;
    // Retour au centre / approche progressive (lerpAngle).
    const steerLerp = control.steer === 0 ? 8 * dt : 6 * dt;
    this.currentSteering += (targetSteering - this.currentSteering) * Math.min(1, steerLerp);
    for (const i of this.steeredWheels) {
      this.vehicle.setWheelSteering(i, this.currentSteering);
    }

    // --- Moteur (courbe d'accélération + limitation vitesse max) ---
    let engine = 0;
    let brake = 0;
    const overMax = speed >= cfg.maxSpeed;
    if (control.throttle > 0) {
      // Courbe douce : couple plus faible à haute vitesse.
      const powerCurve = 1 - Math.min(1, speed / cfg.maxSpeed) * 0.6;
      engine = overMax ? 0 : control.throttle * cfg.engineForce * powerCurve;
    }
    if (control.brake > 0) {
      if (this.forwardSpeed > 0.5) {
        // En marche avant : le bouton freine.
        brake = control.brake * cfg.brakeForce;
      } else {
        // À l'arrêt / en arrière : marche arrière.
        engine = -control.brake * cfg.engineForce * 0.5;
      }
    }

    const enginePerWheel = engine / Math.max(1, this.poweredWheels.length);
    for (let i = 0; i < this.vehicle.numWheels(); i++) {
      this.vehicle.setWheelEngineForce(i, this.poweredWheels.includes(i) ? enginePerWheel : 0);
      this.vehicle.setWheelBrake(i, brake);
    }

    // --- Frein à main : forte friction frein sur l'arrière (dérapage) ---
    if (control.handbrake) {
      for (const i of this.poweredWheels) {
        this.vehicle.setWheelBrake(i, cfg.handbrakeForce);
        // Réduit la friction latérale arrière pour autoriser un dérapage contrôlé.
        this.vehicle.setWheelSideFrictionStiffness(i, cfg.lateralFriction * 0.45);
      }
    } else {
      for (const i of this.poweredWheels) {
        this.vehicle.setWheelSideFrictionStiffness(i, cfg.lateralFriction);
      }
    }

    // filterGroups : les rayons de suspension ignorent les autres voitures.
    this.vehicle.updateVehicle(dt, undefined, CAR_INTERACTION_GROUP);
  }

  /** Transform du châssis pour le rendu. */
  getChassisTransform(outPos: THREE.Vector3, outQuat: THREE.Quaternion): void {
    const t = this.body.translation();
    const r = this.body.rotation();
    outPos.set(t.x, t.y, t.z);
    outQuat.set(r.x, r.y, r.z, r.w);
  }

  /** Calcule la transform locale (par rapport au châssis) de chaque roue. */
  getWheelTransforms(out: WheelTransform[]): void {
    for (let i = 0; i < this.vehicle.numWheels(); i++) {
      const conn = this.vehicle.wheelChassisConnectionPointCs(i)!;
      const susp = this.vehicle.wheelSuspensionLength(i) ?? this.config.suspensionRestLength;
      const wt = out[i] ?? (out[i] = { position: new THREE.Vector3(), steering: 0, roll: 0, radius: this.config.wheelRadius });
      // La roue descend de (suspensionLength) le long de l'axe -Y local.
      wt.position.set(conn.x, conn.y - susp, conn.z);
      wt.steering = this.vehicle.wheelSteering(i) ?? 0;
      wt.roll = this.vehicle.wheelRotation(i) ?? 0;
      wt.radius = this.config.wheelRadius;
    }
  }

  /** Vitesse linéaire monde. */
  getVelocity(out: THREE.Vector3): THREE.Vector3 {
    const v = this.body.linvel();
    return out.set(v.x, v.y, v.z);
  }

  /** Vecteur "avant" monde du châssis. */
  getForward(out: THREE.Vector3): THREE.Vector3 {
    const r = this.body.rotation();
    this._q.set(r.x, r.y, r.z, r.w);
    return out.set(0, 0, 1).applyQuaternion(this._q);
  }

  /** True si la voiture est retournée (axe up local pointe vers le bas). */
  isFlipped(): boolean {
    const r = this.body.rotation();
    this._q.set(r.x, r.y, r.z, r.w);
    this._v.set(0, 1, 0).applyQuaternion(this._q);
    return this._v.y < 0.1;
  }

  /** Nombre de roues en contact avec le sol. */
  wheelsInContact(): number {
    let n = 0;
    for (let i = 0; i < this.vehicle.numWheels(); i++) {
      if (this.vehicle.wheelIsInContact(i)) n++;
    }
    return n;
  }

  setSpawn(spawn: VehicleSpawn): void {
    this.spawn = { position: spawn.position.clone(), quaternion: spawn.quaternion.clone() };
  }

  /** Replace le véhicule au spawn courant, vitesses annulées. */
  respawn(spawn?: VehicleSpawn): void {
    const s = spawn ?? this.spawn;
    this.currentSteering = 0;
    this.body.setTranslation({ x: s.position.x, y: s.position.y, z: s.position.z }, true);
    this.body.setRotation({ x: s.quaternion.x, y: s.quaternion.y, z: s.quaternion.z, w: s.quaternion.w }, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  }

  dispose(): void {
    this.world.removeVehicleController(this.vehicle);
    this.world.removeCollider(this.collider, false);
    this.world.removeRigidBody(this.body);
  }
}
