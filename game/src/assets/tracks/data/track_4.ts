/**
 * track_4 — "Cartoon GP" : circuit de course complet importé depuis un modèle
 * 3D low-poly (scene.gltf). Le modèle fournit tout le décor (asphalte visible,
 * tribunes, stands, arbres, terrain) ; la piste *physique* reste procédurale,
 * via une ligne centrale extraite automatiquement du mesh d'asphalte du modèle
 * (matériau « Asfalto »).
 *
 * Dimensions monde du modèle (à modelScale = 1) :
 *   - emprise X : -23.6 → 86.7   (≈ 110 m)
 *   - emprise Z : -108  → 68.5   (≈ 176 m)
 *   - route à plat, surface ≈ Y -0.4 ; largeur de route ≈ 6 m
 *
 * Tracé (vu de dessus, Y vertical) :
 *   - longue DROITE OUEST (x ≈ 1) le long des tribunes
 *   - COMPLEXE SUD-EST : épingle en bas puis virage rapide à l'extrémité est
 *   - DROITE EST (x ≈ 25)
 *   - ÉPINGLE NORD qui rejoint la droite ouest (segment de fermeture)
 *
 * ⚠️ Calage : si la route invisible (collider) ne tombe pas pile sur l'asphalte
 * visible, appuyer sur « L » en jeu pour afficher la ligne centrale de debug et
 * ajuster les points ci-dessous (ou modelScale).
 */
import type { TrackDefinition } from '../types';

// Ligne centrale extraite du mesh « Asfalto » du GLB (24 points de contrôle).
// Le dernier point se relie au premier (boucle fermée CatmullRom) : ce segment
// de fermeture est la longue droite ouest, interpolée en ligne droite.
const CENTERLINE = [
  { x: 0.2, y: -0.3, z: -40.7 },
  { x: 5.2, y: -0.3, z: -51.5 },
  { x: 1.4, y: -0.3, z: -63.9 },
  { x: 7.2, y: -0.3, z: -75.4 },
  { x: 19.7, y: -0.3, z: -78.2 },
  { x: 32.4, y: -0.3, z: -80.9 },
  { x: 40.6, y: -0.3, z: -88.6 },
  { x: 53.5, y: -0.3, z: -88.2 },
  { x: 66.4, y: -0.3, z: -87.3 },
  { x: 71.5, y: -0.3, z: -76.8 },
  { x: 69.5, y: -0.3, z: -65.8 },
  { x: 58.1, y: -0.3, z: -60.0 },
  { x: 49.4, y: -0.3, z: -50.4 },
  { x: 40.8, y: -0.3, z: -40.7 },
  { x: 32.4, y: -0.3, z: -30.9 },
  { x: 27.8, y: -0.3, z: -19.9 },
  { x: 25.6, y: -0.3, z: -7.8 },
  { x: 25.3, y: -0.3, z: 5.1 },
  { x: 25.0, y: -0.3, z: 18.0 },
  { x: 24.7, y: -0.3, z: 31.0 },
  { x: 24.3, y: -0.3, z: 43.9 },
  { x: 19.4, y: -0.3, z: 52.9 },
  { x: 10.0, y: -0.3, z: 45.4 },
  { x: 3.1, y: -0.3, z: 34.5 },
];

export const track_4: TrackDefinition = {
  id: 'track_4',
  name: 'Cartoon GP',
  accentColor: 0x4caf50,

  centerline: CENTERLINE,
  /** Largeur du collider ≈ largeur de l'asphalte du modèle (6 m) + petite marge. */
  roadWidth: 6.5,
  barrierHeight: 1.0,
  segments: 420,

  roadFriction: 1.0,
  gravity: { x: 0, y: -9.81, z: 0 },

  /** Sol physique de sécurité (invisible : le GLB fournit le terrain visible). */
  groundSize: 700,
  groundColor: 0x4f9e3a,

  /** Ambiance diurne ensoleillée, cohérente avec le rendu cartoon clair. */
  lighting: {
    skyColor: 0x8ec9ee,
    groundColor: 0x4f8a30,
    fogColor: 0xcfe6f5,
    ambientColor: 0xd6e8f7,
    ambientIntensity: 0.6,
    hemiIntensity: 0.7,
    sunColor: 0xfff6e6,
    sunIntensity: 3.0,
    sunDirection: { x: -0.4, y: 0.8, z: 0.25 },
  },

  decorations: [],

  /**
   * Départ sur la longue droite ouest (segment de fermeture point23 -> point0),
   * face au premier virage avec de l'élan. startU: 0 plaçait le spawn pile à
   * l'entrée de l'épingle sud-est, sans piste d'élan : la voiture sortait
   * aussitôt et l'IA apprenait à reculer pour survivre. Ajuster entre ~0.90 et
   * ~0.99 avec la touche « L » (ligne centrale de debug) si besoin.
   */
  startU: 0.92,

  /** Modèle 3D du circuit (décor + asphalte visible). */
  modelPath: '/models/tracks/cartoon_circuit/scene.gltf',
  modelScale: 1,

  /**
   * Route procédurale masquée : seul l'asphalte du GLB est visible. Le collider
   * de route (invisible) suit quand même la ligne centrale ci-dessus.
   * Passe à `true` temporairement si tu veux voir le ruban procédural se
   * superposer à la route du modèle pendant le calage.
   */
  showProceduralTrack: false,
};
