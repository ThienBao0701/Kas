import fs from 'node:fs';
import { Router } from 'express';
import { checkDatabase } from '../db/prisma';
import { ApiError } from '../lib/errors';
import {
  BACKUP_DIR,
  ISSUE_UPLOAD_DIR,
  PROOF_UPLOAD_DIR,
  devToolsEnabled,
  env,
  isProduction,
} from '../config/env';

export const healthRouter: Router = Router();

/**
 * GET /api/health — liveness.
 *
 * Reports 200 only when the database actually answers a query; a process that
 * is up but cannot reach its database is not healthy and returns 503. This is
 * what the container health check and the reverse proxy poll.
 */
healthRouter.get('/health', async (_req, res, next) => {
  try {
    const startedAt = Date.now();
    const databaseOk = await checkDatabase();
    const databaseLatencyMs = Date.now() - startedAt;

    if (!databaseOk) {
      next(new ApiError('SERVICE_UNAVAILABLE', 'Không kết nối được cơ sở dữ liệu.'));
      return;
    }

    res.json({
      status: 'ok',
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
      database: {
        connected: true,
        latencyMs: databaseLatencyMs,
      },
    });
  } catch (error) {
    next(error);
  }
});

/** One dependency the process needs before it can serve real traffic. */
interface ReadinessCheck {
  name: string;
  ok: boolean;
  /** A short, operator-facing reason. Never a path, credential or stack trace. */
  detail?: string;
}

/** A directory must exist AND be writable — a read-only volume fails uploads. */
function checkWritableDir(name: string, dir: string): ReadinessCheck {
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.accessSync(dir, fs.constants.W_OK);
    return { name, ok: true };
  } catch {
    // Deliberately no path in the message: readiness is often public-ish.
    return { name, ok: false, detail: 'không ghi được' };
  }
}

/**
 * GET /api/ready — readiness.
 *
 * Verifies the dependencies the app needs to actually do its job: the database
 * answers, the persistent upload/backup directories exist and are writable, and
 * the production configuration is coherent. Returns 503 with a per-check list
 * when anything fails.
 *
 * The payload deliberately contains NO secrets, NO filesystem paths and NO
 * database credentials — only check names and a short reason.
 */
healthRouter.get('/ready', async (_req, res) => {
  const checks: ReadinessCheck[] = [];

  const startedAt = Date.now();
  const databaseOk = await checkDatabase();
  checks.push({
    name: 'database',
    ok: databaseOk,
    ...(databaseOk ? {} : { detail: 'không phản hồi' }),
  });

  checks.push(checkWritableDir('proofUploads', PROOF_UPLOAD_DIR));
  checks.push(checkWritableDir('issueUploads', ISSUE_UPLOAD_DIR));
  checks.push(checkWritableDir('backups', BACKUP_DIR));

  // Configuration coherence. `env` already refused to load if a required value
  // was missing, so this is the last line of defence against a deployment that
  // somehow reached production with the developer tools armed.
  const configOk = !isProduction || (!devToolsEnabled && env.SESSION_COOKIE_SECURE && Boolean(env.APP_ORIGIN));
  checks.push({
    name: 'configuration',
    ok: configOk,
    ...(configOk ? {} : { detail: 'cấu hình production không hợp lệ' }),
  });

  const ready = checks.every((c) => c.ok);
  res.status(ready ? 200 : 503).json({
    status: ready ? 'ready' : 'not-ready',
    timestamp: new Date().toISOString(),
    databaseLatencyMs: Date.now() - startedAt,
    checks,
  });
});
