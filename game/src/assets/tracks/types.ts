/**
 * types.ts — schéma de description d'un circuit.
 * Un circuit contient TOUTES les informations nécessaires à sa génération :
 * tracé, largeur, barrières, décor, ciel/lumières, gravité et adhérence.
 */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface TrackLighting {
  /** Atmosphère procédurale facultative, réservée aux circuits qui l'activent. */
  skyStyle?: 'sunset';
  skyColor: number;
  groundColor: number;
  fogColor?: number;
  fogNear?: number;
  fogFar?: number;
  ambientColor: number;
  ambientIntensity: number;
  hemiIntensity: number;
  sunColor: number;
  sunIntensity: number;
  /** Direction (depuis l'origine) vers le soleil. */
  sunDirection: Vec3;
}

export interface DecorationInstance {
  /** Clé d'asset décoratif (ex: 'tree'). Le placeholder gère 'tree', 'rock'. */
  type: string;
  position: Vec3;
  rotationY?: number;
  scale?: number;
}

/** Source lumineuse ponctuelle (émission omnidirectionnelle). */
export interface TrackPointLight {
  type: 'point';
  position: Vec3;
  color: number;
  intensity: number;
  /** Portée en mètres (0 = illimitée). */
  distance?: number;
  decay?: number;
}

export interface TrackDefinition {
  id: string;
  name: string;
  /** Aperçu / couleur d'accent pour l'UI. */
  accentColor: number;

  /** Points de contrôle de la ligne centrale (boucle fermée, CatmullRom). */
  centerline: Vec3[];
  /** Largeur de la route (mètres). */
  roadWidth: number;
  /** Hauteur des barrières latérales (mètres). */
  barrierHeight: number;
  /** Subdivisions le long de la courbe (qualité du maillage). */
  segments: number;

  /** Adhérence de la route (friction du collider). */
  roadFriction: number;
  /** Gravité spécifique au circuit. */
  gravity: Vec3;

  /** Taille du sol carré (mètres). */
  groundSize: number;
  /** Altitude de la surface du sol de sécurité (-0.02 m par défaut). */
  groundHeight?: number;
  groundColor: number;

  /** Ensemble de décors et de matériaux procéduraux propre au circuit. */
  scenery?: 'sunset-park' | 'midnight-park';

  /** Asphalte texturé, vibreurs et glissières partagés entre les circuits. */
  roadStyle?: 'raceway';

  lighting: TrackLighting;
  /** Sources lumineuses locales (projecteurs, spots de stade, etc.). */
  lights?: TrackPointLight[];
  decorations: DecorationInstance[];

  /** GLB optionnel : si fourni, remplace la génération procédurale visuelle. */
  modelPath?: string;
  /** Facteur d'échelle appliqué au modèle GLB (1 par défaut). */
  modelScale?: number;
  /** Matériaux des barrières du modèle dont la géométrie remplace les murs procéduraux. */
  modelBarrierMaterials?: string[];
  /**
   * Affiche la route et les barrières procédurales même quand un GLB est chargé.
   * Utile quand le modèle ne fournit que le décor (stade, paysage…) sans piste.
   */
  showProceduralTrack?: boolean;

  /** Position de départ le long de la courbe [0..1]. */
  startU?: number;
  /** Décalage du spawn en mètres avant la ligne de départ, dans le sens inverse de la course. */
  spawnOffset?: number;
}
