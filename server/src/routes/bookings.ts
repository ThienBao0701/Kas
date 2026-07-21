import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db/prisma';
import { requireAuth, requireAdmin, requirePasswordChanged } from '../middleware/auth';
import { parseBooking } from '../booking/parser';
import { persistDraftBooking } from '../booking/store';
import { serializeBookingPreview } from '../booking/serialize';

const extractSchema = z.object({
  rawText: z
    .string()
    .min(1, 'Nội dung Booking.com không được để trống.')
    .max(50000, 'Nội dung quá dài.'),
});

export function createBookingsRouter(): Router {
  const router = Router();

  // POST /api/bookings/extract — parse raw Booking.com text into a stored DRAFT
  // and return the structured preview. Admin-only; no dispatch happens here.
  router.post(
    '/bookings/extract',
    requireAuth,
    requirePasswordChanged,
    requireAdmin,
    (req, res, next) => {
      (async () => {
        const { rawText } = extractSchema.parse(req.body);

        const branches = await prisma.branch.findMany({
          where: { active: true },
          orderBy: { id: 'asc' },
        });

        const parsed = parseBooking(rawText, branches);
        const bookingId = await persistDraftBooking(
          parsed,
          rawText,
          req.currentUser?.id ?? null,
        );

        const stored = await prisma.booking.findUniqueOrThrow({
          where: { id: bookingId },
          include: {
            branch: true,
            rooms: { include: { nights: true } },
            warnings: true,
          },
        });

        const preview = serializeBookingPreview(stored);
        // A low-confidence branch is intentionally not persisted to branchId, so
        // surface it here as a candidate the admin can confirm, along with the
        // confidence signals the preview UI needs.
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
    },
  );

  return router;
}
