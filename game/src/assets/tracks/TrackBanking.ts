import * as THREE from 'three';
import type { TrackDefinition } from './types';

const UP = new THREE.Vector3(0, 1, 0);

/** Signed cross-slope, with level entry/exit and a constant-angle middle. */
export function trackBankAngle(u: number, banking: TrackDefinition['banking']): number {
  let angle = 0;
  const progress = THREE.MathUtils.euclideanModulo(u, 1);
  for (const bank of banking ?? []) {
    const span = THREE.MathUtils.euclideanModulo(bank.endU - bank.startU, 1);
    if (span < 1e-6) continue;
    const distance = THREE.MathUtils.euclideanModulo(progress - bank.startU, 1);
    if (distance > span) continue;
    const position = distance / span;
    const ramp = Math.min(1, position / 0.2, (1 - position) / 0.2);
    const blend = (1 - Math.cos(Math.PI * ramp)) / 2;
    angle += THREE.MathUtils.degToRad(bank.angle) * blend;
  }
  return angle;
}

/** Unit lateral in the road plane. Positive bank raises the named left edge. */
export function trackLateral(tangent: THREE.Vector3, bankAngle = 0): THREE.Vector3 {
  const lateral = new THREE.Vector3().crossVectors(UP, tangent).normalize();
  const normal = new THREE.Vector3().crossVectors(tangent, lateral).normalize();
  return lateral.multiplyScalar(Math.cos(bankAngle)).addScaledVector(normal, Math.sin(bankAngle));
}

/** Local +Z follows the track, local +Y is perpendicular to its surface. */
export function trackOrientation(tangent: THREE.Vector3, bankAngle = 0): THREE.Quaternion {
  const forward = tangent.clone().normalize();
  const lateral = trackLateral(forward, bankAngle);
  const normal = new THREE.Vector3().crossVectors(forward, lateral).normalize();
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(lateral, normal, forward));
}
