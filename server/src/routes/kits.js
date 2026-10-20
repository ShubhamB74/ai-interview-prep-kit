import { Router } from 'express';
import { asyncHandler } from '../lib/asyncHandler.js';
import { AppError } from '../lib/errors.js';
import { inputHash, titleFromJd } from '../lib/inputHash.js';
import { validateBody } from '../middleware/validate.js';
import { mockAttemptBody, opsBody, regenerateBody, reviewBody } from '../schema/ops.js';
import { batchKitsBody, createKitBody } from '../schema/requests.js';
import { applyOpsToKit } from '../services/kitEditor.js';
import { regenerateSchedule } from '../services/regenerate.js';
import { getMock, resetMock, saveMockAttempt } from '../services/mockInterview.js';
import { getPractice, recordReview, resetPractice } from '../services/practice.js';

const progressList = (progress) =>
  Object.entries(progress ?? {}).map(([step, v]) => ({ step, status: v.status, detail: v.detail ?? null, seq: v.seq ?? 0 })).sort((a, b) => a.seq - b.seq);

const summary = (k) => ({
  id: k.id, title: k.title, status: k.status, company_url: k.input.company_url, days: k.input.days,
  error: k.error ?? null, createdAt: k.createdAt,
});
const detail = (k) => ({
  ...summary(k), input: k.input, kit: k.kit, version: k.version ?? 0, regen: k.regen ?? null, progress: progressList(k.progress), attempt: k.attempt,
  startedAt: k.startedAt, finishedAt: k.finishedAt, updatedAt: k.updatedAt,
});

const notFound = () => new AppError('KIT_NOT_FOUND', 'Kit not found.', { status: 404 });
const tooMany = (max) => new AppError('TOO_MANY_ACTIVE_JOBS', `You already have ${max} kits generating. Wait for one to finish and try again.`, { status: 429 });

/**
 * Mounted behind requireAuth. Every query is scoped by req.userId.
 * POST creates the record and queues generation; the client polls GET /:id for status + progress.
 */
export function kitsRouter({ kits }, { jobs, limits, regen }) {
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

  // Edit anything in a ready kit. Ops address items by id and are applied to the latest version, so parallel edits merge.
  r.post('/:id/ops', validateBody(opsBody), asyncHandler(async (req, res) => {
    const saved = await applyOpsToKit(kits, req.params.id, req.userId, req.body.ops);
    res.json({ kit: detail(saved) });
  }));

  // Regenerate one section. Schedule: instant. Brief / one category: background (202), poll `regen` on the kit.
  r.post('/:id/regenerate', validateBody(regenerateBody), asyncHandler(async (req, res) => {
    const { section, category, force, days } = req.body;
    const k = await kits.findOwned(req.params.id, req.userId);
    if (!k) throw notFound();
    if (k.status !== 'ready' || !k.kit) throw new AppError('KIT_NOT_READY', 'This kit is not ready to edit yet.', { status: 409 });

    if (section === 'schedule') {
      const saved = await regenerateSchedule({ kits, id: k.id, userId: req.userId, days });
      return res.json({ kit: detail(saved) });
    }
    if (section === 'brief' && k.kit.company_brief.origin === 'edited' && !force) {
      throw new AppError('REGENERATE_WOULD_DISCARD_EDITS', 'You edited the company brief. Regenerating will replace your changes.', { status: 409 });
    }
    const claimed = await kits.claimRegen(k.id, req.userId, { section, ...(category ? { category } : {}) });
    if (!claimed) throw new AppError('REGEN_IN_PROGRESS', 'Another section of this kit is already being regenerated.', { status: 409 });
    regen.enqueue({ kitId: k.id, userId: req.userId, section, category, force });
    res.status(202).json({ kit: detail(claimed) });
  }));

  // ---- practice mode: per-card progress (Leitner boxes), kept beside the kit so reviewing never conflicts with editing ----
  r.get('/:id/practice', asyncHandler(async (req, res) => {
    res.json({ practice: await getPractice(kits, req.params.id, req.userId) });
  }));

  r.post('/:id/practice/reviews', validateBody(reviewBody), asyncHandler(async (req, res) => {
    const result = await recordReview(kits, req.params.id, req.userId, { cardId: req.body.card_id, confidence: req.body.confidence, reviewId: req.body.review_id });
    res.json(result);
  }));

  r.delete('/:id/practice', asyncHandler(async (req, res) => {
    await resetPractice(kits, req.params.id, req.userId);
    res.status(204).end();
  }));

  // ---- mock interview: attempts are saved with server-computed scores; the report is derived ----
  r.get('/:id/mock', asyncHandler(async (req, res) => {
    res.json(await getMock(kits, req.params.id, req.userId));
  }));

  r.post('/:id/mock/attempts', validateBody(mockAttemptBody), asyncHandler(async (req, res) => {
    res.status(201).json(await saveMockAttempt(kits, req.params.id, req.userId, req.body));
  }));

  r.delete('/:id/mock', asyncHandler(async (req, res) => {
    await resetMock(kits, req.params.id, req.userId);
    res.status(204).end();
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
