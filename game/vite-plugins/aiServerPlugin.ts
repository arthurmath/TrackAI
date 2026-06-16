import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs/promises';
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
const SERIES_FILENAME_RE = /^history_[\w-]+\.json$/;

export function aiServerPlugin(): Plugin {
  const aiDir = path.resolve(process.cwd(), '..', 'ai');
  const seriesDir = path.join(aiDir, 'results', 'series');

  return {
    name: 'trackai-ai-server',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url?.split('?')[0];

        if (url === '/api/ai-series' && req.method === 'GET') {
          try {
            const entries = await fs.readdir(seriesDir);
            const files = entries.filter((f) => f.endsWith('.json')).sort().reverse();
            sendJson(res, 200, files);
          } catch {
            sendJson(res, 200, []);
          }
          return;
        }

        const seriesMatch = url?.match(/^\/api\/ai-series\/([^/]+)$/);
        if (seriesMatch && req.method === 'GET') {
          const filename = decodeURIComponent(seriesMatch[1]);
          if (!SERIES_FILENAME_RE.test(filename)) {
            sendJson(res, 400, { error: 'Invalid filename' });
            return;
          }
          try {
            const content = await fs.readFile(path.join(seriesDir, filename), 'utf-8');
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json');
            res.end(content);
          } catch {
            sendJson(res, 404, { error: 'Not found' });
          }
          return;
        }

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
