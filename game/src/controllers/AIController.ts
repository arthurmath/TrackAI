/**
 * AIController — pilotage par un agent externe (réseau de neurones PyTorch).
 *
 * Communication via WebSocket avec un serveur Python (dossier `ai/`).
 * Protocole JSON :
 *   - Client (jeu)  -> Serveur (IA) : { type: 'observation', data: VehicleObservation }
 *   - Serveur (IA)  -> Client (jeu) : { type: 'action', data: { throttle, brake, steer, handbrake, reset } }
 *
 * Le contrôleur est non bloquant : il renvoie la dernière action reçue. Si la
 * connexion est absente, il renvoie un état neutre (voiture à l'arrêt).
 */
import { NEUTRAL_CONTROL } from './Controller';
import type { Controller, ControlState, VehicleObservation } from './Controller';

export type AIInit =
  | { kind: 'training'; mode: 'cold' }
  | { kind: 'training'; mode: 'warm'; weightsFile: string }
  | { kind: 'play'; weightsFile: string };

/** @deprecated Use AIInit */
export type TrainingInit = Extract<AIInit, { kind: 'training' }>;

/**
 * Seuil de backpressure : si la file d'envoi WebSocket du navigateur
 * (`bufferedAmount`) dépasse cette taille, on cesse d'empiler des observations.
 * ~64 Ko laisse passer une petite rafale (le serveur Python peut prendre du
 * retard le temps d'un entraînement) tout en bornant strictement la mémoire.
 */
const MAX_BUFFERED_BYTES = 64 * 1024;

export class AIController implements Controller {
  readonly kind = 'ai' as const;

  // --- Diagnostic agrégé (toutes les voitures) : imprime 1×/s.
  // calls/s : appels à pushObservation (prouve que la boucle de jeu tourne).
  // sent/s  : observations réellement envoyées. skipBuf/s : sautées (backpressure).
  // maxBuf  : plus grand bufferedAmount vu (si énorme → tuyau bouché).
  private static diagCalls = 0;
  private static diagSent = 0;
  private static diagSkipBuf = 0;
  private static diagMaxBuf = 0;
  private static diagTimer: number | null = null;
  private static startDiag(): void {
    if (AIController.diagTimer !== null) return;
    AIController.diagTimer = window.setInterval(() => {
      console.log(`[AIdiag] calls/s=${AIController.diagCalls} sent/s=${AIController.diagSent} `
        + `skipBuf/s=${AIController.diagSkipBuf} maxBuf=${AIController.diagMaxBuf}`);
      AIController.diagCalls = 0;
      AIController.diagSent = 0;
      AIController.diagSkipBuf = 0;
      AIController.diagMaxBuf = 0;
    }, 1000);
  }

  private socket: WebSocket | null = null;
  private latestAction: ControlState = { ...NEUTRAL_CONTROL };
  private lastSendTime = 0;
  private connected = false;

  constructor(
    private readonly url: string,
    private readonly stateSendRate: number,
    private readonly init?: AIInit,
    private readonly sendInit = false,
  ) {
    AIController.startDiag();
    this.connect();
  }

  private connect(): void {
    try {
      this.socket = new WebSocket(this.url);
    } catch (err) {
      console.warn('[AIController] WebSocket indisponible:', err);
      return;
    }
    this.socket.addEventListener('open', () => {
      this.connected = true;
      console.info('[AIController] Connecté au serveur IA:', this.url);
      if (this.sendInit && this.init) {
        if (this.init.kind === 'training') {
          this.socket!.send(JSON.stringify({
            type: 'training_init',
            data: this.init.mode === 'warm'
              ? { mode: 'warm', weightsFile: this.init.weightsFile }
              : { mode: 'cold' },
          }));
        } else {
          this.socket!.send(JSON.stringify({
            type: 'play_init',
            data: { weightsFile: this.init.weightsFile },
          }));
        }
      }
    });
    this.socket.addEventListener('close', (ev) => {
      this.connected = false;
      this.latestAction = { ...NEUTRAL_CONTROL };
      // Diagnostic : on veut savoir si les sockets meurent au moment d'un gel.
      console.warn(`[AIController] Connexion fermée (code=${ev.code}, propre=${ev.wasClean}, raison="${ev.reason}")`);
    });
    this.socket.addEventListener('error', () => {
      this.connected = false;
      console.warn('[AIController] Erreur socket');
    });
    this.socket.addEventListener('message', (ev) => this.onMessage(ev));
  }

  private onMessage(ev: MessageEvent): void {
    try {
      const msg = JSON.parse(ev.data as string);
      if (msg?.type === 'action' && msg.data) {
        const d = msg.data;
        this.latestAction = {
          throttle: clamp01(d.throttle ?? 0),
          brake: clamp01(d.brake ?? 0),
          steer: clampSigned(d.steer ?? 0),
          handbrake: Boolean(d.handbrake),
          reset: Boolean(d.reset),
        };
      }
    } catch (err) {
      console.warn('[AIController] Message invalide:', err);
    }
  }

  pushObservation(obs: VehicleObservation): boolean {
    AIController.diagCalls++;
    if (!this.connected || !this.socket) return false;
    if (this.socket.readyState !== WebSocket.OPEN) return false;
    const now = performance.now();
    const minInterval = 1000 / this.stateSendRate;
    if (now - this.lastSendTime < minInterval) return false;
    const buffered = this.socket.bufferedAmount;
    if (buffered > AIController.diagMaxBuf) AIController.diagMaxBuf = buffered;
    // Backpressure : si le serveur Python n'absorbe pas les observations assez
    // vite, la file d'envoi du navigateur (bufferedAmount) grossit sans limite,
    // engorge le tuyau TCP et finit par geler l'entraînement. Plutôt que d'empiler,
    // on saute l'observation quand la file dépasse le seuil : perdre quelques
    // observations est sans impact sur l'apprentissage, un tuyau bouché est fatal.
    if (buffered > MAX_BUFFERED_BYTES) {
      AIController.diagSkipBuf++;
      return false;
    }
    this.lastSendTime = now;
    this.socket.send(JSON.stringify({ type: 'observation', data: obs }));
    AIController.diagSent++;
    return true;
  }

  sample(): ControlState {
    // L'action de reset est consommée une seule fois.
    const action = { ...this.latestAction };
    this.latestAction.reset = false;
    return action;
  }

  requestStopTraining(): void {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({ type: 'stop_training' }));
    }
  }

  dispose(): void {
    this.socket?.close();
    this.socket = null;
  }
}

// NB: Math.min/max laissent passer NaN (Math.max(-1, NaN) === NaN). Un NaN qui
// atteindrait la physique corromprait Rapier (panique WASM → gel). On mappe donc
// tout non-fini vers 0 (action neutre).
function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(1, v));
}
function clampSigned(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(-1, Math.min(1, v));
}
