import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { env } from './config/env.js';
import { AppError } from './lib/errors.js';
import { healthRouter } from './routes/health.js';
import { authRouter } from './routes/auth.js';
import { kitsRouter } from './routes/kits.js';
import { requireAuth } from './middleware/requireAuth.js';
import { originCheck } from './middleware/originCheck.js';

/** @param {{ repos: { users: object, kits: object } }} deps  repos are injected so tests can use memory repos. */
export function createApp({ repos }) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(cors({ origin: env.webOrigin, credentials: true }));
  app.use(express.json({ limit: '200kb' }));
  app.use(cookieParser());
  app.use(originCheck);

  app.use('/api/health', healthRouter);
  app.use('/api/auth', authRouter(repos));
  app.use('/api/kits', requireAuth, kitsRouter(repos));

  app.use((req, res) => res.status(404).json({ error: { code: 'NOT_FOUND', message: 'No such route.' } }));

  // Structured errors for the UI: { error: { code, message, details? } }
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    let e = err;
    if (err.type === 'entity.parse.failed') e = new AppError('INVALID_JSON', 'Request body is not valid JSON.', { status: 400 });
    else if (err.type === 'entity.too.large') e = new AppError('PAYLOAD_TOO_LARGE', 'Request body too large.', { status: 413 });
    else if (!(err instanceof AppError)) {
      console.error(err);
      e = new AppError('INTERNAL', 'Unexpected server error.');
    }
    res.status(e.status).json({ error: { code: e.code, message: e.message, details: e.details } });
  });
  return app;
}
