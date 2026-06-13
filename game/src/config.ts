/**
 * config.ts — Réglages globaux du jeu (physique, caméra, graphismes).
 * Centralise tous les paramètres "tunables" pour faciliter le réglage du feeling.
 */

export const PHYSICS_CONFIG = {
  /** Pas de temps fixe de la simulation physique (60 Hz). */
  fixedTimeStep: 1 / 60,
  /** Nombre maximum de sous-pas physiques par frame pour éviter la spirale de la mort. */
  maxSubSteps: 5,
  /** Gravité par défaut (peut être surchargée par circuit). */
  gravity: { x: 0, y: -9.81, z: 0 },
} as const;

export const CAMERA_CONFIG = {
  /** Décalage de la chase cam derrière/au-dessus de la voiture (espace local voiture). */
  chaseOffset: { x: 0, y: 3.2, z: -7.5 },
  /** Point visé légèrement au-dessus de la voiture. */
  chaseLookAtHeight: 1.2,
  /** Amortissement du suivi de position (plus petit = plus mou). */
  positionLerp: 6.0,
  /** Amortissement de la rotation. */
  rotationLerp: 5.0,
  /** Décalage de la hood cam (capot). */
  hoodOffset: { x: 0, y: 1.05, z: 0.4 },
  /** FOV de base et FOV max à grande vitesse (sensation de vitesse). */
  baseFov: 70,
  maxFov: 88,
  /** Vitesse (m/s) à laquelle on atteint le FOV max. */
  fovSpeedReference: 60,
} as const;

export const GRAPHICS_CONFIG = {
  shadows: true,
  shadowMapSize: 2048,
  /** Active le post-processing (bloom + motion blur). */
  postProcessing: false,
  bloom: {
    enabled: true,
    strength: 0.45,
    radius: 0.5,
    threshold: 0.85,
  },
  motionBlur: {
    enabled: true,
    /** Intensité (0 = off). */
    strength: 0.35,
  },
  ssao: {
    enabled: false,
  },
  /** Pixel ratio max (limite le coût sur écrans HiDPI). */
  maxPixelRatio: 2,
  /** Distance de brouillard pour cacher le clipping lointain. */
  fogNear: 120,
  fogFar: 600,
} as const;

export const RACE_CONFIG = {
  totalLaps: 3,
  /** Compte à rebours avant le départ (secondes). */
  countdownSeconds: 3,
} as const;

export const AI_CONFIG = {
  /** URL du serveur WebSocket Python pilotant l'AIController. */
  websocketUrl: 'ws://localhost:8765',
  /** Fréquence d'envoi de l'état au serveur IA (Hz). */
  stateSendRate: 30,
  /**
   * Nombre de voitures entraînées simultanément (mode « Entraînement IA »).
   * Chacune ouvre sa propre connexion WebSocket ; le serveur Python agrège
   * leur expérience dans un buffer global partagé. En inférence, une seule.
   */
  trainingCars: 20,
} as const;

/** Clé de stockage localStorage pour les meilleurs temps. */
export const STORAGE_KEYS = {
  bestTimes: 'raceai.bestTimes.v1',
} as const;
