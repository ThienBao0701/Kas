/**
 * "Gửi lại" for an order the Admin WITHDREW.
 *
 * THIS IS NOT THE CLAIM RESEND. `bookingClaim.test.ts` covers the other one: a
 * receptionist held an order, let the three minutes lapse, and it goes back on
 * their queue. That order was never withdrawn and is still valid.
 *
 * This one covers "the Admin sent the wrong thing, took it back, and wants to
 * send it again". The rule is two conditions on the row — it must have been sent
 * once, and it must currently be withdrawn — and every case below is one of
 * those conditions failing or holding.
 *
 * The enforcement being in the WHERE of the update is the point: these call the
 * API directly, with no screen involved, because hiding a button is not a rule.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { seedBranches } from '../src/db/seed';
import { resetAll, testPrisma } from './helpers/db';
import {
  ADMIN_PASSWORD,
  RECEPTIONIST_PASSWORD,
  createAdmin,
  createReceptionist,
  loginAgent,
} from './helpers/auth';
import { resetClock, setClock } from '../src/lib/clock';

let app: ReturnType<typeof createApp>;
let adminAgent: Awaited<ReturnType<typeof loginAgent>>['agent'];
let letan: Awaited<ReturnType<typeof loginAgent>>['agent'];
let adminId: number;
let cn1: number;

const NOW = new Date('2026-08-13T03:00:00.000Z');

beforeAll(async () => {
  await resetAll();
  await testPrisma.branchSourceAlias.deleteMany({});
  await seedBranches(testPrisma);
  app = createApp();

  cn1 = (await testPrisma.branch.findFirstOrThrow({ orderBy: { id: 'asc' } })).id;

  await createAdmin({ mustChangePassword: false });
  adminAgent = (await loginAgent(app, 'admin', ADMIN_PASSWORD)).agent;
  adminId = (await testPrisma.user.findUniqueOrThrow({ where: { username: 'admin' } })).id;

  await createReceptionist(cn1, { username: 'letana', mustChangePassword: false });
  letan = (await loginAgent(app, 'letana', RECEPTIONIST_PASSWORD)).agent;
}, 120_000);

beforeEach(async () => {
  await testPrisma.bookingAuditEvent.deleteMany({});
  await testPrisma.bookingStatusHistory.deleteMany({});
  await testPrisma.bookingCreationProof.deleteMany({});
  await testPrisma.notification.deleteMany({});
  await testPrisma.booking.deleteMany({});
  setClock({ now: () => NOW });
});

afterEach(() => resetClock());

afterAll(async () => {
  resetClock();
  await testPrisma.$disconnect();
});

/** A booking in a chosen lifecycle position. */
async function makeBooking(over: {
  sent?: boolean;
  deleted?: boolean;
  status?: 'DRAFT' | 'NEW';
  verification?: 'NOT_SUBMITTED' | 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED';
} = {}): Promise<string> {
  const sent = over.sent ?? true;
  const b = await testPrisma.booking.create({
    data: {
      bookingCode: `BK-${Math.random().toString(36).slice(2, 10)}`,
      customerName: 'NGUYEN VAN A',
      rawText: 'raw',
      paymentStatus: 'PAY_AFTER',
      branchId: cn1,
      status: over.status ?? (sent ? 'NEW' : 'DRAFT'),
      verificationStatus: over.verification ?? 'NOT_SUBMITTED',
      sentAt: sent ? new Date(NOW.getTime() - 3_600_000) : null,
      sentByUserId: sent ? adminId : null,
      ...(over.deleted
        ? { deletedAt: new Date(NOW.getTime() - 60_000), deletedByUserId: adminId }
        : {}),
    },
  });
  return b.id;
}

const redispatch = (id: string) => adminAgent.post(`/api/admin/bookings/${id}/redispatch`);

/* ================================================================== */
/* The four cases                                                      */
/* ================================================================== */

describe('resend eligibility', () => {
  it('CASE A — sent but NOT deleted: refused', async () => {
    const id = await makeBooking({ sent: true, deleted: false });

    const res = await redispatch(id);
    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/xoá đơn trước/i);

    // Untouched: still with the branch, same dispatch instant.
    const row = await testPrisma.booking.findUniqueOrThrow({ where: { id } });
    expect(row.deletedAt).toBeNull();
    expect(row.sentAt!.getTime()).toBe(NOW.getTime() - 3_600_000);
  });

  it('CASE B — sent and then deleted: allowed', async () => {
    const id = await makeBooking({ sent: true, deleted: true });

    const res = await redispatch(id);
    expect(res.status).toBe(200);

    const row = await testPrisma.booking.findUniqueOrThrow({ where: { id } });
    expect(row.deletedAt).toBeNull();          // visible again
    expect(row.deletedByUserId).toBeNull();
    expect(row.status).toBe('NEW');
    expect(row.sentAt!.toISOString()).toBe(NOW.toISOString());
    expect(row.sentByUserId).toBe(adminId);
  });

  it('CASE C — never sent: refused', async () => {
    const id = await makeBooking({ sent: false, deleted: true });

    const res = await redispatch(id);
    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/chưa từng được gửi/i);

    const row = await testPrisma.booking.findUniqueOrThrow({ where: { id } });
    expect(row.sentAt).toBeNull();
  });

  it('CASE D — already resent: cannot be resent again through the same deletion', async () => {
    const id = await makeBooking({ sent: true, deleted: true });
    expect((await redispatch(id)).status).toBe(200);

    // The first resend cleared `deletedAt`, so the order is no longer withdrawn
    // and the rule stops holding. No counter is involved.
    const second = await redispatch(id);
    expect(second.status).toBe(409);
    expect(second.body.error.message).toMatch(/xoá đơn trước/i);
  });

  /*
    APPROVED is a statement about the OUTSIDE WORLD, not a workflow stage:
    `approveProof` records that an Admin verified the reservation exists in the
    hotel system. Sending such an order back asks a receptionist to create it a
    second time — the duplicate this whole claim feature exists to prevent — and
    would erase the Admin's own sign-off to make room for that work.

    The system already has a way to say "create this again": reject the proof.
  */
  it('APPROVED + deleted: REFUSED, and the approval is left intact', async () => {
    const id = await makeBooking({ sent: true, deleted: true, verification: 'APPROVED' });

    const res = await redispatch(id);
    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/tạo trùng/i);

    const row = await testPrisma.booking.findUniqueOrThrow({ where: { id } });
    expect(row.verificationStatus).toBe('APPROVED');  // not silently discarded
    expect(row.deletedAt).not.toBeNull();             // still withdrawn
  });

  it('the other verification states are still resendable', async () => {
    for (const verification of ['NOT_SUBMITTED', 'PENDING_REVIEW', 'REJECTED'] as const) {
      const id = await makeBooking({ sent: true, deleted: true, verification });
      const res = await redispatch(id);
      expect(res.status, `verification=${verification}`).toBe(200);
      const row = await testPrisma.booking.findUniqueOrThrow({ where: { id } });
      expect(row.verificationStatus).toBe('NOT_SUBMITTED');
    }
  });

  it('CASE D — but a NEW withdrawal makes it resendable again', async () => {
    const id = await makeBooking({ sent: true, deleted: true });
    expect((await redispatch(id)).status).toBe(200);

    // A fresh, deliberate withdrawal is a new decision about a new dispatch.
    expect((await adminAgent.delete(`/api/admin/bookings/${id}`)).status).toBe(200);
    expect((await redispatch(id)).status).toBe(200);
  });
});

/* ================================================================== */
/* What a resend does to the branch's work                             */
/* ================================================================== */

describe('a resent order is fresh work for the branch', () => {
  it('clears the claim and advances the cycle so reception must CẮT again', async () => {
    const id = await makeBooking({ sent: true, deleted: true });
    await testPrisma.booking.update({
      where: { id },
      data: {
        claimedByUserId: adminId,
        claimedAt: NOW,
        claimExpiresAt: new Date(NOW.getTime() + 60_000),
        claimCycle: 2,
      },
    });

    await redispatch(id);

    const row = await testPrisma.booking.findUniqueOrThrow({ where: { id } });
    expect(row.claimedByUserId).toBeNull();
    expect(row.claimExpiresAt).toBeNull();
    expect(row.claimCycle).toBe(3);
    expect(row.verificationStatus).toBe('NOT_SUBMITTED');
  });

  it('records the resend in the audit trail and the status history', async () => {
    const id = await makeBooking({ sent: true, deleted: true });
    await redispatch(id);

    const events = await testPrisma.bookingAuditEvent.findMany({
      where: { bookingId: id, action: 'BOOKING_RESENT' },
    });
    expect(events).toHaveLength(1);
    expect(events[0]!.reason).toBe('REDISPATCH_AFTER_DELETE');

    const history = await testPrisma.bookingStatusHistory.findMany({ where: { bookingId: id } });
    expect(history.some((h) => h.newStatus === 'NEW')).toBe(true);
  });

  it('puts the order back on the receptionist queue', async () => {
    const id = await makeBooking({ sent: true, deleted: true });

    // Withdrawn, so reception cannot see it.
    const before = await letan.get('/api/bookings/new');
    expect((before.body.bookings as { id: string }[]).map((b) => b.id)).not.toContain(id);

    await redispatch(id);

    const after = await letan.get('/api/bookings/new');
    expect((after.body.bookings as { id: string }[]).map((b) => b.id)).toContain(id);
  });
});

/* ================================================================== */
/* Authorization and the flag the screen reads                         */
/* ================================================================== */

describe('authorization and the canRedispatch flag', () => {
  it('refuses a RECEPTIONIST', async () => {
    const id = await makeBooking({ sent: true, deleted: true });
    expect((await letan.post(`/api/admin/bookings/${id}/redispatch`)).status).toBe(403);
    expect((await testPrisma.booking.findUniqueOrThrow({ where: { id } })).deletedAt).not.toBeNull();
  });

  it('refuses an anonymous caller', async () => {
    const id = await makeBooking({ sent: true, deleted: true });
    const anon = (await import('supertest')).default(app);
    expect((await anon.post(`/api/admin/bookings/${id}/redispatch`)).status).toBe(401);
  });

  it('the flag agrees with the rule the server enforces', async () => {
    const notDeleted = await makeBooking({ sent: true, deleted: false });
    const withdrawn = await makeBooking({ sent: true, deleted: true });
    const neverSent = await makeBooking({ sent: false, deleted: true });
    const approved = await makeBooking({ sent: true, deleted: true, verification: 'APPROVED' });

    const flagOf = async (id: string) =>
      (await adminAgent.get(`/api/admin/bookings/${id}`)).body.booking.canRedispatch;

    expect(await flagOf(notDeleted)).toBe(false);
    expect(await flagOf(withdrawn)).toBe(true);
    expect(await flagOf(neverSent)).toBe(false);
    // The button must not offer what the endpoint refuses.
    expect(await flagOf(approved)).toBe(false);

    // And after a resend it flips back, matching CASE D.
    await redispatch(withdrawn);
    expect(await flagOf(withdrawn)).toBe(false);
  });

  it('refuses an unknown booking', async () => {
    expect((await redispatch('does-not-exist')).status).toBe(404);
  });
});

/* ================================================================== */
/* The order may have been replaced while it was withdrawn             */
/* ================================================================== */

/**
 * Withdrawing an order stopped blocking a fresh dispatch of the same
 * reservation — correct, because a withdrawn order asks nobody to create
 * anything. That opened a gap at the other end: the Admin can withdraw A, send
 * the same reservation as B, and still be looking at A's "Gửi lại" button.
 *
 * WHAT ACTUALLY STOPS IT. Reviving A clears its `deletedAt`, which moves the
 * row INTO `Booking_one_operational_per_code_branch_checkin` — where B already
 * sits under the same key. PostgreSQL rejects the UPDATE. That was already true
 * before the application check existed, and it is what makes the rule safe under
 * concurrency rather than merely usually right.
 *
 * The application check added alongside it changes the MESSAGE, not the outcome:
 * without it an Admin saw "Dữ liệu đã tồn tại" and a list of column names, about
 * a booking the screen never mentioned.
 *
 * These cases assert both halves — the refusal, and that A is left exactly as it
 * was.
 */
describe('reviving an order that has already been replaced', () => {
  /** Two bookings sharing one operational identity: (code, branch, check-in). */
  async function pair(opts: {
    /** Whether the SECOND booking is live or itself withdrawn. */
    otherDeleted: boolean;
    verification?: 'NOT_SUBMITTED' | 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED';
  }) {
    const identity = {
      bookingCode: `DUP-${Math.random().toString(36).slice(2, 10)}`,
      branchId: cn1,
      checkInDate: new Date('2026-09-01T00:00:00.000Z'),
    };
    const common = {
      customerName: 'NGUYEN VAN A',
      rawText: 'raw',
      paymentStatus: 'PAY_AFTER' as const,
      sentAt: new Date(NOW.getTime() - 3_600_000),
      sentByUserId: adminId,
      status: 'NEW' as const,
    };

    const withdrawn = await testPrisma.booking.create({
      data: {
        ...identity,
        ...common,
        verificationStatus: opts.verification ?? 'NOT_SUBMITTED',
        deletedAt: new Date(NOW.getTime() - 60_000),
        deletedByUserId: adminId,
      },
    });
    const other = await testPrisma.booking.create({
      data: {
        ...identity,
        ...common,
        ...(opts.otherDeleted
          ? { deletedAt: new Date(NOW.getTime() - 30_000), deletedByUserId: adminId }
          : {}),
      },
    });
    return { withdrawn: withdrawn.id, other: other.id };
  }

  it('CASE 1 — withdrawn with NO active duplicate: still allowed', async () => {
    // The ordinary path, unchanged. `makeBooking` gives each order its own code.
    const id = await makeBooking({ sent: true, deleted: true });

    const res = await redispatch(id);
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(200);

    const row = await testPrisma.booking.findUniqueOrThrow({ where: { id } });
    expect(row.deletedAt).toBeNull();
    expect(row.status).toBe('NEW');
  });

  it('CASE 2 — withdrawn WITH an active duplicate: refused', async () => {
    const { withdrawn, other } = await pair({ otherDeleted: false });

    const res = await redispatch(withdrawn);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('DUPLICATE_BOOKING');
    // It names the order that is actually in the way, which is the whole point
    // of checking in the application rather than letting the index answer.
    expect(res.body.error.details.existingBookingId).toBe(other);
    expect(res.body.error.message).toMatch(/tạo trùng/i);
  });

  it('CASE 3 — withdrawn, and the only other match is ALSO withdrawn: allowed', async () => {
    const { withdrawn, other } = await pair({ otherDeleted: true });

    const res = await redispatch(withdrawn);
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(200);

    const revived = await testPrisma.booking.findUniqueOrThrow({ where: { id: withdrawn } });
    expect(revived.deletedAt).toBeNull();
    // The other withdrawn order is history and stays that way.
    const untouched = await testPrisma.booking.findUniqueOrThrow({ where: { id: other } });
    expect(untouched.deletedAt).not.toBeNull();
  });

  it('CASE 4 — the active duplicate is not touched by the refusal', async () => {
    const { withdrawn, other } = await pair({ otherDeleted: false });
    const before = await testPrisma.booking.findUniqueOrThrow({ where: { id: other } });

    expect((await redispatch(withdrawn)).status).toBe(409);

    const after = await testPrisma.booking.findUniqueOrThrow({ where: { id: other } });
    expect(after.deletedAt).toBeNull();
    expect(after.status).toBe(before.status);
    expect(after.sentAt).toEqual(before.sentAt);
    expect(after.claimCycle).toBe(before.claimCycle);
    expect(after.verificationStatus).toBe(before.verificationStatus);
  });

  it('CASE 5 — the withdrawn order stays withdrawn after a refusal', async () => {
    const { withdrawn } = await pair({ otherDeleted: false });
    const before = await testPrisma.booking.findUniqueOrThrow({ where: { id: withdrawn } });

    expect((await redispatch(withdrawn)).status).toBe(409);

    const after = await testPrisma.booking.findUniqueOrThrow({ where: { id: withdrawn } });
    expect(after.deletedAt).toEqual(before.deletedAt);
    expect(after.deletedByUserId).toBe(before.deletedByUserId);
    expect(after.status).toBe(before.status);
    expect(after.sentAt).toEqual(before.sentAt);
    // Not half-revived: the claim cycle did not move either.
    expect(after.claimCycle).toBe(before.claimCycle);

    // And nothing was recorded as if the resend had happened.
    expect(
      await testPrisma.bookingAuditEvent.count({
        where: { bookingId: withdrawn, action: 'BOOKING_RESENT' },
      }),
    ).toBe(0);
    expect(
      await testPrisma.bookingStatusHistory.count({ where: { bookingId: withdrawn } }),
    ).toBe(0);
  });

  it('CASE 6 — APPROVED still refuses as APPROVED, not as a duplicate', async () => {
    /*
      Both rules would block this order. The APPROVED refusal is the one that
      tells the Admin what to do about it — reject the proof — so it keeps its
      priority and its exact wording. The duplicate check is deliberately asked
      only of an order that is otherwise eligible.
    */
    const { withdrawn } = await pair({ otherDeleted: false, verification: 'APPROVED' });

    const res = await redispatch(withdrawn);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
    expect(res.body.error.code).not.toBe('DUPLICATE_BOOKING');
    expect(res.body.error.message).toMatch(/từ chối ảnh xác nhận/i);

    const row = await testPrisma.booking.findUniqueOrThrow({ where: { id: withdrawn } });
    expect(row.verificationStatus).toBe('APPROVED');
    expect(row.deletedAt).not.toBeNull();
  });

  it('CASE 7 — a different check-in date is a different reservation', async () => {
    // The identity is (code, branch, check-in). A live order for another stay
    // under the same code must not block this one.
    const bookingCode = `SAME-${Math.random().toString(36).slice(2, 8)}`;
    const common = {
      bookingCode,
      branchId: cn1,
      customerName: 'NGUYEN VAN A',
      rawText: 'raw',
      paymentStatus: 'PAY_AFTER' as const,
      sentAt: new Date(NOW.getTime() - 3_600_000),
      sentByUserId: adminId,
      status: 'NEW' as const,
    };
    const withdrawn = await testPrisma.booking.create({
      data: {
        ...common,
        checkInDate: new Date('2026-09-01T00:00:00.000Z'),
        deletedAt: new Date(NOW.getTime() - 60_000),
        deletedByUserId: adminId,
      },
    });
    await testPrisma.booking.create({
      data: { ...common, checkInDate: new Date('2026-10-01T00:00:00.000Z') },
    });

    const res = await redispatch(withdrawn.id);
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(200);
  });

  it('CASE 8 — concurrent revivals cannot both land', async () => {
    /*
      The race the database closes. Two "Gửi lại" clicks on two withdrawn orders
      for one reservation arrive together; both pass their application check,
      because neither has been revived yet. Only one UPDATE can take the key in
      the partial unique index, so only one order comes back.

      This is why the fix did not need a new transaction: the guarantee was
      already in the index the previous migration corrected.
    */
    const { withdrawn, other } = await pair({ otherDeleted: true });

    const results = await Promise.all([redispatch(withdrawn), redispatch(other)]);
    const revived = results.filter((r) => r.status === 200);
    expect(revived).toHaveLength(1);

    const live = await testPrisma.booking.findMany({
      where: { id: { in: [withdrawn, other] }, deletedAt: null },
    });
    expect(live).toHaveLength(1);
  });

  it('CASE 9 — a fresh dispatch racing a revival cannot double up either', async () => {
    // Same protection from the other direction: reviving A while B is being
    // created for the same reservation.
    const { withdrawn, other } = await pair({ otherDeleted: true });

    const results = await Promise.all([
      redispatch(withdrawn),
      redispatch(other),
      redispatch(withdrawn),
    ]);
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(
      await testPrisma.booking.count({
        where: { id: { in: [withdrawn, other] }, deletedAt: null },
      }),
    ).toBe(1);
  });
});
