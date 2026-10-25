/**
 * Menus — gère tous les écrans plein écran : menu principal, sélection voiture,
 * sélection circuit, chargement, pause et résultats. Chaque écran est rendu
 * dans un conteneur dédié et communique via des callbacks.
 */
import type { VehicleConfig } from '../assets/cars/types';
import { CARS } from '../assets/cars';
import { TRACKS } from '../assets/tracks';
import { getCarPreview, getTrackPreview } from './AssetPreviews';
import { trackMapSvg, trackLengthMeters } from './TrackMap';
import type { TrackDefinition } from '../assets/tracks/types';
import type { RaceSnapshot } from '../utils/Recorder';
import { formatTime } from '../utils/helpers';
import { getBestTimeMs } from '../utils/Storage';

import { AI_CONFIG } from '../config';
import { attachTrainingChart, type ScorePoint } from './TrainingGraph';

export interface SavedWeight {
  filename: string;
  score: number;
  timestamp: string;
}

const arrow = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 12h15M13 5l7 7-7 7" stroke="currentColor" stroke-width="1.8"/></svg>';
const flag = '<svg viewBox="0 0 32 32" fill="none" aria-hidden="true"><path d="M6 28V5h20v15H6" stroke="currentColor" stroke-width="2"/><path d="M7 6h6v6H7zm12 0h6v6h-6zm-6 6h6v7h-6z" fill="currentColor"/></svg>';
const escapeHtml = (value: string): string => value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const hex = (color: number): string => `#${color.toString(16).padStart(6, '0')}`;

export class Menus {
  private readonly container: HTMLElement;
  private progressFill: HTMLElement | null = null;
  private screenVersion = 0;

  constructor(parent: HTMLElement) {
    this.container = document.createElement('div');
    this.container.id = 'menus';
    parent.appendChild(this.container);
  }

  hide(): void {
    this.screenVersion++;
    this.container.innerHTML = '';
    this.container.classList.add('hidden');
  }

  private screen(html: string, layout = 'utility', section = 'Paddock', step = 0): HTMLElement {
    this.screenVersion++;
    this.progressFill = null;
    this.container.classList.remove('hidden');
    this.container.innerHTML = `
      <div class="screen ${layout}-screen">
        <header class="menu-header">
          <div class="brand" aria-label="Track AI"><span class="brand-mark" aria-hidden="true"><i></i><i></i><i></i></span>TRACK<span>AI</span><span class="brand-divider"></span><small>RACING LAB</small></div>
          ${step ? `<ol class="setup-steps" aria-label="Préparation de la course">
            <li class="${step === 1 ? 'current' : 'complete'}" ${step === 1 ? 'aria-current="step"' : ''}><b>01</b> Garage</li>
            <li class="${step === 2 ? 'current' : ''}" ${step === 2 ? 'aria-current="step"' : ''}><b>02</b> Circuit</li>
            <li><b>03</b> Départ</li>
          </ol>` : `<span class="header-section">${section}</span>`}
          <span class="header-status"><i></i> PRÊT À ROULER</span>
        </header>
        <main class="menu-content">${html}</main>
        <footer class="menu-footer"><span>DRIVE. LEARN. REPEAT.</span><span>TRACK AI <b>/</b> LE CHRONO N'ATTEND QUE VOUS</span><span class="footer-stripes" aria-hidden="true">/////</span></footer>
      </div>`;
    const screen = this.container.querySelector<HTMLElement>('.screen')!;
    const heading = screen.querySelector<HTMLElement>('h1, h2');
    heading?.setAttribute('tabindex', '-1');
    heading?.focus({ preventScroll: true });
    return screen;
  }

  private previewMarkup(label: string): string {
    return `<img class="asset-preview" alt="${escapeHtml(label)}" hidden /><span class="preview-placeholder" role="status"><i></i>Chargement de l’aperçu</span>`;
  }

  private setPreview(frame: HTMLElement, request: Promise<string>): void {
    const image = frame.querySelector<HTMLImageElement>('.asset-preview')!;
    const placeholder = frame.querySelector<HTMLElement>('.preview-placeholder')!;
    // A newer selection can reuse this frame before a previous render finishes.
    const token = String(Number(frame.dataset.previewVersion ?? 0) + 1);
    frame.dataset.previewVersion = token;
    image.hidden = true;
    placeholder.hidden = false;
    placeholder.innerHTML = '<i></i>Chargement de l’aperçu';
    frame.classList.remove('preview-ready');
    request.then((url) => {
      if (!frame.isConnected || frame.dataset.previewVersion !== token) return;
      image.src = url;
      image.hidden = false;
      placeholder.hidden = true;
      frame.classList.add('preview-ready');
    }).catch(() => {
      if (frame.isConnected && frame.dataset.previewVersion === token) {
        placeholder.textContent = 'Aperçu 3D indisponible';
      }
    });
  }

  // ---------- Menu principal ----------
  showMain(cb: { onPlay: () => void; onAI: () => void; onEditor: () => void; onConnectGamepad: () => Promise<void> }): void {
    const featured = CARS.find((car) => car.modelPath) ?? CARS[0];
    const s = this.screen(`
      <section class="home-hero">
        <div class="hero-copy">
          <div class="eyebrow"><span></span> VOTRE PROCHAINE TRAJECTOIRE</div>
          <h1>LA PISTE<br>EST <em>À VOUS.</em></h1>
          <p>Au volant ou aux commandes de l’IA.<br>Trouvez la trajectoire. Repoussez vos limites.</p>
          <button class="btn primary hero-cta" id="m-play">PRENDRE LE DÉPART ${arrow}</button>
          <div class="hero-inventory"><span><b>${String(CARS.length).padStart(2, '0')}</b> VOITURES</span><span><b>${String(TRACKS.length).padStart(2, '0')}</b> CIRCUITS</span><span><b>∞</b> TRAJECTOIRES</span></div>
        </div>
        <div class="hero-visual" aria-label="${escapeHtml(featured.name)}">
          <span class="hero-orbit orbit-one" aria-hidden="true"></span><span class="hero-orbit orbit-two" aria-hidden="true"></span>
          <span class="hero-word" aria-hidden="true">FULL<br>THROTTLE</span>
          <div class="hero-car" id="home-preview">${this.previewMarkup(featured.name)}</div>
          <span class="hero-sticker">BUILT<br>TO RACE <span>↗</span></span>
          <div class="hero-caption"><span class="tiny-cross" aria-hidden="true">+</span><span>${escapeHtml(featured.name)}<small>LE GOÛT DE LA VITESSE</small></span><span class="hero-caption-line"></span><span>01 / ${String(CARS.length).padStart(2, '0')}</span></div>
        </div>
      </section>
      <section class="mode-grid" aria-label="Modes de jeu">
        <button class="mode-card race-mode" id="m-race"><span class="mode-icon">${flag}</span><span class="mode-copy"><small>01 / À VOUS DE JOUER</small><strong>Course libre</strong><span>Votre voiture. Votre circuit. Votre record.</span></span><span class="mode-arrow">${arrow}</span></button>
        <button class="mode-card ai-mode" id="m-ai"><span class="mode-icon"><svg viewBox="0 0 32 32" fill="none" aria-hidden="true"><path d="m7 7 18 9-18 9V7Zm0 0 18 18M7 25 25 7" stroke="currentColor" stroke-width="1.5"/><circle cx="7" cy="7" r="3" fill="currentColor"/><circle cx="25" cy="7" r="3" fill="currentColor"/><circle cx="25" cy="25" r="3" fill="currentColor"/><circle cx="7" cy="25" r="3" fill="currentColor"/></svg></span><span class="mode-copy"><small>02 / L’INTELLIGENCE EN PISTE</small><strong>AI Lab</strong><span>Entraînez un agent. Observez ses progrès.</span></span><span class="mode-arrow">${arrow}</span></button>
        <button class="mode-card editor-mode" id="m-editor" disabled><span class="mode-icon"><svg viewBox="0 0 32 32" fill="none" aria-hidden="true"><path d="m16 4 12 7-12 7L4 11 16 4ZM4 17l12 7 12-7M4 23l12 7 12-7" stroke="currentColor" stroke-width="1.6"/></svg></span><span class="mode-copy"><small>03 / IMAGINEZ LA SUITE</small><strong>Éditeur de circuits</strong><span>De nouvelles lignes à inventer.</span></span><span class="soon-badge">BIENTÔT</span></button>
      </section>
      <div class="gamepad-connection">
        <button class="btn" id="m-connect-gamepad" type="button">Connecter la manette USB PowerA</button>
        <span id="m-gamepad-status" role="status" aria-live="polite">PowerA USB : cliquez sur « Connecter la manette ».</span>
      </div>
      <details class="controls-guide"><summary><span class="keyboard-icon" aria-hidden="true">⌨</span> LES COMMANDES <span>+</span></summary><div class="control-keys"><span><kbd>Z / ↑</kbd> Accélérer</span><span><kbd>S / ↓</kbd> Freiner et reculer</span><span><kbd>Q D / ← →</kbd> Tourner</span><span><kbd>Espace</kbd> Frein à main</span><span><kbd>C</kbd> Caméra</span><span><kbd>R</kbd> Replacer</span><span><kbd>Échap</kbd> Pause</span></div></details>
      <details class="controls-guide"><summary><span aria-hidden="true">🎮</span> MANETTE <span>+</span></summary><div class="control-keys"><span><kbd>Stick gauche</kbd> Tourner</span><span><kbd>ZR / RT</kbd> Accélérer</span><span><kbd>ZL / LT</kbd> Freiner et reculer</span><span><kbd>B (Switch) / A (Xbox)</kbd> Frein à main</span><span><kbd>Y (Switch) / B (Xbox)</kbd> Replacer</span><span><kbd>A (Switch) / Y (Xbox)</kbd> Caméra</span><span><kbd>+ / Start</kbd> Pause et reprendre</span></div><p class="hint"></p></details>
    `, 'home', 'Accueil');
    s.querySelector('#m-play')!.addEventListener('click', cb.onPlay);
    s.querySelector('#m-race')!.addEventListener('click', cb.onPlay);
    s.querySelector('#m-ai')!.addEventListener('click', cb.onAI);
    const connectButton = s.querySelector<HTMLButtonElement>('#m-connect-gamepad')!;
    connectButton.addEventListener('click', async () => {
      connectButton.disabled = true;
      try { await cb.onConnectGamepad(); }
      finally { connectButton.disabled = false; }
    });
    this.setPreview(s.querySelector('#home-preview')!, getCarPreview(featured));
  }

  updateGamepadStatus(message: string): void {
    const status = this.container.querySelector('#m-gamepad-status');
    if (status && status.textContent !== message) status.textContent = message;
  }

  private optionPickerHtml(
    id: string,
    label: string,
    items: { value: string; label: string }[],
    emptyMessage = 'Aucune option',
  ): string {
    if (!items.length) {
      return `
        <div class="weight-picker disabled">
          <span class="warm-label">${label}</span>
          <div class="weight-empty">${emptyMessage}</div>
        </div>`;
    }
    const first = items[0];
    const options = items
      .map(
        (item, i) =>
          `<button type="button" class="weight-option${i === 0 ? ' selected' : ''}" data-value="${escapeHtml(item.value)}">${escapeHtml(item.label)}</button>`,
      )
      .join('');
    return `
      <div class="weight-picker" data-picker="${id}">
        <span class="warm-label">${label}</span>
        <div class="weight-dropdown">
          <button type="button" class="weight-trigger">
            <span class="weight-value">${escapeHtml(first.label)}</span>
            <span class="weight-chevron" aria-hidden="true">▾</span>
          </button>
          <div class="weight-menu hidden">
            ${options}
          </div>
        </div>
        <input type="hidden" class="weight-input" value="${escapeHtml(first.value)}" />
      </div>`;
  }

  private weightPickerHtml(id: string, weights: SavedWeight[]): string {
    return this.optionPickerHtml(
      id,
      'Poids sauvegardés',
      weights.map((w) => ({
        value: w.filename,
        label: `score ${w.score}${w.timestamp ? ` · ${w.timestamp}` : ''}`,
      })),
      'Aucun poids sauvegardé',
    );
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
      onGraphs: () => void;
      onBack: () => void;
    },
  ): void {
    const serverBtnHtml = serverRunning
      ? `<div class="server-status" id="ai-server-status">
           <span class="status-dot"></span>Serveur lancé
         </div>`
      : `<button class="btn server-launch" id="ai-server-start">Lancer le serveur python</button>`;

    const s = this.screen(`
      <div class="section-heading"><div><div class="eyebrow">L’INTELLIGENCE EN PISTE</div><h2>AI <em>LAB.</em></h2><p>Faites de chaque tour une leçon de pilotage.</p></div><span class="section-index">/ LAB</span></div>
      <div class="lab-status"><div><span class="status-indicator ${serverRunning ? 'online' : ''}"></span><strong>${serverRunning ? 'Votre équipe est en ligne' : 'Connectez votre équipe'}</strong><span>Le serveur IA pilote les agents et leur entraînement.</span></div>${serverBtnHtml}</div>
      <div class="ai-mode-row">
        <div class="ai-mode-col">
          <button class="btn lab-choice primary" id="ai-player" aria-pressed="false"><span class="lab-number">01</span><small>INFERENCE</small><strong>Agent pilote</strong><span>Regardez votre agent entraîné piloter.</span>${arrow}</button>
          <div class="ai-panel hidden" id="player-panel">${this.weightPickerHtml('player', weights)}</div>
        </div>
        <div class="ai-mode-col">
          <button class="btn lab-choice cold" id="train-cold" aria-pressed="false"><span class="lab-number">02</span><small>COLD START</small><strong>Partir de zéro</strong><span>Commencer l'entraînement d'un nouveau réseau de neurones.</span>${arrow}</button>
        </div>
        <div class="ai-mode-col">
          <button class="btn lab-choice warm" id="train-warm" aria-pressed="false"><span class="lab-number">03</span><small>WARM START</small><strong>Reprendre l’entraînement</strong><span>Reprendre l'entrainement à partir de poids sauvegardés.</span>${arrow}</button>
          <div class="ai-panel hidden" id="warm-panel">${this.weightPickerHtml('warm', weights)}</div>
        </div>
        <div class="ai-mode-col">
          <button class="btn lab-choice graphs" id="ai-graphs"><span class="lab-number">04</span><small>ANALYSER</small><strong>Performances</strong><span>Explorez les courbes de progression.</span>${arrow}</button>
        </div>
      </div>
      <div class="selection-footer"><button class="btn ghost" id="ai-back">← Retour à l’accueil</button><span class="selection-help">Choisissez le prochain défi de votre agent.</span><button class="btn primary" id="ai-continue" disabled>CONTINUER ${arrow}</button></div>
    `, 'lab', 'AI Lab');

    const running = serverRunning;

    const serverStartBtn = s.querySelector<HTMLButtonElement>('#ai-server-start');
    serverStartBtn?.addEventListener('click', async () => {
      serverStartBtn.disabled = true;
      serverStartBtn.textContent = 'Démarrage…';
      try {
        if (!await cb.onStartServer()) throw new Error('Le serveur Python ne répond pas.');
      } catch (err) {
        serverStartBtn.disabled = false;
        serverStartBtn.textContent = 'Lancer le serveur python';
        alert(`Impossible de démarrer le serveur.\n${err instanceof Error ? err.message : String(err)}`);
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
      playerBtn.setAttribute('aria-pressed', String(mode === 'play'));
      coldBtn.setAttribute('aria-pressed', String(mode === 'cold'));
      warmBtn.setAttribute('aria-pressed', String(mode === 'warm'));
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
    s.querySelector('#ai-graphs')!.addEventListener('click', cb.onGraphs);
    s.querySelector('#ai-back')!.addEventListener('click', cb.onBack);
  }

  static async fetchSeriesFiles(): Promise<string[]> {
    try {
      const res = await fetch(AI_CONFIG.seriesListApiUrl);
      if (!res.ok) return [];
      return (await res.json()) as string[];
    } catch {
      return [];
    }
  }

  static async fetchSeriesData(filename: string): Promise<ScorePoint[]> {
    try {
      const res = await fetch(`${AI_CONFIG.seriesDataApiUrl}${encodeURIComponent(filename)}`);
      if (!res.ok) return [];
      const data = (await res.json()) as { scores_history?: ScorePoint[] };
      return data.scores_history ?? [];
    } catch {
      return [];
    }
  }

  showAIGraphs(cb: { onBack: () => void }): void {
    void this.renderAIGraphs(cb);
  }

  private async renderAIGraphs(cb: { onBack: () => void }): Promise<void> {
    const version = this.screenVersion;
    const files = await Menus.fetchSeriesFiles();
    if (version !== this.screenVersion) return;
    const fileItems = files.map((f) => ({ value: f, label: f }));

    const s = this.screen(`
      <div class="eyebrow">AI LAB / TÉLÉMÉTRIE</div><h2>CHAQUE TOUR <em>COMPTE.</em></h2>
      <div class="subtitle">Évolution des performances de vos agents</div>
      <div class="graphs-toolbar">
        <div class="graphs-file-picker" id="graphs-file-picker">
          ${this.optionPickerHtml('graphs-file', 'Fichier', fileItems, 'Aucun fichier')}
        </div>
        <label class="graphs-toggle">
          <input type="checkbox" id="graphs-show-best" checked />
          <span>Afficher la meilleure progression</span>
        </label>
      </div>
      <div class="graphs-canvas-wrap">
        <canvas id="training-chart" class="training-chart"></canvas>
      </div>
      <div class="menu-col graphs-nav-row">
        <button class="btn ghost" id="graphs-back">Retour</button>
      </div>
    `);

    const pickerRoot = s.querySelector('#graphs-file-picker') as HTMLElement;
    const showBestInput = s.querySelector<HTMLInputElement>('#graphs-show-best')!;
    const canvas = s.querySelector<HTMLCanvasElement>('#training-chart')!;

    let points: ScorePoint[] = [];
    let loadVersion = 0;
    let closed = false;

    const chart = attachTrainingChart(
      canvas,
      () => points,
      () => showBestInput.checked,
    );

    const loadFile = async (filename: string): Promise<void> => {
      const request = ++loadVersion;
      const loaded = filename ? await Menus.fetchSeriesData(filename) : [];
      if (closed || request !== loadVersion || !canvas.isConnected) return;
      points = loaded;
      chart.redraw();
    };

    const closePickers = (): void => {
      s.querySelectorAll('.weight-menu').forEach((m) => m.classList.add('hidden'));
      s.querySelectorAll('.weight-trigger').forEach((t) => t.classList.remove('open'));
    };

    s.addEventListener('click', closePickers);

    const fileInput = this.setupWeightPicker(pickerRoot, () => void loadFile(fileInput.value));

    showBestInput.addEventListener('change', chart.redraw);
    s.querySelector('#graphs-back')!.addEventListener('click', () => {
      closed = true;
      chart.destroy();
      cb.onBack();
    });
    if (files.length) void loadFile(files[0]);
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
    const current = vehicles.find((v) => v.id === selectedId) ?? vehicles[0];
    const cards = vehicles.map((v, i) => `
      <button type="button" class="vehicle-card ${v.id === current.id ? 'selected' : ''}" data-id="${escapeHtml(v.id)}" aria-pressed="${v.id === current.id}" style="--vehicle-accent:${hex(v.color)}">
        <span class="card-number">${String(i + 1).padStart(2, '0')}</span><span class="selection-check" aria-hidden="true">✓</span>
        <span class="vehicle-thumb" data-car-preview="${escapeHtml(v.id)}">${this.previewMarkup(v.name)}</span>
        <span class="vehicle-card-label"><span><small>${v.modelPath ? 'MONOPLACE' : 'ENTRAÎNEMENT'}</small><strong>${escapeHtml(v.name)}</strong></span><span>${Math.round(v.maxSpeed * 3.6)}<small>KM/H</small></span></span>
      </button>`).join('');
    const s = this.screen(`
      <div class="section-heading"><div><div class="eyebrow">01 / LE GARAGE</div><h2>VOTRE <em>MACHINE.</em></h2><p>Choisissez celle qui signera votre prochain record.</p></div><span class="section-count"><b>${String(vehicles.length).padStart(2, '0')}</b> VOITURES DISPONIBLES</span></div>
      <div class="garage-layout">
        <section class="vehicle-showcase"><div class="showcase-top"><span>PRÊTE POUR LA PISTE</span><span>VUE DU VÉHICULE</span></div><div class="showcase-watermark" aria-hidden="true">RACE</div><div class="showcase-image" id="vehicle-preview">${this.previewMarkup(current.name)}</div><div class="showcase-caption"><span class="tiny-cross">+</span><span id="vehicle-kind"></span><span>TRACK AI / GARAGE</span></div></section>
        <aside class="vehicle-options" aria-label="Voitures disponibles">${cards}</aside>
      </div>
      <div class="vehicle-specs" aria-live="polite"><div class="selected-vehicle"><small>VOTRE SÉLECTION</small><h3 id="vehicle-name"></h3></div><div class="spec"><span>VITESSE MAX. ESTIMÉE</span><strong id="vehicle-speed"></strong></div><div class="spec"><span>MASSE</span><strong id="vehicle-mass"></strong></div><div class="spec"><span>MOTORISATION</span><strong id="vehicle-drive"></strong></div></div>
      <div class="selection-footer"><button class="btn ghost" id="v-back">← Retour</button><span class="selection-help">Votre ligne de départ se rapproche.</span><button class="btn primary" id="v-next">CHOISIR LE CIRCUIT ${arrow}</button></div>
    `, 'garage', 'Garage', 1);
    const update = (vehicle: VehicleConfig): void => {
      s.querySelector('#vehicle-name')!.textContent = vehicle.name;
      s.querySelector('#vehicle-speed')!.innerHTML = `${Math.round(vehicle.maxSpeed * 3.6)} <small>km/h</small>`;
      s.querySelector('#vehicle-mass')!.innerHTML = `${vehicle.mass.toLocaleString('fr-FR')} <small>kg</small>`;
      const powered = vehicle.wheelConnections.filter((wheel) => wheel.powered);
      s.querySelector('#vehicle-drive')!.textContent = powered.length === 4 ? '4 roues motrices' : powered.every((wheel) => wheel.z < 0) ? 'Propulsion' : 'Traction';
      s.querySelector('#vehicle-kind')!.textContent = vehicle.modelPath ? 'MONOPLACE / COMPÉTITION' : 'TRAINING / ESSENTIEL';
      const frame = s.querySelector<HTMLElement>('#vehicle-preview')!;
      frame.querySelector('img')!.alt = vehicle.name;
      this.setPreview(frame, getCarPreview(vehicle));
    };
    update(current);
    for (const vehicle of vehicles) {
      const frame = [...s.querySelectorAll<HTMLElement>('[data-car-preview]')].find((el) => el.dataset.carPreview === vehicle.id)!;
      this.setPreview(frame, getCarPreview(vehicle));
    }
    s.querySelectorAll<HTMLButtonElement>('.vehicle-card').forEach((card) => {
      card.addEventListener('click', () => {
        s.querySelectorAll('.vehicle-card').forEach((other) => {
          other.classList.toggle('selected', other === card);
          other.setAttribute('aria-pressed', String(other === card));
        });
        const vehicle = vehicles.find((v) => v.id === card.dataset.id)!;
        update(vehicle);
        cb.onSelect(vehicle.id);
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
    const current = tracks.find((t) => t.id === selectedId) ?? tracks[0];
    const vehicle = CARS.find((v) => v.id === vehicleId);
    const cards = tracks.map((t, i) => {
      const best = getBestTimeMs(t.id, vehicleId);
      return `<button type="button" class="track-card ${t.id === current.id ? 'selected' : ''}" data-id="${escapeHtml(t.id)}" aria-pressed="${t.id === current.id}" style="--track-accent:${hex(t.accentColor)}">
        <span class="track-scene" data-track-preview="${escapeHtml(t.id)}">${this.previewMarkup(`Vue d’ensemble : ${t.name}`)}<span class="track-scene-shade"></span><span class="track-number">CIRCUIT / ${String(i + 1).padStart(2, '0')}</span><span class="selection-check" aria-hidden="true">✓</span><span class="track-map">${trackMapSvg(t, 'track-route')}</span></span>
        <span class="track-card-info"><span class="track-category">${t.scenery === 'alpine-forest' ? 'FORÊT / MONTAGNE / JOUR' : t.scenery === 'sunset-park' ? 'GOLDEN HOUR' : t.modelPath ? 'GRAND PRIX' : 'NIGHT SESSION'}</span><strong>${escapeHtml(t.name)}</strong><span class="track-data"><span>${Math.round(trackLengthMeters(t))} <small>MÈTRES</small></span><span>${t.roadWidth.toLocaleString('fr-FR')} <small>M DE LARGE</small></span></span><span class="track-record"><span>RECORD PERSONNEL</span><b>${best != null ? formatTime(best) : 'À établir'}</b></span></span>
      </button>`;
    }).join('');
    const s = this.screen(`
      <div class="section-heading"><div><div class="eyebrow">02 / LES CIRCUITS</div><h2>TROUVEZ VOTRE <em>TERRAIN.</em></h2><p>Des ambiances à explorer. Une obsession : le prochain chrono.</p></div><span class="section-count"><b>${String(tracks.length).padStart(2, '0')}</b> CIRCUITS À EXPLORER</span></div>
      <div class="track-grid" aria-label="Circuits disponibles">${cards}</div>
      <div class="race-summary"><div class="summary-icon">${flag}</div><div><small>VOTRE GRILLE DE DÉPART</small><strong><span>${escapeHtml(vehicle?.name ?? vehicleId)}</span><span class="summary-separator">/</span><span id="selected-track-name" aria-live="polite">${escapeHtml(current.name)}</span></strong></div><span class="map-legend"><i></i> Point de départ sur le tracé</span></div>
      <div class="selection-footer"><button class="btn ghost" id="t-back">← Retour au garage</button><span class="selection-help">Le plus dur, c’est de lever le pied.</span><button class="btn primary" id="t-start">LANCER LA COURSE ${arrow}</button></div>
    `, 'tracks', 'Circuits', 2);
    // Start with the selected track; render and cache the rest in the background.
    for (const track of [current, ...tracks.filter((t) => t !== current)]) {
      const frame = [...s.querySelectorAll<HTMLElement>('[data-track-preview]')].find((el) => el.dataset.trackPreview === track.id)!;
      this.setPreview(frame, getTrackPreview(track));
    }
    s.querySelectorAll<HTMLButtonElement>('.track-card').forEach((card) => {
      card.addEventListener('click', () => {
        s.querySelectorAll('.track-card').forEach((other) => {
          other.classList.toggle('selected', other === card);
          other.setAttribute('aria-pressed', String(other === card));
        });
        const track = tracks.find((t) => t.id === card.dataset.id)!;
        s.querySelector('#selected-track-name')!.textContent = track.name;
        cb.onSelect(track.id);
      });
    });
    s.querySelector('#t-start')!.addEventListener('click', cb.onStart);
    s.querySelector('#t-back')!.addEventListener('click', cb.onBack);
  }

  // ---------- Chargement ----------
  showLoading(): void {
    this.screen(`
      <div class="loading-emblem" aria-hidden="true">${flag}</div><div class="eyebrow">LA LIGNE DE DÉPART SE PRÉPARE</div><h2>PLACE À LA <em>COURSE.</em></h2><p class="loading-caption" role="status">Préparation de votre voiture et du circuit…</p>
      <div class="progress-wrap">
        <div class="progress-bar" role="progressbar" aria-label="Chargement de la course" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><div class="progress-fill" id="loading-fill"></div></div>
      </div>
    `);
    this.progressFill = this.container.querySelector('#loading-fill');
  }

  setProgress(frac: number): void {
    if (!this.progressFill) return;
    const percent = Math.round(Math.max(0, Math.min(1, frac)) * 100);
    this.progressFill.style.width = `${percent}%`;
    this.progressFill.parentElement?.setAttribute('aria-valuenow', String(percent));
  }

  // ---------- Pause ----------
  showPause(cb: { onResume: () => void; onRestart: () => void; onMenu: () => void }): void {
    const s = this.screen(`
      <div class="eyebrow">ARRÊT AU STAND</div><h2>ON <em>SOUFFLE.</em></h2><p class="subtitle">La piste vous attend.</p>
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
      <div class="eyebrow">DRAPEAU À DAMIER</div><h2>BIEN <em>JOUÉ.</em></h2>
      ${isRecord ? '<div class="record-badge">★ NOUVEAU RECORD</div>' : ''}
      <div class="hud-time" style="font-size:46px">${formatTime(snap.elapsedMs)}</div>
      <table class="results-table">${laps}
        <tr><td>Meilleur</td><td class="val">${snap.bestTimeMs != null ? formatTime(snap.bestTimeMs) : 'À établir'}</td></tr>
      </table>
      <div class="menu-col results-actions">
        <button class="btn primary" id="r-restart">Recommencer</button>
        <button class="btn" id="r-menu">Menu principal</button>
      </div>
    `);
    s.querySelector('#r-restart')!.addEventListener('click', cb.onRestart);
    s.querySelector('#r-menu')!.addEventListener('click', cb.onMenu);
  }
}
