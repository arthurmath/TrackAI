/**
 * HUD — overlay DOM (découplé de la boucle de jeu) : tour, chrono, meilleur
 * temps, delta coloré et compteur de vitesse en arc SVG animé.
 */
import type { RaceSnapshot } from '../game/Race';
import { formatTime, formatDelta } from '../utils/format';

const SPEEDO_MAX_KMH = 320;
const ARC_RADIUS = 80;
// Arc de 270° centré en bas.
const ARC_START = 135; // degrés
const ARC_SWEEP = 270;

export class HUD {
  private readonly root: HTMLElement;
  private readonly lapEl: HTMLElement;
  private readonly timeEl: HTMLElement;
  private readonly bestEl: HTMLElement;
  private readonly deltaEl: HTMLElement;
  private readonly speedValueEl: HTMLElement;
  private readonly arcFg: SVGPathElement;
  private readonly arcLength: number;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.id = 'hud';
    this.root.classList.add('hidden');

    this.root.innerHTML = `
      <div class="hud-topleft">
        <div class="hud-lap"><span id="hud-lap">LAP 1/3</span></div>
        <div class="hud-time" id="hud-time">00:00.000</div>
        <div class="hud-best">
          <span id="hud-best">BEST --:--.---</span>
          <span class="delta" id="hud-delta"></span>
        </div>
      </div>
      <div class="hud-speed">
        <svg width="220" height="150" viewBox="0 0 220 150">
          <path id="speedo-bg" fill="none" stroke="rgba(255,255,255,0.12)" stroke-width="12" stroke-linecap="round"/>
          <path id="speedo-fg" fill="none" stroke="url(#speedoGrad)" stroke-width="12" stroke-linecap="round"/>
          <defs>
            <linearGradient id="speedoGrad" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stop-color="#2ecc71"/>
              <stop offset="60%" stop-color="#ff8c42"/>
              <stop offset="100%" stop-color="#ff3b30"/>
            </linearGradient>
          </defs>
        </svg>
        <div class="speed-value"><span id="hud-speed">0</span></div>
        <div class="speed-unit">KM/H</div>
      </div>
    `;
    parent.appendChild(this.root);

    this.lapEl = this.root.querySelector('#hud-lap')!;
    this.timeEl = this.root.querySelector('#hud-time')!;
    this.bestEl = this.root.querySelector('#hud-best')!;
    this.deltaEl = this.root.querySelector('#hud-delta')!;
    this.speedValueEl = this.root.querySelector('#hud-speed')!;

    const bg = this.root.querySelector('#speedo-bg') as SVGPathElement;
    this.arcFg = this.root.querySelector('#speedo-fg') as SVGPathElement;
    const d = describeArc(110, 90, ARC_RADIUS, ARC_START, ARC_START + ARC_SWEEP);
    bg.setAttribute('d', d);
    this.arcFg.setAttribute('d', d);
    this.arcLength = this.arcFg.getTotalLength();
    this.arcFg.style.strokeDasharray = `${this.arcLength}`;
    this.arcFg.style.strokeDashoffset = `${this.arcLength}`;
  }

  show(): void {
    this.root.classList.remove('hidden');
  }
  hide(): void {
    this.root.classList.add('hidden');
  }

  update(snap: RaceSnapshot, speedKmh: number): void {
    this.lapEl.textContent = `LAP ${snap.currentLap}/${snap.totalLaps}`;
    this.timeEl.textContent = formatTime(snap.elapsedMs);
    this.bestEl.textContent = `BEST ${snap.bestTimeMs != null ? formatTime(snap.bestTimeMs) : '--:--.---'}`;

    if (snap.deltaMs != null) {
      this.deltaEl.textContent = formatDelta(snap.deltaMs);
      this.deltaEl.classList.toggle('good', snap.deltaMs <= 0);
      this.deltaEl.classList.toggle('bad', snap.deltaMs > 0);
    } else {
      this.deltaEl.textContent = '';
    }

    const kmh = Math.round(speedKmh);
    this.speedValueEl.textContent = `${kmh}`;
    const frac = Math.min(1, speedKmh / SPEEDO_MAX_KMH);
    this.arcFg.style.strokeDashoffset = `${this.arcLength * (1 - frac)}`;
  }

  dispose(): void {
    this.root.remove();
  }
}

function polarToCartesian(cx: number, cy: number, r: number, angleDeg: number): [number, number] {
  const a = ((angleDeg - 90) * Math.PI) / 180;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
}

function describeArc(cx: number, cy: number, r: number, startAngle: number, endAngle: number): string {
  const [sx, sy] = polarToCartesian(cx, cy, r, endAngle);
  const [ex, ey] = polarToCartesian(cx, cy, r, startAngle);
  const largeArc = endAngle - startAngle <= 180 ? '0' : '1';
  return `M ${sx} ${sy} A ${r} ${r} 0 ${largeArc} 0 ${ex} ${ey}`;
}
