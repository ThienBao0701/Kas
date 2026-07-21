import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { seedBranches } from '../src/db/seed';
import { resetAll, testPrisma } from './helpers/db';
import { ADMIN_PASSWORD, RECEPTIONIST_PASSWORD, createAdmin, createReceptionist, loginAgent } from './helpers/auth';
import { createDraftBooking, expectedStayDates } from './helpers/bookings';

let app: ReturnType<typeof createApp>;
let adminAgent: Awaited<ReturnType<typeof loginAgent>>['agent'];
let receptionistAgent: Awaited<ReturnType<typeof loginAgent>>['agent'];
let ownBranchId: number;

beforeEach(async () => {
  await resetAll();
  await seedBranches(testPrisma);
  app = createApp();
  const own = await testPrisma.branch.findUniqueOrThrow({ where: { code: 'TRUONG_DINH_05' } });
  ownBranchId = own.id;

  const admin = await createAdmin({ mustChangePassword: false });
  adminAgent = (await loginAgent(app, 'admin', ADMIN_PASSWORD)).agent;
  await createReceptionist(ownBranchId, { username: 'letan', mustChangePassword: false });
  receptionistAgent = (await loginAgent(app, 'letan', RECEPTIONIST_PASSWORD)).agent;
  void admin;
});

afterAll(async () => {
  await testPrisma.$disconnect();
});

describe('GET /api/admin/bookings/:id', () => {
  it('returns the full detail including rawText and rooms', async () => {
    const draft = await createDraftBooking({ branchId: ownBranchId });
    const res = await adminAgent.get(`/api/admin/bookings/${draft.id}`);
    expect(res.status).toBe(200);
    expect(res.body.booking.status).toBe('DRAFT');
    expect(res.body.booking.rawText).toBeTruthy();
    expect(res.body.booking.rooms[0].nights).toHaveLength(3);
    expect(res.body.booking.rooms[0].nights[0].manuallyCorrected).toBe(false);
  });

  it('forbids a receptionist', async () => {
    const draft = await createDraftBooking({ branchId: ownBranchId });
    const res = await receptionistAgent.get(`/api/admin/bookings/${draft.id}`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });
});

describe('PUT /api/admin/bookings/:id', () => {
  it('updates scalar fields and replaces rooms atomically', async () => {
    const draft = await createDraftBooking({ branchId: ownBranchId });
    const dates = expectedStayDates('2026-07-19', '2026-07-22');
    const res = await adminAgent.put(`/api/admin/bookings/${draft.id}`).send({
      customerName: 'Trần Thị B',
      phone: '0912000000',
      rooms: [
        {
          roomIndex: 1,
          roomType: 'Superior Twin Room',
          roomSubtotal: 2_700_000,
          nights: [
            { stayDate: dates[0], amount: 900_000 },
            { stayDate: dates[1], amount: 900_000 },
            { stayDate: dates[2], amount: 900_000 },
          ],
        },
      ],
    });
    expect(res.status).toBe(200);
    expect(res.body.booking.customerName).toBe('Trần Thị B');
    expect(res.body.booking.rooms[0].roomType).toBe('Superior Twin Room');
    expect(res.body.booking.rooms[0].nights.map((n: { amount: number }) => n.amount)).toEqual([
      900_000, 900_000, 900_000,
    ]);
    // Changed amounts are marked manually corrected.
    expect(res.body.booking.rooms[0].nights.every((n: { manuallyCorrected: boolean }) => n.manuallyCorrected)).toBe(
      true,
    );
  });

  it('keeps manuallyCorrected false when the amount is unchanged', async () => {
    const draft = await createDraftBooking({ branchId: ownBranchId });
    const dates = expectedStayDates('2026-07-19', '2026-07-22');
    const res = await adminAgent.put(`/api/admin/bookings/${draft.id}`).send({
      rooms: [
        {
          roomIndex: 1,
          roomType: 'Deluxe Double Room',
          nights: dates.map((d) => ({ stayDate: d, amount: 850_000 })),
        },
      ],
    });
    expect(res.status).toBe(200);
    expect(res.body.booking.rooms[0].nights.every((n: { manuallyCorrected: boolean }) => !n.manuallyCorrected)).toBe(
      true,
    );
  });

  it('rejects a room whose nights do not match the expected stay dates', async () => {
    const draft = await createDraftBooking({ branchId: ownBranchId });
    const res = await adminAgent.put(`/api/admin/bookings/${draft.id}`).send({
      rooms: [
        {
          roomIndex: 1,
          nights: [
            { stayDate: '2026-07-19', amount: 850_000 },
            { stayDate: '2026-07-22', amount: 850_000 }, // check-out date as a night
          ],
        },
      ],
    });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects forbidden fields (status, rawText, id)', async () => {
    const draft = await createDraftBooking({ branchId: ownBranchId });
    const res = await adminAgent.put(`/api/admin/bookings/${draft.id}`).send({ status: 'NEW' });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns a READY booking to DRAFT when edited', async () => {
    const draft = await createDraftBooking({ branchId: ownBranchId, status: 'READY' });
    const res = await adminAgent.put(`/api/admin/bookings/${draft.id}`).send({ customerName: 'Đổi tên' });
    expect(res.status).toBe(200);
    expect(res.body.booking.status).toBe('DRAFT');
    const history = await testPrisma.bookingStatusHistory.findMany({ where: { bookingId: draft.id } });
    expect(history.some((h) => h.oldStatus === 'READY' && h.newStatus === 'DRAFT')).toBe(true);
  });

  it('cannot edit a booking that has already been sent', async () => {
    const draft = await createDraftBooking({ branchId: ownBranchId, status: 'NEW' });
    const res = await adminAgent.put(`/api/admin/bookings/${draft.id}`).send({ customerName: 'X' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
  });

  it('forbids a receptionist from editing', async () => {
    const draft = await createDraftBooking({ branchId: ownBranchId });
    const res = await receptionistAgent.put(`/api/admin/bookings/${draft.id}`).send({ customerName: 'X' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });
});

describe('POST /api/admin/bookings/:id/ready', () => {
  it('marks a valid DRAFT ready and records history', async () => {
    const draft = await createDraftBooking({ branchId: ownBranchId });
    const res = await adminAgent.post(`/api/admin/bookings/${draft.id}/ready`).send({});
    expect(res.status).toBe(200);
    expect(res.body.booking.status).toBe('READY');
    const history = await testPrisma.bookingStatusHistory.findMany({ where: { bookingId: draft.id } });
    expect(history.some((h) => h.oldStatus === 'DRAFT' && h.newStatus === 'READY')).toBe(true);
  });

  it('blocks READY with 422 and errors when the branch is missing', async () => {
    const draft = await createDraftBooking({ branchId: null });
    const res = await adminAgent.post(`/api/admin/bookings/${draft.id}/ready`).send({});
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('BOOKING_NOT_READY');
    expect(res.body.error.details.errors.map((e: { code: string }) => e.code)).toContain('BRANCH_NOT_SELECTED');
  });
});
