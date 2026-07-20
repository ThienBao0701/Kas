import type { RequestHandler } from 'express';
import { ApiError } from '../lib/errors';
import { isProduction } from '../config/env';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Defense-in-depth CSRF mitigation.
 *
 * The session cookie is SameSite=Lax, which already stops other sites from
 * making cookie-bearing state-changing requests in a browser — but that is not
 * a full CSRF defense on its own. In production the client is served from the
 * same origin as the API, so any state-changing request whose Origin/Referer
 * names a different host is illegitimate and rejected here.
 *
 * Enforced only in production: local development proxies the client dev server
 * and tests use a non-browser client, neither of which sends a matching Origin.
 */
export const sameOriginCheck: RequestHandler = (req, _res, next) => {
  if (!isProduction || SAFE_METHODS.has(req.method)) {
    next();
    return;
  }

  const host = req.headers.host;
  const source = req.headers.origin ?? req.headers.referer;
  // Non-browser / same-origin internal callers send no Origin or Referer.
  if (!host || !source) {
    next();
    return;
  }

  try {
    if (new URL(source).host !== host) {
      next(ApiError.forbidden('Yêu cầu bị từ chối: khác nguồn gốc.'));
      return;
    }
  } catch {
    next(ApiError.forbidden('Yêu cầu bị từ chối: nguồn gốc không hợp lệ.'));
    return;
  }
  next();
};
