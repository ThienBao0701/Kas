import type { Prisma, ProofReviewReason } from '@prisma/client';
import { prisma } from '../db/prisma';
import { ApiError } from '../lib/errors';
import { getClock, type Clock } from '../lib/clock';
import { loadBookingDetail } from './bookingRepo';
import { generateStoredFileName, saveProofFile, sniffImageMime } from './proofStorage';
import type { BookingDetail } from './bookingView';

type Actor = { id: number; role: 'ADMIN' | 'RECEPTIONIST'; branchId: number | null; fullName: string };

export interface UploadedProof {
  buffer: Buffer;
  originalName: string;
  size: number;
}

/** Vietnamese labels for the rejection reasons, used in notifications. */
export const REVIEW_REASON_LABELS: Record<ProofReviewReason, string> = {
  WRONG_CUSTOMER_NAME: 'Sai tên khách',
  WRONG_BOOKING_CODE: 'Sai mã Booking',
  WRONG_DATES: 'Sai ngày check-in/check-out',
  WRONG_ROOM_COUNT: 'Sai số lượng phòng',
  WRONG_ROOM_TYPE: 'Sai hạng phòng',
  WRONG_PRICE: 'Sai giá',
  MISSING_ROOM: 'Thiếu phòng',
  UNCLEAR_IMAGE: 'Ảnh không rõ',
  OTHER: 'Khác',
};

function assertReceptionistBranch(booking: BookingDetail, actor: Actor): void {
  if (actor.role === 'RECEPTIONIST' && booking.branchId !== actor.branchId) {
    throw ApiError.branchAccessDenied();
  }
}

// ---------------------------------------------------------------------------
// SUBMIT / RESUBMIT
// ---------------------------------------------------------------------------
export async function submitProof(
  bookingId: string,
  file: UploadedProof | undefined,
  note: string | undefined,
  actor: Actor,
  clock: Clock = getClock(),
): Promise<BookingDetail> {
  if (!file) throw ApiError.proofRequired();

  const booking = await loadBookingDetail(bookingId);
  assertReceptionistBranch(booking, actor);

  if (booking.status !== 'NEW') {
    throw ApiError.conflict('Chỉ có thể nộp ảnh cho đơn đang chờ tạo.', { status: booking.status });
  }
  if (booking.verificationStatus === 'APPROVED') {
    throw ApiError.proofAlreadyReviewed('Đơn đã được xác nhận đúng, không cần nộp lại.');
  }
  if (booking.verificationStatus === 'PENDING_REVIEW') {
    throw ApiError.conflict('Đơn đang chờ Admin kiểm tra; vui lòng đợi kết quả.', {
      verificationStatus: booking.verificationStatus,
    });
  }

  // The declared MIME is never trusted — sniff the real image type from bytes.
  const mime = sniffImageMime(file.buffer);
  if (!mime) throw ApiError.unsupportedMedia();

  const attemptNumber = (await prisma.bookingCreationProof.count({ where: { bookingId } })) + 1;
  const storedFileName = generateStoredFileName(bookingId, attemptNumber, mime);

  // Write the file first; if the DB write then fails on a race, the file is a
  // harmless orphan (proofs are never deleted anyway).
  await saveProofFile(file.buffer, storedFileName);

  await prisma.$transaction(async (tx) => {
    await tx.bookingCreationProof.create({
      data: {
        bookingId,
        attemptNumber,
        storedFileName,
        originalFileName: file.originalName.slice(0, 255),
        mimeType: mime,
        fileSize: file.size,
        submissionNote: note ?? null,
        submittedByUserId: actor.id,
        status: 'PENDING_REVIEW',
      },
    });

    // The receptionist's claim that they created the reservation externally.
    await tx.booking.update({
      where: { id: bookingId },
      data: {
        verificationStatus: 'PENDING_REVIEW',
        completedByUserId: actor.id,
        completedAt: clock.now(),
        // A resubmission clears the previous review verdict.
        reviewedByUserId: null,
        reviewedAt: null,
      },
    });

    await notifyAdminsProofSubmitted(tx, bookingId, booking);
  });

  return loadBookingDetail(bookingId);
}

async function notifyAdminsProofSubmitted(
  tx: Prisma.TransactionClient,
  bookingId: string,
  booking: BookingDetail,
): Promise<void> {
  const admins = await tx.user.findMany({ where: { role: 'ADMIN', active: true }, select: { id: true } });
  if (admins.length === 0) return;
  const code = booking.bookingCode.length > 0 ? booking.bookingCode : '(không mã)';
  const branchName = booking.branch?.address ?? 'chi nhánh';
  await tx.notification.createMany({
    data: admins.map((a) => ({
      userId: a.id,
      bookingId,
      title: 'Có đơn chờ kiểm tra',
      body: `${code} — ${branchName}`,
    })),
  });
}

// ---------------------------------------------------------------------------
// APPROVE
// ---------------------------------------------------------------------------
export async function approveProof(
  bookingId: string,
  proofId: string,
  admin: Actor,
  clock: Clock = getClock(),
): Promise<BookingDetail> {
  const proof = await prisma.bookingCreationProof.findUnique({ where: { id: proofId } });
  if (!proof || proof.bookingId !== bookingId) throw ApiError.notFound('Không tìm thấy ảnh.');
  if (proof.status !== 'PENDING_REVIEW') {
    throw ApiError.proofAlreadyReviewed('Ảnh này đã được duyệt trước đó.', { status: proof.status });
  }

  await prisma.$transaction(async (tx) => {
    // Conditional update: exactly one approval wins even under a double click.
    const updated = await tx.bookingCreationProof.updateMany({
      where: { id: proofId, status: 'PENDING_REVIEW' },
      data: { status: 'APPROVED', reviewedByUserId: admin.id, reviewedAt: clock.now() },
    });
    if (updated.count === 0) throw ApiError.proofAlreadyReviewed('Ảnh này đã được duyệt trước đó.');

    await tx.booking.update({
      where: { id: bookingId },
      data: {
        status: 'COMPLETED',
        verificationStatus: 'APPROVED',
        reviewedByUserId: admin.id,
        reviewedAt: clock.now(),
      },
    });

    await tx.bookingStatusHistory.create({
      data: {
        bookingId,
        oldStatus: 'NEW',
        newStatus: 'COMPLETED',
        changedByUserId: admin.id,
        note: `Duyệt ảnh (lần ${proof.attemptNumber})`,
      },
    });

    await notifyReceptionist(tx, proof.submittedByUserId, bookingId, 'Đơn đã được xác nhận đúng', await bookingCodeOf(tx, bookingId));
  });

  return loadBookingDetail(bookingId);
}

// ---------------------------------------------------------------------------
// REJECT
// ---------------------------------------------------------------------------
export async function rejectProof(
  bookingId: string,
  proofId: string,
  reasonCode: ProofReviewReason | undefined,
  reviewNote: string | undefined,
  admin: Actor,
  clock: Clock = getClock(),
): Promise<BookingDetail> {
  if (!reasonCode) throw ApiError.reviewReasonRequired();

  const proof = await prisma.bookingCreationProof.findUnique({ where: { id: proofId } });
  if (!proof || proof.bookingId !== bookingId) throw ApiError.notFound('Không tìm thấy ảnh.');
  if (proof.status !== 'PENDING_REVIEW') {
    throw ApiError.proofAlreadyReviewed('Ảnh này đã được xử lý trước đó.', { status: proof.status });
  }

  await prisma.$transaction(async (tx) => {
    const updated = await tx.bookingCreationProof.updateMany({
      where: { id: proofId, status: 'PENDING_REVIEW' },
      data: {
        status: 'REJECTED',
        reviewReasonCode: reasonCode,
        reviewNote: reviewNote ?? null,
        reviewedByUserId: admin.id,
        reviewedAt: clock.now(),
      },
    });
    if (updated.count === 0) throw ApiError.proofAlreadyReviewed('Ảnh này đã được xử lý trước đó.');

    // The booking status stays NEW (still operationally open); only the
    // verification verdict changes. The immutable proof attempt is the audit.
    await tx.booking.update({
      where: { id: bookingId },
      data: { verificationStatus: 'REJECTED', reviewedByUserId: admin.id, reviewedAt: clock.now() },
    });

    await notifyReceptionist(
      tx,
      proof.submittedByUserId,
      bookingId,
      'Đơn cần tạo lại',
      REVIEW_REASON_LABELS[reasonCode],
    );
  });

  return loadBookingDetail(bookingId);
}

async function bookingCodeOf(tx: Prisma.TransactionClient, bookingId: string): Promise<string> {
  const b = await tx.booking.findUnique({ where: { id: bookingId }, select: { bookingCode: true } });
  return b && b.bookingCode.length > 0 ? b.bookingCode : '(không mã)';
}

async function notifyReceptionist(
  tx: Prisma.TransactionClient,
  receptionistId: number | null,
  bookingId: string,
  title: string,
  body: string,
): Promise<void> {
  if (receptionistId == null) return;
  // Only notify an active receptionist who still exists.
  const user = await tx.user.findFirst({
    where: { id: receptionistId, role: 'RECEPTIONIST', active: true },
    select: { id: true },
  });
  if (!user) return;
  await tx.notification.create({ data: { userId: receptionistId, bookingId, title, body } });
}

// ---------------------------------------------------------------------------
// IMAGE ACCESS AUTHORIZATION
// ---------------------------------------------------------------------------
/** Authorises a proof-image request and returns what the file endpoint needs. */
export async function authorizeProofImage(
  bookingId: string,
  proofId: string,
  actor: Actor,
): Promise<{ storedFileName: string; mimeType: string }> {
  const proof = await prisma.bookingCreationProof.findUnique({
    where: { id: proofId },
    select: { storedFileName: true, mimeType: true, bookingId: true, booking: { select: { branchId: true } } },
  });
  if (!proof || proof.bookingId !== bookingId) throw ApiError.notFound('Không tìm thấy ảnh.');
  if (actor.role === 'RECEPTIONIST' && proof.booking.branchId !== actor.branchId) {
    throw ApiError.branchAccessDenied();
  }
  return { storedFileName: proof.storedFileName, mimeType: proof.mimeType };
}
