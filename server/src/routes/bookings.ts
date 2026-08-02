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
import { parseCtripBooking } from '../booking/ctrip';
import { loadBranchConfigs } from '../booking/branchConfig';
import { detectBusinessType } from '../booking/businessType';
import { persistDraftBooking, snapshotRoomClasses } from '../booking/store';
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
  // Only the platforms that actually HAVE an intake parser. Tripadvisor and
  // Traveloka are valid identity platforms but are refused here, so a booking
  // can never claim a source the system cannot extract.
  source: z.enum(['BOOKING_COM', 'AGODA', 'CTRIP']).default('BOOKING_COM'),
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

const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/**
 * The history query, extended into the operational search.
 *
 * Every addition is OPTIONAL and additive: an existing caller that sends none
 * of the new parameters gets exactly the results it did before. The one
 * behavioural change is that `search` is now case-insensitive — see the handler.
 *
 * `status` accepts the operational states as well as the original five. Without
 * them a dispatched OTA booking could never be filtered to "checked in", which
 * is the state an operator most often looks for.
 */
const historyQuery = z.object({
  search: z.string().trim().min(1).max(100).optional(),
  branchId: z.coerce.number().int().positive().optional(),
  status: z
    .enum([
      'DRAFT', 'READY', 'NEW', 'COMPLETED', 'ARCHIVED',
      'RECEIVED', 'CHECKED_IN', 'CHECKED_OUT', 'CANCELLED', 'NO_SHOW',
    ])
    .optional(),
  /** Which platform the reservation came from. */
  source: z.enum(['BOOKING_COM', 'AGODA', 'CTRIP']).optional(),
  verificationStatus: z
    .enum(['NOT_SUBMITTED', 'PENDING_REVIEW', 'APPROVED', 'REJECTED'])
    .optional(),
  country: z.string().trim().min(1).max(100).optional(),
  language: z.string().trim().min(1).max(100).optional(),
  paymentStatus: z.enum(['PAY_BEFORE', 'PAY_AFTER']).optional(),
  isLastMinute: z.enum(['true', 'false']).optional(),
  sentFrom: isoDay.optional(),
  sentTo: isoDay.optional(),
  checkInFrom: isoDay.optional(),
  checkInTo: isoDay.optional(),
  checkOutFrom: isoDay.optional(),
  checkOutTo: isoDay.optional(),
  createdFrom: isoDay.optional(),
  createdTo: isoDay.optional(),
  updatedFrom: isoDay.optional(),
  updatedTo: isoDay.optional(),
  completedFrom: isoDay.optional(),
  completedTo: isoDay.optional(),
  sort: z
    .enum([
      'sentAt', 'checkInDate', 'checkOutDate', 'completedAt', 'createdAt',
      'updatedAt', 'customerName', 'totalAmount', 'status', 'sourcePlatform',
    ])
    .optional(),
  /** Ascending is opt-in; every existing caller keeps newest-first. */
  order: z.enum(['asc', 'desc']).optional(),
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

/**
 * The acting user, plus the request correlation id so booking-scoped audit
 * events can be tied back to one HTTP request. The id is opaque metadata — it
 * is never a credential and never identifies anything but the request.
 */
function actor(user: UserWithBranch, correlationId?: string) {
  return {
    id: user.id,
    role: user.role,
    branchId: user.branchId,
    fullName: user.fullName,
    correlationId: correlationId ?? null,
  };
}

export function createBookingsRouter(): Router {
  const router = Router();

  // POST /api/bookings/extract — Admin-only: parse raw text into a stored DRAFT.
  router.post('/bookings/extract', requireAuth, requirePasswordChanged, requireAdmin, (req, res, next) => {
    (async () => {
      const { rawText, source } = extractSchema.parse(req.body);
      // One load of the routing configuration (active branches + their active
      // platform aliases); the parsers stay pure and never query the database.
      const branches = await loadBranchConfigs();

      // Every adapter returns the identical normalized structure; only the
      // source stamp, the platform its hotel name is recognised against, and a
      // few label/prepaid variants differ. The chosen source is preserved
      // verbatim on the stored booking — a CTrip booking is never filed as
      // Agoda, even though the two share property names today.
      const parsed =
        source === 'AGODA'
          ? parseAgodaBooking(rawText, branches)
          : source === 'CTRIP'
            ? parseCtripBooking(rawText, branches)
            : parseBooking(rawText, branches, 'BOOKING_COM');
      const bookingId = await persistDraftBooking(parsed, rawText, req.currentUser?.id ?? null, source);
      // Branch-specific room codes, captured as an immutable snapshot.
      await snapshotRoomClasses(bookingId);

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
              branchNumber:
                branches.find((b) => b.id === parsed.suggestedBranch?.id)?.branchNumber ?? 0,
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
        // Present only for an Agoda hotel-partner email: structured partner fields
        // plus the exact two-line PMS note the receptionist copies.
        agoda: parsed.agoda ?? null,
      });
    })().catch(next);
  });

  /**
   * Shared handler for the three "still operationally NEW" verification lists,
   * distinguished only by verificationStatus:
   *   NOT_SUBMITTED + APPROVED -> "Đơn mới" / "Chờ chi nhánh tạo"
   *   PENDING_REVIEW           -> "Chờ Admin kiểm tra" / "Chờ kiểm tra"
   *   REJECTED                 -> "Cần tạo lại"
   *
   * WHY APPROVED SITS IN THE FIRST LIST:
   * proof approval no longer completes a booking — the two lifecycles are
   * independent — so an approved booking stays at NEW until reception receives
   * it. Filtering on a single verificationStatus meant APPROVED matched none of
   * the three lists and the booking was not in "completed" either: it vanished
   * from every reception screen while still needing to be received and checked
   * in. Both NOT_SUBMITTED and APPROVED mean the same thing to a receptionist —
   * nothing is pending from an Admin, the branch must act — so they share a
   * list. A booking is therefore visible on some reception screen at every
   * point in its life.
   * Branch isolation is enforced through branchScope, so a receptionist can never
   * widen the list to another branch via the query string.
   */
  function newStageList(
    verificationStatuses: readonly ('NOT_SUBMITTED' | 'PENDING_REVIEW' | 'REJECTED' | 'APPROVED')[],
  ) {
    return (req: Request, res: Response, next: NextFunction) => {
      (async () => {
        const user = req.currentUser!;
        const query = newListQuery.parse(req.query);
        const branchId = branchScope(user, query.branchId);

        const where: Prisma.BookingWhereInput = {
          status: 'NEW',
          verificationStatus: { in: [...verificationStatuses] },
        };
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

  // GET /api/bookings/new — dispatched work the BRANCH must act on: no proof
  // submitted yet, or a proof already approved and the stay still to be run.
  router.get('/bookings/new', requireAuth, requirePasswordChanged, newStageList(['NOT_SUBMITTED', 'APPROVED']));
  // GET /api/bookings/pending-review — proof submitted, awaiting admin verdict.
  router.get('/bookings/pending-review', requireAuth, requirePasswordChanged, newStageList(['PENDING_REVIEW']));
  // GET /api/bookings/rejected — proof rejected, needs recreation ("Cần tạo lại").
  router.get('/bookings/rejected', requireAuth, requirePasswordChanged, newStageList(['REJECTED']));

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
        // Case-INSENSITIVE, deliberately. `contains` is case-sensitive on
        // PostgreSQL, so searching "khuyen" found nothing for a guest stored as
        // "Khuyen" — an operator typing a name from memory would conclude the
        // booking did not exist. Widened at the same time from three fields to
        // the ones people actually search by; the hotel name is included
        // because a branch is often remembered by its hotel, not its code.
        const term = { contains: query.search, mode: 'insensitive' as const };
        where.OR = [
          { bookingCode: term },
          { customerName: term },
          { phone: term },
          { hotelName: term },
          { countryOfResidence: term },
          { branch: { hotelName: term } },
          { branch: { code: term } },
        ];
      }
      if (query.status) where.status = query.status;
      if (query.source) where.sourcePlatform = query.source;
      if (query.verificationStatus) where.verificationStatus = query.verificationStatus;
      if (query.country) where.countryOfResidence = { contains: query.country, mode: 'insensitive' };
      if (query.language) where.websiteLanguage = { contains: query.language, mode: 'insensitive' };
      if (query.paymentStatus) where.paymentStatus = query.paymentStatus;
      if (query.isLastMinute) where.isLastMinute = query.isLastMinute === 'true';

      const sentAt = rangeFilter(query.sentFrom, query.sentTo);
      if (sentAt) where.sentAt = { ...(where.sentAt as object), ...sentAt };
      const checkIn = rangeFilter(query.checkInFrom, query.checkInTo);
      if (checkIn) where.checkInDate = checkIn;
      const checkOut = rangeFilter(query.checkOutFrom, query.checkOutTo);
      if (checkOut) where.checkOutDate = checkOut;
      const createdAt = rangeFilter(query.createdFrom, query.createdTo);
      if (createdAt) where.createdAt = createdAt;
      const updatedAt = rangeFilter(query.updatedFrom, query.updatedTo);
      if (updatedAt) where.updatedAt = updatedAt;
      const completedAt = rangeFilter(query.completedFrom, query.completedTo);
      if (completedAt) where.completedAt = completedAt;

      // Newest-first stays the default for every existing caller.
      const sortKey = query.sort ?? 'sentAt';
      const direction = query.order ?? 'desc';
      const orderBy: Prisma.BookingOrderByWithRelationInput[] =
        sortKey === 'sentAt'
          ? [{ sentAt: direction }, { createdAt: 'desc' }]
          : [{ [sortKey]: direction }, { createdAt: 'desc' }];

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
        const booking = await submitProof(req.params.id!, file, note, actor(user, req.requestId), getClock());

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
        actor(user, req.requestId),
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
        const booking = await approveProof(req.params.id!, req.params.proofId!, actor(user, req.requestId), getClock());
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
          actor(user, req.requestId),
          getClock(),
        );
        res.json({ booking: serializeOpsBookingDetail(booking, true) });
      })().catch(next);
    },
  );

  return router;
}
