import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { env } from '../config/env';

/**
 * bcrypt work factor. 10 (the long-standing default) in production; the test
 * environment lowers it via BCRYPT_COST so the pure-JS implementation does not
 * dominate — and occasionally exceed a test's timeout under VM CPU contention.
 */
const BCRYPT_ROUNDS = env.BCRYPT_COST;

/**
 * Internal password policy (Phase 2 spec §5): at least 8 characters, with at
 * least one letter and one number. The 72-character ceiling matches bcrypt's
 * effective input limit, so nothing is silently truncated.
 */
export const passwordSchema = z
  .string()
  .min(8, 'Mật khẩu phải có ít nhất 8 ký tự.')
  .max(72, 'Mật khẩu không được vượt quá 72 ký tự.')
  .refine((value) => /[A-Za-z]/.test(value), {
    message: 'Mật khẩu phải chứa ít nhất một chữ cái.',
  })
  .refine((value) => /[0-9]/.test(value), {
    message: 'Mật khẩu phải chứa ít nhất một chữ số.',
  });

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

/**
 * A precomputed hash of a random value, compared against when a login names a
 * user that does not exist. Doing the same bcrypt work in both branches keeps
 * login timing from leaking whether a username exists.
 */
const DUMMY_HASH = bcrypt.hashSync('user-does-not-exist-placeholder', BCRYPT_ROUNDS);

export async function verifyAgainstDummy(plain: string): Promise<void> {
  await bcrypt.compare(plain, DUMMY_HASH);
}
