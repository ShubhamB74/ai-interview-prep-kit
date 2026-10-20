import crypto from 'node:crypto';
import { ROUND_TITLE, scoreAnswer, splitOutline, summarizeMock } from '@prepkit/shared/mock';
import { AppError } from '../lib/errors.js';

async function loadReady(kits, id, userId) {
  const rec = await kits.findOwned(id, userId);
  if (!rec) throw new AppError('KIT_NOT_FOUND', 'Kit not found.', { status: 404 });
  if (rec.status !== 'ready' || !rec.kit) throw new AppError('KIT_NOT_READY', 'This kit is not ready yet.', { status: 409 });
  return rec;
}

export async function getMock(kits, id, userId) {
  const rec = await loadReady(kits, id, userId);
  const attempts = rec.mock ?? [];
  return { attempts, report: summarizeMock(rec.kit, attempts) };
}

/**
 * Stores one attempt. Everything that matters is recomputed here: the checklist comes from the kit's current outline,
 * `covered` is normalised to its length, and the score is derived from the ticked boxes, never taken from the client.
 */
export async function saveMockAttempt(kits, id, userId, body) {
  const rec = await loadReady(kits, id, userId);
  const byId = new Map(rec.kit.questions.map((q) => [q.id, q]));
  const answers = body.answers.map((a) => {
    const q = byId.get(a.question_id);
    if (!q) throw new AppError('ITEM_NOT_FOUND', `Question ${a.question_id} not found.`, { status: 404 });
    const points = splitOutline(q.answer_outline);
    const covered = points.map((_, i) => !a.skipped && Boolean(a.covered[i]));
    return {
      question_id: q.id, round_id: a.round_id, prompt: q.prompt.slice(0, 300), answer_text: a.skipped ? '' : a.answer_text,
      covered, seconds: a.seconds, skipped: a.skipped, score: scoreAnswer(covered, points.length, a.skipped),
    };
  });
  const attempt = {
    id: `m-${crypto.randomBytes(5).toString('hex')}`,
    saved_at: new Date().toISOString(),
    completed: body.completed,
    basis: body.basis ?? 'default',
    rounds: body.rounds.map((r) => ({ id: r.id, title: ROUND_TITLE[r.id], question_ids: r.question_ids })),
    answers,
    overall: answers.reduce((n, a) => n + a.score, 0) / answers.length,
  };
  if (!(await kits.addMockAttempt(id, userId, attempt))) throw new AppError('KIT_NOT_READY', 'This kit is not ready yet.', { status: 409 });
  const attempts = [attempt, ...(rec.mock ?? [])].slice(0, 10);
  return { attempt, report: summarizeMock(rec.kit, attempts) };
}

export async function resetMock(kits, id, userId) {
  await loadReady(kits, id, userId);
  await kits.resetMock(id, userId);
}
