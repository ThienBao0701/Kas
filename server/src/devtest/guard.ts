/**
 * Guards for the developer test tools. When the tools are disabled (the default,
 * and always in production) every dev-test endpoint responds 404 — as if it did
 * not exist — so the surface is invisible and unusable outside development.
 */
import type { RequestHandler } from 'express';
import { devToolsEnabled } from '../config/env';
import { ApiError } from '../lib/errors';
import { TEST_RECEPTIONIST_USERNAME } from './constants';
import type { UserWithBranch } from '../auth/serialize';

// A test-only override so the disabled/production gate can be exercised without
// reloading the frozen env. Null = use the real configured value.
let override: boolean | null = null;

/** Whether the developer tools are currently active (config value or test override). */
export function devToolsActive(): boolean {
  return override ?? devToolsEnabled;
}

/** Test-only: force the dev-tools gate on/off. Always reset in teardown. */
export function setDevToolsOverride(value: boolean | null): void {
  override = value;
}

/** 404s unless the developer tools are enabled (non-production + explicit flag). */
export const requireDevTools: RequestHandler = (_req, _res, next) => {
  if (!devToolsActive()) {
    next(ApiError.notFound('Không tìm thấy tài nguyên.'));
    return;
  }
  next();
};

/** True only for the dedicated test-receptionist account. */
export function isTestReceptionist(user: Pick<UserWithBranch, 'username' | 'role'>): boolean {
  return user.role === 'RECEPTIONIST' && user.username === TEST_RECEPTIONIST_USERNAME;
}
