import { Router } from 'express';
import { checkDatabase } from '../db/prisma';
import { ApiError } from '../lib/errors';

export const healthRouter: Router = Router();

/**
 * GET /api/health
 *
 * Reports 200 only when the database actually answers a query; a process that
 * is up but cannot reach SQLite is not healthy and returns 503.
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
