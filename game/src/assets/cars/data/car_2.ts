/**
 * car_2 — F1 McLaren : monoplace chargée depuis le modèle GLB (export Sketchfab).
 * La physique reste sur le collider procédural ; seul le visuel provient du fichier.
 */
import type { VehicleConfig } from '../types';

export const car_2: VehicleConfig = {
    id: 'car_2',
    name: 'F1 Maclaren',
    color: 0xff2d55,
    mass: 1000,
    chassisHalfExtents: { x: 0.85, y: 0.38, z: 1.95 },
    suspensionRestLength: 0.28,
    suspensionStiffness: 32,
    suspensionDamping: 4.0,
    maxSuspensionTravel: 0.28,
    wheelConnections: [
        { x: -0.85, y: -0.25, z: 1.35, steering: true, powered: false },
        { x: 0.85, y: -0.25, z: 1.35, steering: true, powered: false },
        { x: -0.85, y: -0.25, z: -1.35, steering: false, powered: true },
        { x: 0.85, y: -0.25, z: -1.35, steering: false, powered: true },
    ],
    wheelRadius: 0.38,
    wheelFriction: 2.2,
    lateralFriction: 1.1,
    maxSteering: 0.82,
    engineForce: 9200,
    brakeForce: 160,
    maxSpeed: 82,
    centerOfMassOffset: { x: 0, y: -0.32, z: 0 },

    modelPath: '/models/cars/f1/source/f1.glb',
    /** Échelle visuelle : longueur 4,00 m, largeur 1,67 m. */
    modelScale: 0.180625,
    /** Le modèle Roblox pointe vers -Z ; la physique utilise +Z comme avant. */
    modelRotation: { x: 0, y: Math.PI, z: 0 },
    /** Compense la nouvelle échelle pour conserver la hauteur du bas des pneus. */
    modelOffset: { x: 0, y: -0.91844, z: 0 },
    /** Roulement, braquage et suspension des quatre roues. */
    wheelAnimation: 'full',
    /** Essieux avant et arrière du GLB, chacun avec les roues G+D fusionnées. */
    wheelAxleMeshNames: ['Object_13', 'Object_12'],
    /** Le mesh GLB braque visuellement plus fort que la physique. */
    visualSteerScale: 0.65,
};
