import path from 'node:path';
import { defineConfig } from 'vitest/config';

// Tests run against their own throwaway SQLite file so development data is
// never touched. The absolute path avoids ambiguity about which cwd Prisma
// resolves a relative file: URL from.
const testDbPath = path.join(__dirname, '.tmp', 'test.db');

export default defineConfig({
  test: {
    environment: 'node',
    globalSetup: ['./tests/setup/globalSetup.ts'],
    // SQLite is a single file with writer locking; serial runs keep the
    // constraint tests deterministic.
    fileParallelism: false,
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: `file:${testDbPath.split(path.sep).join('/')}`,
      SESSION_SECRET: 'test-session-secret-value',
    },
    include: ['tests/**/*.test.ts'],
  },
});
