/**
 * Dispatch-order ownership — the "CUT" claim.
 *
 * WHY THIS EXISTS, IN ONE SENTENCE: every receptionist at a branch sees the
 * same dispatch queue, so without an owner two of them can create the SAME
 * reservation in the hotel system, and the hotel ends up double-booked. The
 * claim is the lock that prevents that. The three-minute countdown is only a
 * deadline on holding the lock — it is not the safety mechanism, and a feature
 * that shipped the timer without the server-side claim would prevent nothing.
 *
 * ── WHY NOT `BookingStatus.RECEIVED` ──────────────────────────────────────
 * `RECEIVED` / `receivedAt` / `receivedByUserId` already exist and look like a
 * claim. They are not. They belong to the guest-stay lifecycle in
 * `lifecycle.ts` (RECEIVED is what CHECK_IN transitions FROM) and mean "the
 * branch acknowledged the guest". Reusing them would make taking an order for
 * creation indistinguishable from the guest having arrived. This module lives
 * on the verification axis instead and never touches `status`.
 *
 * ── EXPIRY IS DERIVED, NOT SWEPT ──────────────────────────────────────────
 * There is no domain scheduler in KAS and this feature does not justify
 * introducing one. A claim is active while `claimExpiresAt > now`; every read
 * filters on that timestamp and every write re-checks it. The consequence that
 * matters: an expired claim cannot be acted on even when a polled screen still
 * shows it as active, because the deadline is re-evaluated inside the same
 * conditional update that performs the work.
 *
 * ── CONCURRENCY ───────────────────────────────────────────────────────────
 * Uses the pattern `proof.ts` and `lifecycle.ts` already established: a single
 * conditional `updateMany` whose WHERE encodes every precondition. Two
 * receptionists pressing CUT at the same instant serialise on the booking row;
 * the loser's WHERE matches nothing once the winner commits and it is reported
 * as a conflict rather than silently overwriting the winner's ownership. No new
 * concurrency primitive, no advisory locks.
 */
import type { Prisma, PrismaClient, UserRole } from '@prisma/client';
import { prisma as defaultPrisma } from '../db/prisma';
import { ApiError } from '../lib/errors';
import { getClock, type Clock } from '../lib/clock';

/**
 * The creation window, in milliseconds. THREE MINUTES, deliberately.
 *
 * A named constant rather than configuration: it is a business rule the
 * operator chose, and a per-branch or per-user override would make "how long do
 * I have?" unanswerable at a glance. Exported so tests assert the real value
 * instead of restating it.
 */
export const CLAIM_WINDOW_MS = 3 * 60 * 1000;

/** Who is acting. Mirrors the shape the rest of the booking modules pass. */
export interface ClaimActor {
  id: number;
  role: UserRole;
  branchId: number | null;
}

/**
 * The verification states a dispatched order can be claimed in.
 *
 * `NOT_SUBMITTED` is a fresh dispatch; `REJECTED` is "Cần tạo lại", where the
 * receptionist must create the reservation again — the same duplicate risk, so
 * the same protection. `PENDING_REVIEW` and `APPROVED` are deliberately absent:
 * the creation work is already done and there is nothing left to own.
 */
export const CLAIMABLE_VERIFICATION_STATUSES = ['NOT_SUBMITTED', 'REJECTED'] as const;

/** A booking row carrying the claim columns. */
export interface ClaimFields {
  claimedByUserId: number | null;
  claimedAt: Date | null;
  claimExpiresAt: Date | null;
  claimCycle: number;
}

/** Whether a claim is currently held, as of `now`. */
export function isClaimActive(booking: ClaimFields, now: Date): boolean {
  return (
    booking.claimedByUserId !== null &&
    booking.claimExpiresAt !== null &&
    booking.claimExpiresAt.getTime() > now.getTime()
  );
}

/** Whether a claim was held and the deadline has passed. */
export function isClaimExpired(booking: ClaimFields, now: Date): boolean {
  return (
    booking.claimedByUserId !== null &&
    booking.claimExpiresAt !== null &&
    booking.claimExpiresAt.getTime() <= now.getTime()
  );
}

/**
 * The `where` fragment matching an order whose claim is free — never claimed,
 * or claimed and expired.
 *
 * Written as Prisma OR rather than fetched-then-compared so the check runs IN
 * THE DATABASE, inside the same statement that takes ownership. A read-then-
 * write version has a window between the two in which another receptionist can
 * claim, which is precisely the bug this module exists to prevent.
 */
export function claimableWhere(now: Date): Prisma.BookingWhereInput {
  return {
    OR: [{ claimedByUserId: null }, { claimExpiresAt: { lt: now } }],
  };
}

export interface ClaimResult {
  claimedAt: Date;
  claimExpiresAt: Date;
  claimCycle: number;
}

/**
 * Takes ownership of a dispatched order ("CUT").
 *
 * RECEPTIONIST ONLY. An Admin has no creation work to own, and letting one
 * claim would hide the order from the branch that has to act on it.
 *
 * The conditional update below is the whole safety property. Its WHERE encodes,
 * atomically: the order still exists and is not deleted, it is still dispatched
 * (`status: NEW`), it is still in a state that needs creating, it belongs to
 * this receptionist's branch, and no unexpired claim is held. Anything else and
 * `count` is 0 and the caller is told why.
 */
export async function claimBooking(
  bookingId: string,
  actor: ClaimActor,
  client: PrismaClient = defaultPrisma,
  clock: Clock = getClock(),
): Promise<ClaimResult> {
  if (actor.role !== 'RECEPTIONIST') {
    throw ApiError.forbidden('Chỉ lễ tân mới nhận được đơn.');
  }

  const now = clock.now();
  const claimExpiresAt = new Date(now.getTime() + CLAIM_WINDOW_MS);

  const claimed = await client.booking.updateMany({
    where: {
      id: bookingId,
      deletedAt: null,
      status: 'NEW',
      verificationStatus: { in: [...CLAIMABLE_VERIFICATION_STATUSES] },
      // Branch scoping is part of the atomic condition, not a separate check —
      // a receptionist must never take an order belonging to another branch,
      // and doing it here means there is no window between checking and taking.
      branchId: actor.branchId,
      ...claimableWhere(now),
    },
    data: {
      claimedByUserId: actor.id,
      claimedAt: now,
      claimExpiresAt,
    },
  });

  if (claimed.count === 0) {
    // Nothing was claimed. Work out WHY so the receptionist gets a message that
    // tells them what to do, rather than a bare conflict.
    await explainClaimFailure(bookingId, actor, now, client);
  }

  const row = await client.booking.findUniqueOrThrow({
    where: { id: bookingId },
    select: { claimedAt: true, claimExpiresAt: true, claimCycle: true },
  });

  await client.bookingAuditEvent.create({
    data: {
      bookingId,
      action: 'BOOKING_CLAIMED',
      newValue: `CYCLE_${row.claimCycle}`,
      actorUserId: actor.id,
      actorRole: actor.role,
    },
  });

  return {
    claimedAt: row.claimedAt!,
    claimExpiresAt: row.claimExpiresAt!,
    claimCycle: row.claimCycle,
  };
}

/**
 * Turns a failed claim into a specific, actionable error. Always throws.
 *
 * Read AFTER the failed update, so it describes the state that actually beat
 * us rather than a state we sampled beforehand.
 */
async function explainClaimFailure(
  bookingId: string,
  actor: ClaimActor,
  now: Date,
  client: PrismaClient,
): Promise<never> {
  const booking = await client.booking.findFirst({
    where: { id: bookingId, deletedAt: null },
    select: {
      status: true,
      verificationStatus: true,
      branchId: true,
      claimedByUserId: true,
      claimExpiresAt: true,
      claimedBy: { select: { fullName: true } },
    },
  });

  if (!booking) throw ApiError.notFound('Không tìm thấy đơn.');
  if (actor.role === 'RECEPTIONIST' && booking.branchId !== actor.branchId) {
    throw ApiError.branchAccessDenied();
  }
  if (booking.status !== 'NEW') {
    throw ApiError.conflict('Đơn không còn ở trạng thái chờ tạo.', { status: booking.status });
  }
  if (!(CLAIMABLE_VERIFICATION_STATUSES as readonly string[]).includes(booking.verificationStatus)) {
    throw ApiError.conflict('Đơn này không cần tạo nữa.', {
      verificationStatus: booking.verificationStatus,
    });
  }
  if (
    booking.claimedByUserId !== null &&
    booking.claimExpiresAt !== null &&
    booking.claimExpiresAt.getTime() > now.getTime()
  ) {
    const who = booking.claimedBy?.fullName ?? 'một lễ tân khác';
    throw ApiError.conflict(`Đơn này đã được ${who} nhận. Bạn không thể nhận đơn này.`, {
      claimedByUserId: booking.claimedByUserId,
      claimExpiresAt: booking.claimExpiresAt.toISOString(),
    });
  }
  throw ApiError.conflict('Không nhận được đơn. Vui lòng tải lại danh sách.');
}

/**
 * Guard for any work performed UNDER a claim — currently proof submission.
 *
 * THIS IS WHAT MAKES THE DEADLINE REAL. The countdown in the browser is
 * decoration; a receptionist whose tab was asleep, whose network dropped, or
 * whose polled list is stale will still be refused here, because the check runs
 * against the stored deadline at the moment of the write.
 *
 * Throws when the actor may not submit; returns silently when they may.
 */
export function assertClaimAllowsSubmission(
  booking: ClaimFields,
  actor: ClaimActor,
  now: Date,
): void {
  // Admins are not bound by the claim: they do not do creation work, and a
  // support action on behalf of a branch must not be blocked by a receptionist's
  // expired timer.
  if (actor.role !== 'RECEPTIONIST') return;

  // CUT IS A HARD PREREQUISITE. An unclaimed order cannot be submitted.
  //
  // This is the business rule, not a convenience: the duplicate being prevented
  // is created in the EXTERNAL hotel system, before any proof exists, and the
  // only way to stop two receptionists doing that work simultaneously is to
  // require one of them to own it first. Allowing an unclaimed submission would
  // leave the exact path the feature exists to close: both create the
  // reservation, one submits, the other discovers it afterwards.
  //
  // The cycle requirement is satisfied transitively rather than by comparing
  // `claimCycle`: a resend CLEARS the claim, so a holder from a previous cycle
  // no longer matches `claimedByUserId` and is refused by the branch below. A
  // stored per-claim cycle would be a second source of truth that could
  // disagree with the claim itself.
  if (booking.claimedByUserId === null) {
    throw ApiError.conflict('Bạn cần bấm CUT để nhận đơn trước khi gửi ảnh.');
  }

  if (booking.claimedByUserId !== actor.id) {
    throw ApiError.conflict('Đơn này đang do lễ tân khác nhận. Bạn không thể gửi ảnh cho đơn này.');
  }
  if (booking.claimExpiresAt === null || booking.claimExpiresAt.getTime() <= now.getTime()) {
    throw ApiError.conflict(
      'Đã quá 3 phút kể từ khi nhận đơn. Đơn đã được trả lại cho Admin để gửi lại.',
      { claimExpiresAt: booking.claimExpiresAt?.toISOString() ?? null },
    );
  }
}

/**
 * Releases an expired claim so the order can be taken again ("Gửi lại").
 *
 * ADMIN ONLY, and conditional on the claim STILL being expired — which is what
 * makes a double-clicked "Gửi lại" safe: the second request finds
 * `claimedByUserId` already null, matches nothing, and is reported as a
 * no-longer-applicable conflict instead of incrementing the cycle twice.
 *
 * The Booking row is never duplicated. A resend is the same business order
 * entering its next dispatch cycle, which is what `claimCycle` counts.
 */
export async function resendBooking(
  bookingId: string,
  actor: ClaimActor,
  client: PrismaClient = defaultPrisma,
  clock: Clock = getClock(),
): Promise<{ claimCycle: number }> {
  if (actor.role !== 'ADMIN') {
    throw ApiError.forbidden('Chỉ Admin mới gửi lại được đơn.');
  }

  const now = clock.now();
  const previous = await client.booking.findFirst({
    where: { id: bookingId, deletedAt: null },
    select: { claimedByUserId: true, claimExpiresAt: true, claimCycle: true, verificationStatus: true },
  });
  if (!previous) throw ApiError.notFound('Không tìm thấy đơn.');

  const released = await client.booking.updateMany({
    where: {
      id: bookingId,
      deletedAt: null,
      status: 'NEW',
      verificationStatus: { in: [...CLAIMABLE_VERIFICATION_STATUSES] },
      // Only an EXPIRED claim may be released. An active claim is someone's
      // work in progress, and a completed order has no claim to release.
      claimedByUserId: { not: null },
      claimExpiresAt: { lt: now },
    },
    data: {
      claimedByUserId: null,
      claimedAt: null,
      claimExpiresAt: null,
      claimCycle: { increment: 1 },
    },
  });

  if (released.count === 0) {
    if (previous.claimedByUserId === null) {
      throw ApiError.conflict('Đơn này đã được gửi lại rồi.');
    }
    if (previous.claimExpiresAt !== null && previous.claimExpiresAt.getTime() > now.getTime()) {
      throw ApiError.conflict('Đơn này vẫn đang trong thời gian xử lý của lễ tân.');
    }
    throw ApiError.conflict('Không gửi lại được đơn này.');
  }

  const row = await client.booking.findUniqueOrThrow({
    where: { id: bookingId },
    select: { claimCycle: true },
  });

  // Two rows, because two things happened: the previous claim ran out, and the
  // Admin put the order back. Recording only the resend would lose which
  // receptionist held it and lose the reason it came back at all.
  await client.bookingAuditEvent.createMany({
    data: [
      {
        bookingId,
        action: 'BOOKING_CLAIM_EXPIRED',
        oldValue: previous.claimedByUserId === null ? null : String(previous.claimedByUserId),
        reason: 'CLAIM_WINDOW_ELAPSED',
        actorUserId: actor.id,
        actorRole: actor.role,
      },
      {
        bookingId,
        action: 'BOOKING_RESENT',
        newValue: `CYCLE_${row.claimCycle}`,
        actorUserId: actor.id,
        actorRole: actor.role,
      },
    ],
  });

  return { claimCycle: row.claimCycle };
}
