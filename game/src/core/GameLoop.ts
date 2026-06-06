/**
 * GameLoop — boucle requestAnimationFrame avec accumulateur à pas fixe.
 * La physique avance à pas fixe (60 Hz) ; le rendu se fait à la fréquence native
 * de l'écran. `alpha` permet d'interpoler le rendu entre deux pas de physique.
 */
import { PHYSICS_CONFIG } from '../config';

export type FixedUpdateFn = (fixedDt: number) => void;
export type RenderFn = (alpha: number, frameDt: number) => void;

export class GameLoop {
  private rafId = 0;
  private running = false;
  private lastTime = 0;
  private accumulator = 0;
  private readonly step = PHYSICS_CONFIG.fixedTimeStep;

  constructor(
    private readonly fixedUpdate: FixedUpdateFn,
    private readonly render: RenderFn,
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now();
    this.accumulator = 0;
    this.rafId = requestAnimationFrame(this.tick);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.rafId);
  }

  private tick = (now: number): void => {
    if (!this.running) return;
    this.rafId = requestAnimationFrame(this.tick);

    let frameDt = (now - this.lastTime) / 1000;
    this.lastTime = now;
    // Clamp pour éviter une avalanche de pas physiques après un freeze (onglet inactif).
    if (frameDt > 0.25) frameDt = 0.25;

    this.accumulator += frameDt;
    let steps = 0;
    while (this.accumulator >= this.step && steps < PHYSICS_CONFIG.maxSubSteps) {
      this.fixedUpdate(this.step);
      this.accumulator -= this.step;
      steps++;
    }
    // Si on a saturé les sous-pas, on vide l'accumulateur pour rester stable.
    if (steps === PHYSICS_CONFIG.maxSubSteps && this.accumulator > this.step) {
      this.accumulator = 0;
    }

    const alpha = this.accumulator / this.step;
    this.render(alpha, frameDt);
  };
}
