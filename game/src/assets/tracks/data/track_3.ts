/**
 * track_3 — "Stadium Sprint" : circuit oval tracé sur le terrain synthétique
 * à l'intérieur du stade de la Coupe du Monde (modèle GLB wc1.glb).
 *
 * Le stade est chargé depuis le GLB et mis à l'échelle ×5 (ce qui porte
 * l'arène à ~180 m de large, soit une échelle proche du réel).
 * Le tracé contourne le terrain de football en deux grandes courbes et deux
 * longues lignes droites, offrant des opportunités de dépassement en bout
 * droit et un freinage appuyé dans les virages en épingle.
 *
 * Eclairage : floodlights de stade — ambiance nocturne froide, lumière
 * zenitale intense, légère brume bleutée pour la profondeur.
 */
import type { TrackDefinition } from '../types';

/**
 * Oval inspiré d'un circuit de speedway, dimensionné pour tenir à l'intérieur
 * du terrain de football mis à l'échelle (≈ 90 m × 58 m).
 *
 * Géométrie de la ligne centrale (vue de dessus, Y vertical) :
 *   - Deux longues droites (Nord/Sud) le long de l'axe Z
 *   - Deux virages en demi-cercle aplanis aux extrémités Est/Ouest
 *   - Quelques points intermédiaires pour adoucir les courbes CatmullRom
 */
const CENTERLINE = [
  // --- Virage Est (x > 0) ---
  { x: 32, y: 0.4, z: 8 },
  { x: 34, y: 0.4, z: 2 },
  { x: 34, y: 0.4, z: -2 },
  { x: 32, y: 0.4, z: -8 },
  // --- Longue droite Sud ---
  { x: 20, y: 0.4, z: -18 },
  { x: 5, y: 0.4, z: -24 },
  { x: -5, y: 0.4, z: -24 },
  { x: -20, y: 0.4, z: -18 },
  // --- Virage Ouest (x < 0) ---
  { x: -32, y: 0.4, z: -8 },
  { x: -34, y: 0.4, z: -2 },
  { x: -34, y: 0.4, z: 2 },
  { x: -32, y: 0.4, z: 8 },
  // --- Longue droite Nord ---
  { x: -20, y: 0.4, z: 18 },
  { x: -5, y: 0.4, z: 24 },
  { x: 5, y: 0.4, z: 24 },
  { x: 20, y: 0.4, z: 18 },
];

export const track_3: TrackDefinition = {
  id: 'track_3',
  name: 'Stadium Sprint',

  /** Cyan électrique évoquant l'éclairage LED des stades modernes. */
  accentColor: 0x00d4ff,

  centerline: CENTERLINE,
  roadWidth: 11,
  barrierHeight: 1.1,
  segments: 360,

  roadFriction: 1.05,
  gravity: { x: 0, y: -9.81, z: 0 },

  /** Sol physique invisible (filet de sécurité sous le terrain du stade). */
  groundSize: 600,
  groundColor: 0x1a3d0a,

  /** Floodlights de stade : ciel nuit, lumière zenitale blanche intense. */
  lighting: {
    skyColor: 0x050a14,
    groundColor: 0x060d02,
    fogColor: 0x0a1020,
    ambientColor: 0x3a4d6b,
    ambientIntensity: 0.7,
    hemiIntensity: 0.5,
    /** Lumière principale simulant les projecteurs suspendus au-dessus du terrain. */
    sunColor: 0xfff8e8,
    sunIntensity: 4.5,
    sunDirection: { x: 0.1, y: 1.0, z: 0.15 },
  },

  /** Projecteur central omnidirectionnel au-dessus du terrain. */
  lights: [
    {
      type: 'point',
      position: { x: 0, y: 60, z: 0 },
      color: 0xfff8e8,
      intensity: 1500,
      distance: 0,
      decay: 1,
    },
  ],

  decorations: [],

  /** La ligne de départ est placée au milieu de la droite Nord. */
  startU: 0.85,

  /** Modèle 3D du stade (décor uniquement — la piste reste procédurale). */
  modelPath: '/models/tracks/stadium/source/wc1.glb',

  /**
   * Facteur d'échelle ×5 : le modèle natif (~36 m) est porté à ~180 m,
   * offrant un cadre visuel imposant qui entoure le circuit sans l'écraser.
   */
  modelScale: 7,

  /** Route asphaltée + barrières latéraires visibles par-dessus le GLB. */
  showProceduralTrack: true,
};
