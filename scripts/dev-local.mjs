/**
 * Local development launcher for NaijaPages.
 *
 * Ensures the local Cloudflare Worker (`wrangler dev --env development --port 8787`)
 * and local D1 migrations are ready before/alongside Vite on port 3000 so
 * Vite's `/api/*` proxy never encounters `ECONNREFUSED 127.0.0.1:8787`.
 */
import { spawn, spawnSync } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import process from 'node:process';
import { existsSync } from 'node:fs';

const ROOT = process.cwd();
const BIN_DIR = path.join(ROOT, 'node_modules', '.bin');
const WRANGLER_BIN = existsSync(path.join(BIN_DIR, 'wrangler'))
  ? path.join(BIN_DIR, 'wrangler')
  : 'wrangler';
const VITE_BIN = existsSync(path.join(BIN_DIR, 'vite'))
  ? path.join(BIN_DIR, 'vite')
  : 'vite';

const WORKER_HOST = '127.0.0.1';
const WORKER_PORT = 8787;

function isPortListening(host, port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    const done = (ok) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(400);
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
    socket.once('timeout', () => done(false));
  });
}

async function waitForPort(host, port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isPortListening(host, port)) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

const children = [];
let shuttingDown = false;

function shutdown(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (child && !child.killed) {
      try {
        child.kill('SIGTERM');
      } catch {
        // Ignore already-exited child
      }
    }
  }
  setTimeout(() => {
    for (const child of children) {
      if (child && !child.killed) {
        try {
          child.kill('SIGKILL');
        } catch {
          // Ignore
        }
      }
    }
    process.exit(exitCode);
  }, 1500).unref();
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

async function main() {
  const workerAlreadyUp = await isPortListening(WORKER_HOST, WORKER_PORT);

  if (!workerAlreadyUp) {
    // Apply local D1 migrations idempotently so all auth & directory tables exist.
    const migrate = spawnSync(
      WRANGLER_BIN,
      ['d1', 'migrations', 'apply', 'DB', '--env', 'development', '--local'],
      {
        cwd: ROOT,
        stdio: 'inherit',
        env: { ...process.env, CI: 'true' },
      },
    );
    if (migrate.status !== 0) {
      console.warn('[dev-local] Warning: local D1 migration returned non-zero exit code:', migrate.status);
    }

    const worker = spawn(
      WRANGLER_BIN,
      [
        'dev',
        '--env',
        'development',
        '--port',
        String(WORKER_PORT),
        '--ip',
        WORKER_HOST,
        '--show-interactive-dev-session=false',
      ],
      {
        cwd: ROOT,
        stdio: ['ignore', 'inherit', 'inherit'],
        env: { ...process.env, CI: 'true' },
      },
    );
    children.push(worker);

    worker.on('exit', (code) => {
      if (!shuttingDown) {
        console.error(`[dev-local] Wrangler dev exited unexpectedly (code=${code ?? 'null'}).`);
      }
    });

    // Wait briefly for the Worker to accept connections so initial requests succeed immediately.
    const ready = await waitForPort(WORKER_HOST, WORKER_PORT, 12000);
    if (!ready) {
      console.warn('[dev-local] Worker is still starting up on 127.0.0.1:8787; starting Vite now.');
    }
  }

  // Forward any caller-supplied Vite flags, defaulting to --port=3000 --host=0.0.0.0.
  const extraArgs = process.argv.slice(2);
  const hasPort = extraArgs.some((arg) => arg === '--port' || arg === '-p' || arg.startsWith('--port='));
  const hasHost = extraArgs.some((arg) => arg === '--host' || arg.startsWith('--host='));
  const viteArgs = [...extraArgs];
  if (!hasPort) viteArgs.push('--port=3000');
  if (!hasHost) viteArgs.push('--host=0.0.0.0');

  const vite = spawn(VITE_BIN, viteArgs, {
    cwd: ROOT,
    stdio: 'inherit',
    env: process.env,
  });
  children.push(vite);

  vite.on('exit', (code) => {
    shutdown(code ?? 0);
  });
}

void main();
