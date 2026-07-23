import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { seedBranches } from '../src/db/seed';
import { setClock, resetClock } from '../src/lib/clock';
import { resetAll, testPrisma } from './helpers/db';
import { ADMIN_PASSWORD, RECEPTIONIST_PASSWORD, createAdmin, createReceptionist, loginAgent } from './helpers/auth';
import { createDraftBooking } from './helpers/bookings';

let app: ReturnType<typeof createApp>;
let adminAgent: Awaited<ReturnType<typeof loginAgent>>['agent'];
let branch1: number;
let branch2: number;

beforeEach(async () => {
  await resetAll();
  await seedBranches(testPrisma);
  app = createApp();
  branch1 = (await testPrisma.branch.findUniqueOrThrow({ where: { code: 'TRUONG_DINH_05' } })).id;
  branch2 = (await testPrisma.branch.findUniqueOrThrow({ where: { code: 'LY_TU_TRONG_260' } })).id;

  await createAdmin({ mustChangePassword: false });
  adminAgent = (await loginAgent(app, 'admin', ADMIN_PASSWORD)).agent;

  // Freeze "today" to 2026-07-15 (HCM) so the day-window maths is deterministic.
  setClock({ now: () => new Date('2026-07-15T05:00:00.000Z') });
});

afterEach(() => resetClock());
afterAll(async () => {
  await testPrisma.$disconnect();
});

describe('GET /api/admin/dashboard/summary', () => {
  it('computes totals and per-branch counts in the property timezone', async () => {
    // Waiting, not last-minute, sent today.
    await createDraftBooking({ status: 'NEW', branchId: branch1, bookingCode: 'W111111111', sentAt: '2026-07-15T02:00:00.000Z' });
    // Waiting AND last-minute (check-in today), sent today.
    await createDraftBooking({ status: 'NEW', branchId: branch2, bookingCode: 'LM22222222', checkIn: '2026-07-15', checkOut: '2026-07-17', sentAt: '2026-07-15T02:00:00.000Z' });
    // Confirmed today.
    await createDraftBooking({ status: 'COMPLETED', branchId: branch1, bookingCode: 'C333333333', sentAt: '2026-07-15T02:00:00.000Z', completedAt: '2026-07-15T03:00:00.000Z' });

    const res = await adminAgent.get('/api/admin/dashboard/summary');
    expect(res.status).toBe(200);
    expect(res.body.totals).toEqual({ waiting: 2, confirmedToday: 1, lastMinute: 1, sentToday: 3 });

    const b1 = res.body.branches.find((x: { branch: { id: number } }) => x.branch.id === branch1);
    const b2 = res.body.branches.find((x: { branch: { id: number } }) => x.branch.id === branch2);
    expect(b1).toMatchObject({ waiting: 1, confirmedToday: 1, lastMinute: 0 });
    expect(b2).toMatchObject({ waiting: 1, confirmedToday: 0, lastMinute: 1 });
    // All 8 seeded branches appear (even with zero activity).
    expect(res.body.branches).toHaveLength(8);
  });

  it('forbids a receptionist', async () => {
    await createReceptionist(branch1, { username: 'letan', mustChangePassword: false });
    const { agent } = await loginAgent(app, 'letan', RECEPTIONIST_PASSWORD);
    const res = await agent.get('/api/admin/dashboard/summary');
    expect(res.status).toBe(403);
  });
});
