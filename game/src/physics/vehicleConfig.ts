/**
 * vehicleConfig.ts — Paramètres physiques des véhicules.
 * Chaque voiture sélectionnable possède sa propre configuration.
 */

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
  wheelRadius: number;
  /** Position des points d'ancrage des roues dans l'espace local du châssis. */
  wheelConnections: ReadonlyArray<{ x: number; y: number; z: number; steering: boolean; powered: boolean }>;
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
  centerOfMassOffset: { x: number; y: number; z: number };

  /** Chemin du GLB (si fourni). Si absent, le placeholder procédural est utilisé. */
  modelPath?: string;
}

const STANDARD_WHEELS = [
  // avant gauche / avant droit (braqués + non motorisés)
  { x: -0.85, y: -0.25, z: 1.35, steering: true, powered: false },
  { x: 0.85, y: -0.25, z: 1.35, steering: true, powered: false },
  // arrière gauche / arrière droit (motorisés, propulsion)
  { x: -0.85, y: -0.25, z: -1.35, steering: false, powered: true },
  { x: 0.85, y: -0.25, z: -1.35, steering: false, powered: true },
] as const;

export const VEHICLES: Record<string, VehicleConfig> = {
  raptor: {
    id: 'raptor',
    name: 'Raptor GT',
    color: 0xff3b30,
    mass: 1200,
    chassisHalfExtents: { x: 0.9, y: 0.4, z: 2.0 },
    suspensionRestLength: 0.3,
    suspensionStiffness: 28,
    suspensionDamping: 4.5,
    maxSuspensionTravel: 0.3,
    wheelRadius: 0.4,
    wheelConnections: STANDARD_WHEELS,
    wheelFriction: 2.0,
    lateralFriction: 1.0,
    maxSteering: 0.6,
    engineForce: 3200,
    brakeForce: 180,
    handbrakeForce: 400,
    maxSpeed: 75,
    centerOfMassOffset: { x: 0, y: -0.3, z: 0 },
  },
  comet: {
    id: 'comet',
    name: 'Comet RS',
    color: 0x0a84ff,
    mass: 1000,
    chassisHalfExtents: { x: 0.85, y: 0.38, z: 1.95 },
    suspensionRestLength: 0.28,
    suspensionStiffness: 32,
    suspensionDamping: 4.0,
    maxSuspensionTravel: 0.28,
    wheelRadius: 0.38,
    wheelConnections: STANDARD_WHEELS,
    wheelFriction: 2.2,
    lateralFriction: 1.1,
    maxSteering: 0.62,
    engineForce: 3000,
    brakeForce: 160,
    handbrakeForce: 420,
    maxSpeed: 82,
    centerOfMassOffset: { x: 0, y: -0.32, z: 0 },
  },
  bull: {
    id: 'bull',
    name: 'Bull Heavy',
    color: 0x34c759,
    mass: 1500,
    chassisHalfExtents: { x: 1.0, y: 0.45, z: 2.1 },
    suspensionRestLength: 0.34,
    suspensionStiffness: 26,
    suspensionDamping: 5.0,
    maxSuspensionTravel: 0.34,
    wheelRadius: 0.44,
    wheelConnections: STANDARD_WHEELS,
    wheelFriction: 1.8,
    lateralFriction: 0.95,
    maxSteering: 0.55,
    engineForce: 3600,
    brakeForce: 200,
    handbrakeForce: 380,
    maxSpeed: 70,
    centerOfMassOffset: { x: 0, y: -0.35, z: 0 },
  },
};

export const DEFAULT_VEHICLE_ID = 'raptor';
