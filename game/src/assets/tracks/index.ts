/** Registre des circuits disponibles. */
import type { TrackDefinition } from './types';
import { track_1 } from './data/track_1';
import { track_2 } from './data/track_2';
import { track_3 } from './data/track_3';
import { track_4 } from './data/track_4';

export const TRACKS: TrackDefinition[] = [track_1, track_2, track_3, track_4];

export function getTrackById(id: string): TrackDefinition {
  const t = TRACKS.find((x) => x.id === id);
  if (!t) throw new Error(`Circuit inconnu: ${id}`);
  return t;
}

export const DEFAULT_TRACK_ID = 'track_1';
export type { TrackDefinition };
