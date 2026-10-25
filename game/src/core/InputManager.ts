/**
 * InputManager : capture clavier et manette.
 * Fournit l'état brut des touches ainsi que des événements "appui" (edge) pour
 * les actions ponctuelles (reset, pause, changement de caméra, debug).
 */
import { PowerAGamepad, type PadSnapshot } from './PowerAGamepad';

export type ActionEvent =
  | 'reset'
  | 'pause'
  | 'cycleCamera'
  | 'toggleDebug'
  | 'toggleCenterline';

const STICK_DEADZONE = 0.15;
const STANDARD_BUTTONS = { throttle: 7, brake: 6, handbrake: 0, reset: 1, camera: 3, pause: 9 };
// PowerA NSW Wired controller (20d6:a713), lorsque le navigateur expose le HID brut.
// Ne pas appliquer ce profil si le navigateur fournit déjà le mapping standard.
const POWERA_BUTTONS = { ...STANDARD_BUTTONS, handbrake: 1, reset: 0, camera: 2 };
// En mapping standard, A (Switch) est à droite et Y (Switch) à gauche.
const POWERA_STANDARD_BUTTONS = { ...STANDARD_BUTTONS, reset: 2, camera: 1 };

function isPowerA(pad: PadSnapshot): boolean {
  return /NSW Wired controller|20d6.*a713/i.test(pad.id);
}

function buttonValue(pad: PadSnapshot, index: number): number {
  const button = pad.buttons[index];
  if (!button) return 0;
  return Math.min(1, Math.max(0, button.value || Number(button.pressed)));
}

export class InputManager {
  private readonly powerA = new PowerAGamepad();
  private readonly pressed = new Set<string>();
  private readonly listeners = new Map<ActionEvent, Set<() => void>>();
  private enabled = true;
  private focused = document.hasFocus();
  private gamepadIndex: number | null = null;
  private gamepadId: string | null = null;
  private gamepadThrottle = 0;
  private gamepadBrake = 0;
  private gamepadSteer = 0;
  private gamepadHandbrake = false;
  private gamepadActions = { reset: false, camera: false, pause: false };

  constructor() {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    window.addEventListener('focus', this.onFocus);
  }

  get gamepadStatus(): string {
    if (this.powerA.snapshot || !this.gamepadId) return this.powerA.status;
    return `Manette détectée : ${this.gamepadId}`;
  }

  connectGamepad(): Promise<void> {
    return this.powerA.connect();
  }

  /** Sondage une fois par image, avant la physique, y compris en pause. */
  update(): void {
    this.clearGamepadControls();
    if (!this.focused || document.hidden) {
      this.clearGamepad();
      return;
    }

    let pads: (Gamepad | null)[] = [];
    try {
      if (typeof navigator.getGamepads === 'function') pads = navigator.getGamepads();
    } catch {
      // API indisponible : poursuivre avec la connexion USB directe et le clavier.
    }
    const supported = (pad: Gamepad | null): pad is Gamepad => !!pad && pad.connected
      && (pad.mapping === 'standard' || isPowerA(pad));
    const current = this.gamepadIndex === null ? null : pads[this.gamepadIndex] ?? null;
    const pad = this.powerA.snapshot ?? (supported(current) ? current : pads.find(supported));
    if (!pad) {
      this.clearGamepad();
      return;
    }

    const buttons = pad.mapping === 'standard'
      ? (isPowerA(pad) ? POWERA_STANDARD_BUTTONS : STANDARD_BUTTONS)
      : POWERA_BUTTONS;
    const actions = {
      reset: buttonValue(pad, buttons.reset) > 0.5,
      camera: buttonValue(pad, buttons.camera) > 0.5,
      pause: buttonValue(pad, buttons.pause) > 0.5,
    };
    const previous = this.gamepadIndex === pad.index && this.gamepadId === pad.id
      ? this.gamepadActions : actions;
    this.gamepadIndex = pad.index;
    this.gamepadId = pad.id;
    this.gamepadActions = actions;

    const axis = Math.min(1, Math.max(-1, pad.axes[0] ?? 0));
    this.gamepadSteer = Math.abs(axis) <= STICK_DEADZONE ? 0
      : Math.sign(axis) * (Math.abs(axis) - STICK_DEADZONE) / (1 - STICK_DEADZONE);
    this.gamepadThrottle = buttonValue(pad, buttons.throttle);
    this.gamepadBrake = buttonValue(pad, buttons.brake);
    this.gamepadHandbrake = buttonValue(pad, buttons.handbrake) > 0.5;

    const wasEnabled = this.enabled;
    if (actions.pause && !previous.pause) this.emit('pause');
    if (wasEnabled && this.enabled) {
      if (actions.reset && !previous.reset) this.emit('reset');
      if (actions.camera && !previous.camera) this.emit('cycleCamera');
    }
  }

  /** Active/désactive la prise en compte des touches de conduite (ex: pendant un menu). */
  setEnabled(value: boolean): void {
    this.enabled = value;
    if (!value) this.pressed.clear();
  }

  isDown(code: string): boolean {
    return this.pressed.has(code);
  }

  /** Accélération et frein indépendants pour permettre leur appui simultané. */
  get throttle(): number {
    if (!this.enabled) return 0;
    return Math.max(this.gamepadThrottle, Number(this.isDown('KeyZ') || this.isDown('ArrowUp') || this.isDown('KeyW')));
  }

  get brake(): number {
    if (!this.enabled) return 0;
    return Math.max(this.gamepadBrake, Number(this.isDown('KeyS') || this.isDown('ArrowDown')));
  }

  /** Axe direction (-1 gauche .. +1 droite). */
  get steerAxis(): number {
    if (!this.enabled) return 0;
    let v = 0;
    if (this.isDown('KeyD') || this.isDown('ArrowRight')) v += 1;
    if (this.isDown('KeyQ') || this.isDown('ArrowLeft') || this.isDown('KeyA')) v -= 1;
    return v || this.gamepadSteer;
  }

  get handbrake(): boolean {
    return this.enabled && (this.isDown('Space') || this.gamepadHandbrake);
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
    this.focused = false;
    this.clearGamepad();
  };

  private onFocus = (): void => {
    this.focused = true;
  };

  private clearGamepadControls(): void {
    this.gamepadThrottle = 0;
    this.gamepadBrake = 0;
    this.gamepadSteer = 0;
    this.gamepadHandbrake = false;
  }

  private clearGamepad(): void {
    this.clearGamepadControls();
    this.gamepadIndex = null;
    this.gamepadId = null;
    this.gamepadActions = { reset: false, camera: false, pause: false };
  }

  dispose(): void {
    this.powerA.dispose();
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    window.removeEventListener('focus', this.onFocus);
    this.pressed.clear();
    this.clearGamepad();
    this.listeners.clear();
  }
}
