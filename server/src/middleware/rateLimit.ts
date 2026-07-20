import rateLimit from 'express-rate-limit';
import type { RequestHandler } from 'express';
import { env } from '../config/env';
import { ApiError } from '../lib/errors';

/**
 * Rate limiter for the login endpoint only — deliberately not applied to the
 * booking APIs, which are trusted internal traffic. A fresh instance is created
 * per app so each test file (and the rate-limit test in particular) gets its
 * own counter state and cannot make sibling tests flaky.
 */
export function createLoginRateLimiter(): RequestHandler {
  return rateLimit({
    windowMs: env.LOGIN_RATE_LIMIT_WINDOW_MINUTES * 60 * 1000,
    limit: env.LOGIN_RATE_LIMIT_MAX,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    // Route the limit breach through the shared API error format (429).
    handler: (_req, _res, next) => {
      next(
        new ApiError(
          'RATE_LIMITED',
          'Bạn đã thử đăng nhập quá nhiều lần. Vui lòng thử lại sau ít phút.',
        ),
      );
    },
  });
}
