import { Router } from 'express';
import { healthRouter } from './health';
import { createAuthRouter } from './auth';
import { createBranchesRouter } from './branches';
import { createAdminBranchesRouter } from './adminBranches';
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
  router.use(createAdminBranchesRouter());
  router.use(createAdminUsersRouter());
  router.use(createAdminBookingsRouter());
  router.use(createAdminDashboardRouter());
  router.use(createBookingsRouter());
  router.use(createNotificationsRouter());
  router.use(createIssuesRouter());
  router.use(createDevTestRouter());

  return router;
}
