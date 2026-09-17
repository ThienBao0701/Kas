import { Router } from 'express';
import { z } from 'zod';
import { getClock } from '../lib/clock';
import { requireAuth, requirePasswordChanged, requireRole } from '../middleware/auth';
import {
  checkInShift,
  closeOpenSession,
  findOpenSession,
  serializeShiftSession,
} from '../shift/shiftService';
import { SHIFT_DEFINITIONS } from '../shift/shiftTypes';
import type { UserWithBranch } from '../auth/serialize';

const SHIFT = z.enum(['A', 'B', 'C', 'A4', 'C4']);

const checkInSchema = z.object({
  shiftType: SHIFT,
  /**
   * Trimmed by zod BEFORE min(1), so a name of only spaces is refused rather
   * than stored. The service trims again — it is reachable without this router.
   */
  receptionistName: z.string().trim().min(1, 'Vui lòng nhập họ tên lễ tân.').max(200),
});

function actor(user: UserWithBranch) {
  return { id: user.id, role: user.role, branchId: user.branchId, fullName: user.fullName };
}

/** Only a receptionist works a shift. */
const requireReception = requireRole('RECEPTIONIST');

/**
 * Reception shift check-in.
 *
 * The whole point of these routes is that the browser never decides who is
 * working: it asks the server for the current shift on every load, and the
 * server answers from the database. Nothing here trusts React state, which is
 * why a refresh, a second tab and a reopened laptop all agree.
 */
export function createReceptionShiftsRouter(): Router {
  const router = Router();

  // GET /api/reception/shifts/options — the five shifts, with their clock times.
  // Served rather than hardcoded in the client so the times exist ONCE.
  router.get('/reception/shifts/options', requireAuth, requirePasswordChanged, (_req, res) => {
    res.json({ shifts: SHIFT_DEFINITIONS });
  });

  // GET /api/reception/shifts/current — the open session, or null.
  //
  // Answers with `session: null` rather than 404 when nobody is checked in: "no
  // shift yet" is the normal state at the start of a day, not an error, and the
  // client renders the picker from it.
  router.get('/reception/shifts/current', requireAuth, requirePasswordChanged, (req, res, next) => {
    (async () => {
      const user = req.currentUser!;
      const now = getClock().now();
      const session = await findOpenSession(user.id);
      res.json({ session: session ? serializeShiftSession(session, now) : null });
    })().catch(next);
  });

  // POST /api/reception/shifts/check-in — open a shift (closes the previous one).
  router.post('/reception/shifts/check-in', requireAuth, requirePasswordChanged, requireReception, (req, res, next) => {
    (async () => {
      const user = req.currentUser!;
      const input = checkInSchema.parse(req.body ?? {});
      const clock = getClock();
      const session = await checkInShift(input, actor(user), clock);
      res.status(201).json({ session: serializeShiftSession(session, clock.now()) });
    })().catch(next);
  });

  // POST /api/reception/shifts/close — end the shift without starting another.
  router.post('/reception/shifts/close', requireAuth, requirePasswordChanged, requireReception, (req, res, next) => {
    (async () => {
      const user = req.currentUser!;
      const closed = await closeOpenSession(actor(user), getClock());
      res.json({ closed });
    })().catch(next);
  });

  return router;
}
