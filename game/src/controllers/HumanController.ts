/**
 * HumanController — pilotage clavier via l'InputManager.
 * Traduit les axes clavier en ControlState normalisé.
 */
import type { Controller, ControlState } from './Controller';
import type { InputManager } from '../core/InputManager';

export class HumanController implements Controller {
  readonly kind = 'human' as const;
  private resetRequested = false;

  constructor(private readonly input: InputManager) {
    this.input.on('reset', () => {
      this.resetRequested = true;
    });
  }

  sample(): ControlState {
    const steer = this.input.steerAxis;
    const reset = this.resetRequested;
    this.resetRequested = false;
    return {
      throttle: this.input.throttle,
      brake: this.input.brake,
      steer,
      handbrake: this.input.handbrake,
      reset,
    };
  }
}
