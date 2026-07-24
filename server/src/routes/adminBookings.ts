import { Router } from 'express';
import { z } from 'zod';
import { ApiError } from '../lib/errors';
import { getClock } from '../lib/clock';
import { requireAuth, requireAdmin, requirePasswordChanged } from '../middleware/auth';
import { loadBookingDetail } from '../booking/bookingRepo';
import { serializeAdminBookingDetail } from '../booking/bookingView';
import { updateBookingDraft, updateBookingSchema } from '../booking/adminEdit';
import { markBookingReady, sendBooking } from '../booking/dispatch';
import { confirmBusinessType } from '../booking/businessTypeService';
import { latestAnalysis, listAnalyses, reanalyzeProof } from '../booking/ocr/analysisService';
import type { UserWithBranch } from '../auth/serialize';

const readySchema = z.object({ note: z.string().trim().max(500).optional() });

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

  return router;
}

function proofIdOf(raw: string | undefined): string {
  if (!raw || raw.trim().length === 0) throw ApiError.notFound('Không tìm thấy ảnh.');
  return raw;
}
