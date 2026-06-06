/**
 * main.ts — point d'entrée. Orchestre le flux de l'application :
 *   Menu principal → Sélection voiture → Sélection circuit → Chargement →
 *   Compte à rebours → Course → Résultats.
 *
 * Les systèmes persistants (renderer, scène, caméra, post-process, boucle de jeu,
 * UI) vivent ici ; chaque course est encapsulée dans une RaceSession jetable.
 */
import { initPhysics } from './physics/PhysicsWorld';
import { SceneManager } from './rendering/SceneManager';
import { Lighting } from './rendering/Lighting';
import { CameraController } from './rendering/CameraController';
import { PostProcessing } from './rendering/PostProcessing';
import { GameLoop } from './core/GameLoop';
import { InputManager } from './core/InputManager';
import { HumanController } from './controllers/HumanController';
import { RaceSession } from './game/RaceSession';
import { Menus } from './ui/Menus';
import { HUD } from './ui/HUD';
import { Countdown } from './ui/Countdown';
import { DebugOverlay } from './ui/DebugOverlay';
import { VEHICLES, DEFAULT_VEHICLE_ID } from './physics/vehicleConfig';
import { TRACKS, getTrackById, DEFAULT_TRACK_ID } from './entities/tracks';

type AppState = 'menu' | 'vehicleSelect' | 'trackSelect' | 'loading' | 'racing' | 'paused' | 'results';

class App {
  private readonly scene: SceneManager;
  private readonly lighting: Lighting;
  private readonly camera: CameraController;
  private readonly post: PostProcessing;
  private readonly input: InputManager;
  private readonly loop: GameLoop;

  private readonly uiRoot: HTMLElement;
  private readonly menus: Menus;
  private readonly hud: HUD;
  private readonly countdown: Countdown;
  private readonly debug: DebugOverlay;

  private state: AppState = 'menu';
  private session: RaceSession | null = null;
  private resultsShown = false;

  private selectedVehicleId = DEFAULT_VEHICLE_ID;
  private selectedTrackId = DEFAULT_TRACK_ID;

  constructor(canvas: HTMLCanvasElement) {
    this.scene = new SceneManager(canvas);
    this.lighting = new Lighting(this.scene.scene);
    this.camera = new CameraController(this.scene.camera);
    this.post = new PostProcessing(
      this.scene.renderer,
      this.scene.scene,
      this.scene.camera,
      this.scene.size,
    );

    this.uiRoot = document.getElementById('ui-root')!;
    this.menus = new Menus(this.uiRoot);
    this.hud = new HUD(this.uiRoot);
    this.countdown = new Countdown(this.uiRoot);
    this.debug = new DebugOverlay(this.uiRoot);

    this.input = new InputManager();
    this.bindInput();

    // Décor de fond pour les menus (lumière douce + ciel).
    this.lighting.apply(getTrackById(DEFAULT_TRACK_ID).lighting);

    this.loop = new GameLoop(this.fixedUpdate, this.render);

    window.addEventListener('resize', () => {
      this.post.setSize(window.innerWidth, window.innerHeight);
    });
  }

  start(): void {
    this.goToMenu();
    this.loop.start();
  }

  // ---------------- Flux d'écrans ----------------

  private goToMenu(): void {
    this.disposeSession();
    this.state = 'menu';
    this.input.setEnabled(false);
    this.hud.hide();
    this.countdown.hide();
    this.menus.showMain({
      onPlay: () => this.goToVehicleSelect(),
      onAI: () =>
        alert(
          "Mode IA : un AIController est fourni (WebSocket vers un serveur Python).\n" +
            "La partie entraînement (PyTorch / Reinforcement Learning) sera ajoutée dans le dossier ai/.",
        ),
      onEditor: () => alert('Éditeur de circuits : à venir.'),
    });
  }

  private goToVehicleSelect(): void {
    this.state = 'vehicleSelect';
    this.menus.showVehicleSelect(Object.values(VEHICLES), this.selectedVehicleId, {
      onSelect: (id) => (this.selectedVehicleId = id),
      onNext: () => this.goToTrackSelect(),
      onBack: () => this.goToMenu(),
    });
  }

  private goToTrackSelect(): void {
    this.state = 'trackSelect';
    this.menus.showTrackSelect(TRACKS, this.selectedVehicleId, this.selectedTrackId, {
      onSelect: (id) => (this.selectedTrackId = id),
      onStart: () => void this.startRace(),
      onBack: () => this.goToVehicleSelect(),
    });
  }

  private async startRace(): Promise<void> {
    this.state = 'loading';
    this.menus.showLoading();
    this.menus.setProgress(0.15);

    // Laisse le navigateur peindre l'écran de chargement avant le build lourd.
    await nextFrame();
    this.menus.setProgress(0.5);

    this.disposeSession();
    const vehicleConfig = VEHICLES[this.selectedVehicleId];
    const trackDef = getTrackById(this.selectedTrackId);
    const controller = new HumanController(this.input);

    this.session = new RaceSession(this.scene.scene, this.lighting, vehicleConfig, trackDef, controller);
    this.menus.setProgress(1);

    await nextFrame();

    this.resultsShown = false;
    this.menus.hide();
    this.hud.show();
    this.input.setEnabled(true);
    this.state = 'racing';
  }

  private showResults(): void {
    if (!this.session) return;
    this.resultsShown = true;
    this.state = 'results';
    this.input.setEnabled(false);
    this.hud.hide();
    const snap = this.session.race.snapshot();
    this.menus.showResults(snap, this.session.race.isNewRecord, {
      onRestart: () => void this.startRace(),
      onMenu: () => this.goToMenu(),
    });
  }

  private togglePause(): void {
    if (this.state === 'racing') {
      this.state = 'paused';
      this.input.setEnabled(false);
      this.menus.showPause({
        onResume: () => this.resume(),
        onRestart: () => void this.startRace(),
        onMenu: () => this.goToMenu(),
      });
    } else if (this.state === 'paused') {
      this.resume();
    }
  }

  private resume(): void {
    this.state = 'racing';
    this.menus.hide();
    this.hud.show();
    this.input.setEnabled(true);
  }

  // ---------------- Boucle ----------------

  private fixedUpdate = (dt: number): void => {
    if (this.state !== 'racing' || !this.session) return;
    const racing = this.session.race.isRacing;
    this.session.fixedUpdate(dt, racing);
    if (this.session.race.isFinished && !this.resultsShown) {
      this.showResults();
    }
  };

  private render = (alpha: number, frameDt: number): void => {
    if (this.session) {
      this.session.render(alpha);
      this.camera.update(
        this.session.renderPosition,
        this.session.renderRotation,
        this.session.vehicle.forwardSpeed,
        frameDt,
      );

      const snap = this.session.race.snapshot();
      if (this.state === 'racing' && snap.state === 'countdown') {
        this.countdown.set(snap.countdownValue);
      } else {
        this.countdown.hide();
      }
      if (this.state === 'racing' || this.state === 'paused') {
        this.hud.update(snap, this.session.speedKmh);
      }
      this.post.setSpeed(this.session.speed01);
    }

    this.debug.update(frameDt, this.session ? [
      `Speed ${this.session.speedKmh.toFixed(0)} km/h`,
      `Cam ${this.camera.mode}`,
      `State ${this.state}`,
    ] : [`State ${this.state}`]);

    if (this.post.enabled && this.session) {
      this.post.render(frameDt);
    } else {
      this.scene.renderer.render(this.scene.scene, this.scene.camera);
    }
  };

  private bindInput(): void {
    this.input.on('pause', () => this.togglePause());
    this.input.on('cycleCamera', () => this.camera.cycle());
    this.input.on('toggleDebug', () => this.debug.toggle());
    // 'reset' est consommé par le HumanController/RaceSession.
  }

  private disposeSession(): void {
    if (this.session) {
      this.session.dispose(this.scene.scene);
      this.session = null;
    }
  }
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

// ---------------- Bootstrap ----------------
async function bootstrap(): Promise<void> {
  await initPhysics();
  const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
  const app = new App(canvas);
  app.start();
}

bootstrap().catch((err) => {
  console.error('Échec du démarrage:', err);
  const root = document.getElementById('ui-root');
  if (root) {
    root.innerHTML = `<div class="screen"><h2>Erreur de démarrage</h2><div class="hint">${String(err)}</div></div>`;
  }
});
