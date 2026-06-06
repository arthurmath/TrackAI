/**
 * track_2 — "Midnight Circuit" : tracé plus technique et serré, ambiance
 * nocturne fraîche. Démontre la variété de configuration des circuits.
 */
import type { TrackDefinition, DecorationInstance } from './types';

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
  barrierHeight: 1.2,
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
