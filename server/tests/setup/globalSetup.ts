import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const serverRoot = path.resolve(__dirname, '../..');
const repoRoot = path.resolve(serverRoot, '..');
const tmpDir = path.join(serverRoot, '.tmp');
const testDbFile = path.join(tmpDir, 'test.db');

/**
 * Resolves Prisma's JavaScript entry point so it can be run with the current
 * node binary. Spawning the `npx.cmd` shim instead fails with EINVAL on
 * Windows under Node 22+, which blocks .cmd files from spawnSync.
 */
function resolvePrismaEntry(): string {
  const packageJsonPath = require.resolve('prisma/package.json', { paths: [repoRoot] });
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as {
    bin?: string | Record<string, string>;
  };
  const relativeBin =
    typeof packageJson.bin === 'string' ? packageJson.bin : packageJson.bin?.prisma;

  if (!relativeBin) {
    throw new Error('Could not resolve the prisma CLI entry point from prisma/package.json');
  }

  return path.join(path.dirname(packageJsonPath), relativeBin);
}

/**
 * Rebuilds the test database from the committed migrations before the suite
 * runs. Using `migrate deploy` (not `db push`) means the tests exercise the
 * real migration files, so a broken migration fails the suite.
 */
export default function setup(): void {
  fs.mkdirSync(tmpDir, { recursive: true });

  for (const file of [testDbFile, `${testDbFile}-journal`]) {
    if (fs.existsSync(file)) fs.rmSync(file);
  }

  // Start each run with an empty proof-upload dir so uploaded fixtures never
  // accumulate between runs (must match PROOF_UPLOAD_DIR in vitest.config.ts).
  const proofDir = path.join(serverRoot, '.tmp', 'proof-uploads');
  fs.rmSync(proofDir, { recursive: true, force: true });
  fs.mkdirSync(proofDir, { recursive: true });

  const databaseUrl = `file:${testDbFile.split(path.sep).join('/')}`;

  execFileSync(
    process.execPath,
    [
      resolvePrismaEntry(),
      'migrate',
      'deploy',
      '--schema',
      path.join(repoRoot, 'prisma', 'schema.prisma'),
    ],
    {
      cwd: repoRoot,
      env: { ...process.env, DATABASE_URL: databaseUrl },
      stdio: 'pipe',
    },
  );
}
