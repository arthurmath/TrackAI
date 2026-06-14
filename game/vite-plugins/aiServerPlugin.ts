import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import type { Plugin } from 'vite';

const AI_PORT = 8765;
const WEIGHTS_URL = `http://127.0.0.1:${AI_PORT}/weights`;

let aiProcess: ChildProcess | null = null;

async function isAiServerRunning(): Promise<boolean> {
  try {
    const res = await fetch(WEIGHTS_URL, { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForServer(maxAttempts = 30): Promise<boolean> {
  for (let i = 0; i < maxAttempts; i++) {
    if (await isAiServerRunning()) return true;
    await sleep(1000);
  }
  return false;
}

function startAiProcess(aiDir: string): void {
  if (aiProcess && !aiProcess.killed) return;

  aiProcess = spawn('uv run main.py', {
    cwd: aiDir,
    shell: true,
    detached: true,
    stdio: 'ignore',
  });
  aiProcess.unref();

  aiProcess.on('exit', () => {
    aiProcess = null;
  });
}

function sendJson(res: import('http').ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

/** Dev-only : démarre le serveur Python (`uv run main.py` dans `ai/`). */
export function aiServerPlugin(): Plugin {
  const aiDir = path.resolve(process.cwd(), '..', 'ai');

  return {
    name: 'trackai-ai-server',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url?.split('?')[0];

        if (url === '/api/ai-server/status' && req.method === 'GET') {
          sendJson(res, 200, { running: await isAiServerRunning() });
          return;
        }

        if (url === '/api/ai-server/start' && req.method === 'POST') {
          if (await isAiServerRunning()) {
            sendJson(res, 200, { running: true, started: false });
            return;
          }

          try {
            startAiProcess(aiDir);
            const ready = await waitForServer();
            sendJson(res, ready ? 200 : 504, { running: ready, started: ready });
          } catch (err) {
            sendJson(res, 500, { running: false, error: String(err) });
          }
          return;
        }

        next();
      });
    },
    closeBundle() {
      if (aiProcess && !aiProcess.killed) {
        aiProcess.kill();
        aiProcess = null;
      }
    },
  };
}
