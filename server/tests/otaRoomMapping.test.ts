/**
 * Per-platform OTA room mappings.
 *
 * Two things are being protected here.
 *
 * INDEPENDENCE: Agoda and CTrip room names are identical today, which makes a
 * shared row tempting. Sharing one would mean renaming a room on Agoda silently
 * changed what a CTrip booking resolves to, so the rows must be separate and
 * separately editable.
 *
 * CODE FIDELITY: the PMS code goes verbatim into the note a receptionist pastes
 * into the hotel system. The operator's mapping list used four codes this system
 * does not have (PREMIUM, PRE-DD, TWINT, STUDIO); the authoritative catalogue
 * uses LUXDEL, PRE_DD, TWIN and STU. These tests pin the repository's codes.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { seedBranches } from '../src/db/seed';
import { seedOtaRoomMappings } from '../src/room/otaRoomMappingSeed';
import {
  BRANCH_OTA_ROOM_MAPPING_SEED,
  MAPPED_PLATFORMS,
  OTA_ROOM_MAPPING_COUNT,
} from '../src/room/otaRoomMappingCatalog';
import { CONFIRMED_PMS_CODES } from '../src/room/roomClassCatalog';
import {
  loadOtaRoomMappings,
  resolveOtaRoomCode,
  resolveOtaRoomCodeById,
} from '../src/room/otaRoomMappingResolver';
import { resetAll, testPrisma } from './helpers/db';

const branchIdByCode = new Map<string, number>();

beforeAll(async () => {
  await resetAll();
  await seedBranches(testPrisma);
  for (const seed of BRANCH_OTA_ROOM_MAPPING_SEED) {
    const row = await testPrisma.branch.findUniqueOrThrow({ where: { code: seed.branchCode } });
    branchIdByCode.set(seed.branchCode, row.id);
  }
});

beforeEach(async () => {
  // Restore the seeded mappings after any test that edited or deleted one.
  await testPrisma.branchOtaRoomMapping.deleteMany();
  await testPrisma.branchOtaRoomMappingEvent.deleteMany();
  await seedOtaRoomMappings(testPrisma);
});

afterAll(async () => testPrisma.$disconnect());

const mappingsFor = (branchCode: string, platform: 'AGODA' | 'CTRIP') =>
  loadOtaRoomMappings(branchIdByCode.get(branchCode)!, platform, testPrisma);

/* ================================================================== */
/* Seeded counts and code fidelity                                     */
/* ================================================================== */

describe('seeded mappings', () => {
  it('seeds every room for BOTH platforms, as independent rows', async () => {
    expect(MAPPED_PLATFORMS).toEqual(['AGODA', 'CTRIP']);

    for (const platform of MAPPED_PLATFORMS) {
      const count = await testPrisma.branchOtaRoomMapping.count({ where: { platform } });
      expect(count, platform).toBe(OTA_ROOM_MAPPING_COUNT);
    }
    // Nothing was seeded for a platform that has no mapping table.
    expect(
      await testPrisma.branchOtaRoomMapping.count({
        where: { platform: { in: ['BOOKING_COM', 'TRIPADVISOR', 'TRAVELOKA'] } },
      }),
    ).toBe(0);
  });

  it.each(BRANCH_OTA_ROOM_MAPPING_SEED.map((s) => [s.branchCode, s.rooms.length] as const))(
    '%s has its exact room count on both platforms',
    async (branchCode, expected) => {
      for (const platform of MAPPED_PLATFORMS) {
        const rows = await mappingsFor(branchCode, platform);
        expect(rows.length, `${branchCode} ${platform}`).toBe(expected);
      }
    },
  );

  it('uses only PMS codes that exist in the authoritative catalogue', async () => {
    const rows = await testPrisma.branchOtaRoomMapping.findMany({ select: { pmsCode: true } });
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(CONFIRMED_PMS_CODES as readonly string[]).toContain(row.pmsCode);
    }
  });

  it('resolves the four corrected codes to the repository values, not the draft strings', async () => {
    const cn2 = await mappingsFor('LY_TU_TRONG_260', 'AGODA');
    expect(resolveOtaRoomCode('Phòng Premium Có Giường Cỡ King Nhìn Ra Thành Phố', cn2).pmsCode).toBe('LUXDEL');
    expect(resolveOtaRoomCode('Phòng Premium 2 Giường Đơn Nhìn Ra Thành Phố', cn2).pmsCode).toBe('PRE_DD');

    const cn5 = await mappingsFor('LE_THANH_TON_278', 'AGODA');
    expect(resolveOtaRoomCode('Phòng Twin Superior Có Cửa Sổ', cn5).pmsCode).toBe('TWIN');
    expect(resolveOtaRoomCode('Căn Hộ Studio', cn5).pmsCode).toBe('STU');

    // The draft strings are not codes anywhere in the system.
    const all = await testPrisma.branchOtaRoomMapping.findMany({ select: { pmsCode: true } });
    const codes = new Set(all.map((r) => r.pmsCode));
    for (const draft of ['PREMIUM', 'PRE-DD', 'TWINT', 'STUDIO']) {
      expect(codes.has(draft), draft).toBe(false);
    }
  });

  it('records Agoda room-type ids and leaves CTrip ids null', async () => {
    const agoda = await mappingsFor('TRUONG_DINH_05', 'AGODA');
    expect(agoda.find((m) => m.pmsCode === 'STAN')?.otaRoomTypeId).toBe('852778539');
    expect(agoda.every((m) => m.otaRoomTypeId !== null)).toBe(true);

    // No CTrip identifier has been supplied, so none is invented or borrowed.
    const ctrip = await mappingsFor('TRUONG_DINH_05', 'CTRIP');
    expect(ctrip.every((m) => m.otaRoomTypeId === null)).toBe(true);
    const anyCtripId = await testPrisma.branchOtaRoomMapping.count({
      where: { platform: 'CTRIP', otaRoomTypeId: { not: null } },
    });
    expect(anyCtripId).toBe(0);
  });

  it('is idempotent: re-running creates nothing and duplicates no audit event', async () => {
    const before = await testPrisma.branchOtaRoomMapping.count();
    const eventsBefore = await testPrisma.branchOtaRoomMappingEvent.count();

    const report = await seedOtaRoomMappings(testPrisma);
    expect(Object.values(report.created).every((n) => n === 0)).toBe(true);
    expect(report.skipped).toBeGreaterThan(0);
    expect(report.unknownPmsCodes).toEqual([]);
    expect(report.branchesMissing).toEqual([]);

    expect(await testPrisma.branchOtaRoomMapping.count()).toBe(before);
    expect(await testPrisma.branchOtaRoomMappingEvent.count()).toBe(eventsBefore);
  });
});

/* ================================================================== */
/* Independence                                                        */
/* ================================================================== */

describe('Agoda and CTrip mappings are independent', () => {
  const branchCode = 'BUI_THI_XUAN_40';
  const roomName = 'Phòng Deluxe Có Cửa Sổ (Giường Queen)';

  it('start identical but are separate rows', async () => {
    const agoda = await mappingsFor(branchCode, 'AGODA');
    const ctrip = await mappingsFor(branchCode, 'CTRIP');
    expect(resolveOtaRoomCode(roomName, agoda).pmsCode).toBe('DEL');
    expect(resolveOtaRoomCode(roomName, ctrip).pmsCode).toBe('DEL');

    const rows = await testPrisma.branchOtaRoomMapping.findMany({
      where: { branchId: branchIdByCode.get(branchCode)!, normalizedOtaRoomName: { not: '' } },
    });
    const ids = new Set(rows.map((r) => r.id));
    expect(ids.size).toBe(rows.length); // no shared row
  });

  it('editing the Agoda mapping leaves CTrip untouched', async () => {
    const branchId = branchIdByCode.get(branchCode)!;
    await testPrisma.branchOtaRoomMapping.updateMany({
      where: { branchId, platform: 'AGODA', otaRoomName: roomName },
      data: { pmsCode: 'DELQUEEN' },
    });

    expect(resolveOtaRoomCode(roomName, await mappingsFor(branchCode, 'AGODA')).pmsCode).toBe('DELQUEEN');
    expect(resolveOtaRoomCode(roomName, await mappingsFor(branchCode, 'CTRIP')).pmsCode).toBe('DEL');
  });

  it('deleting the CTrip mapping leaves Agoda untouched', async () => {
    const branchId = branchIdByCode.get(branchCode)!;
    await testPrisma.branchOtaRoomMapping.deleteMany({
      where: { branchId, platform: 'CTRIP', otaRoomName: roomName },
    });

    expect(resolveOtaRoomCode(roomName, await mappingsFor(branchCode, 'CTRIP')).pmsCode).toBeNull();
    expect(resolveOtaRoomCode(roomName, await mappingsFor(branchCode, 'AGODA')).pmsCode).toBe('DEL');
  });
});

/* ================================================================== */
/* Branch specificity and unresolved mappings                          */
/* ================================================================== */

describe('resolution', () => {
  it('is branch-specific: the same OTA name means different codes per branch', async () => {
    const shared = 'Phòng Twin Superior Có Cửa Sổ';
    expect(resolveOtaRoomCode(shared, await mappingsFor('LE_THANH_TON_278', 'AGODA')).pmsCode).toBe('TWIN');
    expect(resolveOtaRoomCode(shared, await mappingsFor('BUI_THI_XUAN_40', 'AGODA')).pmsCode).toBe('DD');
  });

  it('folds case, accents and spacing but never meaning', async () => {
    const cn1 = await mappingsFor('TRUONG_DINH_05', 'AGODA');
    expect(resolveOtaRoomCode('  PHÒNG   TIÊU CHUẨN KHÔNG CÓ CỬA SỔ ', cn1).pmsCode).toBe('STAN');
    // A different room is still a different room.
    expect(resolveOtaRoomCode('Phòng Tiêu Chuẩn Có Cửa Sổ', cn1).pmsCode).toBeNull();
  });

  it('CN4 has no Standard mapping, so a Standard input stays unresolved', async () => {
    const cn4 = await mappingsFor('NGUYEN_THAI_BINH_170', 'AGODA');
    expect(cn4.some((m) => m.pmsCode === 'STAN')).toBe(false);

    for (const name of [
      'Phòng Tiêu Chuẩn Không Có Cửa Sổ',
      'Standard Room',
      'Phòng Tiêu Chuẩn Giường Đôi Không Có Cửa Sổ',
    ]) {
      const resolved = resolveOtaRoomCode(name, cn4);
      expect(resolved.pmsCode, name).toBeNull();
      expect(resolved.requiresManualMapping, name).toBe(true);
    }
  });

  it('an unmapped name is never guessed', async () => {
    const cn1 = await mappingsFor('TRUONG_DINH_05', 'AGODA');
    const resolved = resolveOtaRoomCode('Presidential Ocean Suite', cn1);
    expect(resolved.pmsCode).toBeNull();
    expect(resolved.requiresManualMapping).toBe(true);
  });

  it('resolves by Agoda room-type id, but never for CTrip (no ids supplied)', async () => {
    const agoda = await mappingsFor('TRUONG_DINH_05', 'AGODA');
    expect(resolveOtaRoomCodeById('852779721', agoda).pmsCode).toBe('SUP');
    expect(resolveOtaRoomCodeById('000000000', agoda).pmsCode).toBeNull();

    const ctrip = await mappingsFor('TRUONG_DINH_05', 'CTRIP');
    expect(resolveOtaRoomCodeById('852779721', ctrip).pmsCode).toBeNull();
  });
});
