/**
 * HUD — overlay DOM (découplé de la boucle de jeu) : tour, chrono, meilleur
 * temps, delta coloré et compteur de vitesse en arc SVG animé.
 */
import type { RaceSnapshot } from '../utils/Recorder';
import { formatTime, formatDelta } from '../utils/helpers';

const SPEEDO_MAX_KMH = 320;
const ARC_RADIUS = 80;
const ARC_CENTER_X = 110;
const ARC_CENTER_Y = 108;
const SVG_WIDTH = 220;
const SVG_HEIGHT = 210;
const SVG_VIEWBOX_Y = -12;
// Arc 270° : symétrie miroir (0 en bas-gauche, sens horaire) puis rotation +90°.
const ARC_ZERO_ANGLE = 315; // position 0 km/h (haut-gauche après rotation)
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
  private trainingBar: HTMLElement | null = null;

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
        <div class="speedo-wrap">
          <svg width="${SVG_WIDTH}" height="${SVG_HEIGHT}" viewBox="0 ${SVG_VIEWBOX_Y} ${SVG_WIDTH} ${SVG_HEIGHT}">
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
          <div class="speedo-readout">
            <div class="speed-value"><span id="hud-speed">0</span></div>
            <div class="speed-unit">KM/H</div>
          </div>
        </div>
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
    const arcEnd = ARC_ZERO_ANGLE - ARC_SWEEP; // 45° — fin de l'arc en sens horaire
    const d = describeArc(ARC_CENTER_X, ARC_CENTER_Y, ARC_RADIUS, arcEnd, ARC_ZERO_ANGLE, true);
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
    this.hideTrainingControls();
  }

  showTrainingControls(onStop: () => void): void {
    this.hideTrainingControls();
    this.trainingBar = document.createElement('div');
    this.trainingBar.className = 'hud-training';
    this.trainingBar.innerHTML =
      '<button class="btn" id="hud-stop-training">Stop training</button>';
    this.trainingBar.querySelector('#hud-stop-training')!.addEventListener('click', onStop);
    this.root.appendChild(this.trainingBar);
  }

  hideTrainingControls(): void {
    this.trainingBar?.remove();
    this.trainingBar = null;
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

function describeArc(
  cx: number,
  cy: number,
  r: number,
  startAngle: number,
  endAngle: number,
  clockwise = false,
): string {
  const [sx, sy] = polarToCartesian(cx, cy, r, endAngle);
  const [ex, ey] = polarToCartesian(cx, cy, r, startAngle);
  const sweep = clockwise ? 1 : 0;
  const ccwSpan = ((endAngle - startAngle) % 360 + 360) % 360;
  const cwSpan = ((startAngle - endAngle) % 360 + 360) % 360;
  const largeArc = clockwise ? (cwSpan <= 180 ? '1' : '0') : ccwSpan <= 180 ? '0' : '1';
  return `M ${sx} ${sy} A ${r} ${r} 0 ${largeArc} ${sweep} ${ex} ${ey}`;
}
