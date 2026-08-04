/**
 * The Kas Windows launcher.
 *
 * Double-clicking `Kas.cmd` runs this. It performs the startup an operator
 * would otherwise do by hand in PowerShell — check prerequisites, start the
 * server, wait for it to be healthy, open the browser — and it opens
 * `http://localhost:3001` rather than the machine's LAN address, which is what
 * makes the app installable (see plan.ts).
 *
 * ONE PROCESS. Production serves the API and the built SPA from the same
 * Express app on one origin, exactly as scripts/production/windows/KasOps.ps1
 * describes. There is no Vite process to start; doing so would put the UI on a
 * second origin with no service worker.
 *
 * Every decision lives in plan.ts and is unit tested. This file is the part
 * that touches the operating system.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
  appUrl,
  decideAction,
  describeEnvironment,
  problemMessage,
  type LauncherEnvironment,
} from './plan';

/** Repository root: this file runs from `server/dist/launcher/`. */
const ROOT = path.resolve(__dirname, '..', '..', '..');
const SERVER_ENTRY = path.join(ROOT, 'server', 'dist', 'index.js');
const CLIENT_INDEX = path.join(ROOT, 'client', 'dist', 'index.html');
const LOG_DIR = path.join(ROOT, 'logs');
const LOG_FILE = path.join(LOG_DIR, 'launcher.log');

/** How long to wait for the server to answer /api/health before giving up. */
const HEALTH_TIMEOUT_MS = 60_000;
const HEALTH_INTERVAL_MS = 500;

/* ------------------------------------------------------------------ */
/* Logging                                                             */
/* ------------------------------------------------------------------ */

/**
 * Appends to the launcher log and echoes to the console.
 *
 * Nothing secret is ever passed in: the launcher reports the PRESENCE of
 * DATABASE_URL, never its value, and the server's own stdout is written
 * verbatim because it is already written to be safe to display.
 */
function log(line: string): void {
  const stamped = `[${new Date().toISOString()}] ${line}`;
  // eslint-disable-next-line no-console
  console.log(line);
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    fs.appendFileSync(LOG_FILE, `${stamped}\n`, 'utf8');
  } catch {
    // A log that cannot be written must not stop the app from starting.
  }
}

/* ------------------------------------------------------------------ */
/* Probes                                                              */
/* ------------------------------------------------------------------ */

/** True when the health endpoint answers as Kas. */
async function probeKas(port: number, timeoutMs = 1500): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const response = await fetch(`${appUrl(port)}/api/health`, { signal: controller.signal });
    clearTimeout(timer);
    if (!response.ok) return false;
    // Any JSON body from /api/health is Kas; a foreign server on the port would
    // not answer this path with 200 + JSON.
    await response.json();
    return true;
  } catch {
    return false;
  }
}

/** True when anything at all accepts a TCP connection on the port. */
async function probePort(port: number): Promise<boolean> {
  const net = await import('node:net');
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const done = (inUse: boolean) => {
      socket.destroy();
      resolve(inUse);
    };
    socket.setTimeout(1000);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
    socket.connect(port, '127.0.0.1');
  });
}

async function readEnvironment(port: number): Promise<LauncherEnvironment> {
  const portServesKas = await probeKas(port);
  return {
    nodeMajor: Number.parseInt(process.versions.node.split('.')[0] ?? '0', 10),
    port,
    serverBuildPresent: fs.existsSync(SERVER_ENTRY),
    clientBuildPresent: fs.existsSync(CLIENT_INDEX),
    // Only probed when Kas is not already answering, to keep startup quick.
    portInUse: portServesKas ? true : await probePort(port),
    portServesKas,
    databaseUrlConfigured: (process.env.DATABASE_URL ?? '').trim().length > 0,
  };
}

/* ------------------------------------------------------------------ */
/* Browser                                                             */
/* ------------------------------------------------------------------ */

/**
 * Opens the default browser at `url`.
 *
 * `cmd /c start` hands the URL to the shell, which reuses an already-open
 * browser window instead of starting a second copy. The empty first argument
 * is required: `start` treats a lone quoted argument as the window title.
 */
function openBrowser(url: string): void {
  try {
    const child = spawn('cmd', ['/c', 'start', '', url], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.unref();
    log(`Đã mở trình duyệt tại ${url}`);
  } catch (error) {
    log(`Không mở được trình duyệt tự động. Hãy mở thủ công: ${url}`);
    log(`  (chi tiết: ${(error as Error).message})`);
  }
}

/* ------------------------------------------------------------------ */
/* Server process                                                      */
/* ------------------------------------------------------------------ */

let serverProcess: ChildProcess | null = null;

function startServer(): ChildProcess {
  log('Đang khởi động máy chủ Kas...');
  const child = spawn(process.execPath, [SERVER_ENTRY], {
    cwd: ROOT,
    // Inherited as-is: the server reads its own configuration from .env, so the
    // launcher never parses, copies or logs any secret.
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout?.on('data', (chunk: Buffer) => log(`[server] ${chunk.toString().trimEnd()}`));
  child.stderr?.on('data', (chunk: Buffer) => log(`[server] ${chunk.toString().trimEnd()}`));
  child.on('exit', (code, signal) => {
    log(`Máy chủ đã dừng (mã ${code ?? 'null'}${signal ? `, tín hiệu ${signal}` : ''}).`);
    serverProcess = null;
  });

  return child;
}

/** Waits until the server answers, or gives up with a readable reason. */
async function waitForHealth(port: number): Promise<boolean> {
  const deadline = Date.now() + HEALTH_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await probeKas(port, 1000)) return true;
    // The child exiting is a faster and clearer failure than the timeout.
    if (serverProcess === null) return false;
    await new Promise((resolve) => setTimeout(resolve, HEALTH_INTERVAL_MS));
  }
  return false;
}

/**
 * Stops the server when the launcher window closes.
 *
 * The server installs its own SIGINT/SIGTERM handler and shuts down gracefully,
 * so it is asked rather than killed — an abrupt kill during a write is how a
 * half-finished dispatch would happen.
 */
function stopServer(): void {
  if (!serverProcess) return;
  log('Đang dừng máy chủ Kas...');
  serverProcess.kill('SIGTERM');
  serverProcess = null;
}

/* ------------------------------------------------------------------ */
/* Entry point                                                         */
/* ------------------------------------------------------------------ */

export async function main(): Promise<number> {
  // The server's own loader reads .env from the repository root; the launcher
  // does the same so its checks see the same configuration the server will.
  const dotenv = await import('dotenv');
  dotenv.config({ path: path.join(ROOT, '.env') });

  const port = Number.parseInt(process.env.PORT ?? '3001', 10);

  log('===============================================');
  log('  Kas — khởi động ứng dụng');
  log('===============================================');

  const environment = await readEnvironment(port);
  for (const line of describeEnvironment(environment)) log(`  ${line}`);

  const action = decideAction(environment);

  if (action.kind === 'ABORT') {
    log('');
    log(`KHÔNG THỂ KHỞI ĐỘNG: ${problemMessage(action.problem, environment)}`);
    return 1;
  }

  if (action.kind === 'ATTACH') {
    log('');
    log('Kas đã chạy sẵn — không khởi động thêm tiến trình nào.');
    openBrowser(action.url);
    return 0;
  }

  serverProcess = startServer();
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
    process.on(signal, () => {
      stopServer();
      process.exit(0);
    });
  }
  process.on('exit', stopServer);

  if (!(await waitForHealth(port))) {
    log('');
    log('Máy chủ không phản hồi trong thời gian chờ. Xem chi tiết ở logs/launcher.log.');
    stopServer();
    return 1;
  }

  log('Máy chủ đã sẵn sàng.');
  openBrowser(action.url);
  log('');
  log('Kas đang chạy. Đóng cửa sổ này để tắt ứng dụng.');

  // Hold the window open so closing it stops the server.
  await new Promise<void>(() => undefined);
  return 0;
}

// Executed directly by Kas.cmd.
if (require.main === module) {
  main()
    .then((code) => {
      if (code !== 0) process.exitCode = code;
    })
    .catch((error: unknown) => {
      log(`Lỗi không mong đợi: ${(error as Error).message}`);
      process.exitCode = 1;
    });
}
