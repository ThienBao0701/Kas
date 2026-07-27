/**
 * Restore from a verified backup.
 *
 * Deliberately unfriendly by design — a restore overwrites live data, so it:
 *   - never runs automatically and never picks a backup for you,
 *   - refuses any backup whose manifest or checksums do not verify,
 *   - refuses to overwrite a live target unless `confirmed` is passed,
 *   - snapshots whatever it is about to replace (so a mistaken restore is
 *     itself reversible),
 *   - restores database and uploads together, never one without the other,
 *   - and prints a verification checklist instead of restarting anything.
 *
 * `targetDbFile`/`targetUploadDirs` allow restoring into a throwaway directory,
 * which is how a restore drill is rehearsed — and how the automated tests
 * exercise this module without touching any real environment.
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { BACKUP_DB_NAME, verifyBackup, type BackupManifest } from './backup';
import { ISSUE_UPLOAD_DIR, PROOF_UPLOAD_DIR, sqliteFilePath } from '../config/env';

export interface RestoreOptions {
  /** The backup directory to restore. Always explicit — never auto-selected. */
  backupDir: string;
  /** Must be true to write anything. */
  confirmed: boolean;
  /** Where the database file is written. Defaults to the live DATABASE_URL file. */
  targetDbFile?: string | null;
  /** Where each upload set is written. Defaults to the live upload directories. */
  targetUploadDirs?: { name: string; dir: string }[];
  /** Snapshot the current data before overwriting it. Default true. */
  safetyCopy?: boolean;
  now?: Date;
}

export interface RestoreResult {
  restoredDbFile: string;
  restoredUploads: { name: string; dir: string; files: number }[];
  manifest: BackupManifest;
  /** Where the pre-restore state was preserved, or null when nothing existed. */
  safetyCopyDir: string | null;
  checklist: string[];
}

/** Live SQLite writes leave `-wal`/`-shm` beside the database; both must go. */
async function removeSqliteSidecars(dbFile: string): Promise<void> {
  for (const suffix of ['-wal', '-shm', '-journal']) {
    await fsp.rm(`${dbFile}${suffix}`, { force: true });
  }
}

async function countFiles(dir: string): Promise<number> {
  let total = 0;
  const walk = async (current: string): Promise<void> => {
    let entries: fs.Dirent[];
    try {
      entries = await fsp.readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) await walk(path.join(current, entry.name));
      else total += 1;
    }
  };
  await walk(dir);
  return total;
}

export async function restoreBackup(options: RestoreOptions): Promise<RestoreResult> {
  const now = options.now ?? new Date();

  const verification = await verifyBackup(options.backupDir);
  if (!verification.ok || !verification.manifest) {
    throw new Error(
      `Bản sao lưu không hợp lệ, đã hủy khôi phục:\n  - ${verification.problems.join('\n  - ')}`,
    );
  }
  const manifest = verification.manifest;

  if (!options.confirmed) {
    throw new Error('Khôi phục chưa được xác nhận (confirmed = false). Đã hủy.');
  }

  const targetDbFile = options.targetDbFile ?? sqliteFilePath();
  if (!targetDbFile) {
    throw new Error('Không xác định được tệp cơ sở dữ liệu đích (DATABASE_URL không phải file:).');
  }

  const targetUploads = options.targetUploadDirs ?? [
    { name: 'booking-proofs', dir: PROOF_UPLOAD_DIR },
    { name: 'issue-photos', dir: ISSUE_UPLOAD_DIR },
  ];

  // --- Preserve whatever is about to be replaced ---
  let safetyCopyDir: string | null = null;
  if (options.safetyCopy !== false) {
    const stamp = now.toISOString().replace(/[:.]/g, '').slice(0, 15);
    const dir = path.join(path.dirname(options.backupDir), `pre-restore-${stamp}`);
    let preserved = false;
    if (fs.existsSync(targetDbFile)) {
      await fsp.mkdir(dir, { recursive: true });
      await fsp.copyFile(targetDbFile, path.join(dir, BACKUP_DB_NAME));
      preserved = true;
    }
    for (const upload of targetUploads) {
      if (!fs.existsSync(upload.dir)) continue;
      await fsp.mkdir(dir, { recursive: true });
      await fsp.cp(upload.dir, path.join(dir, 'uploads', upload.name), { recursive: true });
      preserved = true;
    }
    safetyCopyDir = preserved ? dir : null;
  }

  // --- Database ---
  await fsp.mkdir(path.dirname(targetDbFile), { recursive: true });
  await removeSqliteSidecars(targetDbFile);
  await fsp.copyFile(path.join(options.backupDir, manifest.database.file), targetDbFile);

  // --- Uploads: replace wholesale so a deleted file does not survive ---
  const restoredUploads: RestoreResult['restoredUploads'] = [];
  for (const upload of targetUploads) {
    const source = path.join(options.backupDir, 'uploads', upload.name);
    await fsp.rm(upload.dir, { recursive: true, force: true });
    await fsp.mkdir(upload.dir, { recursive: true });
    if (fs.existsSync(source)) {
      await fsp.cp(source, upload.dir, { recursive: true });
    }
    restoredUploads.push({ ...upload, files: await countFiles(upload.dir) });
  }

  return {
    restoredDbFile: targetDbFile,
    restoredUploads,
    manifest,
    safetyCopyDir,
    checklist: [
      'Chạy `npx prisma migrate deploy` để chắc chắn schema khớp mã nguồn đang chạy.',
      'Gọi /api/health và /api/ready — cả hai phải trả 200.',
      `Đối chiếu số bản ghi với manifest: ${JSON.stringify(manifest.counts)}.`,
      'Đăng nhập bằng tài khoản Admin và mở danh sách chi nhánh.',
      'Mở một đơn có ảnh chứng minh và xác nhận ảnh hiển thị được.',
      'Kiểm tra quyền: lễ tân chỉ thấy chi nhánh của mình.',
      safetyCopyDir
        ? `Giữ bản sao trước khi khôi phục tại: ${safetyCopyDir}`
        : 'Không có dữ liệu cũ để sao lưu (đích trống).',
    ],
  };
}
