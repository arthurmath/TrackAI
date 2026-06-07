/**
 * track_1 — "Sunset Oval" : une boucle fermée fluide, terrain plat, ciel
 * diurne. Circuit de démonstration complet (départ/arrivée + tours).
 */
import type { TrackDefinition, DecorationInstance } from '../types';

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
    skyColor: 0x6eb5e8,
    groundColor: 0x3a4a2a,
    fogColor: 0xb8daf0,
    ambientColor: 0xc8dff5,
    ambientIntensity: 0.55,
    hemiIntensity: 0.65,
    sunColor: 0xfff4e0,
    sunIntensity: 2.8,
    sunDirection: { x: -0.5, y: 0.45, z: -0.3 },
  },
  decorations: buildDecorations(),
  startU: 0,
};
