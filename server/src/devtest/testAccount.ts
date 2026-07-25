/**
 * Creates or reuses the dedicated dev-test receptionist. Development only.
 */
import type { PrismaClient } from '@prisma/client';
import { prisma as defaultPrisma } from '../db/prisma';
import { hashPassword } from '../auth/password';
import { normalizeUsername } from '../auth/username';
import { ApiError } from '../lib/errors';
import { TEST_RECEPTIONIST_FULLNAME, TEST_RECEPTIONIST_PASSWORD, TEST_RECEPTIONIST_USERNAME } from './constants';

/**
 * Ensures the `reception_test` account exists (RECEPTIONIST, active, no forced
 * password change). Its permanent DB branch is the first active branch — dev
 * branch switching overrides the *effective* branch per session without ever
 * changing this stored assignment. Re-enables the account if it was disabled.
 */
export async function ensureTestReceptionist(client: PrismaClient = defaultPrisma) {
  const username = normalizeUsername(TEST_RECEPTIONIST_USERNAME);
  const firstBranch = await client.branch.findFirst({ where: { active: true }, orderBy: { id: 'asc' } });
  if (!firstBranch) throw ApiError.validation('Chưa có chi nhánh để gán tài khoản test.');

  const existing = await client.user.findUnique({ where: { username } });
  if (existing) {
    return client.user.update({
      where: { id: existing.id },
      data: { active: true, role: 'RECEPTIONIST', mustChangePassword: false, branchId: existing.branchId ?? firstBranch.id },
      include: { branch: true },
    });
  }
  return client.user.create({
    data: {
      username,
      passwordHash: await hashPassword(TEST_RECEPTIONIST_PASSWORD),
      fullName: TEST_RECEPTIONIST_FULLNAME,
      role: 'RECEPTIONIST',
      branchId: firstBranch.id,
      active: true,
      mustChangePassword: false,
    },
    include: { branch: true },
  });
}
