import { Router } from 'express';
import { healthRouter } from './health';
import { createAuthRouter } from './auth';
import { createBranchesRouter } from './branches';
import { createAdminUsersRouter } from './adminUsers';
import { createBookingsRouter } from './bookings';
import { createAdminBookingsRouter } from './adminBookings';
import { createNotificationsRouter } from './notifications';

/**
 * Builds a fresh API router. A factory (rather than a shared singleton) so each
 * app instance — notably each test file — gets its own login rate limiter state.
 */
export function createApiRouter(): Router {
  const router = Router();

  router.use(healthRouter);
  router.use(createAuthRouter());
  router.use(createBranchesRouter());
  router.use(createAdminUsersRouter());
  router.use(createAdminBookingsRouter());
  router.use(createBookingsRouter());
  router.use(createNotificationsRouter());

  return router;
}
