import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { seedBranches } from '../src/db/seed';
import { resetAll, testPrisma } from './helpers/db';
import { ADMIN_PASSWORD, RECEPTIONIST_PASSWORD, createAdmin, createReceptionist, loginAgent } from './helpers/auth';
import { createDraftBooking } from './helpers/bookings';

let app: ReturnType<typeof createApp>;
let adminAgent: Awaited<ReturnType<typeof loginAgent>>['agent'];
let ownAgent: Awaited<ReturnType<typeof loginAgent>>['agent'];
let ownBranchId: number;

const PARTNER_TEXT = `Saigon Hotel & Ben Thanh
Booking.com for Partners
Rate plan: Partner Rate (B2B)
Tên khách:
Nguyễn Văn A
Mã số đặt phòng:
6312474567
Nhận phòng
Thứ Năm, 23 Tháng 7 2026
Trả phòng
Thứ Sáu, 24 Tháng 7 2026
Phòng 1: Deluxe Double Room
2026-07-23: 850.000 VND
Tổng cộng: 850.000 VND`;

const DIRECT_TEXT = PARTNER_TEXT.replace('Rate plan: Partner Rate (B2B)', 'Fully flexible, Domestic rate');

beforeEach(async () => {
  await resetAll();
  await seedBranches(testPrisma);
  app = createApp();
  ownBranchId = (await testPrisma.branch.findUniqueOrThrow({ where: { code: 'TRUONG_DINH_05' } })).id;
  await createAdmin({ mustChangePassword: false });
  adminAgent = (await loginAgent(app, 'admin', ADMIN_PASSWORD)).agent;
  await createReceptionist(ownBranchId, { username: 'letan_own', mustChangePassword: false });
  ownAgent = (await loginAgent(app, 'letan_own', RECEPTIONIST_PASSWORD)).agent;
});

afterAll(async () => {
  await testPrisma.$disconnect();
});

describe('business type — extraction & persistence', () => {
  it('existing bookings default to UNKNOWN (safe migration default)', async () => {
    const b = await createDraftBooking({ status: 'NEW', branchId: ownBranchId });
    const stored = await testPrisma.booking.findUniqueOrThrow({ where: { id: b.id } });
    expect(stored.businessType).toBe('UNKNOWN');
    expect(stored.businessTypeManuallyConfirmed).toBe(false);
  });

  it('extract detects and persists PARTNER from explicit partner-rate text', async () => {
    const res = await adminAgent.post('/api/bookings/extract').send({ rawText: PARTNER_TEXT });
    expect(res.status).toBe(201);
    expect(res.body.businessType).toBe('PARTNER');
    expect(res.body.businessTypeRequiresAdminConfirmation).toBe(false);
    expect(res.body.booking.businessType).toBe('PARTNER');

    const stored = await testPrisma.booking.findUniqueOrThrow({ where: { id: res.body.booking.id } });
    expect(stored.businessType).toBe('PARTNER');
    expect(stored.businessTypeManuallyConfirmed).toBe(false);
  });

  it('extract detects DIRECT for a normal retail booking', async () => {
    const res = await adminAgent.post('/api/bookings/extract').send({ rawText: DIRECT_TEXT });
    expect(res.body.businessType).toBe('DIRECT');
  });
});

describe('business type — admin override', () => {
  async function draft() {
    const res = await adminAgent.post('/api/bookings/extract').send({ rawText: DIRECT_TEXT });
    return res.body.booking.id as string;
  }

  it('lets an admin mark a booking as PARTNER (manual, overrides detection)', async () => {
    const id = await draft();
    const res = await adminAgent.post(`/api/admin/bookings/${id}/business-type`).send({ businessType: 'PARTNER' });
    expect(res.status).toBe(200);
    expect(res.body.booking.businessType).toBe('PARTNER');
    expect(res.body.booking.businessTypeManuallyConfirmed).toBe(true);
  });

  it('lets an admin mark a booking as DIRECT (manual)', async () => {
    const id = await draft();
    const res = await adminAgent.post(`/api/admin/bookings/${id}/business-type`).send({ businessType: 'DIRECT' });
    expect(res.body.booking.businessType).toBe('DIRECT');
    expect(res.body.booking.businessTypeManuallyConfirmed).toBe(true);
  });

  it('persists the manual decision and never re-detects it on a later edit', async () => {
    const id = await draft();
    await adminAgent.post(`/api/admin/bookings/${id}/business-type`).send({ businessType: 'PARTNER' });
    // An unrelated edit must not re-run detection or reset the manual decision.
    await adminAgent.put(`/api/admin/bookings/${id}`).send({ customerName: 'Người Khác' });
    const stored = await testPrisma.booking.findUniqueOrThrow({ where: { id } });
    expect(stored.businessType).toBe('PARTNER');
    expect(stored.businessTypeManuallyConfirmed).toBe(true);
    expect(stored.businessTypeDetectionSource).toMatch(/^manual:/);
  });

  it('rejects a receptionist trying to override via the admin route', async () => {
    const id = await draft();
    const res = await ownAgent.post(`/api/admin/bookings/${id}/business-type`).send({ businessType: 'PARTNER' });
    expect(res.status).toBe(403);
    const stored = await testPrisma.booking.findUniqueOrThrow({ where: { id } });
    expect(stored.businessTypeManuallyConfirmed).toBe(false);
  });

  it('rejects an invalid business type value', async () => {
    const id = await draft();
    const res = await adminAgent.post(`/api/admin/bookings/${id}/business-type`).send({ businessType: 'UNKNOWN' });
    expect(res.status).toBe(422);
  });
});

describe('history / completed list columns', () => {
  it('returns roomSummary and totalAmount, aggregating identical room types', async () => {
    await createDraftBooking({
      status: 'COMPLETED',
      branchId: ownBranchId,
      bookingCode: 'SUMMARY0001',
      rooms: 2,
      roomType: 'Superior Giường Đôi',
      totalAmount: 3_000_000,
    });

    const res = await adminAgent.get('/api/bookings/history?search=SUMMARY0001');
    expect(res.status).toBe(200);
    const row = res.body.bookings[0];
    expect(row.roomSummary).toBe('Superior Giường Đôi (2)');
    expect(row.totalAmount).toBe(3_000_000);
    expect(row.businessType).toBe('UNKNOWN');
  });

  it('lists mixed room types separately in the summary', async () => {
    const b = await createDraftBooking({ status: 'COMPLETED', branchId: ownBranchId, bookingCode: 'MIXED00001', rooms: 1, roomType: 'Superior Giường Đôi' });
    // Add a second room of a different type directly.
    await testPrisma.bookingRoom.create({
      data: { bookingId: b.id, roomIndex: 2, roomType: 'Deluxe Giường Đôi' },
    });

    const res = await adminAgent.get('/api/bookings/completed');
    const row = res.body.bookings.find((x: { bookingCode: string }) => x.bookingCode === 'MIXED00001');
    expect(row.roomSummary).toBe('Superior Giường Đôi (1) | Deluxe Giường Đôi (1)');
  });
});
