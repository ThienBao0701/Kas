import { Router } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '../db/prisma';
import { ApiError } from '../lib/errors';
import { getClock } from '../lib/clock';
import { requireAuth, requireAdmin, requirePasswordChanged } from '../middleware/auth';
import { parseBooking } from '../booking/parser';
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
import { completeBooking } from '../booking/dispatch';
import type { UserWithBranch } from '../auth/serialize';

const extractSchema = z.object({
  rawText: z.string().min(1, 'Nội dung Booking.com không được để trống.').max(50000, 'Nội dung quá dài.'),
});

const completeSchema = z.object({ completionNote: z.string().trim().max(1000).optional() });

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
      const { rawText } = extractSchema.parse(req.body);
      const branches = await prisma.branch.findMany({ where: { active: true }, orderBy: { id: 'asc' } });

      const parsed = parseBooking(rawText, branches);
      const bookingId = await persistDraftBooking(parsed, rawText, req.currentUser?.id ?? null);

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
        branchConfident: parsed.branchConfident,
        requiresManualConfirmation: parsed.requiresManualConfirmation,
        fieldConfidence: parsed.fieldConfidence,
      });
    })().catch(next);
  });

  // GET /api/bookings/new — receptionist inbox of dispatched-but-uncompleted work.
  router.get('/bookings/new', requireAuth, requirePasswordChanged, (req, res, next) => {
    (async () => {
      const user = req.currentUser!;
      const query = newListQuery.parse(req.query);
      const branchId = branchScope(user, query.branchId);

      const where: Prisma.BookingWhereInput = { status: 'NEW' };
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
  });

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

  // POST /api/bookings/:id/complete — receptionist (own branch) or admin.
  router.post('/bookings/:id/complete', requireAuth, requirePasswordChanged, (req, res, next) => {
    (async () => {
      const user = req.currentUser!;
      const { completionNote } = completeSchema.parse(req.body ?? {});
      const booking = await completeBooking(req.params.id!, completionNote, actor(user), getClock());
      res.json({ booking: serializeOpsBookingDetail(booking, user.role === 'ADMIN') });
    })().catch(next);
  });

  return router;
}
