import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { AppError } from './errors.js';

export const COOKIE_NAME = 'prepkit_session';
const isProd = env.nodeEnv === 'production';

/** Stateless signed session. Expiry is enforced by the token itself. */
export function signSession(userId) {
  return jwt.sign({ sub: String(userId) }, env.sessionSecret, {
    expiresIn: `${env.sessionTtlDays}d`,
  });
}

/** @returns {string} userId. Throws AppError SESSION_EXPIRED / INVALID_SESSION. */
export function verifySession(token) {
  try {
    return jwt.verify(token, env.sessionSecret).sub;
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      throw new AppError('SESSION_EXPIRED', 'Your session has expired. Please sign in again.', { status: 401 });
    }
    throw new AppError('INVALID_SESSION', 'Invalid session. Please sign in again.', { status: 401 });
  }
}

// Deployed web + API live on different origins, so prod needs SameSite=None; Secure.
// CSRF is mitigated by the Origin check in middleware/originCheck.js plus JSON-only bodies.
const cookieBase = {
  httpOnly: true,
  secure: isProd,
  sameSite: isProd ? 'none' : 'lax',
  path: '/',
};

export const setSessionCookie = (res, userId) =>
  res.cookie(COOKIE_NAME, signSession(userId), { ...cookieBase, maxAge: env.sessionTtlDays * 86400_000 });

export const clearSessionCookie = (res) => res.clearCookie(COOKIE_NAME, cookieBase);
