import express, { type Express } from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { env } from './config/env';
import { apiRouter } from './routes';
import { requestContext } from './middleware/requestContext';
import { requestLogger } from './middleware/requestLogger';
import { notFoundHandler } from './middleware/notFound';
import { errorHandler } from './middleware/errorHandler';

export function createApp(): Express {
  const app = express();

  // Behind a LAN reverse proxy the real client IP matters for rate limiting.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(helmet());
  // Before the body parsers: a malformed JSON body must still produce an
  // error response carrying a requestId.
  app.use(requestContext);
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: false }));
  app.use(cookieParser());

  if (env.NODE_ENV === 'development') {
    app.use(requestLogger);
  }

  app.use('/api', apiRouter);

  // The built client is served here from Phase 8; until then unknown paths 404.
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
