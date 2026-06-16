/**
 * OrbitCameraController — caméra libre autour d'un point cible (mode entraînement IA).
 * Souris : orbite / zoom. ZQSD : déplace la caméra sur le plan horizontal (sans tourner).
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { ORBIT_CAMERA_CONFIG } from '../config';
import type { InputManager } from '../core/InputManager';

export class OrbitCameraController {
  private readonly controls: OrbitControls;
  private readonly _forward = new THREE.Vector3();
  private readonly _right = new THREE.Vector3();
  private readonly _move = new THREE.Vector3();
  private active = false;

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    domElement: HTMLElement,
    private readonly input: InputManager,
  ) {
    this.controls = new OrbitControls(camera, domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.screenSpacePanning = false;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.05;
    this.controls.enabled = false;
  }

  get target(): THREE.Vector3 {
    return this.controls.target;
  }

  get isActive(): boolean {
    return this.active;
  }

  /** Active la caméra orbit et place la vue au-dessus du point initial. */
  activate(initialTarget: THREE.Vector3): void {
    this.active = true;
    this.controls.enabled = true;
    this.controls.target.copy(initialTarget);
    const { initialHeight, initialDistance } = ORBIT_CAMERA_CONFIG;
    this.camera.position.set(
      initialTarget.x,
      initialTarget.y + initialHeight,
      initialTarget.z + initialDistance,
    );
    this.camera.fov = ORBIT_CAMERA_CONFIG.fov;
    this.camera.updateProjectionMatrix();
    this.controls.update();
  }

  deactivate(): void {
    this.active = false;
    this.controls.enabled = false;
  }

  update(dt: number): void {
    if (!this.active) return;

    const panX = this.input.orbitPanX;
    const panZ = this.input.orbitPanZ;
    if (panX !== 0 || panZ !== 0) {
      // Direction horizontale de déplacement : vers le point visé (pas la direction de regard).
      this._forward.subVectors(this.controls.target, this.camera.position);
      this._forward.y = 0;
      if (this._forward.lengthSq() < 1e-6) {
        this.camera.getWorldDirection(this._forward);
        this._forward.y = 0;
      }
      if (this._forward.lengthSq() > 1e-6) {
        this._forward.normalize();
        this._right.crossVectors(this._forward, THREE.Object3D.DEFAULT_UP).normalize();
        const speed = ORBIT_CAMERA_CONFIG.panSpeed * dt;
        this._move
          .copy(this._right).multiplyScalar(panX * speed)
          .addScaledVector(this._forward, panZ * speed);
        // Translater caméra ET cible ensemble → orientation inchangée.
        this.camera.position.add(this._move);
        this.controls.target.add(this._move);
      }
    }

    this.controls.update();
  }

  dispose(): void {
    this.controls.dispose();
  }
}
