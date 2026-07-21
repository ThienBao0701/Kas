import type { Prisma } from '@prisma/client';

/**
 * One place that defines how a booking is loaded for the operational APIs and
 * how it is projected onto the wire. Keeping the include and the serializers
 * together guarantees the response always has exactly the relations it reads.
 */
export const BOOKING_DETAIL_INCLUDE = {
  branch: true,
  rooms: { include: { nights: true } },
  warnings: true,
  statusHistory: { include: { changedBy: true }, orderBy: { changedAt: 'asc' } },
  sentBy: true,
  completedBy: true,
  createdBy: true,
} satisfies Prisma.BookingInclude;

export type BookingDetail = Prisma.BookingGetPayload<{ include: typeof BOOKING_DETAIL_INCLUDE }>;

export const BOOKING_LIST_INCLUDE = {
  branch: true,
  sentBy: true,
  completedBy: true,
  rooms: { include: { nights: true } },
  warnings: true,
} satisfies Prisma.BookingInclude;

export type BookingListItem = Prisma.BookingGetPayload<{ include: typeof BOOKING_LIST_INCLUDE }>;

type ActorUser = { id: number; username: string; fullName: string } | null;

/** Public, non-sensitive view of a user acting on a booking (never the hash). */
function actor(user: ActorUser): { id: number; fullName: string } | null {
  return user ? { id: user.id, fullName: user.fullName } : null;
}

function iso(date: Date | null): string | null {
  return date ? date.toISOString() : null;
}

function isoDate(date: Date | null): string | null {
  return date ? date.toISOString().slice(0, 10) : null;
}

function branchView(branch: BookingDetail['branch']) {
  return branch
    ? { id: branch.id, code: branch.code, hotelName: branch.hotelName, address: branch.address }
    : null;
}

function roomsView(rooms: BookingDetail['rooms']) {
  return [...rooms]
    .sort((a, b) => a.roomIndex - b.roomIndex)
    .map((room) => ({
      id: room.id,
      roomIndex: room.roomIndex,
      roomType: room.roomType,
      roomSubtotal: room.roomSubtotal,
      taxAmount: room.taxAmount,
      feeAmount: room.feeAmount,
      nights: [...room.nights]
        .sort((a, b) => a.stayDate.getTime() - b.stayDate.getTime())
        .map((night) => ({
          id: night.id,
          stayDate: isoDate(night.stayDate),
          amount: night.amount,
          currency: night.currency,
          manuallyCorrected: night.manuallyCorrected,
          isEstimated: night.isEstimated,
        })),
    }));
}

function warningsView(warnings: BookingDetail['warnings']) {
  return warnings.map((w) => ({ code: w.code, message: w.message, severity: w.severity }));
}

function statusHistoryView(history: BookingDetail['statusHistory']) {
  return history.map((h) => ({
    id: h.id,
    oldStatus: h.oldStatus,
    newStatus: h.newStatus,
    changedBy: actor(h.changedBy),
    changedAt: h.changedAt.toISOString(),
    note: h.note,
  }));
}

/** The full booking detail an Admin sees (includes rawText). */
export function serializeAdminBookingDetail(booking: BookingDetail) {
  return {
    id: booking.id,
    status: booking.status,
    hotelName: booking.hotelName,
    branch: branchView(booking.branch),
    branchId: booking.branchId,
    customerName: booking.customerName.length > 0 ? booking.customerName : null,
    phone: booking.phone,
    bookingCode: booking.bookingCode.length > 0 ? booking.bookingCode : null,
    checkInDate: isoDate(booking.checkInDate),
    checkOutDate: isoDate(booking.checkOutDate),
    checkInTime: booking.checkInTime,
    checkOutTime: booking.checkOutTime,
    totalAmount: booking.totalAmount,
    currency: booking.currency,
    paymentStatus: booking.paymentStatus,
    specialRequest: booking.specialRequest,
    rawText: booking.rawText,
    parserVersion: booking.parserVersion,
    isLastMinute: booking.isLastMinute,
    rooms: roomsView(booking.rooms),
    warnings: warningsView(booking.warnings),
    statusHistory: statusHistoryView(booking.statusHistory),
    createdBy: actor(booking.createdBy),
    sentBy: actor(booking.sentBy),
    completedBy: actor(booking.completedBy),
    createdAt: booking.createdAt.toISOString(),
    updatedAt: booking.updatedAt.toISOString(),
    sentAt: iso(booking.sentAt),
    completedAt: iso(booking.completedAt),
    completionNote: booking.completionNote,
  };
}

/**
 * The booking detail for the operational endpoints. Receptionists get the same
 * structured data minus rawText, so raw Booking.com personal data is not spread
 * further than it needs to be.
 */
export function serializeOpsBookingDetail(booking: BookingDetail, includeRawText: boolean) {
  const full = serializeAdminBookingDetail(booking);
  if (includeRawText) return full;
  const { rawText: _omit, ...rest } = full;
  return rest;
}

function missingNightlyCount(rooms: BookingListItem['rooms']): number {
  let count = 0;
  for (const room of rooms) for (const night of room.nights) if (night.amount === null) count += 1;
  return count;
}

/** Compact row for the receptionist "Đơn mới" inbox. */
export function serializeNewListItem(booking: BookingListItem) {
  return {
    id: booking.id,
    bookingCode: booking.bookingCode.length > 0 ? booking.bookingCode : null,
    customerName: booking.customerName.length > 0 ? booking.customerName : null,
    phone: booking.phone,
    branch: branchView(booking.branch),
    checkInDate: isoDate(booking.checkInDate),
    checkOutDate: isoDate(booking.checkOutDate),
    numberOfRooms: booking.rooms.length,
    totalAmount: booking.totalAmount,
    currency: booking.currency,
    paymentStatus: booking.paymentStatus,
    isLastMinute: booking.isLastMinute,
    sentAt: iso(booking.sentAt),
    sentBy: actor(booking.sentBy),
    status: booking.status,
    missingNightlyPriceCount: missingNightlyCount(booking.rooms),
    warningCount: booking.warnings.length,
  };
}

/** Compact row for the "Đã hoàn thành" list. */
export function serializeCompletedListItem(booking: BookingListItem) {
  return {
    id: booking.id,
    customerName: booking.customerName.length > 0 ? booking.customerName : null,
    bookingCode: booking.bookingCode.length > 0 ? booking.bookingCode : null,
    branch: branchView(booking.branch),
    checkInDate: isoDate(booking.checkInDate),
    totalAmount: booking.totalAmount,
    currency: booking.currency,
    isLastMinute: booking.isLastMinute,
    completedAt: iso(booking.completedAt),
    completedBy: actor(booking.completedBy),
    completionNote: booking.completionNote,
  };
}

/** Compact row for the history list. */
export function serializeHistoryListItem(booking: BookingListItem) {
  return {
    id: booking.id,
    bookingCode: booking.bookingCode.length > 0 ? booking.bookingCode : null,
    customerName: booking.customerName.length > 0 ? booking.customerName : null,
    phone: booking.phone,
    branch: branchView(booking.branch),
    status: booking.status,
    paymentStatus: booking.paymentStatus,
    checkInDate: isoDate(booking.checkInDate),
    checkOutDate: isoDate(booking.checkOutDate),
    totalAmount: booking.totalAmount,
    currency: booking.currency,
    isLastMinute: booking.isLastMinute,
    sentAt: iso(booking.sentAt),
    sentBy: actor(booking.sentBy),
    completedAt: iso(booking.completedAt),
    completedBy: actor(booking.completedBy),
    createdAt: booking.createdAt.toISOString(),
  };
}
