/**
 * car_2 — F1 McLaren : monoplace chargée depuis le modèle GLB (export Sketchfab).
 * La physique reste sur le collider procédural ; seul le visuel provient du fichier.
 */
import type { VehicleConfig } from '../types';

export const car_2: VehicleConfig = {
    id: 'car_2',
    name: 'F1 Maclaren',
    color: 0xff2d55,
    /** Compense le châssis plus haut pour retrouver la hauteur de suivi de la Trackmania. */
    chaseCameraHeightOffset: -0.4068,
    mass: 1000,
    chassisHalfExtents: { x: 0.767125, y: 0.34295, z: 1.759875 },
    suspensionRestLength: 0.25270,
    suspensionStiffness: 32,
    suspensionDamping: 4.0,
    maxSuspensionTravel: 0.25270,
    // Centres des pneus du GLB après échelle, rotation et inclinaison visuelle.
    // L'attache est au-dessus du centre de la longueur de suspension au repos.
    wheelConnections: [
        { x: -0.53755180, y: -0.29742600, z: 0.85300310, steering: true, powered: false },
        { x: 0.55565690, y: -0.29779935, z: 0.85299265, steering: true, powered: false },
        { x: -0.60688280, y: -0.35383130, z: -1.44469065, steering: false, powered: true },
        { x: 0.57029545, y: -0.33754070, z: -1.44493860, steering: false, powered: true },
    ],
    wheelRadius: 0.27075,
    wheelFriction: 2.2,
    lateralFriction: 1.1,
    maxSteering: 0.82,
    engineForce: 9200,
    brakeForce: 160,
    maxSpeed: 82,
    centerOfMassOffset: { x: 0.00, y: -0.28880, z: 0.00 },

    modelPath: '/models/cars/f1/source/f1.glb',
    /** Échelle réduite de 9,75 % au total : longueur 3,61 m, largeur 1,51 m. */
    modelScale: 0.1630140625,
    /** Le modèle Roblox pointe vers -Z ; la physique utilise +Z comme avant. */
    modelRotation: { x: 0, y: Math.PI, z: 0 },
    /** Compense la nouvelle échelle pour conserver la hauteur du bas des pneus. */
    modelOffset: { x: 0.00, y: -0.82889210, z: 0.00 },
    /** Roulement, braquage et suspension des quatre roues. */
    wheelAnimation: 'full',
    /** Essieux avant et arrière du GLB, chacun avec les roues G+D fusionnées. */
    wheelAxleMeshNames: ['Object_13', 'Object_12'],
    /** Le mesh GLB braque visuellement plus fort que la physique. */
    visualSteerScale: 0.65,
    alignVisualSteeringToTrajectory: true,
};
