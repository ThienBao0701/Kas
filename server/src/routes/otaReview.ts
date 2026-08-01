/**
 * Admin-only OTA review endpoint.
 *
 * One stateless route: given the pasted text and the Admin's corrections, it
 * returns the fully-resolved review — branch, room lines with their internal
 * codes, prices, the exact PMS note, and precisely why dispatch is or is not
 * allowed.
 *
 * Stateless on purpose. Editing a review writes nothing, so an Admin can adjust
 * a price or swap a branch without leaving half-finished rows behind, and the
 * note shown always corresponds to what the server would actually generate.
 *
 * NOTHING THE CLIENT SENDS IS TRUSTED. The branch must be active, and a
 * submitted PMS code is re-validated against the selected branch's own
 * catalogue — a code that branch does not have is refused, never accepted
 * because the browser asked.
 */
import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireAdmin, requirePasswordChanged } from '../middleware/auth';
import { buildOtaReviewFromText } from '../booking/otaReviewService';

const roomLineSchema = z.object({
  quantity: z.number().int().min(1, 'Số lượng phòng phải lớn hơn 0.').max(50),
  otaRoomName: z.string().trim().max(300).nullable(),
  otaRoomTypeId: z.string().trim().max(100).nullable(),
  /** A proposal only — the server checks it against the branch. */
  pmsCode: z.string().trim().max(40).nullable(),
  requiresManualMapping: z.boolean(),
});

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Ngày phải có định dạng YYYY-MM-DD.');

const overridesSchema = z
  .object({
    branchId: z.number().int().positive().nullable().optional(),
    bookingCode: z.string().trim().max(100).nullable().optional(),
    guestName: z.string().trim().max(200).nullable().optional(),
    checkIn: isoDate.nullable().optional(),
    checkOut: isoDate.nullable().optional(),
    rooms: z.array(roomLineSchema).max(20).optional(),
    branchPrice: z.number().int().nonnegative().nullable().optional(),
    guestBookedPrice: z.number().int().nonnegative().nullable().optional(),
    breakfastIncluded: z.boolean().nullable().optional(),
    paymentMode: z.enum(['CN', 'HOTEL_PAYMENT']).optional(),
  })
  .strict();

const reviewSchema = z.object({
  // Only the two platforms this review serves. Booking.com has its own,
  // already-operational path and must never be routed through here.
  source: z.enum(['AGODA', 'CTRIP']),
  rawText: z.string().min(1, 'Nội dung không được để trống.').max(50000, 'Nội dung quá dài.'),
  overrides: overridesSchema.optional(),
});

export function createOtaReviewRouter(): Router {
  const router = Router();
  router.use('/admin/ota', requireAuth, requirePasswordChanged, requireAdmin);

  // POST /api/admin/ota/review — build or recompute the review.
  router.post('/admin/ota/review', (req, res, next) => {
    (async () => {
      const input = reviewSchema.parse(req.body ?? {});
      res.json(await buildOtaReviewFromText(input));
    })().catch(next);
  });

  return router;
}
