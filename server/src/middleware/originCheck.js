import { env } from '../config/env.js';
import { AppError } from '../lib/errors.js';

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Cookie auth + cross-site cookies => reject state-changing requests from other origins. */
export function originCheck(req, res, next) {
  const origin = req.headers.origin;
  if (!SAFE.has(req.method) && origin && origin !== env.webOrigin) {
    return next(new AppError('BAD_ORIGIN', 'Request origin not allowed.', { status: 403 }));
  }
  next();
}
