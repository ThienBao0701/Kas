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
  reviewedBy: true,
  createdBy: true,
  proofs: {
    include: { submittedBy: true, reviewedBy: true },
    orderBy: { attemptNumber: 'asc' },
  },
} satisfies Prisma.BookingInclude;

export type BookingDetail = Prisma.BookingGetPayload<{ include: typeof BOOKING_DETAIL_INCLUDE }>;

export const BOOKING_LIST_INCLUDE = {
  branch: true,
  sentBy: true,
  completedBy: true,
  reviewedBy: true,
  rooms: { include: { nights: true } },
  warnings: true,
  // Only the most recent proof attempt, for the list's status/reason display.
  proofs: { orderBy: { attemptNumber: 'desc' }, take: 1 },
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

/** The authenticated image endpoint for a proof — never a filesystem path. */
export function proofImageUrl(bookingId: string, proofId: string): string {
  return `/api/bookings/${bookingId}/proofs/${proofId}/image`;
}

type ProofRow = BookingDetail['proofs'][number];

/** A single proof attempt on the wire (never exposes the stored path). */
export function proofView(bookingId: string, proof: ProofRow) {
  return {
    id: proof.id,
    attemptNumber: proof.attemptNumber,
    status: proof.status,
    originalFileName: proof.originalFileName,
    mimeType: proof.mimeType,
    fileSize: proof.fileSize,
    submissionNote: proof.submissionNote,
    submittedBy: actor(proof.submittedBy),
    submittedAt: proof.submittedAt.toISOString(),
    reviewedBy: actor(proof.reviewedBy),
    reviewedAt: iso(proof.reviewedAt),
    reviewReasonCode: proof.reviewReasonCode,
    reviewNote: proof.reviewNote,
    imageUrl: proofImageUrl(bookingId, proof.id),
  };
}

function proofsView(bookingId: string, proofs: BookingDetail['proofs']) {
  return [...proofs]
    .sort((a, b) => a.attemptNumber - b.attemptNumber)
    .map((p) => proofView(bookingId, p));
}

/** The full booking detail an Admin sees (includes rawText). */
export function serializeAdminBookingDetail(booking: BookingDetail) {
  return {
    id: booking.id,
    status: booking.status,
    sourcePlatform: booking.sourcePlatform,
    verificationStatus: booking.verificationStatus,
    businessType: booking.businessType,
    businessTypeConfidence: booking.businessTypeConfidence,
    businessTypeManuallyConfirmed: booking.businessTypeManuallyConfirmed,
    businessTypeDetectionSource: booking.businessTypeDetectionSource,
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
    proofs: proofsView(booking.id, booking.proofs),
    createdBy: actor(booking.createdBy),
    sentBy: actor(booking.sentBy),
    completedBy: actor(booking.completedBy),
    reviewedBy: actor(booking.reviewedBy),
    createdAt: booking.createdAt.toISOString(),
    updatedAt: booking.updatedAt.toISOString(),
    sentAt: iso(booking.sentAt),
    completedAt: iso(booking.completedAt),
    completionNote: booking.completionNote,
    reviewedAt: iso(booking.reviewedAt),
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
  // Receptionists see the final persisted business type only — never the raw
  // text nor the internal detection debug (confidence / detection source).
  const {
    rawText: _omitRaw,
    businessTypeConfidence: _omitConf,
    businessTypeDetectionSource: _omitSource,
    ...rest
  } = full;
  return rest;
}

function missingNightlyCount(rooms: BookingListItem['rooms']): number {
  let count = 0;
  for (const room of rooms) for (const night of room.nights) if (night.amount === null) count += 1;
  return count;
}

/**
 * A compact "room type (count)" summary for a booking, aggregated by the
 * persisted room type. Types differing only by whitespace/case are merged, the
 * first-seen readable name is kept, and no type is ever listed twice, e.g.
 * "Superior Giường Đôi (2)" or "Superior Giường Đôi (1) | Deluxe Giường Đôi (1)".
 * Count comes from physical room records, never the guest count.
 */
export function roomSummary(rooms: BookingListItem['rooms']): string {
  const order: string[] = [];
  const counts = new Map<string, number>();
  const display = new Map<string, string>();
  for (const room of rooms) {
    const readable = (room.roomType ?? '').trim().replace(/\s+/g, ' ') || 'Chưa rõ hạng phòng';
    const key = readable.toLowerCase();
    if (!counts.has(key)) {
      order.push(key);
      display.set(key, readable);
    }
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return order.map((k) => `${display.get(k)} (${counts.get(k)})`).join(' | ');
}

function latestProof(booking: BookingListItem) {
  return booking.proofs[0] ?? null;
}

/** Compact row for the receptionist "Đơn mới" inbox and review lists. */
export function serializeNewListItem(booking: BookingListItem) {
  const proof = latestProof(booking);
  return {
    id: booking.id,
    bookingCode: booking.bookingCode.length > 0 ? booking.bookingCode : null,
    customerName: booking.customerName.length > 0 ? booking.customerName : null,
    phone: booking.phone,
    branch: branchView(booking.branch),
    sourcePlatform: booking.sourcePlatform,
    businessType: booking.businessType,
    verificationStatus: booking.verificationStatus,
    checkInDate: isoDate(booking.checkInDate),
    checkOutDate: isoDate(booking.checkOutDate),
    numberOfRooms: booking.rooms.length,
    roomSummary: roomSummary(booking.rooms),
    totalAmount: booking.totalAmount,
    currency: booking.currency,
    paymentStatus: booking.paymentStatus,
    isLastMinute: booking.isLastMinute,
    sentAt: iso(booking.sentAt),
    sentBy: actor(booking.sentBy),
    status: booking.status,
    missingNightlyPriceCount: missingNightlyCount(booking.rooms),
    warningCount: booking.warnings.length,
    latestAttemptNumber: proof?.attemptNumber ?? 0,
    latestRejectionReason: proof?.status === 'REJECTED' ? proof.reviewReasonCode : null,
    submittedAt: iso(proof?.submittedAt ?? null),
    reviewedAt: iso(booking.reviewedAt),
  };
}

/** Compact row for the "Đã xác nhận đúng" list. */
export function serializeCompletedListItem(booking: BookingListItem) {
  return {
    id: booking.id,
    customerName: booking.customerName.length > 0 ? booking.customerName : null,
    bookingCode: booking.bookingCode.length > 0 ? booking.bookingCode : null,
    branch: branchView(booking.branch),
    sourcePlatform: booking.sourcePlatform,
    businessType: booking.businessType,
    verificationStatus: booking.verificationStatus,
    checkInDate: isoDate(booking.checkInDate),
    roomSummary: roomSummary(booking.rooms),
    totalAmount: booking.totalAmount,
    currency: booking.currency,
    isLastMinute: booking.isLastMinute,
    completedAt: iso(booking.completedAt),
    completedBy: actor(booking.completedBy),
    completionNote: booking.completionNote,
    reviewedBy: actor(booking.reviewedBy),
    reviewedAt: iso(booking.reviewedAt),
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
    sourcePlatform: booking.sourcePlatform,
    businessType: booking.businessType,
    status: booking.status,
    verificationStatus: booking.verificationStatus,
    paymentStatus: booking.paymentStatus,
    checkInDate: isoDate(booking.checkInDate),
    checkOutDate: isoDate(booking.checkOutDate),
    roomSummary: roomSummary(booking.rooms),
    totalAmount: booking.totalAmount,
    currency: booking.currency,
    isLastMinute: booking.isLastMinute,
    sentAt: iso(booking.sentAt),
    sentBy: actor(booking.sentBy),
    completedAt: iso(booking.completedAt),
    completedBy: actor(booking.completedBy),
    reviewedBy: actor(booking.reviewedBy),
    reviewedAt: iso(booking.reviewedAt),
    createdAt: booking.createdAt.toISOString(),
  };
}
