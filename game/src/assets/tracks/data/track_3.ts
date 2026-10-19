/** Stadium Sprint : boucle technique étendue sur la pelouse de l'arène. */
import type { TrackDefinition } from '../types';

// Échelle générale du stade. Le tracé ci-dessous occupe la pelouse à cette échelle.
const CIRCUIT_SCALE = 2;

// Tracé élargi et allongé, avec deux rentrants plus profonds côté nord pour
// conserver quatre virages alternés d'affilée. Le S au sud est aussi accentué.
// Les raccords lissés gardent les bords de route réguliers à largeur constante.
const CENTERLINE = [
  { x: -45.6932, y: 0.4, z: -0.9158 },
  { x: -45.2599, y: 0.4, z: 1.5189 },
  { x: -44.5924, y: 0.4, z: 3.8745 },
  { x: -43.6937, y: 0.4, z: 6.1343 },
  { x: -42.5818, y: 0.4, z: 8.2934 },
  { x: -41.2900, y: 0.4, z: 10.3592 },
  { x: -39.8603, y: 0.4, z: 12.3476 },
  { x: -38.3350, y: 0.4, z: 14.2781 },
  { x: -36.7489, y: 0.4, z: 16.1680 },
  { x: -35.1256, y: 0.4, z: 18.0275 },
  { x: -33.4758, y: 0.4, z: 19.8553 },
  { x: -31.7990, y: 0.4, z: 21.6359 },
  { x: -30.0861, y: 0.4, z: 23.3363 },
  { x: -28.3231, y: 0.4, z: 24.9052 },
  { x: -26.4967, y: 0.4, z: 26.2745 },
  { x: -24.5998, y: 0.4, z: 27.3654 },
  { x: -22.6368, y: 0.4, z: 28.0980 },
  { x: -20.6238, y: 0.4, z: 28.4054 },
  { x: -18.5855, y: 0.4, z: 28.2472 },
  { x: -16.5463, y: 0.4, z: 27.6239 },
  { x: -14.5224, y: 0.4, z: 26.5871 },
  { x: -12.5162, y: 0.4, z: 25.2460 },
  { x: -10.5177, y: 0.4, z: 23.7645 },
  { x: -8.5114, y: 0.4, z: 22.3469 },
  { x: -6.4863, y: 0.4, z: 21.2094 },
  { x: -4.4421, y: 0.4, z: 20.5407 },
  { x: -2.3914, y: 0.4, z: 20.4605 },
  { x: -0.3532, y: 0.4, z: 20.9930 },
  { x: 1.6554, y: 0.4, z: 22.0629 },
  { x: 3.6285, y: 0.4, z: 23.5185 },
  { x: 5.5743, y: 0.4, z: 25.1685 },
  { x: 7.5133, y: 0.4, z: 26.8197 },
  { x: 9.4702, y: 0.4, z: 28.3045 },
  { x: 11.4650, y: 0.4, z: 29.4957 },
  { x: 13.5068, y: 0.4, z: 30.3127 },
  { x: 15.5912, y: 0.4, z: 30.7214 },
  { x: 17.7041, y: 0.4, z: 30.7295 },
  { x: 19.8264, y: 0.4, z: 30.3770 },
  { x: 21.9393, y: 0.4, z: 29.7229 },
  { x: 24.0265, y: 0.4, z: 28.8290 },
  { x: 26.0738, y: 0.4, z: 27.7471 },
  { x: 28.0683, y: 0.4, z: 26.5120 },
  { x: 29.9979, y: 0.4, z: 25.1416 },
  { x: 31.8525, y: 0.4, z: 23.6437 },
  { x: 33.6253, y: 0.4, z: 22.0233 },
  { x: 35.3121, y: 0.4, z: 20.2879 },
  { x: 36.9075, y: 0.4, z: 18.4474 },
  { x: 38.3999, y: 0.4, z: 16.5110 },
  { x: 39.7672, y: 0.4, z: 14.4836 },
  { x: 40.9779, y: 0.4, z: 12.3651 },
  { x: 41.9970, y: 0.4, z: 10.1533 },
  { x: 42.7959, y: 0.4, z: 7.8486 },
  { x: 43.3611, y: 0.4, z: 5.4580 },
  { x: 43.6976, y: 0.4, z: 2.9965 },
  { x: 43.8237, y: 0.4, z: 0.4861 },
  { x: 43.7611, y: 0.4, z: -2.0475 },
  { x: 43.5248, y: 0.4, z: -4.5768 },
  { x: 43.1176, y: 0.4, z: -7.0746 },
  { x: 42.5324, y: 0.4, z: -9.5153 },
  { x: 41.7593, y: 0.4, z: -11.8753 },
  { x: 40.7927, y: 0.4, z: -14.1318 },
  { x: 39.6352, y: 0.4, z: -16.2600 },
  { x: 38.2962, y: 0.4, z: -18.2277 },
  { x: 36.7889, y: 0.4, z: -19.9913 },
  { x: 35.1279, y: 0.4, z: -21.4940 },
  { x: 33.3297, y: 0.4, z: -22.6703 },
  { x: 31.4155, y: 0.4, z: -23.4548 },
  { x: 29.4113, y: 0.4, z: -23.7965 },
  { x: 27.3458, y: 0.4, z: -23.6761 },
  { x: 25.2449, y: 0.4, z: -23.1233 },
  { x: 23.1272, y: 0.4, z: -22.2324 },
  { x: 21.0029, y: 0.4, z: -21.1664 },
  { x: 18.8767, y: 0.4, z: -20.1430 },
  { x: 16.7529, y: 0.4, z: -19.3964 },
  { x: 14.6394, y: 0.4, z: -19.1220 },
  { x: 12.5467, y: 0.4, z: -19.4232 },
  { x: 10.4839, y: 0.4, z: -20.2827 },
  { x: 8.4528, y: 0.4, z: -21.5719 },
  { x: 6.4453, y: 0.4, z: -23.0908 },
  { x: 4.4451, y: 0.4, z: -24.6192 },
  { x: 2.4342, y: 0.4, z: -25.9588 },
  { x: 0.4008, y: 0.4, z: -26.9560 },
  { x: -1.6553, y: 0.4, z: -27.5064 },
  { x: -3.7230, y: 0.4, z: -27.5533 },
  { x: -5.7855, y: 0.4, z: -27.0837 },
  { x: -7.8285, y: 0.4, z: -26.1307 },
  { x: -9.8475, y: 0.4, z: -24.7782 },
  { x: -11.8501, y: 0.4, z: -23.1667 },
  { x: -13.8525, y: 0.4, z: -21.4905 },
  { x: -15.8725, y: 0.4, z: -19.9792 },
  { x: -17.9218, y: 0.4, z: -18.8599 },
  { x: -20.0020, y: 0.4, z: -18.3043 },
  { x: -22.1056, y: 0.4, z: -18.3804 },
  { x: -24.2206, y: 0.4, z: -19.0274 },
  { x: -26.3358, y: 0.4, z: -20.0689 },
  { x: -28.4423, y: 0.4, z: -21.2581 },
  { x: -30.5311, y: 0.4, z: -22.3384 },
  { x: -32.5880, y: 0.4, z: -23.0950 },
  { x: -34.5899, y: 0.4, z: -23.3861 },
  { x: -36.5055, y: 0.4, z: -23.1499 },
  { x: -38.2998, y: 0.4, z: -22.3935 },
  { x: -39.9410, y: 0.4, z: -21.1725 },
  { x: -41.4047, y: 0.4, z: -19.5679 },
  { x: -42.6744, y: 0.4, z: -17.6660 },
  { x: -43.7399, y: 0.4, z: -15.5445 },
  { x: -44.5951, y: 0.4, z: -13.2658 },
  { x: -45.2379, y: 0.4, z: -10.8773 },
  { x: -45.6689, y: 0.4, z: -8.4161 },
  { x: -45.8898, y: 0.4, z: -5.9145 },
  { x: -45.9000, y: 0.4, z: -3.4038 },
];

export const track_3: TrackDefinition = {
  id: 'track_3',
  name: 'Stadium Sprint',

  /** Cyan électrique évoquant l'éclairage LED des stades modernes. */
  accentColor: 0x00d4ff,

  centerline: CENTERLINE.map(({ x, y, z }) => ({
    x: x * CIRCUIT_SCALE,
    y: y * CIRCUIT_SCALE,
    z: z * CIRCUIT_SCALE,
  })),
  roadWidth: 7.5 * CIRCUIT_SCALE,
  // Même hauteur compacte que Sunset Oval, indépendante de l'échelle du stade.
  barrierHeight: 0.85,
  roadStyle: 'raceway',
  // Conserver des segments proches de 0,7 m malgré l'allongement de la boucle.
  segments: 768,

  roadFriction: 1.05,
  gravity: { x: 0, y: -9.81, z: 0 },

  /** Sol physique invisible (filet de sécurité sous le terrain du stade). */
  groundSize: 600 * CIRCUIT_SCALE,
  groundColor: 0x1a3d0a,

  /** Projecteurs blancs équilibrés pour garder les couleurs du stade. */
  lighting: {
    skyColor: 0x14213a,
    groundColor: 0x142513,
    fogColor: 0x17243b,
    ambientColor: 0xffffff,
    ambientIntensity: 0.9,
    hemiIntensity: 0.65,
    /** Lumière principale simulant les projecteurs suspendus au-dessus du terrain. */
    sunColor: 0xf5f8ff,
    sunIntensity: 2.0,
    sunDirection: { x: -0.28, y: 1.0, z: 0.38 },
  },

  /** Projecteur central omnidirectionnel au-dessus du terrain. */
  lights: [
    {
      type: 'point',
      position: { x: 0, y: 60 * CIRCUIT_SCALE, z: 0 },
      color: 0xfff8ef,
      intensity: 300 * CIRCUIT_SCALE,
      distance: 0,
      decay: 1,
    },
  ],

  decorations: [],

  /** Départ à l'ouest, avant les enchaînements nord. */
  startU: 0,

  /** Modèle 3D du stade (décor uniquement, la piste reste procédurale). */
  modelPath: '/models/tracks/stadium/source/wc1.glb',

  /**
   * Taille du décor indépendante de l'emprise du tracé sur la pelouse.
   */
  modelScale: 7 * CIRCUIT_SCALE,

  /** Route asphaltée + barrières latéraires visibles par-dessus le GLB. */
  showProceduralTrack: true,
};
