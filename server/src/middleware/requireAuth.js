import { COOKIE_NAME, clearSessionCookie, verifySession } from '../lib/session.js';
import { AppError } from '../lib/errors.js';

/** Protects routes. Sets req.userId. Expired/invalid sessions clear the cookie and return 401. */
export function requireAuth(req, res, next) {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) return next(new AppError('UNAUTHENTICATED', 'Please sign in.', { status: 401 }));
  try {
    req.userId = verifySession(token);
    next();
  } catch (err) {
    clearSessionCookie(res);
    next(err);
  }
}
