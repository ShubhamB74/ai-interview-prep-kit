import crypto from 'node:crypto';
import { AppError } from '../lib/errors.js';

/** In-memory implementation of the same repo interface. Used by tests (no Mongo needed). */
export function createMemoryRepos() {
  const U = new Map();
  const K = new Map();
  const uid = () => crypto.randomBytes(12).toString('hex');

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
      const k = { id: uid(), status: 'pending', kit: null, error: null, createdAt: now, updatedAt: now, ...data };
      K.set(k.id, k);
      return k;
    },
    findByHash: async (userId, hash) => [...K.values()].find((k) => k.userId === userId && k.inputHash === hash) || null,
    list: async (userId) => [...K.values()].filter((k) => k.userId === userId).reverse(),
    findOwned: async (id, userId) => {
      const k = K.get(id);
      return k && k.userId === userId ? k : null;
    },
    remove: async (id, userId) => {
      const k = K.get(id);
      return !!k && k.userId === userId && K.delete(id);
    },
  };

  return { users, kits };
}
