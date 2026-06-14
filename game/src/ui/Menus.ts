/**
 * Menus — gère tous les écrans plein écran : menu principal, sélection voiture,
 * sélection circuit, chargement, pause et résultats. Chaque écran est rendu
 * dans un conteneur dédié et communique via des callbacks.
 */
import type { VehicleConfig } from '../assets/cars/types';
import type { TrackDefinition } from '../assets/tracks/types';
import type { RaceSnapshot } from '../utils/Recorder';
import { formatTime } from '../utils/helpers';
import { getBestTimeMs } from '../utils/Storage';

import { AI_CONFIG } from '../config';

export interface SavedWeight {
  filename: string;
  score: number;
  timestamp: string;
}

export class Menus {
  private readonly container: HTMLElement;
  private progressFill: HTMLElement | null = null;

  constructor(parent: HTMLElement) {
    this.container = document.createElement('div');
    this.container.id = 'menus';
    parent.appendChild(this.container);
  }

  hide(): void {
    this.container.innerHTML = '';
    this.container.classList.add('hidden');
  }

  private screen(html: string): HTMLElement {
    this.container.classList.remove('hidden');
    this.container.innerHTML = `<div class="screen">${html}</div>`;
    return this.container.querySelector('.screen')!;
  }

  // ---------- Menu principal ----------
  showMain(cb: { onPlay: () => void; onAI: () => void; onEditor: () => void }): void {
    const s = this.screen(`
      <h1>TRACK&nbsp;AI</h1>
      <div class="subtitle">Web 3D Race Game · Three.js + Rapier</div>
      <div class="menu-col">
        <button class="btn primary" id="m-play">Play</button>
        <button class="btn" id="m-ai">IA Mode</button>
        <button class="btn" id="m-editor">Éditeur de circuits <span class="tag">soon</span></button>
      </div>
      <div class="hint">Contrôles : Z/↑ accélérer · S/↓ frein/arrière · Q/D braquer · Espace frein à main · C caméra · R reset · Échap pause · F3 debug</div>
    `);
    s.querySelector('#m-play')!.addEventListener('click', cb.onPlay);
    s.querySelector('#m-ai')!.addEventListener('click', cb.onAI);
    s.querySelector('#m-editor')!.addEventListener('click', cb.onEditor);
  }

  private weightPickerHtml(id: string, weights: SavedWeight[]): string {
    if (!weights.length) {
      return `
        <div class="weight-picker disabled">
          <span class="warm-label">Poids sauvegardés</span>
          <div class="weight-empty">Aucun poids sauvegardé</div>
        </div>`;
    }
    const first = weights[0];
    const firstLabel = `score ${first.score}${first.timestamp ? ` · ${first.timestamp}` : ''}`;
    const options = weights
      .map(
        (w, i) =>
          `<button type="button" class="weight-option${i === 0 ? ' selected' : ''}" data-value="${w.filename}">score ${w.score}${w.timestamp ? ` · ${w.timestamp}` : ''}</button>`,
      )
      .join('');
    return `
      <div class="weight-picker" data-picker="${id}">
        <span class="warm-label">Poids sauvegardés</span>
        <div class="weight-dropdown">
          <button type="button" class="weight-trigger">
            <span class="weight-value">${firstLabel}</span>
            <span class="weight-chevron" aria-hidden="true">▾</span>
          </button>
          <div class="weight-menu hidden">
            ${options}
          </div>
        </div>
        <input type="hidden" class="weight-input" value="${first.filename}" />
      </div>`;
  }

  private setupWeightPicker(panel: HTMLElement, onChange: () => void): HTMLInputElement {
    const input = panel.querySelector<HTMLInputElement>('.weight-input')!;
    const picker = panel.querySelector('.weight-picker');
    if (!picker || picker.classList.contains('disabled')) return input;

    const trigger = picker.querySelector<HTMLButtonElement>('.weight-trigger')!;
    const menu = picker.querySelector<HTMLElement>('.weight-menu')!;
    const valueEl = picker.querySelector<HTMLElement>('.weight-value')!;

    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = !menu.classList.contains('hidden');
      panel.closest('.screen')?.querySelectorAll('.weight-menu').forEach((m) => m.classList.add('hidden'));
      panel.closest('.screen')?.querySelectorAll('.weight-trigger').forEach((t) => t.classList.remove('open'));
      if (!isOpen) {
        menu.classList.remove('hidden');
        trigger.classList.add('open');
      }
    });

    picker.querySelectorAll<HTMLButtonElement>('.weight-option').forEach((opt) => {
      opt.addEventListener('click', (e) => {
        e.stopPropagation();
        input.value = opt.dataset.value!;
        valueEl.textContent = opt.textContent ?? '';
        picker.querySelectorAll('.weight-option').forEach((o) => o.classList.remove('selected'));
        opt.classList.add('selected');
        menu.classList.add('hidden');
        trigger.classList.remove('open');
        onChange();
      });
    });

    return input;
  }

  // ---------- Sous-menu IA (AI Player + cold / warm start) ----------
  showAI(
    weights: SavedWeight[],
    serverRunning: boolean,
    cb: {
      onStartServer: () => Promise<boolean>;
      onPlayStart: (filename: string) => void;
      onColdStart: () => void;
      onWarmStart: (filename: string) => void;
      onBack: () => void;
    },
  ): void {
    const serverBtnHtml = serverRunning
      ? `<div class="server-status" id="ai-server-status">
           <span class="status-dot"></span>Serveur lancé
         </div>`
      : `<button class="btn server-launch" id="ai-server-start">Lancer le serveur python</button>`;

    const s = this.screen(`
      <h2>AI Mode</h2>
      <div class="subtitle">Pilotage par un agent (serveur Python · WebSocket)</div>
      <div class="ai-server-row">
        ${serverBtnHtml}
      </div>
      <div class="ai-mode-row">
        <div class="ai-mode-col">
          <button class="btn primary" id="ai-player">AI Player</button>
          <div class="ai-panel hidden" id="player-panel">
            ${this.weightPickerHtml('player', weights)}
          </div>
        </div>
        <div class="ai-mode-col">
          <button class="btn cold" id="train-cold">Cold Start</button>
        </div>
        <div class="ai-mode-col">
          <button class="btn warm" id="train-warm">Warm Start</button>
          <div class="ai-panel hidden" id="warm-panel">
            ${this.weightPickerHtml('warm', weights)}
          </div>
        </div>
      </div>
      <div class="menu-col ai-nav-row">
        <button class="btn ghost" id="ai-back">Retour</button>
        <button class="btn primary" id="ai-continue" disabled>Continue</button>
      </div>
      <div class="hint">Le serveur gère à la fois l'inférence (AI Player) et l'entraînement (Cold / Warm Start).</div>
    `);

    let running = serverRunning;

    const serverStartBtn = s.querySelector<HTMLButtonElement>('#ai-server-start');
    serverStartBtn?.addEventListener('click', async () => {
      serverStartBtn.disabled = true;
      serverStartBtn.textContent = 'Démarrage…';
      const ok = await cb.onStartServer();
      if (!ok) {
        serverStartBtn.disabled = false;
        serverStartBtn.textContent = 'Lancer le serveur python';
        alert('Impossible de démarrer le serveur. Vérifie que uv est installé (cd ai · uv sync).');
      }
    });

    type SelectedMode = 'play' | 'cold' | 'warm' | null;
    let selectedMode: SelectedMode = null;

    const playerPanel = s.querySelector('#player-panel') as HTMLElement;
    const playerBtn = s.querySelector('#ai-player')!;
    const playerInput = this.setupWeightPicker(playerPanel, () => updateContinue());

    const coldBtn = s.querySelector('#train-cold')!;
    const warmPanel = s.querySelector('#warm-panel') as HTMLElement;
    const warmBtn = s.querySelector('#train-warm')!;
    const warmInput = this.setupWeightPicker(warmPanel, () => updateContinue());

    const continueBtn = s.querySelector<HTMLButtonElement>('#ai-continue')!;

    const closePickers = (): void => {
      s.querySelectorAll('.weight-menu').forEach((m) => m.classList.add('hidden'));
      s.querySelectorAll('.weight-trigger').forEach((t) => t.classList.remove('open'));
    };

    s.addEventListener('click', closePickers);

    const updateContinue = (): void => {
      const canContinue =
        running &&
        (selectedMode === 'cold' ||
          (selectedMode === 'play' && weights.length > 0 && Boolean(playerInput.value)) ||
          (selectedMode === 'warm' && weights.length > 0 && Boolean(warmInput.value)));
      continueBtn.disabled = !canContinue;
    };

    const selectMode = (mode: SelectedMode): void => {
      selectedMode = mode;
      closePickers();
      playerBtn.classList.toggle('active', mode === 'play');
      coldBtn.classList.toggle('active', mode === 'cold');
      warmBtn.classList.toggle('active', mode === 'warm');
      playerPanel.classList.toggle('hidden', mode !== 'play');
      warmPanel.classList.toggle('hidden', mode !== 'warm');
      updateContinue();
    };

    playerBtn.addEventListener('click', () => selectMode(selectedMode === 'play' ? null : 'play'));
    coldBtn.addEventListener('click', () => selectMode(selectedMode === 'cold' ? null : 'cold'));
    warmBtn.addEventListener('click', () => selectMode(selectedMode === 'warm' ? null : 'warm'));

    continueBtn.addEventListener('click', () => {
      if (selectedMode === 'cold') cb.onColdStart();
      else if (selectedMode === 'play' && playerInput.value) cb.onPlayStart(playerInput.value);
      else if (selectedMode === 'warm' && warmInput.value) cb.onWarmStart(warmInput.value);
    });
    s.querySelector('#ai-back')!.addEventListener('click', cb.onBack);
  }

  static async fetchSavedWeights(): Promise<SavedWeight[]> {
    try {
      const res = await fetch(AI_CONFIG.weightsApiUrl);
      if (!res.ok) return [];
      return (await res.json()) as SavedWeight[];
    } catch {
      return [];
    }
  }

  // ---------- Sélection de la voiture ----------
  showVehicleSelect(
    vehicles: VehicleConfig[],
    selectedId: string,
    cb: { onSelect: (id: string) => void; onNext: () => void; onBack: () => void },
  ): void {
    const cards = vehicles
      .map(
        (v) => `
        <div class="card ${v.id === selectedId ? 'selected' : ''}" data-id="${v.id}">
          <div class="swatch" style="background: linear-gradient(135deg, #${v.color
            .toString(16)
            .padStart(6, '0')}, #1a1d26)"></div>
          <div class="name">${v.name}</div>
          <div class="meta">Masse ${v.mass} kg · Vmax ~${Math.round(v.maxSpeed * 3.6)} km/h</div>
        </div>`,
      )
      .join('');

    const s = this.screen(`
      <h2>Choisis ta voiture</h2>
      <div class="card-grid">${cards}</div>
      <div class="menu-col" style="flex-direction:row; gap:14px;">
        <button class="btn ghost" id="v-back">Retour</button>
        <button class="btn primary" id="v-next">Continuer</button>
      </div>
    `);

    s.querySelectorAll<HTMLElement>('.card').forEach((card) => {
      card.addEventListener('click', () => {
        s.querySelectorAll('.card').forEach((c) => c.classList.remove('selected'));
        card.classList.add('selected');
        cb.onSelect(card.dataset.id!);
      });
    });
    s.querySelector('#v-next')!.addEventListener('click', cb.onNext);
    s.querySelector('#v-back')!.addEventListener('click', cb.onBack);
  }

  // ---------- Sélection du circuit ----------
  showTrackSelect(
    tracks: TrackDefinition[],
    vehicleId: string,
    selectedId: string,
    cb: { onSelect: (id: string) => void; onStart: () => void; onBack: () => void },
  ): void {
    const cards = tracks
      .map((t) => {
        const best = getBestTimeMs(t.id, vehicleId);
        return `
        <div class="card ${t.id === selectedId ? 'selected' : ''}" data-id="${t.id}">
          <div class="swatch" style="background: linear-gradient(135deg, #${t.accentColor
            .toString(16)
            .padStart(6, '0')}, #0b0e14)"></div>
          <div class="name">${t.name}</div>
          <div class="meta">Best: ${best != null ? formatTime(best) : '—'}</div>
        </div>`;
      })
      .join('');

    const s = this.screen(`
      <h2>Choisis ton circuit</h2>
      <div class="card-grid">${cards}</div>
      <div class="menu-col" style="flex-direction:row; gap:14px;">
        <button class="btn ghost" id="t-back">Retour</button>
        <button class="btn primary" id="t-start">Démarrer la course</button>
      </div>
    `);

    s.querySelectorAll<HTMLElement>('.card').forEach((card) => {
      card.addEventListener('click', () => {
        s.querySelectorAll('.card').forEach((c) => c.classList.remove('selected'));
        card.classList.add('selected');
        cb.onSelect(card.dataset.id!);
      });
    });
    s.querySelector('#t-start')!.addEventListener('click', cb.onStart);
    s.querySelector('#t-back')!.addEventListener('click', cb.onBack);
  }

  // ---------- Chargement ----------
  showLoading(): void {
    this.screen(`
      <h2>Chargement…</h2>
      <div class="progress-wrap">
        <div class="progress-bar"><div class="progress-fill" id="loading-fill"></div></div>
      </div>
    `);
    this.progressFill = this.container.querySelector('#loading-fill');
  }

  setProgress(frac: number): void {
    if (this.progressFill) this.progressFill.style.width = `${Math.round(frac * 100)}%`;
  }

  // ---------- Pause ----------
  showPause(cb: { onResume: () => void; onRestart: () => void; onMenu: () => void }): void {
    const s = this.screen(`
      <h2>Pause</h2>
      <div class="menu-col">
        <button class="btn primary" id="p-resume">Reprendre</button>
        <button class="btn" id="p-restart">Recommencer</button>
        <button class="btn" id="p-menu">Menu principal</button>
      </div>
    `);
    s.querySelector('#p-resume')!.addEventListener('click', cb.onResume);
    s.querySelector('#p-restart')!.addEventListener('click', cb.onRestart);
    s.querySelector('#p-menu')!.addEventListener('click', cb.onMenu);
  }

  // ---------- Résultats ----------
  showResults(
    snap: RaceSnapshot,
    isRecord: boolean,
    cb: { onRestart: () => void; onMenu: () => void },
  ): void {
    const laps = snap.lapTimesMs
      .map((t, i) => `<tr><td>Tour ${i + 1}</td><td class="val">${formatTime(t)}</td></tr>`)
      .join('');
    const s = this.screen(`
      <h2>Arrivée !</h2>
      ${isRecord ? '<div class="record-badge">★ NOUVEAU RECORD</div>' : ''}
      <div class="hud-time" style="font-size:46px">${formatTime(snap.elapsedMs)}</div>
      <table class="results-table">${laps}
        <tr><td>Meilleur</td><td class="val">${snap.bestTimeMs != null ? formatTime(snap.bestTimeMs) : '—'}</td></tr>
      </table>
      <div class="menu-col" style="flex-direction:row; gap:14px;">
        <button class="btn primary" id="r-restart">Recommencer</button>
        <button class="btn" id="r-menu">Menu principal</button>
      </div>
    `);
    s.querySelector('#r-restart')!.addEventListener('click', cb.onRestart);
    s.querySelector('#r-menu')!.addEventListener('click', cb.onMenu);
  }
}
