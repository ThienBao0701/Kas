import { Router } from 'express';
import { z } from 'zod';
import { ApiError } from '../lib/errors';
import { getClock } from '../lib/clock';
import { requireAuth, requireAdmin, requirePasswordChanged } from '../middleware/auth';
import { loadBookingDetail } from '../booking/bookingRepo';
import { serializeAdminBookingDetail } from '../booking/bookingView';
import { updateBookingDraft, updateBookingSchema } from '../booking/adminEdit';
import { markBookingReady, sendBooking } from '../booking/dispatch';
import { editOtaFields } from '../booking/adminOtaFields';
import { softDeleteBooking } from '../booking/deleteBooking';
import { readRequestOrigin } from '../booking/requestAudit';
import { confirmBusinessType } from '../booking/businessTypeService';
import { latestAnalysis, listAnalyses, reanalyzeProof } from '../booking/ocr/analysisService';
import { compareLatest, latestComparison, listComparisons } from '../booking/compare/compareService';
import type { UserWithBranch } from '../auth/serialize';

const readySchema = z.object({ note: z.string().trim().max(500).optional() });

/**
 * The two values an Admin may correct after dispatch. Both optional: an edit
 * that names only one leaves the other exactly as it is.
 */
const otaFieldsSchema = z
  .object({
    adminPmsNote: z.string().trim().min(1, 'Vui lòng nhập người tạo PMS.').max(500).optional(),
    reviewedPaymentMode: z.enum(['CN', 'HOTEL_PAYMENT']).optional(),
  })
  .strict()
  .refine((v) => v.adminPmsNote !== undefined || v.reviewedPaymentMode !== undefined, {
    message: 'Không có thay đổi nào được gửi.',
  });

const businessTypeSchema = z.object({ businessType: z.enum(['DIRECT', 'PARTNER']) });

const sendSchema = z.object({
  branchId: z.number().int().positive(),
  acknowledgedWarningCodes: z.array(z.string().max(100)).max(50).optional().default([]),
});

function adminActor(user: UserWithBranch) {
  return { id: user.id, role: user.role, branchId: user.branchId, fullName: user.fullName };
}

function bookingId(raw: string | undefined): string {
  if (!raw || raw.trim().length === 0) throw ApiError.notFound('Không tìm thấy đơn đặt phòng.');
  return raw;
}

/** Admin-only review, edit and dispatch of extracted bookings. */
export function createAdminBookingsRouter(): Router {
  const router = Router();
  router.use('/admin/bookings', requireAuth, requirePasswordChanged, requireAdmin);

  // GET /api/admin/bookings/:id — full detail including rawText.
  router.get('/admin/bookings/:id', (req, res, next) => {
    (async () => {
      const booking = await loadBookingDetail(bookingId(req.params.id));
      res.json({ booking: serializeAdminBookingDetail(booking) });
    })().catch(next);
  });

  // PUT /api/admin/bookings/:id — edit a DRAFT/READY booking (READY -> DRAFT).
  router.put('/admin/bookings/:id', (req, res, next) => {
    (async () => {
      const user = req.currentUser!;
      const input = updateBookingSchema.parse(req.body);
      const booking = await updateBookingDraft(bookingId(req.params.id), input, user.id);
      res.json({ booking: serializeAdminBookingDetail(booking) });
    })().catch(next);
  });

  // POST /api/admin/bookings/:id/business-type — Admin confirms/overrides the type.
  router.post('/admin/bookings/:id/business-type', (req, res, next) => {
    (async () => {
      const user = req.currentUser!;
      const { businessType } = businessTypeSchema.parse(req.body ?? {});
      const booking = await confirmBusinessType(bookingId(req.params.id), businessType, user.id);
      res.json({ booking: serializeAdminBookingDetail(booking) });
    })().catch(next);
  });

  // POST /api/admin/bookings/:id/ready — validate and mark READY.
  router.post('/admin/bookings/:id/ready', (req, res, next) => {
    (async () => {
      const user = req.currentUser!;
      const { note } = readySchema.parse(req.body ?? {});
      const booking = await markBookingReady(bookingId(req.params.id), adminActor(user), note);
      res.json({ booking: serializeAdminBookingDetail(booking) });
    })().catch(next);
  });

  // POST /api/admin/bookings/:id/send — assign branch and dispatch as NEW.
  router.post('/admin/bookings/:id/send', (req, res, next) => {
    (async () => {
      const user = req.currentUser!;
      const input = sendSchema.parse(req.body ?? {});
      const booking = await sendBooking(
        bookingId(req.params.id),
        { branchId: input.branchId, acknowledgedWarningCodes: input.acknowledgedWarningCodes },
        adminActor(user),
        getClock(),
      );
      res.status(200).json({ booking: serializeAdminBookingDetail(booking) });
    })().catch(next);
  });

  /**
   * PATCH /api/admin/bookings/:id/ota-fields — edit the two values an Admin owns.
   *
   * Additive: a NEW route beside the existing ones. No existing endpoint changed
   * URL, body or meaning. Every accepted change writes an immutable correction.
   */
  router.patch('/admin/bookings/:id/ota-fields', (req, res, next) => {
    (async () => {
      const user = req.currentUser!;
      const input = otaFieldsSchema.parse(req.body ?? {});
      const result = await editOtaFields(bookingId(req.params.id), input, {
        id: user.id,
        origin: readRequestOrigin(req),
      });
      const booking = await loadBookingDetail(result.bookingId);
      res.json({ booking: serializeAdminBookingDetail(booking), changed: result.changed });
    })().catch(next);
  });

  /**
   * DELETE /api/admin/bookings/:id — remove a booking from the queues.
   *
   * Admin-only: the router applies requireAdmin to every route here, so a
   * receptionist reaching this URL gets 403 before any handler runs.
   *
   * Soft: the row and its whole audit trail survive. See deleteBooking.ts.
   */
  router.delete('/admin/bookings/:id', (req, res, next) => {
    (async () => {
      const user = req.currentUser!;
      const result = await softDeleteBooking(bookingId(req.params.id), user.id);
      res.json({ bookingId: result.bookingId, deletedAt: result.deletedAt.toISOString() });
    })().catch(next);
  });

  // --- Proof OCR (advisory extraction; Admin-only via the router middleware) ---

  // GET …/proofs/:proofId/analyses — all analysis runs for a proof (newest first).
  router.get('/admin/bookings/:bookingId/proofs/:proofId/analyses', (req, res, next) => {
    (async () => {
      const analyses = await listAnalyses(bookingId(req.params.bookingId), proofIdOf(req.params.proofId));
      res.json({ analyses });
    })().catch(next);
  });

  // GET …/proofs/:proofId/analyses/latest — the most recent run (or null).
  router.get('/admin/bookings/:bookingId/proofs/:proofId/analyses/latest', (req, res, next) => {
    (async () => {
      const analysis = await latestAnalysis(bookingId(req.params.bookingId), proofIdOf(req.params.proofId));
      res.json({ analysis });
    })().catch(next);
  });

  // POST …/proofs/:proofId/analyze — Admin triggers a fresh run (guards duplicates).
  router.post('/admin/bookings/:bookingId/proofs/:proofId/analyze', (req, res, next) => {
    (async () => {
      const analysis = await reanalyzeProof(bookingId(req.params.bookingId), proofIdOf(req.params.proofId), getClock());
      res.status(201).json({ analysis });
    })().catch(next);
  });

  // --- Proof compare (advisory; Admin-only via the router middleware) ---

  // GET …/proofs/:proofId/comparisons — all comparison runs (newest first).
  router.get('/admin/bookings/:bookingId/proofs/:proofId/comparisons', (req, res, next) => {
    (async () => {
      const comparisons = await listComparisons(bookingId(req.params.bookingId), proofIdOf(req.params.proofId));
      res.json({ comparisons });
    })().catch(next);
  });

  // GET …/proofs/:proofId/comparisons/latest — most recent run (or null).
  router.get('/admin/bookings/:bookingId/proofs/:proofId/comparisons/latest', (req, res, next) => {
    (async () => {
      const comparison = await latestComparison(bookingId(req.params.bookingId), proofIdOf(req.params.proofId));
      res.json({ comparison });
    })().catch(next);
  });

  // POST …/proofs/:proofId/compare — Admin compares the latest completed OCR run
  // (409 when no completed analysis, or one already exists for that analysis).
  router.post('/admin/bookings/:bookingId/proofs/:proofId/compare', (req, res, next) => {
    (async () => {
      const user = req.currentUser!;
      const comparison = await compareLatest(bookingId(req.params.bookingId), proofIdOf(req.params.proofId), user.id);
      res.status(201).json({ comparison });
    })().catch(next);
  });

  return router;
}

function proofIdOf(raw: string | undefined): string {
  if (!raw || raw.trim().length === 0) throw ApiError.notFound('Không tìm thấy ảnh.');
  return raw;
}
