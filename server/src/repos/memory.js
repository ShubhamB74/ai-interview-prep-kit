import crypto from 'node:crypto';
import { AppError } from '../lib/errors.js';

/** In-memory implementation of the same repo interface (see repos/mongo.js). Used by tests; no Mongo needed. */
export function createMemoryRepos() {
  const U = new Map();
  const K = new Map();
  const uid = () => crypto.randomBytes(12).toString('hex');
  const touch = (k) => { k.updatedAt = new Date(); return k; };
  const copy = (k) => k && { ...k, progress: { ...k.progress } };
  const progressKey = (step) => String(step).replace(/[.$]/g, '_');

  const users = {
    async create({ email, passwordHash }) {
      if ([...U.values()].some((u) => u.email === email)) {
        throw new AppError('EMAIL_TAKEN', 'An account with that email already exists.', { status: 409 });
      }
      const u = { id: uid(), email, passwordHash };
      U.set(u.id, u);
      return u;
    },
    findByEmail: async (email) => [...U.values()].find((u) => u.email === email) || null,
    findById: async (id) => U.get(id) || null,
  };

  const kits = {
    async create(data) {
      const existing = await kits.findByHash(data.userId, data.inputHash);
      if (existing) return existing;
      const now = new Date();
      const k = { id: uid(), status: 'pending', attempt: 0, progress: {}, kit: null, error: null, startedAt: null, heartbeatAt: null, finishedAt: null, createdAt: now, updatedAt: now, ...data };
      K.set(k.id, k);
      return copy(k);
    },
    findByHash: async (userId, hash) => copy([...K.values()].find((k) => k.userId === userId && k.inputHash === hash)) || null,
    list: async (userId) => [...K.values()].filter((k) => k.userId === userId).reverse().map(copy),
    findOwned: async (id, userId) => {
      const k = K.get(id);
      return k && k.userId === userId ? copy(k) : null;
    },
    findById: async (id) => copy(K.get(id)) || null,
    remove: async (id, userId) => {
      const k = K.get(id);
      return !!k && k.userId === userId && K.delete(id);
    },
    countActive: async (userId) => [...K.values()].filter((k) => k.userId === userId && ['pending', 'running'].includes(k.status)).length,

    async claim(id) {
      const k = K.get(id);
      if (!k || k.status !== 'pending') return null;
      Object.assign(k, { status: 'running', attempt: k.attempt + 1, startedAt: new Date(), heartbeatAt: new Date(), error: null, progress: {} });
      return copy(touch(k));
    },
    async setProgress(id, attempt, step, patch) {
      const k = K.get(id);
      if (!k || k.status !== 'running' || k.attempt !== attempt) return false;
      k.progress[progressKey(step)] = { ...patch, at: new Date() };
      k.heartbeatAt = new Date();
      touch(k);
      return true;
    },
    async finish(id, attempt, kit) {
      const k = K.get(id);
      if (!k || k.status !== 'running' || k.attempt !== attempt) return false;
      Object.assign(k, { status: 'ready', kit, error: null, finishedAt: new Date() });
      touch(k);
      return true;
    },
    async fail(id, attempt, error) {
      const k = K.get(id);
      if (!k || k.status !== 'running' || k.attempt !== attempt) return false;
      Object.assign(k, { status: 'failed', error, finishedAt: new Date() });
      touch(k);
      return true;
    },
    async requeue(id, userId) {
      const k = K.get(id);
      if (!k || k.userId !== userId || k.status !== 'failed') return null;
      Object.assign(k, { status: 'pending', error: null, progress: {} });
      return copy(touch(k));
    },
    async recoverInterrupted(maxAttempts) {
      for (const k of K.values()) {
        if (k.status !== 'running') continue;
        if (k.attempt < maxAttempts) k.status = 'pending';
        else Object.assign(k, { status: 'failed', finishedAt: new Date(), error: { code: 'JOB_INTERRUPTED', message: 'Generation was interrupted by a server restart too many times.' } });
        touch(k);
      }
      return [...K.values()].filter((k) => k.status === 'pending').map((k) => k.id);
    },
  };

  return { users, kits };
}
