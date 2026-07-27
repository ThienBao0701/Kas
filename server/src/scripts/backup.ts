/**
 * CLI: `npm run prod:backup [-- --retain=7]`
 *
 * Writes a consistency-aware snapshot (database + uploads + manifest) into
 * BACKUP_DIR. Prints no secrets. Exit code 0 on success, 1 on failure — so cron
 * or a systemd timer can alert on it.
 */
import { prisma } from '../db/prisma';
import { BACKUP_DIR } from '../config/env';
import { createBackup } from '../production/backup';

/* eslint-disable no-console */

function numberArg(name: string, fallback: number): number {
  const raw = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (!raw) return fallback;
  const value = Number.parseInt(raw.slice(name.length + 3), 10);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

async function main(): Promise<void> {
  const retain = numberArg('retain', 0);
  const result = await createBackup({ retain });

  console.log('✅ Sao lưu hoàn tất.');
  console.log(`   Thư mục:    ${result.backupDir}`);
  console.log(`   Cơ sở dữ liệu: ${result.manifest.database.bytes} bytes`);
  for (const upload of result.manifest.uploads) {
    console.log(`   ${upload.name}: ${upload.files} tệp, ${upload.bytes} bytes`);
  }
  console.log(`   Số bản ghi: ${JSON.stringify(result.manifest.counts)}`);
  if (result.prunedBackups.length > 0) {
    console.log(`   Đã xóa theo chính sách giữ lại (${retain}): ${result.prunedBackups.join(', ')}`);
  }
  console.log(`\nNhắc: sao chép ${BACKUP_DIR} sang một máy khác — bản sao cùng máy không chống được hỏng ổ đĩa.`);
}

if (require.main === module) {
  main()
    .catch((error: unknown) => {
      console.error('Sao lưu thất bại:', error instanceof Error ? error.message : error);
      process.exitCode = 1;
    })
    .finally(() => void prisma.$disconnect());
}
