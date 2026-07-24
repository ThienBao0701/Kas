import { prisma } from '../db/prisma';
import { loadBookingDetail } from './bookingRepo';
import type { BookingDetail } from './bookingView';

/** The two types an Admin may confirm a booking as (never UNKNOWN). */
export type ConfirmableBusinessType = 'DIRECT' | 'PARTNER';

/**
 * Records an Admin's manual business-type decision. The decision is definitive:
 * it overrides any automatic detection, marks the booking as manually confirmed
 * (so the detector never runs again for it) and records "manual" as the source.
 * Admin-only — enforced by the admin-only router that exposes it.
 */
export async function confirmBusinessType(
  bookingId: string,
  type: ConfirmableBusinessType,
  adminUserId: number,
): Promise<BookingDetail> {
  await loadBookingDetail(bookingId); // throws 404 when the booking does not exist
  await prisma.booking.update({
    where: { id: bookingId },
    data: {
      businessType: type,
      businessTypeManuallyConfirmed: true,
      businessTypeConfidence: 100,
      businessTypeDetectionSource: `manual:${adminUserId}`,
    },
  });
  return loadBookingDetail(bookingId);
}
