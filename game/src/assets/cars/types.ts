/**
 * types.ts — schéma de description d'une voiture.
 * Contient les paramètres physiques et, optionnellement, le chemin d'un modèle 3D.
 */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface WheelConnection extends Vec3 {
  steering: boolean;
  powered: boolean;
}

export interface VehicleConfig {
  id: string;
  name: string;
  /** Couleur de carrosserie du placeholder (et teinte d'UI). */
  color: number;

  mass: number; // kg
  /** Demi-dimensions du châssis (collider cuboid) en mètres. */
  chassisHalfExtents: { x: number; y: number; z: number };

  // Suspension (raycast vehicle)
  suspensionRestLength: number;
  suspensionStiffness: number;
  suspensionDamping: number; // relaxation/compression dérivés de cette valeur
  maxSuspensionTravel: number;

  // Roues
  /** Points d'attache des roues (espace local châssis, ordre : FL, FR, RL, RR). */
  wheelConnections: WheelConnection[];
  wheelRadius: number;
  wheelFriction: number; // adhérence longitudinale (frictionSlip)
  lateralFriction: number; // rigidité de friction latérale

  // Conduite
  maxSteering: number; // radians
  engineForce: number;
  brakeForce: number;
  handbrakeForce: number;
  /** Vitesse max approximative (m/s) — utilisée pour limiter la force moteur. */
  maxSpeed: number;

  /** Décalage du centre de gravité (abaissé pour la stabilité). */
  centerOfMassOffset: Vec3;

  /** GLB/OBJ optionnel : si fourni, remplace le placeholder procédural. */
  modelPath?: string;
  /** Facteur d'échelle appliqué au modèle (1 par défaut). */
  modelScale?: number;
  /** Rotation Euler (radians) appliquée au modèle après chargement. */
  modelRotation?: Vec3;
  /** Décalage visuel du modèle par rapport au centre du châssis (mètres). */
  modelOffset?: Vec3;
  /** Couleur uniforme appliquée à tous les meshes du modèle (remplace les matériaux). */
  modelColor?: number;
  /**
   * Animation visuelle des roues nommées :
   * - `full` : position + braquage + roulement (placeholder procédural)
   * - `steer-only` : braquage sur place uniquement (modèles OBJ statiques)
   * - `none` : roues figées
   */
  wheelAnimation?: 'full' | 'steer-only' | 'none';
  /**
   * Noms des meshes de roues dans le modèle (ordre : FL, FR, RL, RR).
   * Par défaut : Wheel_FL, Wheel_FR, Wheel_RL, Wheel_RR.
   */
  wheelMeshNames?: string[];
  /**
   * Roues avant à braquer en mode `steer-only` (ordre : FL, FR).
   * Les autres roues du modèle restent figées.
   */
  steerWheelMeshNames?: string[];
}