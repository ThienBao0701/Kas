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
let otherBranchId: number;

beforeEach(async () => {
  await resetAll();
  await seedBranches(testPrisma);
  app = createApp();
  ownBranchId = (await testPrisma.branch.findUniqueOrThrow({ where: { code: 'TRUONG_DINH_05' } })).id;
  otherBranchId = (await testPrisma.branch.findUniqueOrThrow({ where: { code: 'LY_TU_TRONG_260' } })).id;

  await createAdmin({ mustChangePassword: false });
  adminAgent = (await loginAgent(app, 'admin', ADMIN_PASSWORD)).agent;
  await createReceptionist(ownBranchId, { username: 'letan_own', mustChangePassword: false });
  ownAgent = (await loginAgent(app, 'letan_own', RECEPTIONIST_PASSWORD)).agent;
  await createReceptionist(otherBranchId, { username: 'letan_other', mustChangePassword: false });
});

afterAll(async () => {
  await testPrisma.$disconnect();
});

describe('GET /api/bookings/new', () => {
  it('shows a receptionist only their own branch, admin all branches', async () => {
    await createDraftBooking({ status: 'NEW', branchId: ownBranchId, bookingCode: 'OWN1111111' });
    await createDraftBooking({ status: 'NEW', branchId: otherBranchId, bookingCode: 'OTH2222222' });

    const own = await ownAgent.get('/api/bookings/new');
    expect(own.status).toBe(200);
    expect(own.body.bookings).toHaveLength(1);
    expect(own.body.bookings[0].branch.id).toBe(ownBranchId);

    const admin = await adminAgent.get('/api/bookings/new');
    expect(admin.body.bookings).toHaveLength(2);
    expect(admin.body.pagination.total).toBe(2);
  });

  it('ignores a client branchId for a receptionist (isolation)', async () => {
    await createDraftBooking({ status: 'NEW', branchId: otherBranchId });
    const res = await ownAgent.get(`/api/bookings/new?branchId=${otherBranchId}`);
    expect(res.body.bookings).toHaveLength(0);
  });

  it('sorts last-minute first, then by nearest check-in', async () => {
    await createDraftBooking({ status: 'NEW', branchId: ownBranchId, bookingCode: 'FAR0000001', checkIn: '2026-09-10', checkOut: '2026-09-12', isLastMinute: false });
    await createDraftBooking({ status: 'NEW', branchId: ownBranchId, bookingCode: 'SOON000001', checkIn: '2026-08-01', checkOut: '2026-08-03', isLastMinute: false });
    await createDraftBooking({ status: 'NEW', branchId: ownBranchId, bookingCode: 'LAST000001', checkIn: '2026-07-30', checkOut: '2026-08-01', isLastMinute: true });

    const res = await ownAgent.get('/api/bookings/new');
    expect(res.body.bookings.map((b: { bookingCode: string }) => b.bookingCode)).toEqual([
      'LAST000001', 'SOON000001', 'FAR0000001',
    ]);
    expect(res.body.bookings[0].isLastMinute).toBe(true);
  });

  it('reports the count of missing nightly prices and supports pagination', async () => {
    await createDraftBooking({ status: 'NEW', branchId: ownBranchId, nightlyAmount: null });
    const res = await ownAgent.get('/api/bookings/new?page=1&pageSize=1');
    expect(res.body.bookings[0].missingNightlyPriceCount).toBe(3);
    expect(res.body.pagination.pageSize).toBe(1);
  });
});

describe('GET /api/bookings/:id (operational detail)', () => {
  it('lets a receptionist view their own branch booking without rawText', async () => {
    const b = await createDraftBooking({ status: 'NEW', branchId: ownBranchId });
    const res = await ownAgent.get(`/api/bookings/${b.id}`);
    expect(res.status).toBe(200);
    expect(res.body.booking.rawText).toBeUndefined();
    expect(res.body.booking.rooms[0].nights).toHaveLength(3);
  });

  it('includes rawText for an admin', async () => {
    const b = await createDraftBooking({ status: 'NEW', branchId: ownBranchId });
    const res = await adminAgent.get(`/api/bookings/${b.id}`);
    expect(res.body.booking.rawText).toBeTruthy();
  });

  it("denies a receptionist another branch's booking", async () => {
    const b = await createDraftBooking({ status: 'NEW', branchId: otherBranchId });
    const res = await ownAgent.get(`/api/bookings/${b.id}`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('BRANCH_ACCESS_DENIED');
  });

  it('hides a not-yet-dispatched DRAFT from a receptionist', async () => {
    const b = await createDraftBooking({ status: 'DRAFT', branchId: ownBranchId });
    const res = await ownAgent.get(`/api/bookings/${b.id}`);
    expect(res.status).toBe(404);
  });
});

describe('GET /api/bookings/completed', () => {
  it('isolates by branch and lets an admin filter, newest first', async () => {
    await createDraftBooking({ status: 'COMPLETED', branchId: ownBranchId, completedAt: '2026-07-10T00:00:00.000Z', bookingCode: 'C111111111' });
    await createDraftBooking({ status: 'COMPLETED', branchId: ownBranchId, completedAt: '2026-07-12T00:00:00.000Z', bookingCode: 'C222222222' });
    await createDraftBooking({ status: 'COMPLETED', branchId: otherBranchId, bookingCode: 'C333333333' });

    const own = await ownAgent.get('/api/bookings/completed');
    expect(own.body.bookings).toHaveLength(2);
    // Newest completion first.
    expect(own.body.bookings[0].bookingCode).toBe('C222222222');

    const adminFiltered = await adminAgent.get(`/api/bookings/completed?branchId=${otherBranchId}`);
    expect(adminFiltered.body.bookings).toHaveLength(1);
    expect(adminFiltered.body.bookings[0].branch.id).toBe(otherBranchId);
  });
});

describe('GET /api/bookings/history', () => {
  beforeEach(async () => {
    await createDraftBooking({ status: 'NEW', branchId: ownBranchId, bookingCode: 'HCODE00001', customerName: 'Lê Văn Sử', phone: '0900111222', paymentStatus: 'PAY_BEFORE', isLastMinute: true });
    await createDraftBooking({ status: 'COMPLETED', branchId: otherBranchId, bookingCode: 'HCODE00002', customerName: 'Khác Chi Nhánh', phone: '0933444555' });
  });

  it('searches by booking code, customer name and phone (admin, all branches)', async () => {
    expect((await adminAgent.get('/api/bookings/history?search=HCODE00001')).body.bookings).toHaveLength(1);
    expect((await adminAgent.get('/api/bookings/history?search=Lê Văn Sử')).body.bookings).toHaveLength(1);
    expect((await adminAgent.get('/api/bookings/history?search=0933444555')).body.bookings).toHaveLength(1);
  });

  it('filters by status, payment and last-minute', async () => {
    expect((await adminAgent.get('/api/bookings/history?status=COMPLETED')).body.bookings).toHaveLength(1);
    expect((await adminAgent.get('/api/bookings/history?paymentStatus=PAY_BEFORE')).body.bookings).toHaveLength(1);
    expect((await adminAgent.get('/api/bookings/history?isLastMinute=true')).body.bookings).toHaveLength(1);
  });

  it('restricts a receptionist to their own branch regardless of branchId', async () => {
    const res = await ownAgent.get(`/api/bookings/history?branchId=${otherBranchId}`);
    expect(res.body.bookings.every((b: { branch: { id: number } }) => b.branch.id === ownBranchId)).toBe(true);
    expect(res.body.bookings).toHaveLength(1);
  });

  it('returns pagination metadata', async () => {
    const res = await adminAgent.get('/api/bookings/history?page=1&pageSize=1');
    expect(res.body.pagination).toMatchObject({ page: 1, pageSize: 1, total: 2, totalPages: 2 });
  });
});
