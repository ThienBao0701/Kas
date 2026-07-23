import path from 'node:path';
import dotenv from 'dotenv';
import { z } from 'zod';

// The single .env lives at the repository root, while this code runs with the
// server workspace as cwd (src in dev, dist in production) — resolve explicitly.
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

/**
 * Parses the string forms an environment variable can take for a boolean
 * ("true"/"false"/"1"/"0") without z.coerce.boolean()'s trap of treating the
 * literal string "false" as truthy.
 */
const booleanFromEnv = z
  .union([z.boolean(), z.string()])
  .transform((value) => {
    if (typeof value === 'boolean') return value;
    return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
  });

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().max(65535).default(3001),
    DATABASE_URL: z.string().min(1, 'DATABASE_URL is required (example: file:./data.db)'),

    // Sessions. SESSION_SECRET signs the session cookie; a weak or shared
    // secret undermines every login, so it is required everywhere and must be
    // reasonably long.
    SESSION_SECRET: z.string().min(16, 'SESSION_SECRET must be at least 16 characters'),
    // Send the session cookie only over HTTPS. False in local development; set
    // true in production when the app is served over TLS.
    SESSION_COOKIE_SECURE: booleanFromEnv.default(false),
    // Session lifetime. Also the rolling window that each request refreshes.
    SESSION_MAX_AGE_HOURS: z.coerce.number().int().positive().max(24 * 30).default(12),

    // Initial administrator, created once at startup when no admin exists.
    // Optional here so a fresh checkout can boot; enforced in production below.
    INITIAL_ADMIN_USERNAME: z.string().min(1).optional(),
    INITIAL_ADMIN_PASSWORD: z.string().min(1).optional(),
    INITIAL_ADMIN_FULL_NAME: z.string().min(1).optional(),

    // Login rate limiting. Kept configurable so an operator can loosen or
    // tighten it without a code change.
    LOGIN_RATE_LIMIT_MAX: z.coerce.number().int().positive().max(1000).default(10),
    LOGIN_RATE_LIMIT_WINDOW_MINUTES: z.coerce.number().int().positive().max(1440).default(15),

    // bcrypt work factor. 10 is a sound default for production; the test suite
    // lowers it so the pure-JS implementation does not dominate run time.
    BCRYPT_COST: z.coerce.number().int().min(4).max(15).default(10),

    // Where proof-of-creation screenshots are stored on the server filesystem.
    // Only metadata + a safe relative path live in SQLite; never the image bytes.
    // Relative values are resolved against the repository root.
    PROOF_UPLOAD_DIR: z.string().min(1).default('server/uploads/booking-proofs'),
  })
  .superRefine((value, ctx) => {
    // In production a missing initial-admin variable must never silently create
    // a predictable default account, so fail configuration validation instead.
    if (value.NODE_ENV === 'production') {
      const required: Array<keyof typeof value> = [
        'INITIAL_ADMIN_USERNAME',
        'INITIAL_ADMIN_PASSWORD',
        'INITIAL_ADMIN_FULL_NAME',
      ];
      for (const key of required) {
        if (!value[key]) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [key],
            message: `${key} is required in production`,
          });
        }
      }
    }
  });

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(
      `Invalid environment configuration:\n${details}\n\n` +
        'Copy .env.example to .env and fill in the values.',
    );
  }

  return parsed.data;
}

export const env = loadEnv();

export const isProduction = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';
export const isDevelopment = env.NODE_ENV === 'development';

// Absolute proof-upload directory. A relative PROOF_UPLOAD_DIR is resolved from
// the repository root (this file lives at server/src/config, so up three levels).
const repoRoot = path.resolve(__dirname, '../../..');
export const PROOF_UPLOAD_DIR = path.isAbsolute(env.PROOF_UPLOAD_DIR)
  ? env.PROOF_UPLOAD_DIR
  : path.resolve(repoRoot, env.PROOF_UPLOAD_DIR);
