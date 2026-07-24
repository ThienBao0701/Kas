import { Router } from 'express';
import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '../db/prisma';
import { ApiError } from '../lib/errors';
import { getClock } from '../lib/clock';
import { requireAuth, requireAdmin, requirePasswordChanged } from '../middleware/auth';
import { proofUpload } from '../middleware/upload';
import { parseBooking } from '../booking/parser';
import { parseAgodaBooking } from '../booking/agoda';
import { detectBusinessType } from '../booking/businessType';
import { persistDraftBooking } from '../booking/store';
import { serializeBookingPreview } from '../booking/serialize';
import {
  BOOKING_LIST_INCLUDE,
  serializeCompletedListItem,
  serializeHistoryListItem,
  serializeNewListItem,
  serializeOpsBookingDetail,
} from '../booking/bookingView';
import { loadBookingDetail } from '../booking/bookingRepo';
import { approveProof, rejectProof, submitProof, authorizeProofImage } from '../booking/proof';
import { readProofFile } from '../booking/proofStorage';
import { analyzeAfterSubmit } from '../booking/ocr/analysisService';
import { isTest } from '../config/env';
import type { UserWithBranch } from '../auth/serialize';

const extractSchema = z.object({
  rawText: z.string().min(1, 'Nội dung không được để trống.').max(50000, 'Nội dung quá dài.'),
  source: z.enum(['BOOKING_COM', 'AGODA']).default('BOOKING_COM'),
});

const submitProofSchema = z.object({ note: z.string().trim().max(1000).optional() });
const rejectSchema = z.object({
  // Optional here so a missing reason surfaces the specific REVIEW_REASON_REQUIRED
  // (422) from the service rather than a generic validation error; an invalid
  // non-enum value still fails schema validation.
  reasonCode: z
    .enum([
      'WRONG_CUSTOMER_NAME',
      'WRONG_BOOKING_CODE',
      'WRONG_DATES',
      'WRONG_ROOM_COUNT',
      'WRONG_ROOM_TYPE',
      'WRONG_PRICE',
      'MISSING_ROOM',
      'UNCLEAR_IMAGE',
      'OTHER',
    ])
    .optional(),
  reviewNote: z.string().trim().max(1000).optional(),
});

const paginationSchema = {
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
};

const newListQuery = z.object({ branchId: z.coerce.number().int().positive().optional(), ...paginationSchema });
const completedListQuery = z.object({ branchId: z.coerce.number().int().positive().optional(), ...paginationSchema });

const historyQuery = z.object({
  search: z.string().trim().min(1).max(100).optional(),
  branchId: z.coerce.number().int().positive().optional(),
  status: z.enum(['DRAFT', 'READY', 'NEW', 'COMPLETED', 'ARCHIVED']).optional(),
  paymentStatus: z.enum(['PAY_BEFORE', 'PAY_AFTER']).optional(),
  isLastMinute: z.enum(['true', 'false']).optional(),
  sentFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  sentTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  checkInFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  checkInTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  completedFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  completedTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  sort: z.enum(['sentAt', 'checkInDate', 'completedAt', 'createdAt']).optional(),
  ...paginationSchema,
});

function dayStart(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}
function dayAfter(iso: string): Date {
  const d = new Date(`${iso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d;
}
function rangeFilter(from?: string, to?: string): Prisma.DateTimeFilter | undefined {
  if (!from && !to) return undefined;
  const filter: Prisma.DateTimeFilter = {};
  if (from) filter.gte = dayStart(from);
  if (to) filter.lt = dayAfter(to);
  return filter;
}

function paginate(page: number, pageSize: number): { skip: number; take: number } {
  return { skip: (page - 1) * pageSize, take: pageSize };
}
function meta(page: number, pageSize: number, total: number) {
  return { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}

/**
 * The branch a receptionist is locked to. Admins may target any branch (or none
 * for "all"). A receptionist's own branch always wins over any client-supplied
 * branchId, so branch isolation cannot be bypassed from the query string.
 */
function branchScope(user: UserWithBranch, requested: number | undefined): number | undefined {
  if (user.role === 'ADMIN') return requested;
  return user.branchId ?? -1; // -1 never matches, so an unassigned receptionist sees nothing
}

function actor(user: UserWithBranch) {
  return { id: user.id, role: user.role, branchId: user.branchId, fullName: user.fullName };
}

export function createBookingsRouter(): Router {
  const router = Router();

  // POST /api/bookings/extract — Admin-only: parse raw text into a stored DRAFT.
  router.post('/bookings/extract', requireAuth, requirePasswordChanged, requireAdmin, (req, res, next) => {
    (async () => {
      const { rawText, source } = extractSchema.parse(req.body);
      const branches = await prisma.branch.findMany({ where: { active: true }, orderBy: { id: 'asc' } });

      // Both adapters return the identical normalized structure; only the source
      // platform stamp and a few label/prepaid variants differ.
      const parsed = source === 'AGODA' ? parseAgodaBooking(rawText, branches) : parseBooking(rawText, branches);
      const bookingId = await persistDraftBooking(parsed, rawText, req.currentUser?.id ?? null, source);

      // The same deterministic detection persisted by the store, surfaced in the
      // preview so the Admin sees the type + confidence and can confirm/override.
      const business = detectBusinessType({
        rawText,
        roomType: parsed.rooms[0]?.roomName ?? null,
        specialRequest: parsed.specialRequest,
      });

      const stored = await prisma.booking.findUniqueOrThrow({
        where: { id: bookingId },
        include: { branch: true, rooms: { include: { nights: true } }, warnings: true },
      });

      const preview = serializeBookingPreview(stored);
      const candidateBranch = preview.suggestedBranch
        ? preview.suggestedBranch
        : parsed.suggestedBranch
          ? {
              id: parsed.suggestedBranch.id,
              code: parsed.suggestedBranch.code,
              hotelName: parsed.suggestedBranch.hotelName,
              address: parsed.suggestedBranch.address,
            }
          : null;

      res.status(201).json({
        ...preview,
        suggestedBranch: candidateBranch,
        branchMatchScore: parsed.branchMatchScore,
        branchConfidence: parsed.branchConfidence,
        branchConfident: parsed.branchConfident,
        requiresManualConfirmation: parsed.requiresManualConfirmation,
        fieldConfidence: parsed.fieldConfidence,
        parserQuality: parsed.parserQuality,
        businessType: business.type,
        businessTypeConfidence: business.confidence,
        businessTypeRequiresAdminConfirmation: business.requiresAdminConfirmation,
        businessTypeMatchedRules: business.matchedRules,
      });
    })().catch(next);
  });

  /**
   * Shared handler for the three "still operationally NEW" verification lists,
   * distinguished only by verificationStatus:
   *   NOT_SUBMITTED  -> "Đơn mới" / "Chờ chi nhánh tạo"
   *   PENDING_REVIEW -> "Chờ Admin kiểm tra" / "Chờ kiểm tra"
   *   REJECTED       -> "Cần tạo lại"
   * Branch isolation is enforced through branchScope, so a receptionist can never
   * widen the list to another branch via the query string.
   */
  function newStageList(verificationStatus: 'NOT_SUBMITTED' | 'PENDING_REVIEW' | 'REJECTED') {
    return (req: Request, res: Response, next: NextFunction) => {
      (async () => {
        const user = req.currentUser!;
        const query = newListQuery.parse(req.query);
        const branchId = branchScope(user, query.branchId);

        const where: Prisma.BookingWhereInput = { status: 'NEW', verificationStatus };
        if (branchId !== undefined) where.branchId = branchId;

        const { skip, take } = paginate(query.page, query.pageSize);
        const [total, rows] = await prisma.$transaction([
          prisma.booking.count({ where }),
          prisma.booking.findMany({
            where,
            include: BOOKING_LIST_INCLUDE,
            orderBy: [{ isLastMinute: 'desc' }, { checkInDate: 'asc' }, { sentAt: 'asc' }],
            skip,
            take,
          }),
        ]);

        res.json({ bookings: rows.map(serializeNewListItem), pagination: meta(query.page, query.pageSize, total) });
      })().catch(next);
    };
  }

  // GET /api/bookings/new — dispatched work still awaiting external creation.
  router.get('/bookings/new', requireAuth, requirePasswordChanged, newStageList('NOT_SUBMITTED'));
  // GET /api/bookings/pending-review — proof submitted, awaiting admin verdict.
  router.get('/bookings/pending-review', requireAuth, requirePasswordChanged, newStageList('PENDING_REVIEW'));
  // GET /api/bookings/rejected — proof rejected, needs recreation ("Cần tạo lại").
  router.get('/bookings/rejected', requireAuth, requirePasswordChanged, newStageList('REJECTED'));

  // GET /api/bookings/completed — the "Đã hoàn thành" list.
  router.get('/bookings/completed', requireAuth, requirePasswordChanged, (req, res, next) => {
    (async () => {
      const user = req.currentUser!;
      const query = completedListQuery.parse(req.query);
      const branchId = branchScope(user, query.branchId);

      const where: Prisma.BookingWhereInput = { status: 'COMPLETED' };
      if (branchId !== undefined) where.branchId = branchId;

      const { skip, take } = paginate(query.page, query.pageSize);
      const [total, rows] = await prisma.$transaction([
        prisma.booking.count({ where }),
        prisma.booking.findMany({
          where,
          include: BOOKING_LIST_INCLUDE,
          orderBy: [{ completedAt: 'desc' }],
          skip,
          take,
        }),
      ]);

      res.json({ bookings: rows.map(serializeCompletedListItem), pagination: meta(query.page, query.pageSize, total) });
    })().catch(next);
  });

  // GET /api/bookings/history — filtered, paginated history.
  router.get('/bookings/history', requireAuth, requirePasswordChanged, (req, res, next) => {
    (async () => {
      const user = req.currentUser!;
      const query = historyQuery.parse(req.query);

      const where: Prisma.BookingWhereInput = {};
      const branchId = branchScope(user, query.branchId);
      if (branchId !== undefined) where.branchId = branchId;
      // Receptionists only ever see dispatched bookings for their branch.
      if (user.role !== 'ADMIN') where.sentAt = { not: null };

      if (query.search) {
        where.OR = [
          { bookingCode: { contains: query.search } },
          { customerName: { contains: query.search } },
          { phone: { contains: query.search } },
        ];
      }
      if (query.status) where.status = query.status;
      if (query.paymentStatus) where.paymentStatus = query.paymentStatus;
      if (query.isLastMinute) where.isLastMinute = query.isLastMinute === 'true';

      const sentAt = rangeFilter(query.sentFrom, query.sentTo);
      if (sentAt) where.sentAt = { ...(where.sentAt as object), ...sentAt };
      const checkIn = rangeFilter(query.checkInFrom, query.checkInTo);
      if (checkIn) where.checkInDate = checkIn;
      const completedAt = rangeFilter(query.completedFrom, query.completedTo);
      if (completedAt) where.completedAt = completedAt;

      const sortKey = query.sort ?? 'sentAt';
      const orderBy: Prisma.BookingOrderByWithRelationInput[] =
        sortKey === 'sentAt'
          ? [{ sentAt: 'desc' }, { createdAt: 'desc' }]
          : [{ [sortKey]: 'desc' }, { createdAt: 'desc' }];

      const { skip, take } = paginate(query.page, query.pageSize);
      const [total, rows] = await prisma.$transaction([
        prisma.booking.count({ where }),
        prisma.booking.findMany({ where, include: BOOKING_LIST_INCLUDE, orderBy, skip, take }),
      ]);

      res.json({ bookings: rows.map(serializeHistoryListItem), pagination: meta(query.page, query.pageSize, total) });
    })().catch(next);
  });

  // GET /api/bookings/:id — operational detail (rawText only for Admin).
  router.get('/bookings/:id', requireAuth, requirePasswordChanged, (req, res, next) => {
    (async () => {
      const user = req.currentUser!;
      const booking = await loadBookingDetail(req.params.id!);

      if (user.role !== 'ADMIN') {
        if (booking.branchId !== user.branchId) throw ApiError.branchAccessDenied();
        // Not-yet-dispatched drafts are not visible to receptionists.
        if (booking.status === 'DRAFT' || booking.status === 'READY') {
          throw ApiError.notFound('Không tìm thấy đơn đặt phòng.');
        }
      }

      res.json({ booking: serializeOpsBookingDetail(booking, user.role === 'ADMIN') });
    })().catch(next);
  });

  // POST /api/bookings/:id/proofs — receptionist (own branch) or admin uploads a
  // proof screenshot claiming the reservation was created externally.
  router.post(
    '/bookings/:id/proofs',
    requireAuth,
    requirePasswordChanged,
    proofUpload(),
    (req, res, next) => {
      (async () => {
        const user = req.currentUser!;
        const { note } = submitProofSchema.parse(req.body ?? {});
        const file = req.file
          ? { buffer: req.file.buffer, originalName: req.file.originalname, size: req.file.size }
          : undefined;
        const booking = await submitProof(req.params.id!, file, note, actor(user), getClock());

        // Advisory OCR extraction on the just-created proof. It never blocks or
        // fails the upload: awaited only in tests for determinism, fire-and-forget
        // in production. The proof attempt is already valid regardless of OCR.
        const latestProof = await prisma.bookingCreationProof.findFirst({
          where: { bookingId: req.params.id! },
          orderBy: { attemptNumber: 'desc' },
          select: { id: true },
        });
        if (latestProof) {
          if (isTest) await analyzeAfterSubmit(latestProof.id);
          else void analyzeAfterSubmit(latestProof.id);
        }

        res.status(201).json({ booking: serializeOpsBookingDetail(booking, user.role === 'ADMIN') });
      })().catch(next);
    },
  );

  // GET /api/bookings/:id/proofs/:proofId/image — authenticated, branch-isolated
  // image bytes. Never served as public static content.
  router.get('/bookings/:id/proofs/:proofId/image', requireAuth, requirePasswordChanged, (req, res, next) => {
    (async () => {
      const user = req.currentUser!;
      const { storedFileName, mimeType } = await authorizeProofImage(
        req.params.id!,
        req.params.proofId!,
        actor(user),
      );
      const bytes = await readProofFile(storedFileName);
      res.setHeader('Content-Type', mimeType);
      res.setHeader('Cache-Control', 'private, no-store');
      res.setHeader('Content-Disposition', 'inline');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.send(bytes);
    })().catch(next);
  });

  // POST /api/bookings/:id/proofs/:proofId/approve — Admin marks the proof correct.
  router.post(
    '/bookings/:id/proofs/:proofId/approve',
    requireAuth,
    requirePasswordChanged,
    requireAdmin,
    (req, res, next) => {
      (async () => {
        const user = req.currentUser!;
        const booking = await approveProof(req.params.id!, req.params.proofId!, actor(user), getClock());
        res.json({ booking: serializeOpsBookingDetail(booking, true) });
      })().catch(next);
    },
  );

  // POST /api/bookings/:id/proofs/:proofId/reject — Admin rejects with a reason.
  router.post(
    '/bookings/:id/proofs/:proofId/reject',
    requireAuth,
    requirePasswordChanged,
    requireAdmin,
    (req, res, next) => {
      (async () => {
        const user = req.currentUser!;
        const { reasonCode, reviewNote } = rejectSchema.parse(req.body ?? {});
        const booking = await rejectProof(
          req.params.id!,
          req.params.proofId!,
          reasonCode,
          reviewNote,
          actor(user),
          getClock(),
        );
        res.json({ booking: serializeOpsBookingDetail(booking, true) });
      })().catch(next);
    },
  );

  return router;
}
