import { AI_CONFIG } from '../config';

/** Contrôle et état du serveur Python IA (via le plugin Vite en dev). */
export class AiServer {
  static async isRunning(): Promise<boolean> {
    try {
      const res = await fetch(AI_CONFIG.weightsApiUrl, { signal: AbortSignal.timeout(2000) });
      return res.ok;
    } catch {
      return false;
    }
  }

  static async start(): Promise<boolean> {
    if (await this.isRunning()) return true;

    const res = await fetch(AI_CONFIG.serverStartUrl, { method: 'POST' });
    const data = (await res.json()) as { running?: boolean; error?: string };
    if (!res.ok || !data.running) {
      throw new Error(data.error || 'Le serveur Python ne répond pas. Consulte les logs du terminal Vite.');
    }
    return true;
  }
}
