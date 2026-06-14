/**
 * Controller — couche d'entrée abstraite.
 * Le jeu ne connaît que cette interface : un contrôleur produit un `ControlState`
 * normalisé. Cela permet d'échanger le pilotage humain (clavier) et le pilotage IA
 * (réseau de neurones via WebSocket) sans changer la logique du véhicule.
 */

export interface ControlState {
  /** Accélération [0..1]. */
  throttle: number;
  /** Frein / marche arrière [0..1]. */
  brake: number;
  /** Direction [-1 (gauche) .. +1 (droite)]. */
  steer: number;
  /** Frein à main. */
  handbrake: boolean;
  /** Demande de reset (respawn). */
  reset: boolean;
}

/** Snapshot de l'état du véhicule envoyé à l'IA (observation). */
export interface VehicleObservation {
  /** Position monde. */
  position: [number, number, number];
  /** Orientation (quaternion). */
  rotation: [number, number, number, number];
  /** Vitesse linéaire monde. */
  velocity: [number, number, number];
  /** Vitesse signée le long de l'axe avant (m/s). */
  forwardSpeed: number;
  /** Distances de capteurs raycast vers l'avant/les côtés (m). */
  sensors: number[];
  /** Progression sur le circuit [0..1] (position le long de la courbe centrale). */
  trackProgress: number;
  /** True si la voiture est hors-piste / retournée. */
  offTrack: boolean;
}

export interface Controller {
  readonly kind: 'human' | 'ai';
  /** Lu chaque frame par le véhicule. */
  sample(): ControlState;
  /** Optionnel : le véhicule pousse son observation (utile pour l'IA). */
  pushObservation?(obs: VehicleObservation): void;
  /** Demande l'arrêt de l'entraînement côté serveur IA (mode training uniquement). */
  requestStopTraining?(): void;
  dispose?(): void;
}

export const NEUTRAL_CONTROL: ControlState = {
  throttle: 0,
  brake: 0,
  steer: 0,
  handbrake: false,
  reset: false,
};
