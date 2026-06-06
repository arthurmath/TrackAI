/** DebugOverlay — petit overlay FPS / debug (toggle avec F3). */
export class DebugOverlay {
  private readonly el: HTMLElement;
  private visible = false;
  private frames = 0;
  private accum = 0;
  private fps = 0;

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.id = 'debug-overlay';
    this.el.classList.add('hidden');
    parent.appendChild(this.el);
  }

  toggle(): void {
    this.visible = !this.visible;
    this.el.classList.toggle('hidden', !this.visible);
  }

  update(frameDt: number, lines: string[]): void {
    this.frames++;
    this.accum += frameDt;
    if (this.accum >= 0.5) {
      this.fps = this.frames / this.accum;
      this.frames = 0;
      this.accum = 0;
    }
    if (!this.visible) return;
    this.el.textContent = [`FPS ${this.fps.toFixed(0)}`, ...lines].join('\n');
  }
}
