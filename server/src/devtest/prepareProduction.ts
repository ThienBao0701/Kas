/**
 * Official-launch reset: wipes ALL operational/business data (demo or real) while
 * preserving the schema, the 8 branches, the Admin account, roles and
 * configuration — so the system can open clean for real use.
 *
 * Safety:
 *  - Refuses to run in production unless an explicit override flag is supplied.
 *  - The caller must pass `confirmed: true` (the CLI gates this behind an
 *    interactive phrase).
 *  - Backs up the SQLite file + upload dirs + a manifest BEFORE any deletion, and
 *    aborts if the backup fails. Physical uploads are removed only after backup.
 *  - Idempotent: a second run leaves the system safely empty.
 *
 * This module never runs itself; it is invoked by the CLI wrapper or tests.
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { PrismaClient } from '@prisma/client';
import { prisma as defaultPrisma } from '../db/prisma';
import { isProduction } from '../config/env';
import { TEST_RECEPTIONIST_USERNAME } from './constants';
import { normalizeUsername } from '../auth/username';

export interface ResetOptions {
  /** The caller (CLI) has confirmed the interactive phrase. */
  confirmed: boolean;
  /** Absolute path to the SQLite DB file to back up (skipped if it doesn't exist). */
  dbFilePath?: string | null;
  /** Absolute upload directories to back up + clear (proof/issue photos). */
  uploadDirs?: string[];
  /** Where timestamped backups are written. */
  backupRoot: string;
  /** Whether to perform the backup (always true for the real reset). */
  doBackup?: boolean;
  /** Allow running even when NODE_ENV=production (explicit launch flag). */
  productionOverride?: boolean;
  now?: Date;
  client?: PrismaClient;
}

export interface ResetManifest {
  backupDir: string | null;
  before: Record<string, number>;
  after: Record<string, number>;
  testReceptionist: 'disabled' | 'absent';
  branchesPreserved: number;
  adminsPreserved: number;
}

async function counts(client: PrismaClient): Promise<Record<string, number>> {
  const [bookings, rooms, nights, proofs, analyses, comparisons, notifications, issues, sessions, batches, statusHistory] = await Promise.all([
    client.booking.count(),
    client.bookingRoom.count(),
    client.bookingNightPrice.count(),
    client.bookingCreationProof.count(),
    client.bookingProofAnalysis.count(),
    client.bookingProofComparison.count(),
    client.notification.count(),
    client.hotelIssue.count(),
    client.session.count(),
    client.demoDataBatch.count(),
    client.bookingStatusHistory.count(),
  ]);
  return { bookings, rooms, nights, proofs, analyses, comparisons, notifications, issues, sessions, batches, statusHistory };
}

function timestamp(now: Date): string {
  return now.toISOString().replace(/[:.]/g, '').replace('T', 'T').slice(0, 15);
}

/** Empties a directory's contents without removing the directory itself. */
async function emptyDir(dir: string): Promise<void> {
  let entries: string[] = [];
  try {
    entries = await fsp.readdir(dir);
  } catch {
    return; // dir doesn't exist — nothing to do
  }
  for (const e of entries) await fsp.rm(path.join(dir, e), { recursive: true, force: true });
}

export async function prepareForProduction(opts: ResetOptions): Promise<ResetManifest> {
  const client = opts.client ?? defaultPrisma;
  const now = opts.now ?? new Date();
  const doBackup = opts.doBackup ?? true;

  if (!opts.confirmed) throw new Error('Reset not confirmed.');
  if (isProduction && !opts.productionOverride) {
    throw new Error('Refusing to run the official reset in production without an explicit override flag.');
  }

  const before = await counts(client);

  // --- Backup FIRST (abort on failure) ---
  let backupDir: string | null = null;
  if (doBackup) {
    backupDir = path.join(opts.backupRoot, `pre-official-${timestamp(now)}`);
    await fsp.mkdir(backupDir, { recursive: true });
    if (opts.dbFilePath && fs.existsSync(opts.dbFilePath)) {
      await fsp.copyFile(opts.dbFilePath, path.join(backupDir, 'data.db'));
    }
    const uploadsBackup = path.join(backupDir, 'uploads');
    for (const dir of opts.uploadDirs ?? []) {
      if (fs.existsSync(dir)) {
        await fsp.cp(dir, path.join(uploadsBackup, path.basename(dir)), { recursive: true });
      }
    }
    await fsp.writeFile(path.join(backupDir, 'manifest.json'), JSON.stringify({ createdAt: now.toISOString(), before }, null, 2));
  }

  // --- Delete all operational data (safe dependency order) ---
  // Bookings cascade to rooms/nights/proofs/analyses/comparisons/history/booking
  // notifications; the explicit deletes below cover issue/standalone rows too.
  await client.bookingProofComparison.deleteMany({});
  await client.bookingProofAnalysis.deleteMany({});
  await client.bookingCreationProof.deleteMany({});
  await client.bookingNightPrice.deleteMany({});
  await client.bookingRoom.deleteMany({});
  await client.bookingStatusHistory.deleteMany({});
  await client.notification.deleteMany({});
  await client.booking.deleteMany({});
  await client.hotelIssue.deleteMany({});
  await client.demoDataBatch.deleteMany({});
  await client.session.deleteMany({}); // zero active sessions

  // Disable the dev test receptionist (never auto-create production receptionists).
  const testUser = await client.user.findUnique({ where: { username: normalizeUsername(TEST_RECEPTIONIST_USERNAME) } });
  let testReceptionist: ResetManifest['testReceptionist'] = 'absent';
  if (testUser) {
    await client.user.update({ where: { id: testUser.id }, data: { active: false } });
    testReceptionist = 'disabled';
  }

  // --- Remove physical uploads only AFTER a successful backup ---
  for (const dir of opts.uploadDirs ?? []) await emptyDir(dir);

  const after = await counts(client);
  const branchesPreserved = await client.branch.count();
  const adminsPreserved = await client.user.count({ where: { role: 'ADMIN' } });

  if (backupDir) {
    await fsp.writeFile(path.join(backupDir, 'manifest.json'), JSON.stringify({ createdAt: now.toISOString(), before, after, testReceptionist, branchesPreserved, adminsPreserved }, null, 2));
  }

  return { backupDir, before, after, testReceptionist, branchesPreserved, adminsPreserved };
}
