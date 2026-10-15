import { Router } from 'express';
import { asyncHandler } from '../lib/asyncHandler.js';
import { AppError } from '../lib/errors.js';
import { inputHash, titleFromJd } from '../lib/inputHash.js';
import { validateBody } from '../middleware/validate.js';
import { createKitBody } from '../schema/requests.js';

const summary = (k) => ({
  id: k.id,
  title: k.title,
  status: k.status,
  company_url: k.input.company_url,
  days: k.input.days,
  createdAt: k.createdAt,
});
const detail = (k) => ({ ...summary(k), input: k.input, kit: k.kit, error: k.error, updatedAt: k.updatedAt });

const notFound = () => new AppError('KIT_NOT_FOUND', 'Kit not found.', { status: 404 });

/** Mounted behind requireAuth. Every query is scoped by req.userId. */
export function kitsRouter({ kits }) {
  const r = Router();

  r.get('/', asyncHandler(async (req, res) => {
    res.json({ kits: (await kits.list(req.userId)).map(summary) });
  }));

  // Creates the kit record. Generation is kicked off by the job runner in Phase 5.
  // Submitting the same posting + company again returns the existing kit (200, duplicate: true).
  r.post('/', validateBody(createKitBody), asyncHandler(async (req, res) => {
    const { jd, company_url, days } = req.body;
    const hash = inputHash(jd, company_url);
    const existing = await kits.findByHash(req.userId, hash);
    if (existing) return res.status(200).json({ kit: detail(existing), duplicate: true });

    const created = await kits.create({
      userId: req.userId,
      title: titleFromJd(jd),
      inputHash: hash,
      input: { jd, company_url, days },
    });
    res.status(201).json({ kit: detail(created), duplicate: false });
  }));

  r.get('/:id', asyncHandler(async (req, res) => {
    const k = await kits.findOwned(req.params.id, req.userId);
    if (!k) throw notFound(); // 404, not 403: don't reveal that someone else's kit exists
    res.json({ kit: detail(k) });
  }));

  r.delete('/:id', asyncHandler(async (req, res) => {
    if (!(await kits.remove(req.params.id, req.userId))) throw notFound();
    res.status(204).end();
  }));

  return r;
}
