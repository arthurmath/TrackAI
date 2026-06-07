/**
 * Lighting — configure le ciel et l'éclairage d'une scène à partir d'une
 * définition de circuit (soleil directionnel + ombres, ambiance, hémisphère).
 */
import * as THREE from 'three';
import { GRAPHICS_CONFIG } from '../config';
import type { TrackLighting } from '../assets/tracks/types';

export class Lighting {
  private readonly sun: THREE.DirectionalLight;
  private readonly ambient: THREE.AmbientLight;
  private readonly hemi: THREE.HemisphereLight;
  private readonly group = new THREE.Group();

  constructor(private readonly scene: THREE.Scene) {
    this.sun = new THREE.DirectionalLight(0xffffff, 3.0);
    this.sun.castShadow = GRAPHICS_CONFIG.shadows;
    this.sun.shadow.mapSize.set(GRAPHICS_CONFIG.shadowMapSize, GRAPHICS_CONFIG.shadowMapSize);
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 600;
    const d = 160;
    this.sun.shadow.camera.left = -d;
    this.sun.shadow.camera.right = d;
    this.sun.shadow.camera.top = d;
    this.sun.shadow.camera.bottom = -d;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.02;

    this.ambient = new THREE.AmbientLight(0xffffff, 0.4);
    this.hemi = new THREE.HemisphereLight(0xbfd8ff, 0x586247, 0.6);

    this.group.add(this.sun, this.sun.target, this.ambient, this.hemi);
    scene.add(this.group);
  }

  apply(lighting: TrackLighting): void {
    const sunDir = new THREE.Vector3(lighting.sunDirection.x, lighting.sunDirection.y, lighting.sunDirection.z).normalize();
    this.sun.position.copy(sunDir.clone().multiplyScalar(180));
    this.sun.target.position.set(0, 0, 0);
    this.sun.intensity = lighting.sunIntensity;
    this.sun.color.set(lighting.sunColor);
    this.ambient.intensity = lighting.ambientIntensity;
    this.ambient.color.set(lighting.ambientColor);
    this.hemi.color.set(lighting.skyColor);
    this.hemi.groundColor.set(lighting.groundColor);
    this.hemi.intensity = lighting.hemiIntensity;

    // Ciel + brouillard assortis.
    this.scene.background = new THREE.Color(lighting.skyColor);
    this.scene.fog = new THREE.Fog(lighting.fogColor ?? lighting.skyColor, GRAPHICS_CONFIG.fogNear, GRAPHICS_CONFIG.fogFar);
  }

  /** Fait suivre l'ombre du soleil à la voiture (pour garder une ombre nette). */
  followTarget(pos: THREE.Vector3): void {
    const offset = this.sun.position.clone().sub(this.sun.target.position);
    this.sun.target.position.copy(pos);
    this.sun.position.copy(pos).add(offset);
  }

  dispose(): void {
    this.scene.remove(this.group);
    this.sun.dispose();
    this.ambient.dispose();
    this.hemi.dispose();
  }
}
