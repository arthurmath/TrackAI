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

    try {
      const res = await fetch(AI_CONFIG.serverStartUrl, { method: 'POST' });
      if (!res.ok) return false;
      const data = (await res.json()) as { running?: boolean };
      if (data.running) return true;

      for (let i = 0; i < 30; i++) {
        await new Promise((r) => setTimeout(r, 1000));
        if (await this.isRunning()) return true;
      }
      return false;
    } catch {
      return false;
    }
  }
}
