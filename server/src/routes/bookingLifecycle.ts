/**
 * Reception's operational actions on a dispatched booking.
 *
 *   POST /api/bookings/:id/receive     the branch acknowledges the booking
 *   POST /api/bookings/:id/check-in    the guest actually arrived
 *   POST /api/bookings/:id/check-out   the guest actually departed
 *   POST /api/bookings/:id/complete    the stay is closed
 *   POST /api/bookings/:id/cancel      the booking will not happen
 *   POST /api/bookings/:id/no-show     the guest never arrived
 *
 * A NEW router rather than an addition to `bookings.ts`, so the existing
 * Booking.com read and proof routes are not touched at all.
 *
 * Mounted BEFORE the generic booking router: `/bookings/:id/receive` must not
 * be swallowed by `/bookings/:id`.
 *
 * Authorisation is enforced twice on purpose — the route rejects a receptionist
 * from another branch, and `applyLifecycleAction` checks again at the write.
 * The route can be re-mounted or reordered; the service is where the row
 * actually changes.
 */
import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requirePasswordChanged } from '../middleware/auth';
import { applyLifecycleAction, type LifecycleAction } from '../booking/lifecycle';

/** A reason is optional everywhere, and required nowhere but cancellation. */
const bodySchema = z
  .object({ reason: z.string().trim().max(500).optional() })
  .strict()
  .optional();

const ACTIONS: ReadonlyArray<{ path: string; action: LifecycleAction }> = [
  { path: 'receive', action: 'RECEIVE' },
  { path: 'check-in', action: 'CHECK_IN' },
  { path: 'check-out', action: 'CHECK_OUT' },
  { path: 'complete', action: 'COMPLETE' },
  { path: 'cancel', action: 'CANCEL' },
  { path: 'no-show', action: 'NO_SHOW' },
];

export function createBookingLifecycleRouter(): Router {
  const router = Router();

  for (const { path, action } of ACTIONS) {
    router.post(
      `/bookings/:id/${path}`,
      requireAuth,
      requirePasswordChanged,
      (req, res, next) => {
        (async () => {
          const body = bodySchema.parse(req.body ?? {}) ?? {};
          const user = req.currentUser!;
          const result = await applyLifecycleAction(
            req.params.id!,
            action,
            { id: user.id, role: user.role, branchId: user.branchId ?? null },
            { reason: body.reason },
          );
          res.json(result);
        })().catch(next);
      },
    );
  }

  return router;
}
