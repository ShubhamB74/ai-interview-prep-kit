import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { asyncHandler } from '../lib/asyncHandler.js';
import { AppError } from '../lib/errors.js';
import { clearSessionCookie, setSessionCookie } from '../lib/session.js';
import { validateBody } from '../middleware/validate.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { loginBody, registerBody } from '../schema/requests.js';

const publicUser = (u) => ({ id: u.id, email: u.email });
// Compared against when the email is unknown, so login timing doesn't reveal which emails exist.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10);

export function authRouter({ users }) {
  const r = Router();

  r.post('/register', validateBody(registerBody), asyncHandler(async (req, res) => {
    const passwordHash = await bcrypt.hash(req.body.password, 10);
    const user = await users.create({ email: req.body.email, passwordHash });
    setSessionCookie(res, user.id);
    res.status(201).json({ user: publicUser(user) });
  }));

  r.post('/login', validateBody(loginBody), asyncHandler(async (req, res) => {
    const user = await users.findByEmail(req.body.email);
    const ok = await bcrypt.compare(req.body.password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !ok) throw new AppError('INVALID_CREDENTIALS', 'Invalid email or password.', { status: 401 });
    setSessionCookie(res, user.id);
    res.json({ user: publicUser(user) });
  }));

  r.post('/logout', (req, res) => {
    clearSessionCookie(res);
    res.status(204).end();
  });

  r.get('/me', requireAuth, asyncHandler(async (req, res) => {
    const user = await users.findById(req.userId);
    if (!user) {
      clearSessionCookie(res);
      throw new AppError('INVALID_SESSION', 'Account no longer exists.', { status: 401 });
    }
    res.json({ user: publicUser(user) });
  }));

  return r;
}
