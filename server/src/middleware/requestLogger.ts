import type { NextFunction, Request, Response } from 'express';

const ESC = String.fromCharCode(27);
const RESET = `${ESC}[0m`;
const DIM = `${ESC}[2m`;
const GREEN = `${ESC}[32m`;
const YELLOW = `${ESC}[33m`;
const RED = `${ESC}[31m`;

function statusColor(status: number): string {
  if (status >= 500) return RED;
  if (status >= 400) return YELLOW;
  return GREEN;
}

/**
 * Compact one-line request log for development.
 * Not mounted in production or during tests to keep output clean.
 */
export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const startedAt = process.hrtime.bigint();

  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    const color = statusColor(res.statusCode);
    // eslint-disable-next-line no-console
    console.log(
      `${DIM}${new Date().toISOString()}${RESET} ` +
        `${req.method} ${req.originalUrl} ` +
        `${color}${res.statusCode}${RESET} ` +
        `${DIM}${durationMs.toFixed(1)}ms${RESET}`,
    );
  });

  next();
}
