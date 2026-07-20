import type { PrismaClient } from '@prisma/client';
import { prisma as defaultPrisma } from '../db/prisma';
import { env, isProduction } from '../config/env';
import { hashPassword } from './password';
import { normalizeUsername } from './username';

export interface InitialAdminConfig {
  username?: string;
  password?: string;
  fullName?: string;
}

export interface BootstrapResult {
  created: boolean;
  reason: 'created' | 'exists' | 'missing-config';
  adminId?: number;
}

/**
 * Creates the initial ADMIN account exactly once.
 *
 * - Runs safely at every startup: if an account with the configured username
 *   already exists, its password is never touched.
 * - Production: missing credentials throw, so no predictable default account is
 *   ever silently created.
 * - Development/test: missing credentials are a documented no-op (nothing is
 *   invented). Tests pass explicit values via `config`.
 */
export async function ensureInitialAdmin(
  client: PrismaClient = defaultPrisma,
  config: InitialAdminConfig = {
    username: env.INITIAL_ADMIN_USERNAME,
    password: env.INITIAL_ADMIN_PASSWORD,
    fullName: env.INITIAL_ADMIN_FULL_NAME,
  },
  options: { production?: boolean } = { production: isProduction },
): Promise<BootstrapResult> {
  const { username, password, fullName } = config;

  if (!username || !password || !fullName) {
    if (options.production) {
      throw new Error(
        'Initial admin bootstrap failed: INITIAL_ADMIN_USERNAME, ' +
          'INITIAL_ADMIN_PASSWORD and INITIAL_ADMIN_FULL_NAME are all required in production.',
      );
    }
    // Safe behavior outside production: never invent a predictable account.
    return { created: false, reason: 'missing-config' };
  }

  const normalized = normalizeUsername(username);

  const existing = await client.user.findUnique({ where: { username: normalized } });
  if (existing) {
    // Never overwrite an existing account's password on later restarts.
    return { created: false, reason: 'exists', adminId: existing.id };
  }

  const admin = await client.user.create({
    data: {
      username: normalized,
      passwordHash: await hashPassword(password),
      fullName,
      role: 'ADMIN',
      branchId: null,
      active: true,
      mustChangePassword: true,
    },
  });

  return { created: true, reason: 'created', adminId: admin.id };
}
