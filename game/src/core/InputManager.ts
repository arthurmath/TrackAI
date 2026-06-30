/**
 * InputManager — capture clavier abstraite.
 * Fournit l'état brut des touches ainsi que des événements "appui" (edge) pour
 * les actions ponctuelles (reset, pause, changement de caméra, debug).
 */

export type ActionEvent =
  | 'reset'
  | 'pause'
  | 'cycleCamera'
  | 'toggleDebug'
  | 'toggleCenterline';

export class InputManager {
  private readonly pressed = new Set<string>();
  private readonly listeners = new Map<ActionEvent, Set<() => void>>();
  private enabled = true;

  constructor() {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
  }

  /** Active/désactive la prise en compte des touches de conduite (ex: pendant un menu). */
  setEnabled(value: boolean): void {
    this.enabled = value;
    if (!value) this.pressed.clear();
  }

  isDown(code: string): boolean {
    return this.pressed.has(code);
  }

  /** Axe accélération (-1 freinage/arrière .. +1 accélération). */
  get throttleAxis(): number {
    let v = 0;
    if (this.isDown('KeyZ') || this.isDown('ArrowUp') || this.isDown('KeyW')) v += 1;
    if (this.isDown('KeyS') || this.isDown('ArrowDown')) v -= 1;
    return v;
  }

  /** Axe direction (-1 gauche .. +1 droite). */
  get steerAxis(): number {
    let v = 0;
    if (this.isDown('KeyD') || this.isDown('ArrowRight')) v += 1;
    if (this.isDown('KeyQ') || this.isDown('ArrowLeft') || this.isDown('KeyA')) v -= 1;
    return v;
  }

  get handbrake(): boolean {
    return this.isDown('Space');
  }

  /** Pan horizontal du centre orbit (-1 gauche .. +1 droite). */
  get orbitPanX(): number {
    let v = 0;
    if (this.isDown('KeyD') || this.isDown('ArrowRight')) v += 1;
    if (this.isDown('KeyQ') || this.isDown('ArrowLeft') || this.isDown('KeyA')) v -= 1;
    return v;
  }

  /** Pan avant/arrière du centre orbit (-1 arrière .. +1 avant). */
  get orbitPanZ(): number {
    let v = 0;
    if (this.isDown('KeyZ') || this.isDown('ArrowUp') || this.isDown('KeyW')) v += 1;
    if (this.isDown('KeyS') || this.isDown('ArrowDown')) v -= 1;
    return v;
  }

  on(event: ActionEvent, cb: () => void): () => void {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(cb);
    return () => this.listeners.get(event)!.delete(cb);
  }

  private emit(event: ActionEvent): void {
    this.listeners.get(event)?.forEach((cb) => cb());
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    // Escape et debug fonctionnent même menus ouverts ; les autres edges nécessitent l'activation.
    if (e.code === 'Escape') {
      this.emit('pause');
      return;
    }
    if (e.repeat) return;
    if (e.code === 'F3') {
      this.emit('toggleDebug');
      return;
    }
    // 'L' bascule la ligne centrale même hors conduite (utile en mode entraînement/orbit).
    if (e.code === 'KeyL') {
      this.emit('toggleCenterline');
      return;
    }
    if (!this.enabled) return;

    this.pressed.add(e.code);
    if (e.code === 'KeyR') this.emit('reset');
    if (e.code === 'KeyC') this.emit('cycleCamera');
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.pressed.delete(e.code);
  };

  private onBlur = (): void => {
    this.pressed.clear();
  };

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    this.listeners.clear();
  }
}
