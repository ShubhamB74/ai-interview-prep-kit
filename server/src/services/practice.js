import { interviewAtMs, nextState } from '@prepkit/shared/leitner';
import { AppError } from '../lib/errors.js';

const MAX_TRIES = 5;

async function loadReady(kits, id, userId) {
  const rec = await kits.findOwned(id, userId);
  if (!rec) throw new AppError('KIT_NOT_FOUND', 'Kit not found.', { status: 404 });
  if (rec.status !== 'ready' || !rec.kit) throw new AppError('KIT_NOT_READY', 'This kit is not ready yet.', { status: 409 });
  return rec;
}

export async function getPractice(kits, id, userId) {
  const rec = await loadReady(kits, id, userId);
  return { cards: rec.practice?.cards ?? {}, interview_at: toIso(interviewAtMs(rec.kit)), server_time: new Date().toISOString() };
}

const toIso = (ms) => (ms ? new Date(ms).toISOString() : null);

/**
 * Records one rating. The server owns the clock (a client cannot back-date or fast-forward its own schedule) and
 * applies the Leitner transition to the card's CURRENT stored state: read, compute, write only if the card's review count
 * is unchanged, else retry. `reviewId` makes a double-click or a retried request idempotent.
 * @returns {{ card_id, state, duplicate: boolean }}
 */
export async function recordReview(kits, id, userId, { cardId, confidence, reviewId }, now = Date.now()) {
  for (let attempt = 0; attempt < MAX_TRIES; attempt++) {
    const rec = await loadReady(kits, id, userId);
    if (!rec.kit.flashcards.some((c) => c.id === cardId)) throw new AppError('ITEM_NOT_FOUND', `Flashcard ${cardId} not found.`, { status: 404 });
    const prev = rec.practice?.cards?.[cardId];
    if (reviewId && prev?.last_review_id === reviewId) return { card_id: cardId, state: prev, duplicate: true };
    const state = nextState(prev, confidence, { now, interviewAt: interviewAtMs(rec.kit), reviewId });
    if (await kits.setPracticeCard(id, userId, cardId, prev?.reviews ?? 0, state)) return { card_id: cardId, state, duplicate: false };
  }
  throw new AppError('REVIEW_CONFLICT', 'Could not save that rating. Please try again.', { status: 409 });
}

export async function resetPractice(kits, id, userId) {
  await loadReady(kits, id, userId);
  await kits.resetPractice(id, userId);
}
