import mongoose from 'mongoose';
import { AppError } from '../lib/errors.js';
import { UserModel } from '../models/User.js';
import { KitModel } from '../models/Kit.js';

const validId = (id) => mongoose.isValidObjectId(id);

const toUser = (d) => d && { id: String(d._id), email: d.email, passwordHash: d.passwordHash };
const toKit = (d) =>
  d && {
    id: String(d._id),
    userId: String(d.userId),
    title: d.title,
    inputHash: d.inputHash,
    input: { jd: d.input.jd, company_url: d.input.company_url, days: d.input.days },
    status: d.status,
    kit: d.kit,
    error: d.error,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
  };

export function createMongoRepos() {
  const users = {
    async create({ email, passwordHash }) {
      try {
        return toUser(await UserModel.create({ email, passwordHash }));
      } catch (err) {
        if (err.code === 11000) throw new AppError('EMAIL_TAKEN', 'An account with that email already exists.', { status: 409 });
        throw err;
      }
    },
    findByEmail: async (email) => toUser(await UserModel.findOne({ email })),
    findById: async (id) => (validId(id) ? toUser(await UserModel.findById(id)) : null),
  };

  const kits = {
    async create(data) {
      try {
        return toKit(await KitModel.create(data));
      } catch (err) {
        if (err.code === 11000) return kits.findByHash(data.userId, data.inputHash); // lost a race: return winner
        throw err;
      }
    },
    findByHash: async (userId, hash) => toKit(await KitModel.findOne({ userId, inputHash: hash })),
    list: async (userId) => (await KitModel.find({ userId }).sort({ createdAt: -1 })).map(toKit),
    // Ownership is enforced in the query itself: another user's kit is simply "not found".
    findOwned: async (id, userId) => (validId(id) ? toKit(await KitModel.findOne({ _id: id, userId })) : null),
    remove: async (id, userId) => validId(id) && (await KitModel.deleteOne({ _id: id, userId })).deletedCount === 1,
  };

  return { users, kits };
}
