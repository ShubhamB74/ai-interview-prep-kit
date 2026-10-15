import express from 'express';
import cors from 'cors';
import { env } from './config/env.js';
import { AppError } from './lib/errors.js';
import { healthRouter } from './routes/health.js';

export function createApp() {
  const app = express();
  app.use(cors({ origin: env.webOrigin, credentials: true }));
  app.use(express.json({ limit: '200kb' }));

  app.use('/api/health', healthRouter);
  // PHASE 1: app.use('/api/auth', authRouter); app.use('/api/kits', requireAuth, kitsRouter);

  app.use((req, res) => res.status(404).json({ error: { code: 'NOT_FOUND', message: 'No such route.' } }));

  // Structured errors for the UI: { error: { code, message, details? } }
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const e = err instanceof AppError ? err : new AppError('INTERNAL', 'Unexpected server error.');
    if (!(err instanceof AppError)) console.error(err);
    res.status(e.status).json({ error: { code: e.code, message: e.message, details: e.details } });
  });
  return app;
}
