import { Router } from 'express';
import { healthRouter } from './health';
import { createAuthRouter } from './auth';
import { createBranchesRouter } from './branches';
import { createAdminBranchesRouter } from './adminBranches';
import { createAdminRoomMappingRouter } from './adminRoomMapping';
import { createBookingGuestsRouter } from './bookingGuests';
import { createAdminUsersRouter } from './adminUsers';
import { createBookingsRouter } from './bookings';
import { createAdminBookingsRouter } from './adminBookings';
import { createAdminDashboardRouter } from './adminDashboard';
import { createNotificationsRouter } from './notifications';
import { createIssuesRouter } from './issues';
import { createDevTestRouter } from './devTest';

/**
 * Builds a fresh API router. A factory (rather than a shared singleton) so each
 * app instance — notably each test file — gets its own login rate limiter state.
 */
export function createApiRouter(): Router {
  const router = Router();

  router.use(healthRouter);
  router.use(createAuthRouter());
  router.use(createBranchesRouter());
  // Mounted before the generic /admin router so branch management owns its paths.
  // Room mapping comes first: its paths are nested under a branch id, and the
  // branch router's own /admin/branches/:id handler would otherwise match them.
  router.use(createAdminRoomMappingRouter());
  router.use(createAdminBranchesRouter());
  router.use(createAdminUsersRouter());
  router.use(createAdminBookingsRouter());
  router.use(createAdminDashboardRouter());
  // Guest routes are more specific than /bookings/:id, so they mount first.
  router.use(createBookingGuestsRouter());
  router.use(createBookingsRouter());
  router.use(createNotificationsRouter());
  router.use(createIssuesRouter());
  router.use(createDevTestRouter());

  return router;
}
