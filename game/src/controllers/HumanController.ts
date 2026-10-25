/**
 * HumanController : pilotage clavier ou manette via l'InputManager.
 * Traduit les entrées en ControlState normalisé.
 */
import type { Controller, ControlState } from './Controller';
import type { InputManager } from '../core/InputManager';

export class HumanController implements Controller {
  readonly kind = 'human' as const;
  private resetRequested = false;
  private readonly unsubscribeReset: () => void;

  constructor(private readonly input: InputManager) {
    this.unsubscribeReset = this.input.on('reset', () => {
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

  dispose(): void {
    this.unsubscribeReset();
  }
}
