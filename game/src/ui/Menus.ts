/**
 * Menus — gère tous les écrans plein écran : menu principal, sélection voiture,
 * sélection circuit, chargement, pause et résultats. Chaque écran est rendu
 * dans un conteneur dédié et communique via des callbacks.
 */
import type { VehicleConfig } from '../physics/vehicleConfig';
import type { TrackDefinition } from '../entities/tracks/types';
import type { RaceSnapshot } from '../game/Race';
import { formatTime } from '../game/format';
import { getBestTimeMs } from '../game/Storage';

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
      <h1>RACE&nbsp;AI</h1>
      <div class="subtitle">Trackmania-like · Three.js + Rapier</div>
      <div class="menu-col">
        <button class="btn primary" id="m-play">Jouer</button>
        <button class="btn" id="m-ai">IA — Inférence / Entraînement <span class="tag">bientôt</span></button>
        <button class="btn" id="m-editor">Éditeur de circuits <span class="tag">bientôt</span></button>
      </div>
      <div class="hint">Contrôles : Z/↑ accélérer · S/↓ frein/arrière · Q/D braquer · Espace frein à main · C caméra · R reset · Échap pause · F3 debug</div>
    `);
    s.querySelector('#m-play')!.addEventListener('click', cb.onPlay);
    s.querySelector('#m-ai')!.addEventListener('click', cb.onAI);
    s.querySelector('#m-editor')!.addEventListener('click', cb.onEditor);
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
