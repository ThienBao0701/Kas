import type { Prisma } from '@prisma/client';
import { prisma } from '../db/prisma';
import { ApiError } from '../lib/errors';
import { getClock, isLastMinute, type Clock } from '../lib/clock';
import { loadBookingDetail } from './bookingRepo';
import { validateBooking, type ValidationResult } from './validation';
import { snapshotRoomClasses } from './store';
import type { BookingDetail } from './bookingView';

/**
 * The booking dispatch state machine: DRAFT/READY -> NEW (send) -> COMPLETED.
 * Each transition is atomic, guards its precondition with a conditional update
 * (so two concurrent callers cannot both transition), writes an immutable
 * status-history row, and creates the right persistent notifications.
 */

type Actor = { id: number; role: 'ADMIN' | 'RECEPTIONIST'; branchId: number | null; fullName: string };

function isoDate(date: Date | null): string {
  return date ? date.toISOString().slice(0, 10) : '—';
}

/** Blocking validation errors -> a 422 that carries the full {valid,errors,warnings}. */
function assertNoBlockingErrors(result: ValidationResult): void {
  if (!result.valid) {
    throw ApiError.bookingNotReady('Đơn chưa hợp lệ để xử lý.', {
      valid: false,
      errors: result.errors,
      warnings: result.warnings,
    });
  }
}

// ---------------------------------------------------------------------------
// READY
// ---------------------------------------------------------------------------
export async function markBookingReady(
  bookingId: string,
  admin: Actor,
  note: string | undefined,
): Promise<BookingDetail> {
  const booking = await loadBookingDetail(bookingId);
  if (booking.status !== 'DRAFT') {
    throw ApiError.conflict('Chỉ có thể chuyển sang “sẵn sàng” từ trạng thái nháp.', {
      status: booking.status,
    });
  }

  const result = validateBooking(booking, 'ready');
  assertNoBlockingErrors(result);

  await prisma.$transaction(async (tx) => {
    const updated = await tx.booking.updateMany({
      where: { id: bookingId, status: 'DRAFT' },
      data: { status: 'READY' },
    });
    if (updated.count === 0) {
      throw ApiError.conflict('Trạng thái đơn đã thay đổi, vui lòng tải lại.');
    }
    await tx.bookingStatusHistory.create({
      data: {
        bookingId,
        oldStatus: 'DRAFT',
        newStatus: 'READY',
        changedByUserId: admin.id,
        note: note ?? null,
      },
    });
  });

  return loadBookingDetail(bookingId);
}

// ---------------------------------------------------------------------------
// SEND
// ---------------------------------------------------------------------------
export interface SendInput {
  branchId: number;
  acknowledgedWarningCodes: string[];
}

export async function sendBooking(
  bookingId: string,
  input: SendInput,
  admin: Actor,
  clock: Clock = getClock(),
): Promise<BookingDetail> {
  const booking = await loadBookingDetail(bookingId);

  // A booking already dispatched (or beyond) can never be re-sent.
  if (['NEW', 'COMPLETED', 'ARCHIVED'].includes(booking.status)) {
    throw ApiError.bookingAlreadySent('Đơn đã được gửi trước đó.', { status: booking.status });
  }
  if (booking.status !== 'DRAFT' && booking.status !== 'READY') {
    throw ApiError.conflict('Chỉ có thể gửi đơn ở trạng thái nháp hoặc sẵn sàng.', {
      status: booking.status,
    });
  }

  const branch = await prisma.branch.findUnique({ where: { id: input.branchId } });
  if (!branch || !branch.active) {
    throw ApiError.validation('Chi nhánh không hợp lệ hoặc đã ngừng hoạt động.');
  }

  // Validate against the branch the admin is actually sending to.
  const result = validateBooking({ ...booking, branchId: input.branchId }, 'send');
  assertNoBlockingErrors(result);

  const acknowledged = new Set(input.acknowledgedWarningCodes);
  const unacknowledged = result.warnings.filter((w) => !acknowledged.has(w.code));
  if (unacknowledged.length > 0) {
    throw ApiError.warningsNotAcknowledged('Vui lòng xác nhận các cảnh báo trước khi gửi.', {
      valid: true,
      errors: [],
      warnings: unacknowledged,
    });
  }

  // Duplicate operational booking: same code + branch + check-in already live.
  const duplicate = await prisma.booking.findFirst({
    where: {
      id: { not: bookingId },
      bookingCode: booking.bookingCode,
      branchId: input.branchId,
      checkInDate: booking.checkInDate,
      status: { in: ['NEW', 'COMPLETED', 'ARCHIVED'] },
    },
    select: { id: true, status: true },
  });
  if (duplicate) {
    throw ApiError.duplicateBooking('Đã tồn tại một đơn vận hành trùng khớp.', {
      existingBookingId: duplicate.id,
      existingStatus: duplicate.status,
    });
  }

  const lastMinute = isLastMinute(booking.checkInDate, clock.now());
  const oldStatus = booking.status;

  await prisma.$transaction(async (tx) => {
    // Conditional update: only a still-unsent booking transitions, so a racing
    // second send cannot double-dispatch.
    const updated = await tx.booking.updateMany({
      where: { id: bookingId, status: { in: ['DRAFT', 'READY'] } },
      data: {
        branchId: input.branchId,
        status: 'NEW',
        sentAt: clock.now(),
        sentByUserId: admin.id,
        isLastMinute: lastMinute,
      },
    });
    if (updated.count === 0) {
      throw ApiError.bookingAlreadySent('Đơn đã được gửi trước đó.');
    }

    await tx.bookingStatusHistory.create({
      data: {
        bookingId,
        oldStatus,
        newStatus: 'NEW',
        changedByUserId: admin.id,
        note: `Gửi tới chi nhánh ${branch.hotelName}`,
      },
    });

    await createSendNotifications(tx, bookingId, input.branchId, booking, lastMinute);
  });

  // Dispatch is the moment the branch becomes final, so it is the moment the
  // branch-specific room codes can be resolved. Rooms that already carry a
  // resolved snapshot are left untouched; this only fills in the blanks.
  // Outside the transaction: a resolver problem must never undo a dispatch.
  await snapshotRoomClasses(bookingId);

  return loadBookingDetail(bookingId);
}

async function createSendNotifications(
  tx: Prisma.TransactionClient,
  bookingId: string,
  branchId: number,
  booking: BookingDetail,
  lastMinute: boolean,
): Promise<void> {
  await createBranchNotifications(tx, {
    bookingId,
    branchId,
    customerName: booking.customerName,
    checkInDate: booking.checkInDate,
    lastMinute,
  });
}

/**
 * Tells a branch's receptionists that a booking has arrived.
 *
 * Extracted verbatim from the Booking.com send path so the OTA dispatch raises
 * exactly the same notification — same wording, same recipients, same
 * last-minute emphasis. Taking a plain value object rather than a full
 * `BookingDetail` is what lets a freshly-created OTA booking use it inside the
 * same transaction, before any detail view exists to load.
 */
export async function createBranchNotifications(
  tx: Prisma.TransactionClient,
  input: {
    bookingId: string;
    branchId: number;
    customerName: string;
    checkInDate: Date | null;
    lastMinute: boolean;
  },
): Promise<void> {
  const receptionists = await tx.user.findMany({
    where: { role: 'RECEPTIONIST', branchId: input.branchId, active: true },
    select: { id: true },
  });
  if (receptionists.length === 0) return;

  const branch = await tx.branch.findUnique({
    where: { id: input.branchId },
    select: { hotelName: true },
  });
  const branchName = branch?.hotelName ?? '';
  const customer = input.customerName.length > 0 ? input.customerName : 'Khách';
  const title = input.lastMinute ? 'ĐƠN LAST MINUTE' : 'Có đơn mới';
  const body = input.lastMinute
    ? `${customer} nhận phòng hôm nay\n${branchName}\nVui lòng ưu tiên xử lý`
    : `${customer} – nhận phòng ${isoDate(input.checkInDate)}\n${branchName}`;

  await tx.notification.createMany({
    data: receptionists.map((r) => ({ userId: r.id, bookingId: input.bookingId, title, body })),
  });
}

// Booking completion is no longer a direct receptionist action: a booking moves
// NEW -> COMPLETED only when an admin approves an uploaded creation proof. See
// `booking/proof.ts` (submitProof / approveProof / rejectProof).
