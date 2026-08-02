/**
 * Dispatching a reviewed Agoda or CTrip reservation to its branch.
 *
 * Until now the OTA path ended at a note the Admin copied by hand: nothing was
 * recorded, so no branch saw the booking and no history existed. This turns the
 * reviewed reservation into a real `Booking` row on the SAME rails Booking.com
 * already uses — same table, same status machine, same status history, same
 * notifications — so every downstream feature (reception, proof, dashboards,
 * branch isolation) works for OTA bookings without being rebuilt.
 *
 * ── NOTHING THE BROWSER SENDS IS TRUSTED ──────────────────────────────────
 * The review is rebuilt server-side from the pasted text and the Admin's
 * corrections, exactly as the review screen does, and dispatch is refused
 * unless THAT review says it may proceed. A client cannot talk the server into
 * persisting a booking the review would have blocked.
 *
 * ── IDEMPOTENT BY OTA BOOKING CODE ────────────────────────────────────────
 * Pressing send twice, a retried request, or a double click must not create two
 * bookings for one reservation. A dispatched booking already carrying this
 * (code, platform) is returned untouched instead.
 */
import type { Prisma, PrismaClient } from '@prisma/client';
import { prisma as defaultPrisma } from '../db/prisma';
import { ApiError } from '../lib/errors';
import { getClock, isLastMinute, type Clock } from '../lib/clock';
import { createHash } from 'node:crypto';
import { buildOtaReviewFromText, type OtaReviewRequest } from './otaReviewService';
import { createBranchNotifications } from './dispatch';
import { parseAgodaBooking } from './agoda';
import { parseCtripBooking } from './ctrip';
import { OTA_REVIEW_VERSION } from './otaReview';
import type { OtaReview } from './otaReview';
import { collectCorrections } from './otaCorrections';

/** The Admin performing the dispatch. */
export interface OtaDispatchActor {
  id: number;
  fullName: string;
}

export interface OtaDispatchResult {
  bookingId: string;
  /** False when an identical reservation had already been dispatched. */
  created: boolean;
  review: OtaReview;
}

/**
 * Every state a booking that HAS been dispatched can hold.
 *
 * DRAFT and READY are deliberately absent: those are Booking.com's pre-send
 * states, and a reservation sitting in one has not reached a branch.
 */
const DISPATCHED_STATES = [
  'NEW',
  'RECEIVED',
  'CHECKED_IN',
  'CHECKED_OUT',
  'COMPLETED',
  'CANCELLED',
  'NO_SHOW',
  'ARCHIVED',
] as const;

/** ISO "YYYY-MM-DD" to a UTC midnight Date, matching the rest of the store. */
function isoToUtcDate(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

/** CN / hotel-payment maps onto the existing payment status vocabulary. */
function paymentStatusOf(review: OtaReview): 'PAY_BEFORE' | 'PAY_AFTER' {
  // CN is settled with the platform before arrival; hotel payment is collected
  // at the desk. These are the two values the rest of the system already knows.
  return review.paymentMode === 'CN' ? 'PAY_BEFORE' : 'PAY_AFTER';
}

/**
 * Rebuilds the review, then persists it as a dispatched booking.
 *
 * The whole write is one transaction: booking, rooms, nightly prices, warnings,
 * status history and notifications either all land or none do.
 */
export async function dispatchOtaReview(
  request: OtaReviewRequest,
  actor: OtaDispatchActor,
  client: PrismaClient = defaultPrisma,
  clock: Clock = getClock(),
): Promise<OtaDispatchResult> {
  // Re-derive rather than accept. This is the same call the review screen makes.
  const { review } = await buildOtaReviewFromText(request, client);

  // The SAME parse the review is built from, re-run for the DESCRIPTIVE fields
  // the review does not carry — country, language, benefits, the platform's own
  // status and identifiers. Those are recorded exactly as the parser read them:
  // they are not correctable on the review screen, so there is nothing for an
  // Admin's override to win over, and inventing a value for a field the mail
  // did not state would be worse than leaving it null.
  const parsedBooking =
    request.source === 'AGODA'
      ? parseAgodaBooking(request.rawText, [])
      : parseCtripBooking(request.rawText, []);
  const extras = request.source === 'AGODA' ? parsedBooking.agoda ?? null : null;

  if (!review.canDispatch) {
    throw ApiError.bookingNotReady('Đơn chưa đủ điều kiện để gửi chi nhánh.', {
      valid: false,
      errors: review.blockingReasons,
      warnings: review.warnings.map((w) => w.message),
    });
  }
  // canDispatch already guarantees these; narrowing for the compiler and as a
  // guard against a future change to the review's own rules.
  if (review.branchId === null || review.note === null || review.bookingCode === null) {
    throw ApiError.bookingNotReady('Đơn chưa đủ điều kiện để gửi chi nhánh.', {
      valid: false,
      errors: ['Thiếu chi nhánh, mã đặt phòng hoặc ghi chú.'],
      warnings: [],
    });
  }

  const sourcePlatform = review.source === 'AGODA' ? 'AGODA' : 'CTRIP';

  // Already dispatched? Return it. Never a second booking for one reservation.
  //
  // The list is every state a DISPATCHED booking can be in, including the
  // operational ones. Naming only NEW/COMPLETED/ARCHIVED would have meant that
  // the moment reception acknowledged a booking it stopped counting as
  // dispatched — and a re-send would have created a duplicate for a reservation
  // the branch was already working on.
  const existing = await client.booking.findFirst({
    where: {
      bookingCode: review.bookingCode,
      sourcePlatform,
      status: { in: [...DISPATCHED_STATES] },
    },
    select: { id: true },
  });
  if (existing) {
    return { bookingId: existing.id, created: false, review };
  }

  // What the Admin changed, measured against the UNCORRECTED parse.
  const { review: uncorrected } = await buildOtaReviewFromText(
    { source: request.source, rawText: request.rawText },
    client,
  );
  const corrections = collectCorrections(
    {
      bookingCode: uncorrected.bookingCode,
      guestName: uncorrected.guestName,
      checkIn: uncorrected.checkIn,
      checkOut: uncorrected.checkOut,
      branchId: uncorrected.branchId,
      branchPrice: uncorrected.branchPrice,
      guestBookedPrice: uncorrected.guestBookedPrice,
      rooms: uncorrected.rooms.map((r) => ({
        otaRoomName: r.otaRoomName,
        quantity: r.quantity,
        pmsCode: r.pmsCode,
      })),
    },
    review,
  );

  const now = clock.now();
  const lastMinute = review.checkIn !== null && isLastMinute(isoToUtcDate(review.checkIn), now);

  const bookingId = await client.$transaction(async (tx) => {
    const booking = await tx.booking.create({
      data: {
        bookingCode: review.bookingCode!,
        hotelName: review.branchAddress,
        branchId: review.branchId,
        sourcePlatform,
        customerName: review.guestName ?? '',
        checkInDate: review.checkIn ? isoToUtcDate(review.checkIn) : null,
        checkOutDate: review.checkOut ? isoToUtcDate(review.checkOut) : null,
        // The BRANCH price is what this hotel is owed; the guest's own price is
        // kept on the note, exactly as the review screen shows them.
        totalAmount: review.branchPrice,
        currency: 'VND',
        paymentStatus: paymentStatusOf(review),
        rawText: request.rawText,
        // Dispatched in one step: an OTA reservation is reviewed on screen, so
        // there is no separate draft for an Admin to come back to.
        status: 'NEW',
        isLastMinute: lastMinute,
        sentAt: now,
        sentByUserId: actor.id,
        createdByUserId: actor.id,
        noteGeneratedAt: now,
        // The full review snapshot. Every value is what the parser read or the
        // Admin chose — nothing here is inferred or filled in.
        sourcePropertyId: extras?.sourcePropertyId ?? null,
        otaBookingStatus: extras?.bookingStatus ?? null,
        ratePlanName: extras?.ratePlan ?? null,
        cancellationPolicy: extras?.cancellationPolicy ?? null,
        countryOfResidence: extras?.countryOfResidence ?? null,
        websiteLanguage: extras?.websiteLanguage ?? null,
        paymentType: extras?.paymentType ?? null,
        benefitsIncluded: extras?.benefitsIncluded ?? null,
        phone: extras?.customerPhone ?? parsedBooking.phone ?? null,
        specialRequest: extras?.specialRequests ?? parsedBooking.specialRequest ?? null,
        parserVersion: parsedBooking.parserVersion,
        reviewVersion: OTA_REVIEW_VERSION,
        rawTextSha256: createHash('sha256').update(request.rawText, 'utf8').digest('hex'),
        rooms: {
          create: review.rooms.map((room, index) => ({
            roomIndex: index + 1,
            // The internal PMS code is what the branch acts on; the OTA's own
            // name is preserved beside it so the source stays auditable.
            roomType: room.pmsCode ?? room.otaRoomName ?? '',
            roomSubtotal: review.rooms.length === 1 ? review.branchPrice : null,
            // EVERY night the platform stated, on the first line only.
            //
            // The nightly figures cover the whole reservation, so repeating
            // them under each room line would multiply the stay's value by the
            // number of lines. They are attached once and left exactly as
            // parsed — no night is dropped, merged or recomputed.
            nights:
              index === 0
                ? {
                    create: review.nightlyRates.map((night) => ({
                      stayDate: isoToUtcDate(night.stayDate),
                      amount: night.amount,
                      currency: 'VND',
                      isEstimated: false,
                    })),
                  }
                : undefined,
          })),
        },
        // Everything the review flagged is stored with the booking, so the
        // reasons an Admin saw remain visible after dispatch.
        warnings: {
          create: review.warnings.map((warning) => ({
            code: warning.code,
            message: warning.message,
            severity: warning.severity,
          })),
        },
      },
    });

    // Append-only: written once, never updated, never deleted. What the mail
    // said survives beside what was dispatched even if the booking is edited
    // later.
    if (corrections.length > 0) {
      await tx.bookingCorrection.createMany({
        data: corrections.map((c) => ({
          bookingId: booking.id,
          field: c.field,
          oldValue: c.oldValue,
          newValue: c.newValue,
          correctedByUserId: actor.id,
          correctedAt: now,
        })),
      });
    }

    await tx.bookingStatusHistory.create({
      data: {
        bookingId: booking.id,
        oldStatus: null,
        newStatus: 'NEW',
        changedByUserId: actor.id,
        changedAt: now,
        note: `Gửi chi nhánh từ ${review.source}`,
      },
    });

    await createBranchNotifications(tx as Prisma.TransactionClient, {
      bookingId: booking.id,
      branchId: review.branchId!,
      customerName: review.guestName ?? '',
      checkInDate: review.checkIn ? isoToUtcDate(review.checkIn) : null,
      lastMinute,
    });

    return booking.id;
  });

  return { bookingId, created: true, review };
}
