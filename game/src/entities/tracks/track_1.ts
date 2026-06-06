/**
 * track_1 — "Sunset Oval" : une boucle fermée fluide, terrain plat, ambiance
 * de fin d'après-midi. Circuit de démonstration complet (départ/arrivée + tours).
 */
import type { TrackDefinition, DecorationInstance } from './types';

// Boucle fermée : alternance de longues lignes droites et de virages amples.
const CENTERLINE = [
  { x: 0, y: 0, z: 60 },
  { x: 40, y: 0, z: 55 },
  { x: 70, y: 0, z: 20 },
  { x: 75, y: 0, z: -20 },
  { x: 50, y: 0, z: -55 },
  { x: 10, y: 0, z: -70 },
  { x: -30, y: 0, z: -60 },
  { x: -65, y: 0, z: -30 },
  { x: -75, y: 0, z: 10 },
  { x: -55, y: 0, z: 45 },
  { x: -20, y: 0, z: 62 },
];

// Décor : couronne d'arbres et quelques rochers répartis autour du circuit.
function buildDecorations(): DecorationInstance[] {
  const decos: DecorationInstance[] = [];
  const ringRadius = 110;
  for (let i = 0; i < 48; i++) {
    const a = (i / 48) * Math.PI * 2;
    const r = ringRadius + (i % 3) * 9;
    decos.push({
      type: i % 7 === 0 ? 'rock' : 'tree',
      position: { x: Math.cos(a) * r, y: 0, z: Math.sin(a) * r },
      rotationY: a,
      scale: 0.8 + (i % 4) * 0.25,
    });
  }
  return decos;
}

export const track_1: TrackDefinition = {
  id: 'track_1',
  name: 'Sunset Oval',
  accentColor: 0xff8c42,
  centerline: CENTERLINE,
  roadWidth: 14,
  barrierHeight: 1.1,
  segments: 320,
  roadFriction: 1.0,
  gravity: { x: 0, y: -9.81, z: 0 },
  groundSize: 700,
  groundColor: 0x4a6b3a,
  lighting: {
    skyColor: 0xffb27a,
    groundColor: 0x3a4a2a,
    fogColor: 0xffc59a,
    ambientColor: 0xffd9b3,
    ambientIntensity: 0.5,
    hemiIntensity: 0.7,
    sunColor: 0xffe2b0,
    sunIntensity: 3.2,
    sunDirection: { x: -0.5, y: 0.45, z: -0.3 },
  },
  decorations: buildDecorations(),
  startU: 0,
};
