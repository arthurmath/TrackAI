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
  skyColor: number;
  groundColor: number;
  fogColor?: number;
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
  groundColor: number;

  lighting: TrackLighting;
  decorations: DecorationInstance[];

  /** GLB optionnel : si fourni, remplace la génération procédurale. */
  modelPath?: string;

  /** Position de départ le long de la courbe [0..1]. */
  startU?: number;
}
