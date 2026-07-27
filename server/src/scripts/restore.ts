/**
 * CLI: `npm run prod:restore -- --backup=<dir> [--target-db=<file> --target-uploads=<dir>]`
 *
 * Restores a verified backup. It NEVER selects a backup for you, always
 * verifies checksums first, and requires a typed confirmation before it writes
 * anything. Use `--list` to see what is available, and the `--target-*` flags to
 * rehearse a restore into a throwaway directory instead of the live data.
 */
import path from 'node:path';
import readline from 'node:readline';
import { prisma } from '../db/prisma';
import { BACKUP_DIR } from '../config/env';
import { listBackups, verifyBackup } from '../production/backup';
import { restoreBackup } from '../production/restore';

/* eslint-disable no-console */

const CONFIRM_PHRASE = 'RESTORE KAS DATA';

function stringArg(name: string): string | undefined {
  const raw = process.argv.find((a) => a.startsWith(`--${name}=`));
  return raw?.slice(name.length + 3);
}

function ask(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) =>
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    }),
  );
}

async function main(): Promise<void> {
  if (process.argv.includes('--list')) {
    const backups = await listBackups(BACKUP_DIR);
    console.log(backups.length === 0 ? '(chưa có bản sao lưu nào)' : backups.join('\n'));
    return;
  }

  const selected = stringArg('backup');
  if (!selected) {
    console.error('❌ Bắt buộc chọn bản sao lưu: --backup=<thư mục>. Xem danh sách với --list.');
    process.exitCode = 1;
    return;
  }
  const backupDir = path.isAbsolute(selected) ? selected : path.join(BACKUP_DIR, selected);

  const verification = await verifyBackup(backupDir);
  if (!verification.ok) {
    console.error('❌ Bản sao lưu KHÔNG hợp lệ, không khôi phục:');
    for (const problem of verification.problems) console.error(`   - ${problem}`);
    process.exitCode = 1;
    return;
  }

  const targetDb = stringArg('target-db');
  const targetUploads = stringArg('target-uploads');
  const intoTemp = Boolean(targetDb || targetUploads);

  console.log(`\nBản sao lưu: ${backupDir}`);
  console.log(`Tạo lúc:     ${verification.manifest!.createdAt}`);
  console.log(`Phiên bản:   ${verification.manifest!.releaseRef ?? '(không ghi)'}`);
  console.log(`Số bản ghi:  ${JSON.stringify(verification.manifest!.counts)}`);
  console.log(
    intoTemp
      ? '\nChế độ: khôi phục vào thư mục TẠM (diễn tập) — dữ liệu đang chạy không bị chạm.'
      : '\n⚠️  Chế độ: GHI ĐÈ DỮ LIỆU ĐANG CHẠY. Hãy dừng ứng dụng trước khi tiếp tục.',
  );

  const answer = await ask(`\nGõ chính xác "${CONFIRM_PHRASE}" để khôi phục: `);
  if (answer !== CONFIRM_PHRASE) {
    console.error('Cụm từ xác nhận không đúng. Đã hủy.');
    process.exitCode = 1;
    return;
  }

  const result = await restoreBackup({
    backupDir,
    confirmed: true,
    ...(targetDb ? { targetDbFile: targetDb } : {}),
    ...(targetUploads
      ? {
          targetUploadDirs: [
            { name: 'booking-proofs', dir: path.join(targetUploads, 'booking-proofs') },
            { name: 'issue-photos', dir: path.join(targetUploads, 'issue-photos') },
          ],
        }
      : {}),
  });

  console.log('\n✅ Khôi phục xong.');
  console.log(`   Cơ sở dữ liệu: ${result.restoredDbFile}`);
  for (const upload of result.restoredUploads) {
    console.log(`   ${upload.name}: ${upload.files} tệp`);
  }
  console.log('\nDANH SÁCH KIỂM TRA SAU KHÔI PHỤC:');
  for (const item of result.checklist) console.log(`   [ ] ${item}`);
}

if (require.main === module) {
  main()
    .catch((error: unknown) => {
      console.error('Khôi phục thất bại:', error instanceof Error ? error.message : error);
      process.exitCode = 1;
    })
    .finally(() => void prisma.$disconnect());
}
