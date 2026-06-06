/**
 * Storage — persistance des meilleurs temps locaux (localStorage).
 * Stocke, par couple circuit/voiture, le meilleur temps total et un profil de
 * temps échantillonné le long de la progression (pour l'affichage du delta).
 */
import { STORAGE_KEYS } from '../config';

export const PROGRESS_BUCKETS = 200;

export interface BestRecord {
  timeMs: number;
  /** Temps (ms) atteint à chaque palier de progression globale [0..PROGRESS_BUCKETS-1]. */
  samples: number[];
  date: string;
}

type BestTable = Record<string, BestRecord>;

function keyFor(trackId: string, vehicleId: string): string {
  return `${trackId}::${vehicleId}`;
}

function loadTable(): BestTable {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.bestTimes);
    return raw ? (JSON.parse(raw) as BestTable) : {};
  } catch {
    return {};
  }
}

function saveTable(table: BestTable): void {
  try {
    localStorage.setItem(STORAGE_KEYS.bestTimes, JSON.stringify(table));
  } catch (err) {
    console.warn('[Storage] Échec de sauvegarde:', err);
  }
}

export function getBest(trackId: string, vehicleId: string): BestRecord | null {
  return loadTable()[keyFor(trackId, vehicleId)] ?? null;
}

/** Enregistre le record s'il améliore le précédent. Renvoie true si nouveau record. */
export function saveBest(trackId: string, vehicleId: string, record: BestRecord): boolean {
  const table = loadTable();
  const k = keyFor(trackId, vehicleId);
  const prev = table[k];
  if (prev && prev.timeMs <= record.timeMs) return false;
  table[k] = record;
  saveTable(table);
  return true;
}

export function getBestTimeMs(trackId: string, vehicleId: string): number | null {
  return getBest(trackId, vehicleId)?.timeMs ?? null;
}
