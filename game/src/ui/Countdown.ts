/** Countdown — affichage plein écran du compte à rebours 3-2-1-GO. */
export class Countdown {
  private readonly el: HTMLElement;
  private lastValue = -1;

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.id = 'countdown';
    this.el.classList.add('hidden');
    parent.appendChild(this.el);
  }

  /** @param value 3,2,1 puis 0 = GO. value < 0 masque. */
  set(value: number): void {
    if (value < 0) {
      this.el.classList.add('hidden');
      this.lastValue = -1;
      return;
    }
    this.el.classList.remove('hidden');
    if (value !== this.lastValue) {
      this.lastValue = value;
      const text = value === 0 ? 'GO!' : `${value}`;
      this.el.innerHTML = `<span class="count-pop" style="color:${value === 0 ? '#2ecc71' : '#fff'}">${text}</span>`;
    }
  }

  hide(): void {
    this.el.classList.add('hidden');
    this.lastValue = -1;
  }
}
