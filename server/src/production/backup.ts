/**
 * Consistency-aware production backup (SQLite pilot).
 *
 * The database is captured with SQLite's `VACUUM INTO`, which writes a fully
 * checkpointed, self-contained copy of a **live** database from inside a read
 * transaction. That is the important detail: plainly copying `data.db` while the
 * app is running can capture a torn page set and leaves the `-wal` file's
 * contents behind, so the copy may be unusable. `VACUUM INTO` needs no downtime,
 * needs no `sqlite3` CLI on the host, and produces a single file with no
 * companion `-wal`/`-shm` to keep in sync.
 *
 * Uploads are copied afterwards, then a manifest with SHA-256 checksums, the
 * application version and the deployed commit is written last — so a backup
 * directory without a valid `manifest.json` is by construction incomplete and is
 * rejected by the restore tool.
 *
 * Nothing here prints a secret: DATABASE_URL, session secrets and passwords are
 * never read into the manifest or the log.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { PrismaClient } from '@prisma/client';
import { prisma as defaultPrisma } from '../db/prisma';
import { BACKUP_DIR, ISSUE_UPLOAD_DIR, PROOF_UPLOAD_DIR, sqliteFilePath } from '../config/env';

export const BACKUP_MANIFEST_NAME = 'manifest.json';
export const BACKUP_DB_NAME = 'database.sqlite';
export const BACKUP_FORMAT_VERSION = 1;

export interface BackupOptions {
  /** Root that holds one directory per backup. Defaults to BACKUP_DIR. */
  backupRoot?: string;
  /** Upload directories to include, in manifest order. */
  uploadDirs?: { name: string; dir: string }[];
  /** Keep at most this many backups (oldest deleted first). 0 = keep all. */
  retain?: number;
  now?: Date;
  client?: PrismaClient;
  /** Application release identifier (tag or commit) recorded in the manifest. */
  releaseRef?: string;
}

export interface BackupManifest {
  formatVersion: number;
  createdAt: string;
  appVersion: string;
  releaseRef: string | null;
  database: { file: string; sha256: string; bytes: number; engine: 'sqlite' };
  uploads: { name: string; files: number; bytes: number; sha256: string }[];
  counts: Record<string, number>;
}

export interface BackupResult {
  backupDir: string;
  manifest: BackupManifest;
  prunedBackups: string[];
}

function stamp(now: Date): string {
  return now.toISOString().replace(/[:.]/g, '').replace('Z', '').slice(0, 15);
}

async function sha256OfFile(file: string): Promise<string> {
  const hash = createHash('sha256');
  hash.update(await fsp.readFile(file));
  return hash.digest('hex');
}

/**
 * A stable checksum for a whole directory: every file's relative path and
 * content, in sorted order. Two directories with identical contents hash the
 * same regardless of the order the filesystem happens to list them in.
 */
async function hashDirectory(dir: string): Promise<{ files: number; bytes: number; sha256: string }> {
  const hash = createHash('sha256');
  let files = 0;
  let bytes = 0;

  const walk = async (current: string, prefix: string): Promise<void> => {
    let entries: fs.Dirent[];
    try {
      entries = await fsp.readdir(current, { withFileTypes: true });
    } catch {
      return; // a missing upload directory simply contributes nothing
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(current, entry.name);
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await walk(full, rel);
        continue;
      }
      const content = await fsp.readFile(full);
      hash.update(rel);
      hash.update(content);
      files += 1;
      bytes += content.byteLength;
    }
  };

  await walk(dir, '');
  return { files, bytes, sha256: hash.digest('hex') };
}

async function copyDirectory(from: string, to: string): Promise<void> {
  if (!fs.existsSync(from)) {
    await fsp.mkdir(to, { recursive: true });
    return;
  }
  await fsp.cp(from, to, { recursive: true });
}

/** Row counts recorded for a quick "did the restore land?" comparison. */
async function counts(client: PrismaClient): Promise<Record<string, number>> {
  const [branches, aliases, users, bookings, proofs, issues, notifications] = await Promise.all([
    client.branch.count(),
    client.branchSourceAlias.count(),
    client.user.count(),
    client.booking.count(),
    client.bookingCreationProof.count(),
    client.hotelIssue.count(),
    client.notification.count(),
  ]);
  return { branches, aliases, users, bookings, proofs, issues, notifications };
}

export async function createBackup(options: BackupOptions = {}): Promise<BackupResult> {
  const client = options.client ?? defaultPrisma;
  const now = options.now ?? new Date();
  const backupRoot = options.backupRoot ?? BACKUP_DIR;
  const uploadDirs = options.uploadDirs ?? [
    { name: 'booking-proofs', dir: PROOF_UPLOAD_DIR },
    { name: 'issue-photos', dir: ISSUE_UPLOAD_DIR },
  ];

  const dbFile = sqliteFilePath();
  if (!dbFile) {
    throw new Error('Chỉ hỗ trợ sao lưu SQLite: DATABASE_URL không phải là file: URL.');
  }

  const backupDir = path.join(backupRoot, `backup-${stamp(now)}`);
  await fsp.mkdir(backupDir, { recursive: true });

  // --- Database: a consistent snapshot of the live database ---
  const dbTarget = path.join(backupDir, BACKUP_DB_NAME);
  // VACUUM INTO refuses to overwrite, which is exactly the behaviour we want.
  await client.$executeRawUnsafe(`VACUUM INTO '${dbTarget.replace(/'/g, "''")}'`);

  const dbStat = await fsp.stat(dbTarget);
  const dbHash = await sha256OfFile(dbTarget);

  // --- Uploads ---
  const uploads: BackupManifest['uploads'] = [];
  for (const { name, dir } of uploadDirs) {
    const target = path.join(backupDir, 'uploads', name);
    await copyDirectory(dir, target);
    const digest = await hashDirectory(target);
    uploads.push({ name, ...digest });
  }

  // --- Manifest LAST: its presence is what makes a backup complete ---
  const manifest: BackupManifest = {
    formatVersion: BACKUP_FORMAT_VERSION,
    createdAt: now.toISOString(),
    appVersion: process.env.npm_package_version ?? '0.0.0',
    releaseRef: options.releaseRef ?? process.env.APP_RELEASE_REF ?? null,
    database: { file: BACKUP_DB_NAME, sha256: dbHash, bytes: dbStat.size, engine: 'sqlite' },
    uploads,
    counts: await counts(client),
  };
  await fsp.writeFile(
    path.join(backupDir, BACKUP_MANIFEST_NAME),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );

  return { backupDir, manifest, prunedBackups: await pruneBackups(backupRoot, options.retain ?? 0) };
}

/** Lists backup directories under a root, newest first. */
export async function listBackups(backupRoot: string = BACKUP_DIR): Promise<string[]> {
  let entries: fs.Dirent[];
  try {
    entries = await fsp.readdir(backupRoot, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.isDirectory() && e.name.startsWith('backup-'))
    .map((e) => e.name)
    .sort()
    .reverse();
}

/**
 * Retention: keeps the newest `retain` backups and removes the rest. A retain of
 * 0 keeps everything — deleting backups is never the default.
 */
export async function pruneBackups(backupRoot: string, retain: number): Promise<string[]> {
  if (retain <= 0) return [];
  const all = await listBackups(backupRoot);
  const doomed = all.slice(retain);
  for (const name of doomed) {
    await fsp.rm(path.join(backupRoot, name), { recursive: true, force: true });
  }
  return doomed;
}

export interface VerifyResult {
  ok: boolean;
  problems: string[];
  manifest: BackupManifest | null;
}

/**
 * Validates a backup directory without changing anything: the manifest must
 * parse, its format version must be understood, and every checksum must match.
 * The restore tool refuses to run unless this passes.
 */
export async function verifyBackup(backupDir: string): Promise<VerifyResult> {
  const problems: string[] = [];
  const manifestPath = path.join(backupDir, BACKUP_MANIFEST_NAME);

  let manifest: BackupManifest;
  try {
    manifest = JSON.parse(await fsp.readFile(manifestPath, 'utf8')) as BackupManifest;
  } catch {
    return { ok: false, problems: ['Thiếu hoặc hỏng manifest.json.'], manifest: null };
  }

  if (manifest.formatVersion !== BACKUP_FORMAT_VERSION) {
    problems.push(`Định dạng bản sao lưu không được hỗ trợ: ${String(manifest.formatVersion)}.`);
  }

  const dbPath = path.join(backupDir, manifest.database?.file ?? BACKUP_DB_NAME);
  if (!fs.existsSync(dbPath)) {
    problems.push('Thiếu tệp cơ sở dữ liệu trong bản sao lưu.');
  } else if ((await sha256OfFile(dbPath)) !== manifest.database.sha256) {
    problems.push('Checksum cơ sở dữ liệu không khớp — bản sao lưu đã hỏng.');
  }

  for (const upload of manifest.uploads ?? []) {
    const dir = path.join(backupDir, 'uploads', upload.name);
    const digest = await hashDirectory(dir);
    if (digest.sha256 !== upload.sha256) {
      problems.push(`Checksum thư mục "${upload.name}" không khớp.`);
    }
  }

  return { ok: problems.length === 0, problems, manifest };
}
