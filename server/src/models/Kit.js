import mongoose from 'mongoose';

/**
 * `kit` holds the Appendix A document (null until generated). It is validated by validateKit()
 * before every write -- Mongoose does not police its shape (Mixed on purpose).
 * status: pending -> running -> ready | failed   (driven by Phase 5 job runner)
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
    status: { type: String, enum: ['pending', 'running', 'ready', 'failed'], default: 'pending' },
    kit: { type: mongoose.Schema.Types.Mixed, default: null },
    error: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { timestamps: true }
);

// One kit per (user, posting+company). Backs the "submitted twice" edge case even under races.
kitSchema.index({ userId: 1, inputHash: 1 }, { unique: true });

export const KitModel = mongoose.models.Kit || mongoose.model('Kit', kitSchema);
