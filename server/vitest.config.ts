import path from 'node:path';
import { defineConfig } from 'vitest/config';

// Tests run against their own throwaway SQLite file so development data is
// never touched. The absolute path avoids ambiguity about which cwd Prisma
// resolves a relative file: URL from.
const testDbPath = path.join(__dirname, '.tmp', 'test.db');
// Proof screenshots land in a throwaway dir so the suite never writes into the
// real server/uploads tree.
const testProofDir = path.join(__dirname, '.tmp', 'proof-uploads');

export default defineConfig({
  test: {
    environment: 'node',
    globalSetup: ['./tests/setup/globalSetup.ts'],
    // SQLite is a single file with writer locking; serial runs keep the
    // constraint tests deterministic.
    fileParallelism: false,
    // Generous margin: this can run on a CPU-contended VM where a bcrypt-backed
    // login is occasionally slow. Well above real durations, still catches hangs.
    testTimeout: 20000,
    // beforeEach resets the DB, re-seeds branches and logs in several agents;
    // under full-suite load on a contended VM that can momentarily exceed the
    // 10s default. Match the test timeout so a slow reset is not a false failure.
    hookTimeout: 20000,
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: `file:${testDbPath.split(path.sep).join('/')}`,
      SESSION_SECRET: 'test-session-secret-value',
      // Cheapest valid bcrypt cost so hashing does not dominate the suite.
      BCRYPT_COST: '4',
      PROOF_UPLOAD_DIR: testProofDir,
    },
    include: ['tests/**/*.test.ts'],
  },
});
