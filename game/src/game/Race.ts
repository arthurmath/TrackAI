/**
 * Race — machine à états d'une course : compte à rebours → course → arrivée.
 * Gère le chronométrage, le comptage de tours (via la progression sur la courbe),
 * le calcul du delta par rapport au meilleur run, et la sauvegarde des records.
 */
import { RACE_CONFIG } from '../config';
import { getBest, saveBest, PROGRESS_BUCKETS, type BestRecord } from './Storage';

export type RaceState = 'countdown' | 'racing' | 'finished';

export interface RaceSnapshot {
  state: RaceState;
  currentLap: number;
  totalLaps: number;
  elapsedMs: number;
  bestTimeMs: number | null;
  lastLapMs: number | null;
  /** Delta (ms) vs meilleur run à la progression courante (null si pas de référence). */
  deltaMs: number | null;
  /** Valeur du compte à rebours : 3,2,1 puis 0 = GO. */
  countdownValue: number;
  lapTimesMs: number[];
}

export class Race {
  private state: RaceState = 'countdown';
  private countdownRemaining: number;
  private elapsedMs = 0;

  private lapsCompleted = 0;
  private readonly totalLaps: number;
  private lapStartMs = 0;
  private lastLapMs: number | null = null;
  private readonly lapTimesMs: number[] = [];

  private lastProgress = 0;
  private passedHalf = false;

  private readonly best: BestRecord | null;
  private readonly runSamples: number[] = new Array(PROGRESS_BUCKETS).fill(NaN);
  private lastBucketFilled = -1;
  private deltaMs: number | null = null;

  private newRecord = false;

  constructor(
    private readonly trackId: string,
    private readonly vehicleId: string,
    totalLaps = RACE_CONFIG.totalLaps,
  ) {
    this.totalLaps = totalLaps;
    this.countdownRemaining = RACE_CONFIG.countdownSeconds;
    this.best = getBest(trackId, vehicleId);
  }

  get isRacing(): boolean {
    return this.state === 'racing';
  }
  get isFinished(): boolean {
    return this.state === 'finished';
  }
  get isNewRecord(): boolean {
    return this.newRecord;
  }

  /**
   * Avance la course d'un pas de temps fixe.
   * @param dt secondes
   * @param progress progression brute [0..1) sur la ligne centrale
   */
  update(dt: number, progress: number): void {
    if (this.state === 'countdown') {
      this.countdownRemaining -= dt;
      if (this.countdownRemaining <= 0) {
        this.state = 'racing';
        this.elapsedMs = 0;
        this.lapStartMs = 0;
        this.lastProgress = progress;
        this.passedHalf = false;
      }
      return;
    }

    if (this.state !== 'racing') return;

    this.elapsedMs += dt * 1000;

    // Validation du demi-tour (anti-coupe) puis détection du passage de ligne.
    if (progress > 0.4 && progress < 0.6) this.passedHalf = true;
    const crossedForward = this.lastProgress > 0.75 && progress < 0.25;
    if (crossedForward && this.passedHalf) {
      this.completeLap();
      this.passedHalf = false;
    }
    this.lastProgress = progress;

    // Progression globale + échantillonnage du run + delta.
    const overall = Math.min(0.999999, (this.lapsCompleted + progress) / this.totalLaps);
    const bucket = Math.floor(overall * PROGRESS_BUCKETS);
    for (let b = this.lastBucketFilled + 1; b <= bucket && b < PROGRESS_BUCKETS; b++) {
      this.runSamples[b] = this.elapsedMs;
    }
    if (bucket > this.lastBucketFilled) this.lastBucketFilled = bucket;

    if (this.best && bucket < PROGRESS_BUCKETS && isFinite(this.best.samples[bucket] ?? NaN)) {
      this.deltaMs = this.elapsedMs - this.best.samples[bucket];
    }
  }

  private completeLap(): void {
    const lapMs = this.elapsedMs - this.lapStartMs;
    this.lapStartMs = this.elapsedMs;
    this.lastLapMs = lapMs;
    this.lapTimesMs.push(lapMs);
    this.lapsCompleted++;
    if (this.lapsCompleted >= this.totalLaps) {
      this.finish();
    }
  }

  private finish(): void {
    this.state = 'finished';
    // Complète les paliers restants avec le temps final.
    for (let b = this.lastBucketFilled + 1; b < PROGRESS_BUCKETS; b++) {
      this.runSamples[b] = this.elapsedMs;
    }
    const record: BestRecord = {
      timeMs: this.elapsedMs,
      samples: this.runSamples.map((v) => (isFinite(v) ? v : this.elapsedMs)),
      date: new Date().toISOString(),
    };
    this.newRecord = saveBest(this.trackId, this.vehicleId, record);
  }

  snapshot(): RaceSnapshot {
    return {
      state: this.state,
      currentLap: Math.min(this.lapsCompleted + 1, this.totalLaps),
      totalLaps: this.totalLaps,
      elapsedMs: this.elapsedMs,
      bestTimeMs: this.best?.timeMs ?? null,
      lastLapMs: this.lastLapMs,
      deltaMs: this.deltaMs,
      countdownValue: Math.max(0, Math.ceil(this.countdownRemaining)),
      lapTimesMs: this.lapTimesMs,
    };
  }
}
