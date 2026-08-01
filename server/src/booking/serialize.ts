import type { Prisma } from '@prisma/client';

/** A stored booking loaded with everything the preview needs. */
export type BookingWithExtractRelations = Prisma.BookingGetPayload<{
  include: {
    branch: true;
    rooms: { include: { nights: true } };
    warnings: true;
  };
}>;

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Serialises a stored booking into the structured extraction preview the
 * frontend consumes. Field names follow the Phase 4A contract (guestName,
 * roomName, roomTotal, isEstimated) regardless of the underlying column names.
 */
export function serializeBookingPreview(booking: BookingWithExtractRelations) {
  const rooms = [...booking.rooms]
    .sort((a, b) => a.roomIndex - b.roomIndex)
    .map((room) => ({
      id: room.id,
      roomIndex: room.roomIndex,
      roomName: room.roomType,
      roomTotal: room.roomSubtotal,
      nights: [...room.nights]
        .sort((a, b) => a.stayDate.getTime() - b.stayDate.getTime())
        .map((night) => ({
          id: night.id,
          stayDate: isoDate(night.stayDate),
          amount: night.amount,
          currency: night.currency,
          isEstimated: night.isEstimated,
        })),
    }));

  return {
    booking: {
      id: booking.id,
      bookingCode: booking.bookingCode.length > 0 ? booking.bookingCode : null,
      hotelName: booking.hotelName,
      // The intake platform, echoed back so the review screen shows which
      // source the Admin actually extracted from — never inferred client-side.
      sourcePlatform: booking.sourcePlatform,
      businessType: booking.businessType,
      businessTypeConfidence: booking.businessTypeConfidence,
      businessTypeManuallyConfirmed: booking.businessTypeManuallyConfirmed,
      guestName: booking.customerName.length > 0 ? booking.customerName : null,
      phone: booking.phone,
      checkIn: booking.checkInDate ? isoDate(booking.checkInDate) : null,
      checkOut: booking.checkOutDate ? isoDate(booking.checkOutDate) : null,
      currency: booking.currency,
      totalAmount: booking.totalAmount,
      paymentStatus: booking.paymentStatus,
      specialRequest: booking.specialRequest,
      status: booking.status,
      parserVersion: booking.parserVersion,
      createdAt: booking.createdAt.toISOString(),
    },
    suggestedBranch: booking.branch
      ? {
          id: booking.branch.id,
          code: booking.branch.code,
          hotelName: booking.branch.hotelName,
          address: booking.branch.address,
          branchNumber: booking.branch.branchNumber,
        }
      : null,
    rooms,
    warnings: booking.warnings.map((warning) => ({
      code: warning.code,
      message: warning.message,
      severity: warning.severity,
    })),
  };
}
