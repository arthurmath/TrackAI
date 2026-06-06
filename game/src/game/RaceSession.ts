/**
 * RaceSession — encapsule une course active : monde physique, circuit, véhicule,
 * vue du véhicule, état de course. Avance la physique à pas fixe et fournit un
 * rendu interpolé (alpha) découplé de la simulation.
 */
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { PhysicsWorld } from '../physics/PhysicsWorld';
import { VehicleController, type VehicleSpawn } from '../physics/VehicleController';
import { TrackFactory, type BuiltTrack } from '../assets/TrackFactory';
import { VehicleView } from '../assets/VehicleView';
import { Race } from './Race';
import type { VehicleConfig } from '../physics/vehicleConfig';
import type { TrackDefinition } from '../entities/tracks/types';
import type { Controller, VehicleObservation } from '../controllers/Controller';
import type { Lighting } from '../rendering/Lighting';
import type { WheelTransform } from '../physics/VehicleController';

const SENSOR_ANGLES = [0, 0.5, -0.5, 1.0, -1.0]; // radians (avant, ±30°, ±60°)
const SENSOR_MAX = 50;

export class RaceSession {
  readonly physics: PhysicsWorld;
  readonly track: BuiltTrack;
  readonly vehicle: VehicleController;
  readonly view: VehicleView;
  readonly race: Race;

  private readonly prevPos = new THREE.Vector3();
  private readonly currPos = new THREE.Vector3();
  private readonly prevQuat = new THREE.Quaternion();
  private readonly currQuat = new THREE.Quaternion();
  private readonly renderPos = new THREE.Vector3();
  private readonly renderQuat = new THREE.Quaternion();
  private readonly wheelTransforms: WheelTransform[] = [];

  private readonly _vel = new THREE.Vector3();
  private readonly _fwd = new THREE.Vector3();
  private readonly _ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 });

  private flippedTimer = 0;

  constructor(
    scene: THREE.Scene,
    private readonly lighting: Lighting,
    readonly vehicleConfig: VehicleConfig,
    readonly trackDef: TrackDefinition,
    private readonly controller: Controller,
  ) {
    this.physics = new PhysicsWorld(trackDef.gravity);

    const factory = new TrackFactory(this.physics.world, scene);
    this.track = factory.build(trackDef);

    const spawn: VehicleSpawn = this.track.spawn;
    this.vehicle = new VehicleController(this.physics.world, vehicleConfig, spawn);

    this.view = new VehicleView(vehicleConfig);
    scene.add(this.view.group);

    this.race = new Race(trackDef.id, vehicleConfig.id);

    this.lighting.apply(trackDef.lighting);

    // Initialise les buffers d'interpolation.
    this.vehicle.getChassisTransform(this.currPos, this.currQuat);
    this.prevPos.copy(this.currPos);
    this.prevQuat.copy(this.currQuat);
  }

  /** Pas fixe de simulation. allowControl=false pendant le compte à rebours. */
  fixedUpdate(dt: number, allowControl: boolean): void {
    const control = this.controller.sample();

    if (control.reset) {
      this.vehicle.respawn();
      this.flippedTimer = 0;
    }

    if (allowControl) {
      this.vehicle.update(control, dt);
    } else {
      this.vehicle.update({ throttle: 0, brake: 0, steer: 0, handbrake: true, reset: false }, dt);
    }

    this.physics.step();

    // Buffers d'interpolation.
    this.prevPos.copy(this.currPos);
    this.prevQuat.copy(this.currQuat);
    this.vehicle.getChassisTransform(this.currPos, this.currQuat);

    // Avancement de la course.
    const progress = this.track.getProgress(this.currPos);
    this.race.update(dt, progress);

    // Respawn auto si retournée trop longtemps ou tombée sous la map.
    if (this.vehicle.isFlipped() && this.vehicle.speedKmh < 5) {
      this.flippedTimer += dt;
    } else {
      this.flippedTimer = 0;
    }
    if (this.flippedTimer > 2.5 || this.currPos.y < -10) {
      this.vehicle.respawn();
      this.flippedTimer = 0;
    }

    // Observation pour l'IA (si applicable).
    if (this.controller.pushObservation) {
      this.controller.pushObservation(this.buildObservation(progress));
    }
  }

  /** Rendu interpolé entre deux pas physiques. */
  render(alpha: number): void {
    this.renderPos.lerpVectors(this.prevPos, this.currPos, alpha);
    this.renderQuat.copy(this.prevQuat).slerp(this.currQuat, alpha);
    this.vehicle.getWheelTransforms(this.wheelTransforms);
    this.view.update(this.renderPos, this.renderQuat, this.wheelTransforms);
    this.lighting.followTarget(this.renderPos);
  }

  get renderPosition(): THREE.Vector3 {
    return this.renderPos;
  }
  get renderRotation(): THREE.Quaternion {
    return this.renderQuat;
  }
  get speedKmh(): number {
    return this.vehicle.speedKmh;
  }
  get speed01(): number {
    return Math.min(1, this.vehicle.speedKmh / 320);
  }

  private buildObservation(progress: number): VehicleObservation {
    const t = this.vehicle.body.translation();
    const r = this.vehicle.body.rotation();
    this.vehicle.getVelocity(this._vel);
    this.vehicle.getForward(this._fwd);

    const sensors = this.castSensors();
    const onCurve = this.track.curve.getPointAt(progress);
    const dist = Math.hypot(onCurve.x - t.x, onCurve.z - t.z);
    const offTrack = dist > this.trackDef.roadWidth * 0.6 || this.vehicle.isFlipped();

    return {
      position: [t.x, t.y, t.z],
      rotation: [r.x, r.y, r.z, r.w],
      velocity: [this._vel.x, this._vel.y, this._vel.z],
      forwardSpeed: this.vehicle.forwardSpeed,
      sensors,
      trackProgress: progress,
      offTrack,
    };
  }

  private castSensors(): number[] {
    const t = this.vehicle.body.translation();
    this.vehicle.getForward(this._fwd);
    const baseAngle = Math.atan2(this._fwd.x, this._fwd.z);
    const out: number[] = [];
    for (const off of SENSOR_ANGLES) {
      const a = baseAngle + off;
      const dir = { x: Math.sin(a), y: 0, z: Math.cos(a) };
      this._ray.origin = { x: t.x, y: t.y + 0.3, z: t.z };
      this._ray.dir = dir;
      const hit = this.physics.world.castRay(this._ray, SENSOR_MAX, true, undefined, undefined, undefined, this.vehicle.body);
      const toi = hit ? ((hit as { timeOfImpact?: number; toi?: number }).timeOfImpact ?? (hit as { toi?: number }).toi ?? SENSOR_MAX) : SENSOR_MAX;
      out.push(toi);
    }
    return out;
  }

  dispose(scene: THREE.Scene): void {
    scene.remove(this.view.group);
    this.view.dispose();
    this.vehicle.dispose();
    this.track.dispose();
    this.controller.dispose?.();
    this.physics.dispose();
  }
}
