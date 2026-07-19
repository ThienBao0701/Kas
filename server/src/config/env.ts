import path from 'node:path';
import dotenv from 'dotenv';
import { z } from 'zod';

// The single .env lives at the repository root, while this code runs with the
// server workspace as cwd (src in dev, dist in production) — resolve explicitly.
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().max(65535).default(3001),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required (example: file:./data.db)'),

  // Consumed from Phase 2 onwards; validated here so a misconfigured
  // deployment fails at startup rather than at the first login attempt.
  SESSION_SECRET: z.string().min(16, 'SESSION_SECRET must be at least 16 characters').optional(),
  INITIAL_ADMIN_USERNAME: z.string().min(1).optional(),
  INITIAL_ADMIN_PASSWORD: z.string().min(1).optional(),
  INITIAL_ADMIN_FULL_NAME: z.string().min(1).optional(),
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
