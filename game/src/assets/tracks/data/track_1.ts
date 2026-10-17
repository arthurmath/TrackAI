/**
 * Sunset Oval : circuit de course au milieu d'un parc boisé, en fin d'après-midi.
 */
import type { TrackDefinition } from '../types';

// Boucle fermée : alternance de longues lignes droites et de virages amples.
const CENTERLINE = [
  { x: 0, y: 0, z: 45 },
  { x: 35, y: 0, z: 40 },
  { x: 45, y: 0, z: 10 },
  { x: 20, y: 0, z: -5 },
  { x: 35, y: 0, z: -35 },
  { x: 60, y: 0, z: -55 },
  { x: 30, y: 0, z: -80 },
  { x: -15, y: 0, z: -70 },
  { x: -45, y: 0, z: -40 },
  { x: -20, y: 0, z: -10 },
  { x: -50, y: 0, z: 15 },
  { x: -40, y: 0, z: 48 },
];

export const track_1: TrackDefinition = {
  id: 'track_1',
  name: 'Sunset Oval',
  accentColor: 0xff8c42,
  centerline: CENTERLINE,
  roadWidth: 14,
  barrierHeight: 0.85,
  segments: 320,
  roadFriction: 1.0,
  gravity: { x: 0, y: -9.81, z: 0 },
  groundSize: 700,
  groundColor: 0x657c48,
  scenery: 'sunset-park',
  lighting: {
    skyStyle: 'sunset',
    skyColor: 0x90b7d3,
    groundColor: 0x68724b,
    fogColor: 0xd4d6c5,
    fogNear: 170,
    fogFar: 540,
    ambientColor: 0xe1e7ed,
    ambientIntensity: 0.6,
    hemiIntensity: 1.0,
    sunColor: 0xffe1b2,
    sunIntensity: 2.5,
    sunDirection: { x: -0.72, y: 0.36, z: -0.55 },
  },
  // The sunset-park theme builds the complete landscape around the sampled road.
  decorations: [],
  startU: 0,
};
