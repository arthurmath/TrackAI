/** Helpers de formatage des temps de course. */

/** Formate un temps en ms vers mm:ss.mmm. */
export function formatTime(ms: number): string {
  if (!isFinite(ms) || ms < 0) ms = 0;
  const totalSec = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSec / 60);
  const seconds = totalSec % 60;
  const millis = Math.floor(ms % 1000);
  return `${pad(minutes, 2)}:${pad(seconds, 2)}.${pad(millis, 3)}`;
}

/** Formate un delta signé en +/-SS.mmm. */
export function formatDelta(ms: number): string {
  const sign = ms >= 0 ? '+' : '-';
  const a = Math.abs(ms);
  const seconds = Math.floor(a / 1000);
  const millis = Math.floor(a % 1000);
  return `${sign}${pad(seconds, 2)}.${pad(millis, 3)}`;
}

function pad(n: number, width: number): string {
  return n.toString().padStart(width, '0');
}
