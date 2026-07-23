import type { PrismaClient } from '@prisma/client';
import { prisma as defaultPrisma } from '../db/prisma';
import { isoToUtcDate } from './dates';
import type { ParsedBooking } from './types';

/** Prisma transaction client (the callback argument of `$transaction`). */
type TxClient = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0];

/**
 * Persists a parsed booking as a DRAFT, together with its rooms, generated
 * night prices and extraction warnings — atomically. Everything is written
 * inside a single interactive transaction so a failure can never leave a
 * half-written booking (a booking without its rooms/nights/warnings) behind.
 * Returns the new booking id.
 *
 * Field mapping to the existing schema: guestName -> customerName,
 * roomName -> roomType, roomTotal -> roomSubtotal, night.roomId -> bookingRoomId.
 * Required columns (bookingCode, customerName) fall back to "" when absent so a
 * partial draft can still be stored; the warnings flag what is missing.
 *
 * Branch safety: the branch is auto-assigned only when the match is confident.
 * A low-confidence candidate is surfaced in the preview but never written to
 * `branchId`, so the admin must confirm it before dispatch.
 *
 * Duplicate policy: re-extracting the same confirmation code replaces the
 * previous DRAFT for that code (cascading to its rooms/nights/warnings) rather
 * than piling up unbounded duplicate drafts on retry. Bookings already advanced
 * past DRAFT are never touched.
 */
export async function persistDraftBooking(
  parsed: ParsedBooking,
  rawText: string,
  createdByUserId: number | null,
  client: PrismaClient = defaultPrisma,
): Promise<string> {
  const branchId = parsed.branchConfident ? (parsed.suggestedBranch?.id ?? null) : null;
  const bookingCode = parsed.bookingCode ?? '';

  return client.$transaction(async (tx: TxClient) => {
    if (bookingCode.length > 0) {
      await tx.booking.deleteMany({ where: { bookingCode, status: 'DRAFT' } });
    }

    const booking = await tx.booking.create({
      data: {
        bookingCode,
        hotelName: parsed.hotelName,
        branchId,
        customerName: parsed.guestName ?? '',
        phone: parsed.phone,
        checkInDate: parsed.checkIn ? isoToUtcDate(parsed.checkIn) : null,
        checkOutDate: parsed.checkOut ? isoToUtcDate(parsed.checkOut) : null,
        totalAmount: parsed.totalAmount,
        currency: parsed.currency,
        paymentStatus: parsed.paymentStatus,
        specialRequest: parsed.specialRequest,
        rawText,
        status: 'DRAFT',
        parserVersion: parsed.parserVersion,
        createdByUserId,
        rooms: {
          create: parsed.rooms.map((room) => ({
            roomIndex: room.roomIndex,
            roomType: room.roomName,
            roomSubtotal: room.roomTotal,
            nights: {
              create: room.nights.map((night) => ({
                stayDate: isoToUtcDate(night.stayDate),
                amount: night.amount,
                currency: night.currency,
                isEstimated: night.isEstimated,
              })),
            },
          })),
        },
        warnings: {
          create: parsed.warnings.map((warning) => ({
            code: warning.code,
            message: warning.message,
            severity: warning.severity,
          })),
        },
      },
    });

    return booking.id;
  });
}
