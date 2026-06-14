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

export class AIController implements Controller {
  readonly kind = 'ai' as const;

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
    this.socket.addEventListener('close', () => {
      this.connected = false;
      this.latestAction = { ...NEUTRAL_CONTROL };
    });
    this.socket.addEventListener('error', () => {
      this.connected = false;
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

  pushObservation(obs: VehicleObservation): void {
    if (!this.connected || !this.socket) return;
    const now = performance.now();
    const minInterval = 1000 / this.stateSendRate;
    if (now - this.lastSendTime < minInterval) return;
    this.lastSendTime = now;
    if (this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({ type: 'observation', data: obs }));
    }
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

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}
function clampSigned(v: number): number {
  return Math.max(-1, Math.min(1, v));
}
