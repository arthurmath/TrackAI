/**
 * track_2 — "Midnight Circuit" : tracé plus technique et serré, ambiance
 * nocturne fraîche. Démontre la variété de configuration des circuits.
 */
import type { TrackDefinition, DecorationInstance } from '../types';

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

function buildDecorations(): DecorationInstance[] {
  const decos: DecorationInstance[] = [];
  for (let i = 0; i < 40; i++) {
    const a = (i / 40) * Math.PI * 2;
    const r = 95 + (i % 4) * 7;
    decos.push({
      type: i % 5 === 0 ? 'rock' : 'tree',
      position: { x: Math.cos(a) * r, y: 0, z: Math.sin(a) * r },
      rotationY: a * 1.3,
      scale: 0.7 + (i % 3) * 0.3,
    });
  }
  return decos;
}

export const track_2: TrackDefinition = {
  id: 'track_2',
  name: 'Midnight Circuit',
  accentColor: 0x6c5ce7,
  centerline: CENTERLINE,
  roadWidth: 12,
  barrierHeight: 0.95,
  segments: 340,
  roadFriction: 0.95,
  gravity: { x: 0, y: -9.81, z: 0 },
  groundSize: 700,
  groundColor: 0x1f2433,
  lighting: {
    skyColor: 0x0b1026,
    groundColor: 0x070a14,
    fogColor: 0x0b1026,
    ambientColor: 0x33406b,
    ambientIntensity: 0.45,
    hemiIntensity: 0.5,
    sunColor: 0xaec4ff,
    sunIntensity: 1.6,
    sunDirection: { x: 0.4, y: 0.6, z: 0.5 },
  },
  decorations: buildDecorations(),
  startU: 0,
};
