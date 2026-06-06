/** Registre des circuits disponibles. */
import type { TrackDefinition } from './types';
import { track_1 } from './track_1';
import { track_2 } from './track_2';

export const TRACKS: TrackDefinition[] = [track_1, track_2];

export function getTrackById(id: string): TrackDefinition {
  const t = TRACKS.find((x) => x.id === id);
  if (!t) throw new Error(`Circuit inconnu: ${id}`);
  return t;
}

export const DEFAULT_TRACK_ID = 'track_1';
export type { TrackDefinition };
