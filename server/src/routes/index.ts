import { Router } from 'express';
import { healthRouter } from './health';

export const apiRouter: Router = Router();

apiRouter.use(healthRouter);

// Auth, users, bookings and notifications are mounted here in later phases.
