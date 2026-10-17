import { Router } from 'express';
import { asyncHandler } from '../lib/asyncHandler.js';
import { AppError } from '../lib/errors.js';
import { inputHash, titleFromJd } from '../lib/inputHash.js';
import { validateBody } from '../middleware/validate.js';
import { batchKitsBody, createKitBody } from '../schema/requests.js';

const progressList = (progress) =>
  Object.entries(progress ?? {}).map(([step, v]) => ({ step, status: v.status, detail: v.detail ?? null, seq: v.seq ?? 0 })).sort((a, b) => a.seq - b.seq);

const summary = (k) => ({
  id: k.id, title: k.title, status: k.status, company_url: k.input.company_url, days: k.input.days,
  error: k.error ?? null, createdAt: k.createdAt,
});
const detail = (k) => ({
  ...summary(k), input: k.input, kit: k.kit, progress: progressList(k.progress), attempt: k.attempt,
  startedAt: k.startedAt, finishedAt: k.finishedAt, updatedAt: k.updatedAt,
});

const notFound = () => new AppError('KIT_NOT_FOUND', 'Kit not found.', { status: 404 });
const tooMany = (max) => new AppError('TOO_MANY_ACTIVE_JOBS', `You already have ${max} kits generating. Wait for one to finish and try again.`, { status: 429 });

/**
 * Mounted behind requireAuth. Every query is scoped by req.userId.
 * POST creates the record and queues generation; the client polls GET /:id for status + progress.
 */
export function kitsRouter({ kits }, { jobs, limits }) {
  const r = Router();

  /** Dedupe, enforce the per-user cap, create, queue. The same posting + company never runs twice. */
  async function createAndQueue(userId, { jd, company_url, days }) {
    const hash = inputHash(jd, company_url);
    const existing = await kits.findByHash(userId, hash);
    if (existing) return { kit: existing, duplicate: true };
    if ((await kits.countActive(userId)) >= limits.maxActivePerUser) throw tooMany(limits.maxActivePerUser);
    const created = await kits.create({ userId, title: titleFromJd(jd), inputHash: hash, input: { jd, company_url, days } });
    jobs.enqueue(created.id);
    return { kit: created, duplicate: false };
  }

  r.get('/', asyncHandler(async (req, res) => {
    res.json({ kits: (await kits.list(req.userId)).map(summary) });
  }));

  r.post('/', validateBody(createKitBody), asyncHandler(async (req, res) => {
    const { kit, duplicate } = await createAndQueue(req.userId, req.body);
    res.status(duplicate ? 200 : 201).json({ kit: detail(kit), duplicate });
  }));

  // Several roles at once (the client parses the uploaded file into items). One bad row never sinks the others.
  r.post('/batch', validateBody(batchKitsBody), asyncHandler(async (req, res) => {
    const results = [];
    for (const [index, raw] of req.body.items.entries()) {
      const parsed = createKitBody.safeParse({ ...(typeof raw === 'object' && raw ? raw : {}), days: raw?.days ?? req.body.days });
      if (!parsed.success) {
        results.push({ index, status: 'invalid', errors: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) });
        continue;
      }
      try {
        const { kit, duplicate } = await createAndQueue(req.userId, parsed.data);
        results.push({ index, status: duplicate ? 'duplicate' : 'created', kit_id: kit.id });
      } catch (err) {
        if (!(err instanceof AppError)) throw err;
        results.push({ index, status: 'rejected', error: { code: err.code, message: err.message } });
      }
    }
    res.json({ results });
  }));

  r.get('/:id', asyncHandler(async (req, res) => {
    const k = await kits.findOwned(req.params.id, req.userId);
    if (!k) throw notFound(); // 404, not 403: don't reveal that someone else's kit exists
    res.json({ kit: detail(k) });
  }));

  r.post('/:id/retry', asyncHandler(async (req, res) => {
    const k = await kits.findOwned(req.params.id, req.userId);
    if (!k) throw notFound();
    const notRetryable = () => new AppError('NOT_RETRYABLE', `Only failed kits can be retried (this one is ${k.status}).`, { status: 409 });
    if (k.status !== 'failed') throw notRetryable();
    if ((await kits.countActive(req.userId)) >= limits.maxActivePerUser) throw tooMany(limits.maxActivePerUser);
    const requeued = await kits.requeue(k.id, req.userId);
    if (!requeued) throw notRetryable(); // lost a race with another retry
    jobs.enqueue(requeued.id);
    res.status(202).json({ kit: detail(requeued) });
  }));

  r.delete('/:id', asyncHandler(async (req, res) => {
    // Safe while generating: the job's later writes are conditional on the record still existing and running.
    if (!(await kits.remove(req.params.id, req.userId))) throw notFound();
    res.status(204).end();
  }));

  return r;
}
