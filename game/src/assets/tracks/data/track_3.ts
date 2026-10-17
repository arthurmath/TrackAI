/** Stadium Sprint : boucle technique compacte au milieu de l'arène. */
import type { TrackDefinition } from '../types';

// Échelle commune au stade et à la piste physique, sans modifier les voitures.
const CIRCUIT_SCALE = 2;

// Enchaînements de virages sur les deux côtés, avec des raccords arrondis.
// Rayon minimal interpolé : environ 4,6 m, sans pincement des bords de route.
const CENTERLINE = [
  { x: -29.8396, y: 0.4, z: -0.4410 },
  { x: -29.6121, y: 0.4, z: 1.0010 },
  { x: -29.2022, y: 0.4, z: 2.3832 },
  { x: -28.5874, y: 0.4, z: 3.6834 },
  { x: -27.7870, y: 0.4, z: 4.8961 },
  { x: -26.8522, y: 0.4, z: 6.0358 },
  { x: -25.8406, y: 0.4, z: 7.1287 },
  { x: -24.7953, y: 0.4, z: 8.1986 },
  { x: -23.7388, y: 0.4, z: 9.2604 },
  { x: -22.6797, y: 0.4, z: 10.3202 },
  { x: -21.6199, y: 0.4, z: 11.3792 },
  { x: -20.5577, y: 0.4, z: 12.4351 },
  { x: -19.4862, y: 0.4, z: 13.4782 },
  { x: -18.3895, y: 0.4, z: 14.4835 },
  { x: -17.2431, y: 0.4, z: 15.4040 },
  { x: -16.0225, y: 0.4, z: 16.1742 },
  { x: -14.7192, y: 0.4, z: 16.7246 },
  { x: -13.3517, y: 0.4, z: 17.0001 },
  { x: -11.9616, y: 0.4, z: 16.9735 },
  { x: -10.5973, y: 0.4, z: 16.6514 },
  { x: -9.2906, y: 0.4, z: 16.0772 },
  { x: -8.0411, y: 0.4, z: 15.3308 },
  { x: -6.8163, y: 0.4, z: 14.5209 },
  { x: -5.5694, y: 0.4, z: 13.7677 },
  { x: -4.2663, y: 0.4, z: 13.1811 },
  { x: -2.9043, y: 0.4, z: 12.8428 },
  { x: -1.5134, y: 0.4, z: 12.7975 },
  { x: -0.1392, y: 0.4, z: 13.0518 },
  { x: 1.1791, y: 0.4, z: 13.5763 },
  { x: 2.4273, y: 0.4, z: 14.3105 },
  { x: 3.6213, y: 0.4, z: 15.1720 },
  { x: 4.7994, y: 0.4, z: 16.0674 },
  { x: 6.0062, y: 0.4, z: 16.9009 },
  { x: 7.2751, y: 0.4, z: 17.5818 },
  { x: 8.6147, y: 0.4, z: 18.0352 },
  { x: 10.0072, y: 0.4, z: 18.2166 },
  { x: 11.4198, y: 0.4, z: 18.1227 },
  { x: 12.8230, y: 0.4, z: 17.7919 },
  { x: 14.2031, y: 0.4, z: 17.2898 },
  { x: 15.5608, y: 0.4, z: 16.6848 },
  { x: 16.8996, y: 0.4, z: 16.0236 },
  { x: 18.2147, y: 0.4, z: 15.3193 },
  { x: 19.4889, y: 0.4, z: 14.5561 },
  { x: 20.7012, y: 0.4, z: 13.7090 },
  { x: 21.8402, y: 0.4, z: 12.7663 },
  { x: 22.9132, y: 0.4, z: 11.7401 },
  { x: 23.9393, y: 0.4, z: 10.6575 },
  { x: 24.9325, y: 0.4, z: 9.5412 },
  { x: 25.8854, y: 0.4, z: 8.3963 },
  { x: 26.7617, y: 0.4, z: 7.2091 },
  { x: 27.5041, y: 0.4, z: 5.9587 },
  { x: 28.0570, y: 0.4, z: 4.6323 },
  { x: 28.3955, y: 0.4, z: 3.2351 },
  { x: 28.5395, y: 0.4, z: 1.7865 },
  { x: 28.5419, y: 0.4, z: 0.3098 },
  { x: 28.4574, y: 0.4, z: -1.1771 },
  { x: 28.3139, y: 0.4, z: -2.6614 },
  { x: 28.0995, y: 0.4, z: -4.1291 },
  { x: 27.7734, y: 0.4, z: -5.5615 },
  { x: 27.2944, y: 0.4, z: -6.9384 },
  { x: 26.6496, y: 0.4, z: -8.2476 },
  { x: 25.8607, y: 0.4, z: -9.4890 },
  { x: 24.9636, y: 0.4, z: -10.6653 },
  { x: 23.9789, y: 0.4, z: -11.7631 },
  { x: 22.9020, y: 0.4, z: -12.7422 },
  { x: 21.7193, y: 0.4, z: -13.5413 },
  { x: 20.4317, y: 0.4, z: -14.0987 },
  { x: 19.0665, y: 0.4, z: -14.3711 },
  { x: 17.6678, y: 0.4, z: -14.3471 },
  { x: 16.2764, y: 0.4, z: -14.0556 },
  { x: 14.9101, y: 0.4, z: -13.5691 },
  { x: 13.5594, y: 0.4, z: -12.9983 },
  { x: 12.2001, y: 0.4, z: -12.4722 },
  { x: 10.8154, y: 0.4, z: -12.1095 },
  { x: 9.4124, y: 0.4, z: -11.9938 },
  { x: 8.0200, y: 0.4, z: -12.1612 },
  { x: 6.6709, y: 0.4, z: -12.5988 },
  { x: 5.3807, y: 0.4, z: -13.2522 },
  { x: 4.1376, y: 0.4, z: -14.0380 },
  { x: 2.9078, y: 0.4, z: -14.8573 },
  { x: 1.6511, y: 0.4, z: -15.6074 },
  { x: 0.3402, y: 0.4, z: -16.1929 },
  { x: -1.0261, y: 0.4, z: -16.5378 },
  { x: -2.4207, y: 0.4, z: -16.5966 },
  { x: -3.8025, y: 0.4, z: -16.3615 },
  { x: -5.1369, y: 0.4, z: -15.8637 },
  { x: -6.4131, y: 0.4, z: -15.1684 },
  { x: -7.6492, y: 0.4, z: -14.3646 },
  { x: -8.8823, y: 0.4, z: -13.5533 },
  { x: -10.1510, y: 0.4, z: -12.8362 },
  { x: -11.4772, y: 0.4, z: -12.3047 },
  { x: -12.8557, y: 0.4, z: -12.0262 },
  { x: -14.2583, y: 0.4, z: -12.0318 },
  { x: -15.6514, y: 0.4, z: -12.3061 },
  { x: -17.0169, y: 0.4, z: -12.7852 },
  { x: -18.3620, y: 0.4, z: -13.3610 },
  { x: -19.7095, y: 0.4, z: -13.8985 },
  { x: -21.0741, y: 0.4, z: -14.2624 },
  { x: -22.4416, y: 0.4, z: -14.3468 },
  { x: -23.7666, y: 0.4, z: -14.0964 },
  { x: -24.9931, y: 0.4, z: -13.5128 },
  { x: -26.0833, y: 0.4, z: -12.6454 },
  { x: -27.0327, y: 0.4, z: -11.5699 },
  { x: -27.8566, y: 0.4, z: -10.3607 },
  { x: -28.5618, y: 0.4, z: -9.0690 },
  { x: -29.1323, y: 0.4, z: -7.7181 },
  { x: -29.5451, y: 0.4, z: -6.3164 },
  { x: -29.7982, y: 0.4, z: -4.8721 },
  { x: -29.9169, y: 0.4, z: -3.3993 },
  { x: -29.9301, y: 0.4, z: -1.9157 },
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
  segments: 480,

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
   * Le stade suit l'agrandissement de la piste pour conserver leur alignement.
   */
  modelScale: 7 * CIRCUIT_SCALE,

  /** Route asphaltée + barrières latéraires visibles par-dessus le GLB. */
  showProceduralTrack: true,
};
