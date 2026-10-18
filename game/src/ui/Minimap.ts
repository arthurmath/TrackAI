import { Vector3, type Quaternion } from 'three';
import type { TrackDefinition } from '../assets/tracks/types';
import { createTrackMapLayout, trackMapSvg } from './TrackMap';

/** Static circuit geometry; only the car marker changes each rendered frame. */
export class Minimap {
  private readonly root: HTMLElement;
  private readonly marker: SVGGElement;
  private readonly forward = new Vector3();
  private readonly project: ReturnType<typeof createTrackMapLayout>['project'];

  constructor(parent: HTMLElement, track: TrackDefinition) {
    this.project = createTrackMapLayout(track).project;
    this.root = document.createElement('section');
    this.root.className = 'hud-minimap';
    this.root.setAttribute('aria-label', 'Minimap du circuit et position de la voiture');
    this.root.innerHTML = trackMapSvg(track, 'minimap-track');
    const svg = this.root.querySelector('svg')!;
    svg.setAttribute('aria-label', `Circuit ${track.name} et position de votre voiture`);
    this.marker = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    this.marker.classList.add('minimap-car');
    this.marker.innerHTML = `
      <circle r="10" fill="#ffffff" opacity="0.12" />
      <circle r="6.5" fill="#080f1c" stroke="#ffffff" stroke-width="1.5" />
      <path d="M0 -5L3.5 3L0 1.5L-3.5 3Z" fill="#ffffff" />
    `;
    svg.appendChild(this.marker);
    parent.appendChild(this.root);
  }

  update(position: Vector3, rotation: Quaternion): void {
    const [x, y] = this.project(position);
    this.forward.set(0, 0, 1).applyQuaternion(rotation);
    const angle = Math.atan2(this.forward.z, this.forward.x) * 180 / Math.PI + 90;
    this.marker.setAttribute('transform', `translate(${x.toFixed(2)} ${y.toFixed(2)}) rotate(${angle.toFixed(2)})`);
  }

  dispose(): void {
    this.root.remove();
  }
}
