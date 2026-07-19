import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedBranches } from '../src/db/seed';
import { BRANCHES } from '../src/db/branches';
import { resetAll, testPrisma } from './helpers/db';

describe('branch seed', () => {
  beforeAll(async () => {
    await resetAll();
  });

  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  it('creates exactly 8 branches', async () => {
    await seedBranches(testPrisma);

    const count = await testPrisma.branch.count();
    expect(count).toBe(8);
    expect(BRANCHES).toHaveLength(8);
  });

  it('seeds the exact required codes, hotel names and addresses', async () => {
    const branches = await testPrisma.branch.findMany({ orderBy: { id: 'asc' } });

    expect(branches.map((b) => b.code)).toEqual([
      'TRUONG_DINH_05',
      'LY_TU_TRONG_260',
      'NGUYEN_TRAI_47A',
      'NGUYEN_THAI_BINH_170',
      'LE_THANH_TON_278',
      'BUI_THI_XUAN_40',
      'BUI_THI_XUAN_13',
      'LE_THANH_TON_191',
    ]);

    const truongDinh = branches.find((b) => b.code === 'TRUONG_DINH_05');
    expect(truongDinh?.hotelName).toBe('Saigon Hotel & Ben Thanh');
    expect(truongDinh?.address).toBe('05 Trương Định');

    const nguyenThaiBinh = branches.find((b) => b.code === 'NGUYEN_THAI_BINH_170');
    expect(nguyenThaiBinh?.address).toBe('170-172-174 Nguyễn Thái Bình');

    // Vietnamese diacritics must survive the round trip through SQLite.
    const buiThiXuan = branches.find((b) => b.code === 'BUI_THI_XUAN_13');
    expect(buiThiXuan?.address).toBe('13 Bùi Thị Xuân');
  });

  it('is idempotent: running the seed twice does not create duplicates', async () => {
    await seedBranches(testPrisma);
    await seedBranches(testPrisma);

    const count = await testPrisma.branch.count();
    expect(count).toBe(8);

    const codes = await testPrisma.branch.findMany({ select: { code: true } });
    expect(new Set(codes.map((c) => c.code)).size).toBe(8);
  });

  it('rejects a duplicate branch code', async () => {
    await expect(
      testPrisma.branch.create({
        data: {
          code: 'TRUONG_DINH_05',
          hotelName: 'Trùng mã chi nhánh',
          address: 'Không hợp lệ',
        },
      }),
    ).rejects.toThrow();
  });
});
