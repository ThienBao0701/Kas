import { Router } from 'express';
import { healthRouter } from './health';
import { createAuthRouter } from './auth';
import { createBranchesRouter } from './branches';
import { createAdminUsersRouter } from './adminUsers';

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

  // Bookings and notifications are mounted here in later phases.
  return router;
}
