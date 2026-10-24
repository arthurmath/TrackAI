/**
 * CameraController — caméra de poursuite amortie (spring) avec plusieurs modes
 * togglables : Chase (défaut), Hood (capot) et Far (cinématique surélevée).
 * Le déplacement de la voiture est suivi sans retard, avec un FOV fixe.
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
  private readonly previousCarPos = new THREE.Vector3();
  private readonly carDisplacement = new THREE.Vector3();

  private readonly _offset = new THREE.Vector3();
  private readonly _carForward = new THREE.Vector3();
  private readonly _chaseForward = new THREE.Vector3(0, 0, 1);
  private initialized = false;

  constructor(private readonly camera: THREE.PerspectiveCamera) {}

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
   * @param dt delta temps de rendu
   * @param chaseHeightOffset correction verticale propre au véhicule (mètres)
   */
  update(carPos: THREE.Vector3, carQuat: THREE.Quaternion, dt: number, chaseHeightOffset = 0): void {
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
      const o = mode === 'far' ? { x: 0, y: 5.5, z: -11 } : CAMERA_CONFIG.chaseOffset;
      // Suivre le cap horizontal sans incliner le décalage avec le châssis.
      this._carForward.set(0, 0, 1).applyQuaternion(carQuat);
      this._carForward.y = 0;
      if (this._carForward.lengthSq() > 1e-6) {
        this._chaseForward.copy(this._carForward).normalize();
      }
      // Si la voiture pointe à la verticale, conserver le dernier cap valide.
      const forward = this._chaseForward;
      this._offset.set(
        o.x * forward.z + o.z * forward.x,
        o.y,
        -o.x * forward.x + o.z * forward.z,
      );
      this.desiredPos.copy(carPos).add(this._offset);
      this.lookTarget.copy(carPos);
      this.lookTarget.y += mode === 'far'
        ? CAMERA_CONFIG.farLookAtHeight
        : CAMERA_CONFIG.chaseLookAtHeight;
      if (mode === 'chase') {
        this.desiredPos.y += chaseHeightOffset;
        this.lookTarget.y += chaseHeightOffset;
      }

      if (!this.initialized) {
        this.camera.position.copy(this.desiredPos);
        this.smoothedLook.copy(this.lookTarget);
        this.initialized = true;
      } else {
        // Suivre immédiatement la translation ; amortir seulement le changement de cadrage.
        this.carDisplacement.subVectors(carPos, this.previousCarPos);
        this.camera.position.add(this.carDisplacement);
        this.smoothedLook.add(this.carDisplacement);
        const posK = 1 - Math.exp(-CAMERA_CONFIG.positionLerp * dt);
        const lookK = 1 - Math.exp(-CAMERA_CONFIG.rotationLerp * dt);
        this.camera.position.lerp(this.desiredPos, posK);
        this.smoothedLook.lerp(this.lookTarget, lookK);
      }
      this.camera.lookAt(this.smoothedLook);
    }

    this.previousCarPos.copy(carPos);
    if (this.camera.fov !== CAMERA_CONFIG.baseFov) {
      this.camera.fov = CAMERA_CONFIG.baseFov;
      this.camera.updateProjectionMatrix();
    }
  }
}
