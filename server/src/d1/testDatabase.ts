/**
 * Resolves the PostgreSQL URL the automated test suite runs against.
 *
 * ISOLATION MODEL (D.1 §7 "prefer isolated temporary schemas"): the suite does
 * NOT share the `public` schema of `kas_d1_test`. It gets its own schema
 * (`kas_vitest` by default), which means:
 *
 *   - the destructive restore drill, which drops and recreates `public`,
 *     cannot destroy a running test suite (and vice versa);
 *   - the transferred fixture data in `public` stays intact while tests
 *     truncate their own tables freely;
 *   - dropping the whole test schema between runs is cheap and total, which is
 *     the PostgreSQL equivalent of deleting the old SQLite test.db.
 *
 * The password is never hard-coded: the URL comes from `.env.d1.local`, or
 * from `KAS_TEST_DATABASE_URL` when a developer or CI wants a different
 * target. Nothing here logs the URL.
 */
import fs from 'node:fs';
import path from 'node:path';
import { parseEnvFile } from './localEnv';

/**
 * Typed as `string`, not as the literal, on purpose: it is a configuration
 * value that a future change could point at something dangerous, and the
 * safety check in globalSetup ("must not be public") has to stay reachable
 * rather than being compiled away as provably-impossible.
 */
export const TEST_SCHEMA: string = 'kas_vitest';

/**
 * Adds or replaces the `schema` parameter of a PostgreSQL URL.
 *
 * `URL` preserves the percent-encoding of the password verbatim, so a password
 * containing reserved characters survives the round trip unchanged.
 */
export function withSchema(url: string, schema: string): string {
  const parsed = new URL(url);
  parsed.searchParams.set('schema', schema);
  return parsed.toString();
}

export class MissingTestDatabaseError extends Error {
  constructor(file: string) {
    super(
      [
        'Bộ kiểm thử cần một cơ sở dữ liệu PostgreSQL.',
        '',
        'Kể từ Phase D.1, các kiểm thử chạy trên PostgreSQL thật thay vì SQLite,',
        `trong schema riêng "${TEST_SCHEMA}" của cơ sở dữ liệu kas_d1_test.`,
        '',
        'Hãy làm một trong hai cách:',
        `  1) Tạo ${file} với đúng một dòng:`,
        '     DATABASE_URL=postgresql://kas_app:<mật-khẩu-đã-mã-hóa>@127.0.0.1:5432/kas_d1_test',
        '  2) Hoặc đặt biến môi trường KAS_TEST_DATABASE_URL.',
        '',
        'Ký tự đặc biệt trong mật khẩu phải được percent-encode.',
        'Không bao giờ commit tệp này (đã nằm trong .gitignore).',
      ].join('\n'),
    );
    this.name = 'MissingTestDatabaseError';
  }
}

/**
 * The base URL (no schema override) the suite should use.
 * Throws a long, actionable message rather than failing deep inside Prisma.
 */
export function resolveTestBaseUrl(repoRoot: string): string {
  const explicit = process.env.KAS_TEST_DATABASE_URL;
  if (explicit && explicit.length > 0) return explicit;

  const file = path.join(repoRoot, '.env.d1.local');
  if (!fs.existsSync(file)) throw new MissingTestDatabaseError(file);

  const parsed = parseEnvFile(fs.readFileSync(file, 'utf8'));
  const url = parsed.DATABASE_URL;
  if (!url) throw new MissingTestDatabaseError(file);
  return url;
}

/** The URL the suite connects with: the base URL pinned to the test schema. */
export function resolveTestDatabaseUrl(repoRoot: string, schema: string = TEST_SCHEMA): string {
  return withSchema(resolveTestBaseUrl(repoRoot), schema);
}
