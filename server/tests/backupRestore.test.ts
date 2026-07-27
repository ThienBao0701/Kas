import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { execFileSync } from 'node:child_process';
import { seedBranches } from '../src/db/seed';
import {
  BACKUP_MANIFEST_NAME,
  BACKUP_DB_NAME,
  createBackup,
  listBackups,
  pruneBackups,
  verifyBackup,
} from '../src/production/backup';
import { restoreBackup } from '../src/production/restore';

/**
 * Backup and restore run against a THROWAWAY database and THROWAWAY directories
 * created per test — never the development database, never a real volume, and
 * never a real environment. Nothing here restores over live data.
 */
const REPO_ROOT = path.resolve(__dirname, '..', '..');

let workspace: string;
let dbFile: string;
let proofDir: string;
let issueDir: string;
let backupRoot: string;
let client: PrismaClient;

/** A tiny valid PNG-signature buffer, so upload files are realistic bytes. */
function pngBytes(marker: number): Buffer {
  const buf = Buffer.alloc(32, marker);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf);
  return buf;
}

/** A `file:` URL Prisma accepts on every platform. */
const fileUrl = (p: string): string => `file:${p.split(path.sep).join('/')}`;

/**
 * Applies the committed migrations to a brand-new SQLite file using exactly the
 * production command (`prisma migrate deploy`). The CLI is invoked through its
 * JS entry point with the current Node binary, so there is no shell and no
 * platform-specific `.cmd` wrapper involved.
 */
function migrateInto(file: string): void {
  execFileSync(
    process.execPath,
    [
      path.join(REPO_ROOT, 'node_modules', 'prisma', 'build', 'index.js'),
      'migrate', 'deploy', '--schema', 'prisma/schema.prisma',
    ],
    {
      cwd: REPO_ROOT,
      env: { ...process.env, DATABASE_URL: fileUrl(file) },
      stdio: 'pipe',
    },
  );
}

/** A pristine migrated database, built once and copied per test case. */
let templateDb: string;

beforeAll(() => {
  workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'kas-backup-'));
  templateDb = path.join(workspace, 'template.db');
  migrateInto(templateDb);
}, 180_000);

beforeEach(async () => {
  const unique = fs.mkdtempSync(path.join(workspace, 'case-'));
  dbFile = path.join(unique, 'db', 'kas.db');
  proofDir = path.join(unique, 'uploads', 'booking-proofs');
  issueDir = path.join(unique, 'uploads', 'issue-photos');
  backupRoot = path.join(unique, 'backups');
  fs.mkdirSync(path.dirname(dbFile), { recursive: true });
  fs.mkdirSync(proofDir, { recursive: true });
  fs.mkdirSync(issueDir, { recursive: true });

  // Copying the already-migrated template keeps each case isolated without
  // paying for a full migration run every time.
  fs.copyFileSync(templateDb, dbFile);
  client = new PrismaClient({ datasources: { db: { url: fileUrl(dbFile) } } });
  await seedBranches(client);

  await fsp.writeFile(path.join(proofDir, 'proof-a.png'), pngBytes(0x11));
  await fsp.writeFile(path.join(issueDir, 'issue-a.png'), pngBytes(0x22));
}, 120_000);

afterEach(async () => {
  await client?.$disconnect();
});

afterAll(() => {
  fs.rmSync(workspace, { recursive: true, force: true });
});

const uploadDirs = () => [
  { name: 'booking-proofs', dir: proofDir },
  { name: 'issue-photos', dir: issueDir },
];

const backup = (over: Parameters<typeof createBackup>[0] = {}) =>
  createBackup({ backupRoot, uploadDirs: uploadDirs(), client, ...over });

/* ================================================================== */
/* 23–24  Backup creation and manifest                                 */
/* ================================================================== */

describe('backup', () => {
  it('23. creates a consistent snapshot of a LIVE database plus every upload', async () => {
    // Write during the same session the backup is taken from: VACUUM INTO must
    // capture a checkpointed, self-contained copy rather than a torn file.
    const branch = await client.branch.findFirstOrThrow();
    await client.booking.create({
      data: {
        bookingCode: 'BK-LIVE-1', branchId: branch.id, customerName: 'TEST GUEST',
        paymentStatus: 'PAY_BEFORE', rawText: 'x', status: 'NEW',
      },
    });

    const result = await backup();

    expect(fs.existsSync(path.join(result.backupDir, BACKUP_DB_NAME))).toBe(true);
    expect(fs.existsSync(path.join(result.backupDir, BACKUP_MANIFEST_NAME))).toBe(true);
    expect(fs.existsSync(path.join(result.backupDir, 'uploads', 'booking-proofs', 'proof-a.png'))).toBe(true);
    expect(fs.existsSync(path.join(result.backupDir, 'uploads', 'issue-photos', 'issue-a.png'))).toBe(true);

    // The snapshot is a single self-contained file — no -wal/-shm to keep in sync.
    for (const suffix of ['-wal', '-shm']) {
      expect(fs.existsSync(path.join(result.backupDir, BACKUP_DB_NAME + suffix))).toBe(false);
    }

    // And it is a readable database holding the row written moments earlier.
    const copy = new PrismaClient({
      datasources: { db: { url: fileUrl(path.join(result.backupDir, BACKUP_DB_NAME)) } },
    });
    await expect(copy.booking.count()).resolves.toBe(1);
    await expect(copy.branch.count()).resolves.toBe(8);
    await copy.$disconnect();
  }, 120_000);

  it('24. writes a manifest with checksums, counts, timestamp and release', async () => {
    const result = await backup({ releaseRef: 'v0.0.0-test' });
    const manifest = JSON.parse(
      await fsp.readFile(path.join(result.backupDir, BACKUP_MANIFEST_NAME), 'utf8'),
    );

    expect(manifest.formatVersion).toBe(1);
    expect(manifest.releaseRef).toBe('v0.0.0-test');
    expect(Date.parse(manifest.createdAt)).not.toBeNaN();
    expect(manifest.database.engine).toBe('sqlite');
    expect(manifest.database.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(manifest.database.bytes).toBeGreaterThan(0);
    expect(manifest.counts.branches).toBe(8);
    expect(manifest.counts.aliases).toBe(24);

    const names = (manifest.uploads as { name: string; files: number; sha256: string }[]);
    expect(names.map((u) => u.name)).toEqual(['booking-proofs', 'issue-photos']);
    for (const upload of names) {
      expect(upload.files).toBe(1);
      expect(upload.sha256).toMatch(/^[0-9a-f]{64}$/);
    }

    // A manifest must never contain a secret or a connection string.
    const raw = await fsp.readFile(path.join(result.backupDir, BACKUP_MANIFEST_NAME), 'utf8');
    expect(raw).not.toMatch(/SESSION_SECRET|passwordHash|DATABASE_URL|file:/);

    await expect(verifyBackup(result.backupDir)).resolves.toMatchObject({ ok: true, problems: [] });
  }, 120_000);

  it('24b. retention keeps the newest N and never deletes by default', async () => {
    const a = await backup({ now: new Date('2026-07-01T01:00:00Z') });
    const b = await backup({ now: new Date('2026-07-02T01:00:00Z') });
    const c = await backup({ now: new Date('2026-07-03T01:00:00Z') });
    expect(await listBackups(backupRoot)).toHaveLength(3);

    // retain = 0 (the default) keeps everything.
    expect(await pruneBackups(backupRoot, 0)).toEqual([]);
    expect(await listBackups(backupRoot)).toHaveLength(3);

    const pruned = await pruneBackups(backupRoot, 2);
    expect(pruned).toHaveLength(1);
    expect(fs.existsSync(a.backupDir)).toBe(false);
    expect(fs.existsSync(b.backupDir)).toBe(true);
    expect(fs.existsSync(c.backupDir)).toBe(true);
  }, 180_000);
});

/* ================================================================== */
/* 25–28  Restore, verification and rejection                          */
/* ================================================================== */

describe('restore', () => {
  it('25/26/27. restores database AND uploads into a temporary environment', async () => {
    const branch = await client.branch.findFirstOrThrow();
    await client.booking.create({
      data: {
        bookingCode: 'BK-RESTORE-1', branchId: branch.id, customerName: 'TEST GUEST',
        paymentStatus: 'PAY_BEFORE', rawText: 'x', status: 'NEW',
      },
    });
    const created = await backup();

    // Mutate the "live" state so a successful restore is unambiguous.
    await client.booking.deleteMany({});
    await fsp.rm(path.join(proofDir, 'proof-a.png'));
    await fsp.writeFile(path.join(proofDir, 'stray.png'), pngBytes(0x33));

    // 25. Restore into throwaway targets — the live paths are untouched.
    const tempRoot = fs.mkdtempSync(path.join(workspace, 'drill-'));
    const tempDb = path.join(tempRoot, 'db', 'kas.db');
    const result = await restoreBackup({
      backupDir: created.backupDir,
      confirmed: true,
      targetDbFile: tempDb,
      targetUploadDirs: [
        { name: 'booking-proofs', dir: path.join(tempRoot, 'uploads', 'booking-proofs') },
        { name: 'issue-photos', dir: path.join(tempRoot, 'uploads', 'issue-photos') },
      ],
    });

    // 26. The restored database really contains the backed-up rows.
    const restored = new PrismaClient({
      datasources: { db: { url: fileUrl(tempDb) } },
    });
    await expect(restored.booking.count()).resolves.toBe(1);
    await expect(restored.branch.count()).resolves.toBe(8);
    const booking = await restored.booking.findFirstOrThrow();
    expect(booking.bookingCode).toBe('BK-RESTORE-1');
    await restored.$disconnect();

    // 27. Uploads are restored byte-for-byte, and a file that did not exist in
    // the backup does not appear (the target is replaced, not merged).
    const restoredProof = path.join(tempRoot, 'uploads', 'booking-proofs', 'proof-a.png');
    expect(await fsp.readFile(restoredProof)).toEqual(pngBytes(0x11));
    expect(fs.existsSync(path.join(tempRoot, 'uploads', 'booking-proofs', 'stray.png'))).toBe(false);
    expect(await fsp.readFile(path.join(tempRoot, 'uploads', 'issue-photos', 'issue-a.png')))
      .toEqual(pngBytes(0x22));

    // The live directory was NOT touched by the drill.
    expect(fs.existsSync(path.join(proofDir, 'stray.png'))).toBe(true);
    expect(await client.booking.count()).toBe(0);

    // A verification checklist is printed rather than anything being restarted.
    expect(result.checklist.length).toBeGreaterThan(4);
    expect(result.checklist.join(' ')).toMatch(/migrate deploy/);
    expect(result.checklist.join(' ')).toMatch(/health/);
  }, 180_000);

  it('25b. a restore is refused unless explicitly confirmed', async () => {
    const created = await backup();
    const tempRoot = fs.mkdtempSync(path.join(workspace, 'noconfirm-'));
    await expect(
      restoreBackup({
        backupDir: created.backupDir,
        confirmed: false,
        targetDbFile: path.join(tempRoot, 'kas.db'),
        targetUploadDirs: [],
      }),
    ).rejects.toThrow(/chưa được xác nhận/);
    expect(fs.existsSync(path.join(tempRoot, 'kas.db'))).toBe(false);
  }, 120_000);

  it('25c. the pre-restore state is preserved so a mistaken restore is reversible', async () => {
    const created = await backup();

    const tempRoot = fs.mkdtempSync(path.join(workspace, 'safety-'));
    const tempDb = path.join(tempRoot, 'kas.db');
    fs.writeFileSync(tempDb, 'PREVIOUS DATABASE CONTENT');

    const result = await restoreBackup({
      backupDir: created.backupDir,
      confirmed: true,
      targetDbFile: tempDb,
      targetUploadDirs: [],
    });

    expect(result.safetyCopyDir).not.toBeNull();
    expect(fs.readFileSync(path.join(result.safetyCopyDir!, BACKUP_DB_NAME), 'utf8'))
      .toBe('PREVIOUS DATABASE CONTENT');
  }, 120_000);

  it('28. an invalid, corrupted or incomplete backup is rejected', async () => {
    const created = await backup();
    const tempRoot = fs.mkdtempSync(path.join(workspace, 'invalid-'));
    const target = { targetDbFile: path.join(tempRoot, 'kas.db'), targetUploadDirs: [] };

    // (a) A directory with no manifest at all.
    const empty = path.join(workspace, 'not-a-backup');
    fs.mkdirSync(empty, { recursive: true });
    await expect(verifyBackup(empty)).resolves.toMatchObject({ ok: false });
    await expect(restoreBackup({ backupDir: empty, confirmed: true, ...target }))
      .rejects.toThrow(/không hợp lệ/);

    // (b) A tampered database file — the checksum no longer matches.
    const tampered = path.join(workspace, 'tampered');
    fs.cpSync(created.backupDir, tampered, { recursive: true });
    fs.appendFileSync(path.join(tampered, BACKUP_DB_NAME), 'corruption');
    const verdict = await verifyBackup(tampered);
    expect(verdict.ok).toBe(false);
    expect(verdict.problems.join(' ')).toMatch(/[Cc]hecksum/);
    await expect(restoreBackup({ backupDir: tampered, confirmed: true, ...target }))
      .rejects.toThrow(/không hợp lệ/);

    // (c) A missing database file.
    const truncated = path.join(workspace, 'truncated');
    fs.cpSync(created.backupDir, truncated, { recursive: true });
    fs.rmSync(path.join(truncated, BACKUP_DB_NAME));
    await expect(verifyBackup(truncated)).resolves.toMatchObject({ ok: false });

    // (d) A tampered upload set.
    const badUploads = path.join(workspace, 'bad-uploads');
    fs.cpSync(created.backupDir, badUploads, { recursive: true });
    fs.writeFileSync(path.join(badUploads, 'uploads', 'booking-proofs', 'extra.png'), pngBytes(0x44));
    const uploadVerdict = await verifyBackup(badUploads);
    expect(uploadVerdict.ok).toBe(false);
    expect(uploadVerdict.problems.join(' ')).toMatch(/booking-proofs/);

    // Nothing was written to the target by any rejected attempt.
    expect(fs.existsSync(path.join(tempRoot, 'kas.db'))).toBe(false);
  }, 180_000);
});
