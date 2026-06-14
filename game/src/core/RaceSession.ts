/**
 * RaceSession — encapsule une course active : monde physique, circuit, et un ou
 * plusieurs véhicules. En course classique (humain / inférence IA) il n'y a qu'un
 * véhicule ; en entraînement IA, N véhicules pilotés chacun par leur AIController
 * partagent le même monde (sans collision entre eux). Avance la physique à pas
 * fixe et fournit un rendu interpolé (alpha) découplé de la simulation.
 */
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { PhysicsWorld } from '../physics/PhysicsWorld';
import { VehicleController, CAR_INTERACTION_GROUP, type VehicleSpawn, type WheelTransform } from '../physics/VehicleController';
import { TrackConstructor, type BuiltTrack } from '../assets/tracks/TrackConstructor';
import { CarConstructor, type VehicleView } from '../assets/cars/CarConstructor';
import { AssetLoader } from '../utils/AssetLoader';
import { Recorder } from '../utils/Recorder';
import type { VehicleConfig } from '../assets/cars/types';
import type { TrackDefinition } from '../assets/tracks/types';
import type { Controller, VehicleObservation } from '../controllers/Controller';
import type { Lighting } from '../rendering/Lighting';

const SENSOR_ANGLES = [0, 0.5, -0.5, 1.0, -1.0]; // radians (avant, ±30°, ±60°)
const SENSOR_MAX = 50;

/** Un véhicule piloté dans la session : physique, vue, contrôleur, buffers. */
interface SessionAgent {
  controller: Controller;
  vehicle: VehicleController;
  view: VehicleView;
  prevPos: THREE.Vector3;
  currPos: THREE.Vector3;
  prevQuat: THREE.Quaternion;
  currQuat: THREE.Quaternion;
  renderPos: THREE.Vector3;
  renderQuat: THREE.Quaternion;
  wheelTransforms: WheelTransform[];
  flippedTimer: number;
}

export class RaceSession {
  readonly physics: PhysicsWorld;
  readonly track: BuiltTrack;
  readonly race: Recorder;
  readonly vehicleConfig: VehicleConfig;
  readonly trackDef: TrackDefinition;

  private readonly lighting: Lighting;
  private readonly agents: SessionAgent[];

  // Buffers réutilisés (observation/capteurs) pour éviter les allocations par frame.
  private readonly _vel = new THREE.Vector3();
  private readonly _fwd = new THREE.Vector3();
  private readonly _ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 });

  /**
   * Factory asynchrone : construit le monde physique, le circuit (chargement GLB
   * si modelPath est défini), puis un véhicule par contrôleur fourni.
   * Utilisez toujours cette méthode au lieu du constructeur direct.
   */
  static async create(
    scene: THREE.Scene,
    lighting: Lighting,
    vehicleConfig: VehicleConfig,
    trackDef: TrackDefinition,
    controllers: Controller[],
  ): Promise<RaceSession> {
    const physics = new PhysicsWorld(trackDef.gravity);
    const assetLoader = new AssetLoader();
    const trackFactory = new TrackConstructor(physics.world, scene, assetLoader);
    const carFactory = new CarConstructor(assetLoader);
    const track = await trackFactory.build(trackDef);
    // Une vue par véhicule (le circuit n'est construit qu'une fois).
    const views = await Promise.all(controllers.map(() => carFactory.build(vehicleConfig)));
    return new RaceSession(scene, lighting, vehicleConfig, trackDef, controllers, physics, track, views);
  }

  private constructor(
    scene: THREE.Scene,
    lighting: Lighting,
    vehicleConfig: VehicleConfig,
    trackDef: TrackDefinition,
    controllers: Controller[],
    physics: PhysicsWorld,
    track: BuiltTrack,
    views: VehicleView[],
  ) {
    this.physics = physics;
    this.track = track;
    this.vehicleConfig = vehicleConfig;
    this.trackDef = trackDef;
    this.lighting = lighting;

    const spawn: VehicleSpawn = this.track.spawn;
    this.agents = controllers.map((controller, i) => {
      const vehicle = new VehicleController(this.physics.world, vehicleConfig, spawn);
      const view = views[i];
      scene.add(view.group);
      const agent: SessionAgent = {
        controller,
        vehicle,
        view,
        prevPos: new THREE.Vector3(),
        currPos: new THREE.Vector3(),
        prevQuat: new THREE.Quaternion(),
        currQuat: new THREE.Quaternion(),
        renderPos: new THREE.Vector3(),
        renderQuat: new THREE.Quaternion(),
        wheelTransforms: [],
        flippedTimer: 0,
      };
      // Initialise les buffers d'interpolation.
      vehicle.getChassisTransform(agent.currPos, agent.currQuat);
      agent.prevPos.copy(agent.currPos);
      agent.prevQuat.copy(agent.currQuat);
      return agent;
    });

    // Recorder/HUD/caméra suivent l'agent principal (index 0).
    this.race = new Recorder(trackDef.id, vehicleConfig.id);
    this.lighting.apply(trackDef.lighting);
  }

  /** Agent principal : suivi par la caméra, le HUD et le recorder. */
  private get primary(): SessionAgent {
    return this.agents[0];
  }

  /** Pas fixe de simulation. allowControl=false pendant le compte à rebours. */
  fixedUpdate(dt: number, allowControl: boolean): void {
    // 1) Applique les contrôles de chaque agent AVANT le pas physique unique.
    for (const agent of this.agents) {
      const control = agent.controller.sample();

      if (control.reset) {
        agent.vehicle.respawn();
        agent.flippedTimer = 0;
      }

      if (allowControl) {
        agent.vehicle.update(control, dt);
      } else {
        agent.vehicle.update({ throttle: 0, brake: 0, steer: 0, handbrake: true, reset: false }, dt);
      }
    }

    // 2) Un seul pas physique pour tout le monde.
    this.physics.step();

    // 3) Mise à jour par agent : buffers, progression, respawn auto, observation.
    for (let i = 0; i < this.agents.length; i++) {
      const agent = this.agents[i];

      agent.prevPos.copy(agent.currPos);
      agent.prevQuat.copy(agent.currQuat);
      agent.vehicle.getChassisTransform(agent.currPos, agent.currQuat);

      const progress = this.track.getProgress(agent.currPos);

      // Le recorder ne suit que l'agent principal.
      if (i === 0) {
        this.race.update(dt, progress);
      }

      // Respawn auto si retournée trop longtemps ou tombée sous la map.
      if (agent.vehicle.isFlipped() && agent.vehicle.speedKmh < 5) {
        agent.flippedTimer += dt;
      } else {
        agent.flippedTimer = 0;
      }
      if (agent.flippedTimer > 2.5 || agent.currPos.y < -10) {
        agent.vehicle.respawn();
        agent.flippedTimer = 0;
      }

      // Observation pour l'IA (si applicable). On n'envoie que pendant la phase
      // pilotable : les frames du compte à rebours fausseraient l'apprentissage.
      if (allowControl && agent.controller.pushObservation) {
        agent.controller.pushObservation(this.buildObservation(agent, progress));
      }
    }
  }

  /** Rendu interpolé entre deux pas physiques (tous les véhicules). */
  render(alpha: number): void {
    for (const agent of this.agents) {
      agent.renderPos.lerpVectors(agent.prevPos, agent.currPos, alpha);
      agent.renderQuat.copy(agent.prevQuat).slerp(agent.currQuat, alpha);
      agent.vehicle.getWheelTransforms(agent.wheelTransforms);
      agent.view.update(agent.renderPos, agent.renderQuat, agent.wheelTransforms);
    }
    this.lighting.followTarget(this.primary.renderPos);
  }

  /** Véhicule principal (compat : caméra, debug). */
  get vehicle(): VehicleController {
    return this.primary.vehicle;
  }
  get view(): VehicleView {
    return this.primary.view;
  }
  get renderPosition(): THREE.Vector3 {
    return this.primary.renderPos;
  }
  get renderRotation(): THREE.Quaternion {
    return this.primary.renderQuat;
  }
  get speedKmh(): number {
    return this.primary.vehicle.speedKmh;
  }
  get speed01(): number {
    return Math.min(1, this.primary.vehicle.speedKmh / 320);
  }

  private buildObservation(agent: SessionAgent, progress: number): VehicleObservation {
    const t = agent.vehicle.body.translation();
    const r = agent.vehicle.body.rotation();
    agent.vehicle.getVelocity(this._vel);

    const sensors = this.castSensors(agent);
    const onCurve = this.track.curve.getPointAt(progress);
    const dist = Math.hypot(onCurve.x - t.x, onCurve.z - t.z);
    const offTrack = dist > this.trackDef.roadWidth * 0.6 || agent.vehicle.isFlipped();

    return {
      position: [t.x, t.y, t.z],
      rotation: [r.x, r.y, r.z, r.w],
      velocity: [this._vel.x, this._vel.y, this._vel.z],
      forwardSpeed: agent.vehicle.forwardSpeed,
      sensors,
      trackProgress: progress,
      offTrack,
    };
  }

  private castSensors(agent: SessionAgent): number[] {
    const t = agent.vehicle.body.translation();
    agent.vehicle.getForward(this._fwd);
    const baseAngle = Math.atan2(this._fwd.x, this._fwd.z);
    const out: number[] = [];
    for (const off of SENSOR_ANGLES) {
      const a = baseAngle + off;
      const dir = { x: Math.sin(a), y: 0, z: Math.cos(a) };
      this._ray.origin = { x: t.x, y: t.y + 0.3, z: t.z };
      this._ray.dir = dir;
      // filterGroups : les capteurs ignorent les autres voitures ; on exclut aussi soi-même.
      const hit = this.physics.world.castRay(
        this._ray, SENSOR_MAX, true, undefined, CAR_INTERACTION_GROUP, undefined, agent.vehicle.body,
      );
      const toi = hit ? ((hit as { timeOfImpact?: number; toi?: number }).timeOfImpact ?? (hit as { toi?: number }).toi ?? SENSOR_MAX) : SENSOR_MAX;
      out.push(toi);
    }
    return out;
  }

  requestStopTraining(): void {
    for (const agent of this.agents) {
      agent.controller.requestStopTraining?.();
      break;
    }
  }

  dispose(scene: THREE.Scene): void {
    for (const agent of this.agents) {
      scene.remove(agent.view.group);
      agent.view.dispose();
      agent.vehicle.dispose();
      agent.controller.dispose?.();
    }
    this.track.dispose();
    this.physics.dispose();
  }
}
