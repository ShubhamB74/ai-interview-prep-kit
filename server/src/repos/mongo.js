import mongoose from 'mongoose';
import { AppError } from '../lib/errors.js';
import { UserModel } from '../models/User.js';
import { KitModel } from '../models/Kit.js';

const validId = (id) => mongoose.isValidObjectId(id);
const progressKey = (step) => String(step).replace(/[.$]/g, '_');

const toUser = (d) => d && { id: String(d._id), email: d.email, passwordHash: d.passwordHash };
const toKit = (d) =>
  d && {
    id: String(d._id),
    userId: String(d.userId),
    title: d.title,
    inputHash: d.inputHash,
    input: { jd: d.input.jd, company_url: d.input.company_url, days: d.input.days },
    status: d.status,
    attempt: d.attempt ?? 0,
    version: d.version ?? 0,
    regen: d.regen ?? null,
    progress: d.progress ?? {},
    kit: d.kit,
    error: d.error,
    startedAt: d.startedAt,
    heartbeatAt: d.heartbeatAt,
    finishedAt: d.finishedAt,
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
    // Summaries only: the (large) kit, progress and job description are not loaded for the list view.
    list: async (userId) =>
      (await KitModel.find({ userId }).select('-kit -progress -input.jd').sort({ createdAt: -1 }).lean())
        .map((d) => toKit({ ...d, input: { ...d.input, jd: '' } })),
    // Ownership is enforced in the query itself: another user's kit is simply "not found".
    findOwned: async (id, userId) => (validId(id) ? toKit(await KitModel.findOne({ _id: id, userId })) : null),
    findById: async (id) => (validId(id) ? toKit(await KitModel.findById(id)) : null),
    remove: async (id, userId) => validId(id) && (await KitModel.deleteOne({ _id: id, userId })).deletedCount === 1,
    countActive: (userId) => KitModel.countDocuments({ userId, status: { $in: ['pending', 'running'] } }),

    // ---- job lifecycle. Every transition is a single conditional update, so concurrent callers can't both win. ----
    /** pending -> running (atomically). Returns the claimed record, or null if someone else got it / it isn't pending. */
    async claim(id) {
      if (!validId(id)) return null;
      const now = new Date();
      return toKit(await KitModel.findOneAndUpdate(
        { _id: id, status: 'pending' },
        { $set: { status: 'running', startedAt: now, heartbeatAt: now, error: null, progress: {} }, $inc: { attempt: 1 } },
        { new: true }
      ));
    },
    async setProgress(id, attempt, step, patch) {
      if (!validId(id)) return false;
      const now = new Date();
      const r = await KitModel.updateOne(
        { _id: id, status: 'running', attempt },
        { $set: { [`progress.${progressKey(step)}`]: { ...patch, at: now }, heartbeatAt: now } }
      );
      return r.matchedCount === 1;
    },
    async finish(id, attempt, kit) {
      if (!validId(id)) return false;
      const r = await KitModel.updateOne({ _id: id, status: 'running', attempt }, { $set: { status: 'ready', kit, error: null, finishedAt: new Date() }, $inc: { version: 1 } });
      return r.matchedCount === 1;
    },
    async fail(id, attempt, error) {
      if (!validId(id)) return false;
      const r = await KitModel.updateOne({ _id: id, status: 'running', attempt }, { $set: { status: 'failed', error, finishedAt: new Date() } });
      return r.matchedCount === 1;
    },
    // ---- editing + regeneration ----
    /** Replace the kit document only if nobody wrote since `expectedVersion` was read. Returns the new record or null. */
    replaceKit: async (id, userId, expectedVersion, kit) => (validId(id)
      ? toKit(await KitModel.findOneAndUpdate({ _id: id, userId, status: 'ready', version: expectedVersion }, { $set: { kit }, $inc: { version: 1 } }, { new: true }))
      : null),
    /** Start a regeneration unless one is already running on this kit. Returns the record or null. */
    claimRegen: async (id, userId, regen) => (validId(id)
      ? toKit(await KitModel.findOneAndUpdate(
        { _id: id, userId, status: 'ready', $or: [{ regen: null }, { 'regen.status': { $ne: 'running' } }] },
        { $set: { regen: { ...regen, status: 'running', startedAt: new Date() } } },
        { new: true }
      ))
      : null),
    /** Clear (null) or mark failed a regeneration. */
    async setRegen(id, regen) {
      if (!validId(id)) return false;
      return (await KitModel.updateOne({ _id: id }, { $set: { regen } })).matchedCount === 1;
    },
    /** failed -> pending for an owner-requested retry. */
    requeue: async (id, userId) => (validId(id)
      ? toKit(await KitModel.findOneAndUpdate({ _id: id, userId, status: 'failed' }, { $set: { status: 'pending', error: null, progress: {} } }, { new: true }))
      : null),
    /** Startup recovery: orphaned `running` jobs go back to pending (or fail after maxAttempts). Returns all pending ids. */
    async recoverInterrupted(maxAttempts) {
      await KitModel.updateMany({ 'regen.status': 'running' }, { $set: { regen: null } }); // a regeneration cannot survive a restart
      await KitModel.updateMany({ status: 'running', attempt: { $lt: maxAttempts } }, { $set: { status: 'pending' } });
      await KitModel.updateMany({ status: 'running', attempt: { $gte: maxAttempts } }, {
        $set: { status: 'failed', finishedAt: new Date(), error: { code: 'JOB_INTERRUPTED', message: 'Generation was interrupted by a server restart too many times.' } },
      });
      return (await KitModel.find({ status: 'pending' }).select('_id').sort({ createdAt: 1 })).map((d) => String(d._id));
    },
  };

  return { users, kits };
}
