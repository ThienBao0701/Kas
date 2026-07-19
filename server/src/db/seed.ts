import type { PrismaClient } from '@prisma/client';
import { prisma as defaultPrisma } from './prisma';
import { BRANCHES } from './branches';

/**
 * Seeds the 8 branches. Upserts by `code`, so running it repeatedly updates
 * names/addresses in place and never creates duplicates.
 */
export async function seedBranches(client: PrismaClient = defaultPrisma): Promise<number> {
  for (const branch of BRANCHES) {
    await client.branch.upsert({
      where: { code: branch.code },
      update: {
        hotelName: branch.hotelName,
        address: branch.address,
      },
      create: {
        code: branch.code,
        hotelName: branch.hotelName,
        address: branch.address,
        active: true,
      },
    });
  }

  return client.branch.count();
}

async function main(): Promise<void> {
  const total = await seedBranches();
  // eslint-disable-next-line no-console
  console.log(`Seed hoàn tất: ${BRANCHES.length} chi nhánh đã được ghi, tổng cộng ${total} chi nhánh trong cơ sở dữ liệu.`);
}

// Only run when executed directly (npm run db:seed), not when imported by tests.
if (require.main === module) {
  main()
    .catch((error: unknown) => {
      // eslint-disable-next-line no-console
      console.error('Seed thất bại:', error);
      process.exitCode = 1;
    })
    .finally(() => {
      void defaultPrisma.$disconnect();
    });
}
