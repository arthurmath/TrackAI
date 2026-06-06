/**
 * CameraController — caméra de poursuite amortie (spring) avec plusieurs modes
 * togglables : Chase (défaut), Hood (capot) et Far (cinématique surélevée).
 * Le FOV augmente légèrement avec la vitesse pour la sensation de vitesse.
 */
import * as THREE from 'three';
import { CAMERA_CONFIG } from '../config';

export type CameraMode = 'chase' | 'hood' | 'far';
const MODES: CameraMode[] = ['chase', 'hood', 'far'];

export class CameraController {
  private modeIndex = 0;

  private readonly desiredPos = new THREE.Vector3();
  private readonly lookTarget = new THREE.Vector3();
  private readonly smoothedLook = new THREE.Vector3();

  private readonly _offset = new THREE.Vector3();
  private readonly _carForward = new THREE.Vector3();
  private currentFov: number;
  private initialized = false;

  constructor(private readonly camera: THREE.PerspectiveCamera) {
    this.currentFov = CAMERA_CONFIG.baseFov;
  }

  get mode(): CameraMode {
    return MODES[this.modeIndex];
  }

  cycle(): CameraMode {
    this.modeIndex = (this.modeIndex + 1) % MODES.length;
    this.initialized = false; // snap pour éviter un balayage brutal
    return this.mode;
  }

  /**
   * @param carPos position monde de la voiture
   * @param carQuat orientation monde de la voiture
   * @param speed vitesse (m/s) pour le FOV
   * @param dt delta temps de rendu
   */
  update(carPos: THREE.Vector3, carQuat: THREE.Quaternion, speed: number, dt: number): void {
    const mode = this.mode;

    if (mode === 'hood') {
      const o = CAMERA_CONFIG.hoodOffset;
      this._offset.set(o.x, o.y, o.z).applyQuaternion(carQuat);
      this.desiredPos.copy(carPos).add(this._offset);
      this._carForward.set(0, 0, 1).applyQuaternion(carQuat);
      this.lookTarget.copy(this.desiredPos).add(this._carForward.multiplyScalar(10));
      // Hood cam : suivi quasi-rigide.
      this.camera.position.copy(this.desiredPos);
      this.smoothedLook.copy(this.lookTarget);
      this.camera.lookAt(this.smoothedLook);
    } else {
      const o = mode === 'far' ? { x: 0, y: 6.5, z: -13 } : CAMERA_CONFIG.chaseOffset;
      this._offset.set(o.x, o.y, o.z).applyQuaternion(carQuat);
      this.desiredPos.copy(carPos).add(this._offset);
      this.lookTarget.copy(carPos);
      this.lookTarget.y += CAMERA_CONFIG.chaseLookAtHeight;

      if (!this.initialized) {
        this.camera.position.copy(this.desiredPos);
        this.smoothedLook.copy(this.lookTarget);
        this.initialized = true;
      } else {
        const posK = 1 - Math.exp(-CAMERA_CONFIG.positionLerp * dt);
        const lookK = 1 - Math.exp(-CAMERA_CONFIG.rotationLerp * dt);
        this.camera.position.lerp(this.desiredPos, posK);
        this.smoothedLook.lerp(this.lookTarget, lookK);
      }
      this.camera.lookAt(this.smoothedLook);
    }

    // FOV dynamique selon la vitesse.
    const t = Math.min(1, Math.abs(speed) / CAMERA_CONFIG.fovSpeedReference);
    const targetFov = CAMERA_CONFIG.baseFov + (CAMERA_CONFIG.maxFov - CAMERA_CONFIG.baseFov) * t;
    this.currentFov += (targetFov - this.currentFov) * Math.min(1, 4 * dt);
    if (Math.abs(this.currentFov - this.camera.fov) > 0.01) {
      this.camera.fov = this.currentFov;
      this.camera.updateProjectionMatrix();
    }
  }
}
