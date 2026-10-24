import { CatmullRomCurve3, Vector3 } from 'three';
import type { TrackDefinition } from '../assets/tracks/types';

const MAP_WIDTH = 220;
const MAP_HEIGHT = 160;
const MAP_PADDING = 20;

function escapeAttribute(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character]!);
}

/** Keep this curve identical to the playable track, including its arc lengths. */
function trackCurve(track: TrackDefinition): CatmullRomCurve3 {
  const curve = new CatmullRomCurve3(
    track.centerline.map((point) => new Vector3(point.x, point.y, point.z)),
    true,
    'centripetal',
    0.5,
  );
  curve.arcLengthDivisions = Math.max(200, track.segments * 2);
  return curve;
}

export function trackLengthMeters(track: TrackDefinition): number {
  return trackCurve(track).getLength();
}

/** Shared world-to-map projection for both circuit previews and the live HUD. */
export function createTrackMapLayout(track: TrackDefinition) {
  const curve = trackCurve(track);
  const samples = curve.getSpacedPoints(Math.max(256, track.segments));
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;

  for (const point of samples) {
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minZ = Math.min(minZ, point.z);
    maxZ = Math.max(maxZ, point.z);
  }

  const scale = Math.min(
    (MAP_WIDTH - MAP_PADDING * 2) / Math.max(maxX - minX, 1),
    (MAP_HEIGHT - MAP_PADDING * 2) / Math.max(maxZ - minZ, 1),
  );
  const centerX = (minX + maxX) / 2;
  const centerZ = (minZ + maxZ) / 2;
  const project = (point: { x: number; z: number }): [number, number] => [
    MAP_WIDTH / 2 + (point.x - centerX) * scale,
    MAP_HEIGHT / 2 + (point.z - centerZ) * scale,
  ];
  return { curve, samples, scale, project };
}

/** A proportionally fitted plan of the actual centerline, with its real start. */
export function trackMapSvg(track: TrackDefinition, className = 'track-map'): string {
  const { curve, samples, scale, project } = createTrackMapLayout(track);
  const coordinates = (point: Vector3): string => project(point)
    .map((coordinate) => coordinate.toFixed(2))
    .join(' ');
  const path = samples
    .slice(0, -1)
    .map((point, index) => `${index === 0 ? 'M' : 'L'}${coordinates(point)}`)
    .join(' ') + ' Z';

  const startU = track.startU ?? 0;
  const start = curve.getPointAt(startU);
  const startTangent = curve.getTangentAt(startU);
  const startAngle = Math.atan2(startTangent.z, startTangent.x) * 180 / Math.PI;
  // Move the direction cue about 20 SVG units down the actual track.
  const arrowU = (startU + Math.min(0.08, 20 / Math.max(curve.getLength() * scale, 1))) % 1;
  const arrow = curve.getPointAt(arrowU);
  const arrowTangent = curve.getTangentAt(arrowU);
  const arrowAngle = Math.atan2(arrowTangent.z, arrowTangent.x) * 180 / Math.PI;
  const accent = `#${track.accentColor.toString(16).padStart(6, '0')}`;
  const title = escapeAttribute(`Tracé de ${track.name}, ligne de départ et sens de course`);

  return `<svg class="${escapeAttribute(className)}" viewBox="0 0 ${MAP_WIDTH} ${MAP_HEIGHT}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${title}" focusable="false" preserveAspectRatio="xMidYMid meet">
    <title>${title}</title>
    <g fill="none" stroke-linecap="round" stroke-linejoin="round">
      <path d="${path}" stroke="${accent}" stroke-width="16" opacity="0.12" />
      <path d="${path}" stroke="#080f1c" stroke-width="10" />
      <path d="${path}" stroke="${accent}" stroke-width="5" />
      <path d="${path}" stroke="#ffffff" stroke-width="1" opacity="0.25" />
    </g>
    <g transform="translate(${coordinates(start)}) rotate(${startAngle.toFixed(2)})">
      <rect x="-4" y="-8" width="8" height="16" rx="1" fill="#ffffff" stroke="#080f1c" stroke-width="1.5" />
      <path d="M-3 -7h3v3.5h-3z M0 -3.5h3V0H0z M-3 0h3v3.5h-3z M0 3.5h3V7H0z" fill="#080f1c" />
    </g>
    <g transform="translate(${coordinates(arrow)}) rotate(${arrowAngle.toFixed(2)})" fill="none" stroke-linecap="round" stroke-linejoin="round">
      <path d="M-3 -4L2 0L-3 4" stroke="#080f1c" stroke-width="6" />
      <path d="M-3 -4L2 0L-3 4" stroke="#ffffff" stroke-width="2.5" />
    </g>
  </svg>`;
}
