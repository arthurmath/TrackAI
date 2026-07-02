/**
 * TrainingDashboard — panneau de métriques d'entraînement EN DIRECT.
 * Pendant l'entraînement, poll l'endpoint HTTP /metrics du serveur Python et
 * affiche l'état courant (entraînements, progression, récompense, débit) plus une
 * courbe qui se met à jour. Découplé de la boucle de jeu (simple setInterval).
 */
import { AI_CONFIG } from '../config';
import { drawTrainingChart, type ScorePoint } from './TrainingGraph';

interface RewardPoint {
  iteration: number;
  avg_reward: number;
  best_reward: number;
}

interface Metrics {
  connections: number;
  trainings: number;
  iterations: number;
  bestProgress: number;
  messagesReceived: number;
  timestep: number;
  updateTimestep: number;
  stopRequested: boolean;
  scores: ScorePoint[];
  rewards: RewardPoint[];
}

const POLL_MS = 1500;

export class TrainingDashboard {
  private readonly root: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly bar: HTMLElement;
  private readonly els: Record<string, HTMLElement>;
  private timer: number | null = null;
  // Pour calculer le débit de réception (observations/s) entre deux polls.
  private prevMessages = 0;
  private prevTime = 0;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'training-dash hidden';
    this.root.innerHTML = `
      <h3>Entraînement · live</h3>
      <div class="td-stats">
        <div class="td-stat"><div class="v" id="td-trainings">0</div><div class="k">Entraînements</div></div>
        <div class="td-stat"><div class="v" id="td-best">0.00</div><div class="k">Meilleur (tours)</div></div>
        <div class="td-stat"><div class="v" id="td-avg">—</div><div class="k">Progrès moy.</div></div>
        <div class="td-stat"><div class="v" id="td-reward">—</div><div class="k">Récomp. moy.</div></div>
        <div class="td-stat"><div class="v" id="td-cars">0</div><div class="k">Voitures</div></div>
        <div class="td-stat"><div class="v" id="td-rate">0</div><div class="k">Récept./s</div></div>
      </div>
      <div class="td-bar"><div class="td-bar-fill" id="td-bar-fill"></div></div>
      <div class="td-bar-label" id="td-bar-label">Prochain entraînement</div>
      <canvas id="td-chart" class="td-chart"></canvas>
    `;
    parent.appendChild(this.root);

    this.canvas = this.root.querySelector('#td-chart')!;
    this.bar = this.root.querySelector('#td-bar-fill')!;
    this.els = {
      trainings: this.root.querySelector('#td-trainings')!,
      best: this.root.querySelector('#td-best')!,
      avg: this.root.querySelector('#td-avg')!,
      reward: this.root.querySelector('#td-reward')!,
      cars: this.root.querySelector('#td-cars')!,
      rate: this.root.querySelector('#td-rate')!,
      barLabel: this.root.querySelector('#td-bar-label')!,
    };
  }

  start(): void {
    this.root.classList.remove('hidden');
    this.prevMessages = 0;
    this.prevTime = performance.now();
    void this.poll();
    this.timer = window.setInterval(() => void this.poll(), POLL_MS);
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.root.classList.add('hidden');
  }

  private async poll(): Promise<void> {
    let m: Metrics;
    try {
      const res = await fetch(AI_CONFIG.metricsApiUrl, { signal: AbortSignal.timeout(2000) });
      if (!res.ok) return;
      m = (await res.json()) as Metrics;
    } catch {
      return; // serveur indisponible : on réessaiera au prochain tick
    }
    this.render(m);
  }

  private render(m: Metrics): void {
    const now = performance.now();
    const dt = (now - this.prevTime) / 1000;
    const rate = this.prevMessages > 0 && dt > 0
      ? Math.max(0, Math.round((m.messagesReceived - this.prevMessages) / dt))
      : 0;
    this.prevMessages = m.messagesReceived;
    this.prevTime = now;

    const lastScore = m.scores.length ? m.scores[m.scores.length - 1] : null;
    const lastReward = m.rewards.length ? m.rewards[m.rewards.length - 1] : null;

    this.els.trainings.textContent = String(m.trainings);
    this.els.best.textContent = m.bestProgress.toFixed(2);
    this.els.avg.textContent = lastScore ? lastScore.avg_progress.toFixed(2) : '—';
    this.els.reward.textContent = lastReward ? lastReward.avg_reward.toFixed(1) : '—';
    this.els.cars.textContent = String(m.connections);
    this.els.rate.textContent = String(rate);

    const frac = m.updateTimestep > 0 ? Math.min(1, m.timestep / m.updateTimestep) : 0;
    this.bar.style.width = `${(frac * 100).toFixed(1)}%`;
    this.els.barLabel.textContent = m.stopRequested
      ? 'Entraînement arrêté'
      : `Prochain entraînement · ${m.timestep}/${m.updateTimestep}`;

    drawTrainingChart(this.canvas, m.scores, true);
  }

  dispose(): void {
    this.stop();
    this.root.remove();
  }
}
