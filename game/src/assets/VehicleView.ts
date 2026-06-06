/**
 * VehicleView — représentation visuelle d'un véhicule.
 * Génère un placeholder procédural (carrosserie BoxGeometry + roues
 * CylinderGeometry) facilement remplaçable par un GLB. Met à jour le châssis
 * et les roues (braquage + roulement + suspension) à chaque frame de rendu.
 */
import * as THREE from 'three';
import type { VehicleConfig } from '../physics/vehicleConfig';
import type { WheelTransform } from '../physics/VehicleController';

export class VehicleView {
  readonly group = new THREE.Group();
  private readonly wheelMeshes: THREE.Object3D[] = [];
  private readonly bodyMaterial: THREE.MeshStandardMaterial;

  constructor(config: VehicleConfig) {
    const he = config.chassisHalfExtents;

    this.bodyMaterial = new THREE.MeshStandardMaterial({
      color: config.color,
      metalness: 0.6,
      roughness: 0.35,
    });

    // Corps principal.
    const body = new THREE.Mesh(new THREE.BoxGeometry(he.x * 2, he.y * 1.2, he.z * 2), this.bodyMaterial);
    body.position.y = 0.05;
    body.castShadow = true;
    body.receiveShadow = true;
    this.group.add(body);

    // Cabine (verrière) pour un look plus voiture.
    const cabin = new THREE.Mesh(
      new THREE.BoxGeometry(he.x * 1.5, he.y * 1.1, he.z * 1.0),
      new THREE.MeshStandardMaterial({ color: 0x10131a, metalness: 0.3, roughness: 0.2 }),
    );
    cabin.position.set(0, he.y * 1.0 + 0.1, -0.1);
    cabin.castShadow = true;
    this.group.add(cabin);

    // Repère "avant" (museau) pour visualiser l'orientation.
    const nose = new THREE.Mesh(
      new THREE.BoxGeometry(he.x * 1.6, he.y * 0.4, 0.3),
      new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0x222222 }),
    );
    nose.position.set(0, 0.0, he.z);
    this.group.add(nose);

    // Roues.
    const wheelGeo = new THREE.CylinderGeometry(config.wheelRadius, config.wheelRadius, 0.3, 18);
    wheelGeo.rotateZ(Math.PI / 2); // axe du cylindre aligné sur X (axle)
    const wheelMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.8, metalness: 0.1 });
    for (let i = 0; i < config.wheelConnections.length; i++) {
      const wheel = new THREE.Mesh(wheelGeo, wheelMat);
      wheel.castShadow = true;
      // Pivot pour appliquer braquage (Y) puis roulement (X).
      const pivot = new THREE.Object3D();
      pivot.add(wheel);
      this.group.add(pivot);
      this.wheelMeshes.push(pivot);
    }
  }

  /** Remplace le placeholder par un modèle GLB chargé. */
  replaceWithModel(model: THREE.Object3D, wheelNames: string[]): void {
    // Retire le placeholder de carrosserie (garde la gestion des roues si nommées).
    this.group.clear();
    this.wheelMeshes.length = 0;
    model.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    this.group.add(model);
    for (const name of wheelNames) {
      const w = model.getObjectByName(name);
      if (w) this.wheelMeshes.push(w);
    }
  }

  /** @param wheels transforms locales (espace châssis). */
  update(position: THREE.Vector3, quaternion: THREE.Quaternion, wheels: WheelTransform[]): void {
    this.group.position.copy(position);
    this.group.quaternion.copy(quaternion);
    for (let i = 0; i < this.wheelMeshes.length && i < wheels.length; i++) {
      const pivot = this.wheelMeshes[i];
      const w = wheels[i];
      pivot.position.copy(w.position);
      pivot.rotation.set(0, w.steering, 0);
      // Roulement appliqué sur l'enfant (la roue) autour de X.
      const wheelMesh = pivot.children[0];
      if (wheelMesh) wheelMesh.rotation.x = w.roll;
    }
  }

  dispose(): void {
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.geometry?.dispose();
        const mat = m.material;
        if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
        else mat?.dispose();
      }
    });
  }
}
