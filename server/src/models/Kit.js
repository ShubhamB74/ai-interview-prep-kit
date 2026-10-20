import mongoose from 'mongoose';

/**
 * `kit` holds the Appendix A document (null until generated). It is validated by validateKit()
 * before every write -- Mongoose does not police its shape (Mixed on purpose).
 * status: pending -> running -> ready | failed   (driven by jobs/jobRunner.js)
 */
const kitSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    title: { type: String, required: true },
    inputHash: { type: String, required: true },
    input: {
      jd: { type: String, required: true },
      company_url: { type: String, required: true },
      days: { type: Number, required: true },
    },
    status: { type: String, enum: ['pending', 'running', 'ready', 'failed'], default: 'pending', index: true },
    // Bumped on every claim. Writes from a job carry its attempt number, so a stale or timed-out run can never
    // overwrite the result of a newer one.
    attempt: { type: Number, default: 0 },
    // Optimistic-concurrency counter for the kit document: every write (generation, edit, regeneration commit) bumps it,
    // and edits are applied with "only if the version is still N", so two writers can never silently overwrite each other.
    version: { type: Number, default: 0 },
    // At most one regeneration per kit at a time: { section, category?, status: 'running'|'failed', startedAt, error? } or null.
    regen: { type: mongoose.Schema.Types.Mixed, default: null },
    // Practice progress, per flashcard id: { cards: { [cardId]: { box, due, last_confidence, reviews, ... } } }.
    // Lives beside `kit`, not inside it, so reviewing never conflicts with editing (which compare-and-swaps `kit`).
    practice: { type: mongoose.Schema.Types.Mixed, default: {} },
    // Mock interview attempts, newest first, capped at 10 (written with an atomic $push + $slice).
    mock: { type: [mongoose.Schema.Types.Mixed], default: [] },
    // { [step]: { status, detail, seq, at } } -- latest state per step, so it never grows with retries.
    progress: { type: mongoose.Schema.Types.Mixed, default: {} },
    startedAt: Date,
    heartbeatAt: Date,
    finishedAt: Date,
    kit: { type: mongoose.Schema.Types.Mixed, default: null },
    error: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { timestamps: true, minimize: false }
);

// One kit per (user, posting+company). Backs the "submitted twice" edge case even under races.
kitSchema.index({ userId: 1, inputHash: 1 }, { unique: true });

export const KitModel = mongoose.models.Kit || mongoose.model('Kit', kitSchema);
