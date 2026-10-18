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
  /** Angle de rendu corrigé selon la trajectoire, sans modifier le braquage physique. */
  visualSteering?: number;
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
// Relève la limite d'effort des pneus pour conserver du grip en virage rapide.
const WHEEL_GRIP_MULTIPLIER = 1.5;
// L'avant dispose d'une réserve supplémentaire pour réduire le sous-virage.
const FRONT_GRIP_BIAS = 1.15;
// Renfort de rigidité latérale appliqué aux quatre roues.
const LATERAL_GRIP_MULTIPLIER = 1.3;
// L'arrière glisse avec peu de résistance pour conserver l'élan en dérapage.
const DRIFT_REAR_GRIP = 0.05;
// Le frein amorce la glisse sans dissiper autant de vitesse qu'un freinage droit.
const DRIFT_BRAKE_MULTIPLIER = 0.2;
// Limite de vitesse de rotation (rad/s), abaissée à mesure que la voiture accélère.
// Elle ne dépend pas de l'angle : maintenir le frein permet toujours de tourner davantage.
const DRIFT_MAX_YAW_RATE = 2.4;
const DRIFT_YAW_SPEED_SCALE = 25; // m/s
/** Groupes des colliders voiture ET des rayons (suspension, capteurs). */
export const CAR_INTERACTION_GROUP = (GROUP_CAR << 16) | GROUP_TRACK;

export class VehicleController {
  readonly body: RAPIER.RigidBody;
  private readonly vehicle: RAPIER.DynamicRayCastVehicleController;
  private readonly collider: RAPIER.Collider;
  private readonly poweredWheels: number[] = [];
  private readonly steeredWheels: number[] = [];
  private readonly wheelbase: number;
  private currentSteering = 0;
  private drifting = false;
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
    const wheelZ = config.wheelConnections.map(wheel => wheel.z);
    this.wheelbase = Math.max(...wheelZ) - Math.min(...wheelZ);

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
      const gripBias = w.z > 0 ? FRONT_GRIP_BIAS : 1;
      this.vehicle.setWheelFrictionSlip(i, config.wheelFriction * WHEEL_GRIP_MULTIPLIER * gripBias);
      this.vehicle.setWheelSideFrictionStiffness(i, config.lateralFriction * LATERAL_GRIP_MULTIPLIER * gripBias);
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
    // Réduction moins forte à haute vitesse pour conserver davantage de braquage.
    const speedFactor = 1 / (1 + speed * 0.0025);
    const targetSteering = -control.steer * cfg.maxSteering * speedFactor;
    // Réactivité du braquage réduite de 15 % à toutes les vitesses, à angle cible identique.
    // Réduction supplémentaire progressive de 100 à 200 km/h, jusqu'à 40 %.
    const highSpeedResponse = 1 - 0.4 * THREE.MathUtils.smoothstep(speed * 3.6, 100, 200);
    const steeringResponse = 6 * 0.85 * highSpeedResponse;
    // Retour au centre inchangé.
    const steerLerp = control.steer === 0 ? 8 * dt : steeringResponse * dt;
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
      const powerCurve = 1 - 0.6 * Math.min(1, speed / cfg.maxSpeed);
      engine = overMax ? 0 : control.throttle * cfg.engineForce * powerCurve;
    }
    const brakeInput = Math.max(control.brake, Number(control.handbrake));
    // Le virage amorce la glisse en marche avant ; en marche arrière, Bas
    // doit rester une commande moteur même si le joueur tourne.
    this.drifting = brakeInput > 0 && this.forwardSpeed > 0.5
      && (this.drifting || control.steer !== 0);
    if (brakeInput > 0) {
      if (this.forwardSpeed > 0.5 || control.throttle > 0 || control.handbrake) {
        // Les deux touches freinent pareil ; seul Bas peut engager la marche arrière.
        brake = brakeInput * cfg.brakeForce * (this.drifting ? DRIFT_BRAKE_MULTIPLIER : 1);
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

    // Le frein en virage libère l'arrière ; son relâchement rétablit le grip normal.
    for (let i = 0; i < this.vehicle.numWheels(); i++) {
      const wheel = cfg.wheelConnections[i];
      const gripBias = wheel.z > 0 ? FRONT_GRIP_BIAS : 1;
      const grip = this.drifting
        ? (wheel.z < 0 ? DRIFT_REAR_GRIP : 1)
        : WHEEL_GRIP_MULTIPLIER * gripBias;
      const lateralGrip = this.drifting ? 1 : LATERAL_GRIP_MULTIPLIER * gripBias;
      this.vehicle.setWheelFrictionSlip(i, cfg.wheelFriction * grip);
      this.vehicle.setWheelSideFrictionStiffness(i, cfg.lateralFriction * lateralGrip);
    }

    // filterGroups : les rayons de suspension ignorent les autres voitures.
    this.vehicle.updateVehicle(dt, undefined, CAR_INTERACTION_GROUP);

    if (this.drifting && this.wheelsInContact() >= 2) {
      const rotation = this.body.rotation();
      this._q.set(rotation.x, rotation.y, rotation.z, rotation.w);
      this._v.set(0, 1, 0).applyQuaternion(this._q);
      const angularVelocity = this.body.angvel();
      const yawRate = this._v.dot(angularVelocity);
      const maxYawRate = DRIFT_MAX_YAW_RATE / (1 + speed / DRIFT_YAW_SPEED_SCALE);
      const correction = yawRate - THREE.MathUtils.clamp(yawRate, -maxYawRate, maxYawRate);
      if (correction !== 0) {
        // Modifier uniquement le lacet, sans toucher au roulis ni au tangage.
        this.body.setAngvel({
          x: angularVelocity.x - this._v.x * correction,
          y: angularVelocity.y - this._v.y * correction,
          z: angularVelocity.z - this._v.z * correction,
        }, true);
      }
    }
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
    let trajectorySteering = 0;
    let trajectoryBlend = 0;
    if (this.config.alignVisualSteeringToTrajectory && !this.drifting && this.wheelsInContact() >= 2) {
      const rotation = this.body.rotation();
      this._q.set(rotation.x, rotation.y, rotation.z, rotation.w).invert();
      const velocity = this.body.linvel();
      const forward = this._v.set(velocity.x, velocity.y, velocity.z).applyQuaternion(this._q).z;
      const angularVelocity = this.body.angvel();
      const yawRate = this._v.set(angularVelocity.x, angularVelocity.y, angularVelocity.z).applyQuaternion(this._q).y;
      // Modèle bicyclette : tan(angle) = empattement / rayon, rayon = vitesse / lacet.
      // Le rapport signé conserve le bon sens de braquage en marche arrière.
      if (Math.abs(forward) > 3) {
        trajectorySteering = Math.atan(this.wheelbase * yawRate / forward);
        trajectoryBlend = THREE.MathUtils.smoothstep(Math.abs(forward), 3, 10);
      }
    }
    for (let i = 0; i < this.vehicle.numWheels(); i++) {
      const conn = this.vehicle.wheelChassisConnectionPointCs(i)!;
      const susp = this.vehicle.wheelSuspensionLength(i) ?? this.config.suspensionRestLength;
      const wt = out[i] ?? (out[i] = { position: new THREE.Vector3(), steering: 0, roll: 0, radius: this.config.wheelRadius });
      // La roue descend de (suspensionLength) le long de l'axe -Y local.
      wt.position.set(conn.x, conn.y - susp, conn.z);
      wt.steering = this.vehicle.wheelSteering(i) ?? 0;
      if (this.config.alignVisualSteeringToTrajectory) {
        const commanded = wt.steering * (this.config.visualSteerScale ?? 1);
        // Réduire seulement : un transfert de charge ou un contre-braquage ne doit
        // jamais inverser les roues ni les faire braquer au-delà de la commande.
        const aligned = THREE.MathUtils.clamp(trajectorySteering, Math.min(0, commanded), Math.max(0, commanded));
        wt.visualSteering = THREE.MathUtils.lerp(commanded, aligned, trajectoryBlend);
      }
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
    this.drifting = false;
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
