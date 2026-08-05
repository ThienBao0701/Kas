/**
 * The Kas production runner.
 *
 * ONE entry point for every way Kas starts. `Kas.cmd` runs it interactively
 * when an operator double-clicks; `KasService.cmd` runs it with `--service`
 * from the scheduled task Windows fires at boot. The difference between those
 * two is four lines of policy in plan.ts — whether a browser opens and whether
 * a console holds it open — and nothing else, so the thing that runs at 6am
 * unattended is the same thing the operator tested by hand.
 *
 * ── WHY NOT A WINDOWS SERVICE ─────────────────────────────────────────────
 * A Windows service must speak the Service Control Protocol: connect to the
 * SCM and report status within about thirty seconds. Node has no binding for
 * it, so `sc create binPath="node.exe app.js"` registers happily and then fails
 * at start with error 1053. Making Kas a real service needs a third-party
 * wrapper binary (WinSW, NSSM) committed to this repository and shipped
 * unsigned to the hotel. A scheduled task with an at-startup trigger meets the
 * operational requirement — starts with Windows, no console, no PowerShell, no
 * logged-in user — using only what Windows already ships. That was the call.
 *
 * ── WHY SHUTDOWN GOES OVER IPC AND A NAMED PIPE ───────────────────────────
 * Windows has no POSIX signals. `child.kill('SIGTERM')` on Windows calls
 * TerminateProcess: the child's SIGTERM handler never runs. Verified on this
 * machine — the handler did not fire, while an IPC message ran it and exited
 * cleanly. So the graceful path the server already implements is reached by
 * sending it a message, not a signal, and an outside `--stop` reaches this
 * runner through a named pipe. TerminateProcess remains the last resort, after
 * a timeout, which is the only case where an in-flight request is lost.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import {
  appUrl,
  decideAction,
  describeEnvironment,
  problemMessage,
  type LauncherEnvironment,
} from '../launcher/plan';
import {
  MAX_RESTARTS,
  evaluateHealth,
  decideLock,
  fatalMessage,
  healthFaultMessage,
  lockMessage,
  parseMode,
  shouldOpenBrowser,
  startupBanner,
  type HealthSample,
  type LockFile,
  type RunMode,
} from './plan';
import { openLogs, stamp, type LogSet } from './logs';
import { controlPipe, readHealth, requestStop } from './control';

/** Repository root: this file runs from `server/dist/service/`. */
const ROOT = path.resolve(__dirname, '..', '..', '..');
const SERVER_ENTRY = path.join(ROOT, 'server', 'dist', 'index.js');
const CLIENT_INDEX = path.join(ROOT, 'client', 'dist', 'index.html');
const LOG_DIR = path.join(ROOT, 'logs');
const UPLOAD_DIR = path.join(ROOT, 'server', 'uploads');
const LOCK_FILE = path.join(ROOT, 'logs', 'kas.lock');

/** How long to wait for the server to answer /api/health before giving up. */
const HEALTH_TIMEOUT_MS = 60_000;
const HEALTH_INTERVAL_MS = 500;
/** How often the monitor samples once the server is up. */
const MONITOR_INTERVAL_MS = 30_000;
/** How long a graceful shutdown may take before the process is terminated. */
const SHUTDOWN_GRACE_MS = 15_000;

let logs: LogSet;
let serverProcess: ChildProcess | null = null;
let restartsUsed = 0;
let stopping = false;
let monitorTimer: NodeJS.Timeout | null = null;
let controlServer: net.Server | null = null;

/* ------------------------------------------------------------------ */
/* Logging                                                             */
/* ------------------------------------------------------------------ */

/** Writes one line to the named logs, and to the console when interactive. */
function write(line: string, targets: (keyof LogSet)[], echo = true): void {
  const stamped = stamp(line);
  for (const target of targets) logs[target].append(stamped);
  // eslint-disable-next-line no-console
  if (echo) console.log(line);
}

const info = (line: string) => write(line, ['launcher', 'service']);
const startupLine = (line: string) => write(line, ['launcher', 'startup']);
const fault = (line: string) => write(line, ['launcher', 'service', 'error']);

/* ------------------------------------------------------------------ */
/* Probes                                                              */
/* ------------------------------------------------------------------ */

/**
 * The health endpoint's own view of itself, or null when it did not answer.
 *
 * A 503 counts as an answer: it is Kas reporting that its database is down, the
 * process is alive, and that is emphatically not a reason to restart it.
 */
const probeHealth = readHealth;

/** True when anything at all accepts a TCP connection on the port. */
async function probePort(port: number): Promise<boolean> {
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

/** A directory that exists and accepts a write. Creates it when missing. */
function directoryWritable(dir: string): boolean {
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.accessSync(dir, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

/** Free bytes on the volume holding the install, or null when unreadable. */
function freeDiskBytes(): number | null {
  try {
    const stats = fs.statfsSync(ROOT);
    return Number(stats.bavail) * Number(stats.bsize);
  } catch {
    // Not fatal, and deliberately not fabricated: a made-up figure here would
    // either raise a false alarm or silence a real one.
    return null;
  }
}

async function readEnvironment(port: number): Promise<LauncherEnvironment> {
  const health = await probeHealth(port);
  return {
    nodeMajor: Number.parseInt(process.versions.node.split('.')[0] ?? '0', 10),
    port,
    serverBuildPresent: fs.existsSync(SERVER_ENTRY),
    clientBuildPresent: fs.existsSync(CLIENT_INDEX),
    portInUse: health !== null ? true : await probePort(port),
    portServesKas: health !== null,
    databaseUrlConfigured: (process.env.DATABASE_URL ?? '').trim().length > 0,
    uploadDirWritable: directoryWritable(UPLOAD_DIR),
    logDirWritable: directoryWritable(LOG_DIR),
  };
}

/* ------------------------------------------------------------------ */
/* Lock file                                                           */
/* ------------------------------------------------------------------ */

function readLock(): LockFile | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(LOCK_FILE, 'utf8')) as LockFile;
    return typeof parsed.pid === 'number' ? parsed : null;
  } catch {
    // Absent, truncated by a power cut, or hand-edited. All the same answer:
    // there is no usable lock, and the port probe decides.
    return null;
  }
}

/** Whether a PID exists. Signal 0 tests for the process without touching it. */
function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function writeLock(port: number, mode: RunMode): void {
  const lock: LockFile = { pid: process.pid, port, startedAt: new Date().toISOString(), mode };
  try {
    fs.mkdirSync(path.dirname(LOCK_FILE), { recursive: true });
    fs.writeFileSync(LOCK_FILE, JSON.stringify(lock, null, 2), 'utf8');
  } catch {
    // Without a lock file the port probe still prevents a second server; this
    // is a hint, not the guarantee.
  }
}

function clearLock(): void {
  try {
    fs.rmSync(LOCK_FILE, { force: true });
  } catch {
    // Nothing to do — a leftover lock is cleared by the next start.
  }
}

/* ------------------------------------------------------------------ */
/* Control channel                                                     */
/* ------------------------------------------------------------------ */

/**
 * Listens for a stop request.
 *
 * This is what makes "stop the background service" graceful. A scheduled task
 * ended with `schtasks /end` is terminated outright, so the supported stop is
 * `KasService.cmd stop`, which arrives here and runs the same shutdown an
 * operator gets from Ctrl+C.
 */
function listenForControl(port: number): void {
  try {
    controlServer = net.createServer((socket) => {
      socket.on('data', (chunk) => {
        if (chunk.toString().trim() === 'stop') {
          socket.end('stopping\n');
          void shutdown('yêu cầu dừng từ KasService.cmd stop');
        }
      });
    });
    controlServer.on('error', () => undefined);
    controlServer.listen(controlPipe(port));
  } catch {
    // A missing control channel costs the graceful stop, not the app.
  }
}

/* ------------------------------------------------------------------ */
/* Browser                                                             */
/* ------------------------------------------------------------------ */

/**
 * Opens the default browser at `url`.
 *
 * `cmd /c start` hands the URL to the shell, which reuses an already-open
 * browser window instead of starting a second copy. The empty first argument is
 * required: `start` treats a lone quoted argument as the window title.
 */
function openBrowser(url: string): void {
  try {
    const child = spawn('cmd', ['/c', 'start', '', url], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.unref();
    info(`Đã mở trình duyệt tại ${url}`);
  } catch (error) {
    info(`Không mở được trình duyệt tự động. Hãy mở thủ công: ${url}`);
    info(`  (chi tiết: ${(error as Error).message})`);
  }
}

/* ------------------------------------------------------------------ */
/* Server process                                                      */
/* ------------------------------------------------------------------ */

function startServer(): ChildProcess {
  info('Đang khởi động máy chủ Kas...');
  const child = spawn(process.execPath, [SERVER_ENTRY], {
    cwd: ROOT,
    // Inherited as-is: the server reads its own configuration from .env, so the
    // runner never parses, copies or logs any secret.
    env: process.env,
    // The fourth entry is the IPC channel the graceful shutdown travels over.
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    windowsHide: true,
  });

  // The server's output is voluminous and goes to its own file, so a startup
  // problem is not buried under a week of request logs.
  child.stdout?.on('data', (chunk: Buffer) => write(chunk.toString().trimEnd(), ['server'], false));
  child.stderr?.on('data', (chunk: Buffer) => write(chunk.toString().trimEnd(), ['server', 'error'], false));
  child.on('exit', (code, signal) => {
    const how = `mã ${code ?? 'null'}${signal ? `, tín hiệu ${signal}` : ''}`;
    if (stopping) info(`Máy chủ đã dừng (${how}).`);
    else fault(`Máy chủ dừng ngoài ý muốn (${how}).`);
    serverProcess = null;
  });

  return child;
}

/** Waits until the server answers, or gives up with a readable reason. */
async function waitForHealth(port: number): Promise<boolean> {
  const deadline = Date.now() + HEALTH_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if ((await probeHealth(port, 1000)) !== null) return true;
    // The child exiting is a faster and clearer failure than the timeout.
    if (serverProcess === null) return false;
    await new Promise((resolve) => setTimeout(resolve, HEALTH_INTERVAL_MS));
  }
  return false;
}

/**
 * Asks the server to finish, and waits.
 *
 * The message reaches the server's own shutdown path, which stops accepting
 * connections, lets in-flight requests finish and disconnects Prisma. Only if
 * that has not completed within the grace period is the process terminated —
 * and a terminated write is exactly the half-finished dispatch this avoids.
 */
async function stopServer(): Promise<void> {
  const child = serverProcess;
  if (!child) return;
  info('Đang dừng máy chủ Kas...');

  const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
  try {
    child.send({ type: 'shutdown' });
  } catch {
    // No IPC channel (should not happen) — fall through to the timeout kill.
  }

  const timedOut = await Promise.race([
    exited.then(() => false),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(true), SHUTDOWN_GRACE_MS)),
  ]);

  if (timedOut) {
    fault(`Máy chủ không tắt trong ${SHUTDOWN_GRACE_MS / 1000}s — buộc dừng tiến trình.`);
    child.kill();
    await exited;
  }
  serverProcess = null;
}

/* ------------------------------------------------------------------ */
/* Health monitor                                                      */
/* ------------------------------------------------------------------ */

async function sampleHealth(port: number): Promise<HealthSample> {
  const health = await probeHealth(port);
  return {
    serverProcessAlive: serverProcess !== null,
    healthEndpointOk: health !== null,
    databaseOk: health?.databaseOk === true,
    uploadsWritable: directoryWritable(UPLOAD_DIR),
    freeDiskBytes: freeDiskBytes(),
  };
}

/** One monitor tick: sample, decide, act. */
async function monitorTick(port: number): Promise<void> {
  if (stopping) return;
  const verdict = evaluateHealth(await sampleHealth(port), restartsUsed);

  switch (verdict.kind) {
    case 'HEALTHY':
      return;

    case 'DEGRADED':
      // Reported every tick on purpose: a fault that stops being mentioned
      // reads as a fault that went away.
      for (const reason of verdict.reasons) fault(`Cảnh báo: ${healthFaultMessage(reason)}`);
      return;

    case 'RESTART': {
      fault(`${healthFaultMessage(verdict.reason)} Đang khởi động lại một lần...`);
      restartsUsed += 1;
      await stopServer();
      serverProcess = startServer();
      if (await waitForHealth(port)) info('Máy chủ đã hoạt động trở lại sau khi khởi động lại.');
      else fault('Khởi động lại không thành công — máy chủ vẫn không phản hồi.');
      return;
    }

    case 'FATAL':
      fault(fatalMessage(verdict.reason));
      stopMonitor();
      return;
  }
}

function startMonitor(port: number): void {
  // DELIBERATELY REFERENCED. Supervising IS the reason this process exists, so
  // the monitor is what keeps it alive; the awaited never-settling promise at
  // the end of main() holds nothing at all. Without this the runner's liveness
  // would depend on the child's stdio pipes and the control pipe happening to
  // be open, and it would exit silently the moment both closed — leaving a
  // dead supervisor and a hotel with no server and no explanation.
  //
  // `shutdown` clears it, and so does the FATAL verdict; after either, the
  // control pipe keeps the process reachable for `KasService.cmd stop` and the
  // logs stay readable.
  monitorTimer = setInterval(() => {
    void monitorTick(port);
  }, MONITOR_INTERVAL_MS);
}

function stopMonitor(): void {
  if (monitorTimer) clearInterval(monitorTimer);
  monitorTimer = null;
}

/* ------------------------------------------------------------------ */
/* Shutdown                                                            */
/* ------------------------------------------------------------------ */

/**
 * The one shutdown path, whatever triggered it.
 *
 * Ctrl+C, closing the console window, Windows shutting down and
 * `KasService.cmd stop` all arrive here, so there is one ordering to get right
 * rather than four: stop watching, ask the server to finish, release the lock,
 * close the control channel, exit.
 */
async function shutdown(reason: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  info(`Đang tắt Kas (${reason}).`);

  stopMonitor();
  await stopServer();
  clearLock();
  controlServer?.close();

  info('Kas đã tắt.');
  process.exit(0);
}

function registerShutdownHandlers(): void {
  // SIGINT is Ctrl+C. SIGBREAK is Ctrl+Break and, importantly on Windows, what
  // arrives when the console window is closed or the machine shuts down while
  // a console is attached. SIGTERM is listed for completeness; on Windows
  // nothing external can deliver it, which is why the pipe exists.
  for (const signal of ['SIGINT', 'SIGBREAK', 'SIGTERM', 'SIGHUP'] as const) {
    process.on(signal, () => void shutdown(signal));
  }
}

/* ------------------------------------------------------------------ */
/* Entry point                                                         */
/* ------------------------------------------------------------------ */

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<number> {
  // The server's own loader reads .env from the repository root; the runner
  // does the same so its checks see the configuration the server will.
  const dotenv = await import('dotenv');
  dotenv.config({ path: path.join(ROOT, '.env') });

  const port = Number.parseInt(process.env.PORT ?? '3001', 10);
  const mode = parseMode(argv);
  logs = openLogs(LOG_DIR);

  // `--stop` is not a startup: it asks an already-running runner to finish.
  if (argv.includes('--stop')) {
    const stopped = await requestStop(port);
    info(stopped ? 'Đã gửi yêu cầu dừng tới Kas.' : 'Không tìm thấy tiến trình Kas nào đang chạy.');
    return stopped ? 0 : 1;
  }

  for (const line of startupBanner(mode, process.env.NODE_ENV)) startupLine(line);

  const environment = await readEnvironment(port);
  for (const line of describeEnvironment(environment)) startupLine(`  ${line}`);

  // Single instance, before anything is started or written.
  const lockDecision = decideLock({
    lock: readLock(),
    lockPidAlive: (() => {
      const lock = readLock();
      return lock !== null && pidAlive(lock.pid);
    })(),
    portServesKas: environment.portServesKas,
  });
  startupLine(lockMessage(lockDecision));

  if (lockDecision.kind === 'ATTACH' || lockDecision.kind === 'ALREADY_STARTING') {
    if (shouldOpenBrowser(mode) && lockDecision.kind === 'ATTACH') openBrowser(appUrl(port));
    return 0;
  }
  if (lockDecision.kind === 'CLEAR_STALE_LOCK') clearLock();

  const action = decideAction(environment);
  if (action.kind === 'ABORT') {
    fault(`KHÔNG THỂ KHỞI ĐỘNG: ${problemMessage(action.problem, environment)}`);
    return 1;
  }

  writeLock(port, mode);
  registerShutdownHandlers();
  listenForControl(port);

  serverProcess = startServer();

  if (!(await waitForHealth(port))) {
    fault('Máy chủ không phản hồi trong thời gian chờ. Xem logs/server.log và logs/error.log.');
    await stopServer();
    clearLock();
    return 1;
  }

  startupLine('Máy chủ đã sẵn sàng.');
  if (shouldOpenBrowser(mode)) openBrowser(action.url);
  startMonitor(port);

  info(
    mode === 'SERVICE'
      ? `Kas đang chạy nền và tự theo dõi (tối đa ${MAX_RESTARTS} lần khởi động lại).`
      : 'Kas đang chạy. Đóng cửa sổ này để tắt ứng dụng.',
  );

  // Hold the process open. In interactive mode closing the window ends it; in
  // service mode `KasService.cmd stop` does.
  await new Promise<void>(() => undefined);
  return 0;
}

// Executed directly by Kas.cmd and KasService.cmd.
if (require.main === module) {
  main()
    .then((code) => {
      if (code !== 0) process.exitCode = code;
    })
    .catch((error: unknown) => {
      // Recovery (Feature I): the reason AND the stack, in a file that survives
      // the console window closing. Previous logs are appended to, never
      // replaced — the run before the failure is usually where the cause is.
      const err = error as Error;
      try {
        logs?.error.append(stamp(`Lỗi không mong đợi khi khởi động: ${err.message}`));
        logs?.error.append(stamp(err.stack ?? '(không có stack)'));
      } catch {
        // Logging the failure must not become the failure.
      }
      // eslint-disable-next-line no-console
      console.error(`Lỗi không mong đợi: ${err.message}`);
      process.exitCode = 1;
    });
}
