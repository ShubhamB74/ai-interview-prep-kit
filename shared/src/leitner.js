/**
 * Practice scheduling: Leitner boxes, shared by the server (authoritative) and the browser (instant feedback).
 *
 * Why Leitner rather than a plain confidence sort: a confidence sort forgets. A card you knew once is ranked "strong"
 * forever, and one you missed stays "weak" even after you have since got it right five times. Boxes keep a history in one
 * small number: a miss drops the card to box 1 (due again now), "shaky" holds it, "knew it" promotes it and pushes its next
 * review further out. Weak cards therefore come back sooner and more often, strong ones fade but still resurface.
 *
 * Interview prep has a deadline, unlike open-ended learning, so intervals are capped to a third of the time that remains:
 * a card is always due again at least a few times before the interview.
 */
export const MAX_BOX = 5;
export const BOX_INTERVAL_DAYS = { 1: 0, 2: 1, 3: 2, 4: 4, 5: 7 };
export const CONFIDENT_BOX = 4;
const DAY = 86_400_000;
const RECENT = 5;

/** Estimated interview time: when the plan started + the number of days the user said they have. */
export function interviewAtMs(kit) {
  const start = Date.parse(kit?.schedule?.starts_at || kit?.source?.researched_at || '');
  const days = kit?.schedule?.days_available;
  return Number.isFinite(start) && Number.isInteger(days) ? start + days * DAY : null;
}

/**
 * The card's state after a rating.
 *   confidence 1 "didn't know"  -> box 1
 *   confidence 2 "shaky"        -> stay in the current box (at least 1)
 *   confidence 3 "knew it"      -> one box up (a card seen for the first time jumps to box 2)
 * @returns {{ box, due, last_confidence, reviews, last_reviewed_at, last_review_id?, recent }}
 */
export function nextState(prev, confidence, { now, interviewAt = null, reviewId } = {}) {
  if (![1, 2, 3].includes(confidence)) throw new RangeError('confidence must be 1, 2 or 3');
  const box0 = prev?.box ?? 0;
  const box = confidence === 1 ? 1 : confidence === 2 ? Math.max(1, box0) : box0 === 0 ? 2 : Math.min(MAX_BOX, box0 + 1);
  let interval = BOX_INTERVAL_DAYS[box] * DAY;
  if (interviewAt && interviewAt > now) interval = Math.min(interval, Math.floor((interviewAt - now) / 3));
  return {
    box,
    due: new Date(now + interval).toISOString(),
    last_confidence: confidence,
    reviews: (prev?.reviews ?? 0) + 1,
    last_reviewed_at: new Date(now).toISOString(),
    ...(reviewId ? { last_review_id: reviewId } : {}),
    recent: [...(prev?.recent ?? []), confidence].slice(-RECENT),
  };
}

const UNSEEN_RANK = 2.5; // after the weak boxes (1, 2), before the comfortable ones (3+)

/**
 * Card ids in the order to study them: LEAST CONFIDENT FIRST.
 * mode "due": cards due now plus cards never seen. mode "all": every card (to drill beyond what is due).
 * Order: box (unseen cards rank between box 2 and box 3), then must-have cards, then most overdue, then kit order.
 * Cards that were deleted from the kit are ignored; progress for them is harmless.
 */
export function buildQueue({ flashcards, requirements = [], progress, now, mode = 'due', limit }) {
  const must = new Set(requirements.filter((r) => r.priority === 'must').map((r) => r.id));
  const items = flashcards.map((card, i) => {
    const p = progress?.cards?.[card.id];
    const seen = Boolean(p?.reviews);
    return { id: card.id, i, seen, rank: seen ? p.box : UNSEEN_RANK, dueMs: seen ? Date.parse(p.due) : -Infinity, must: card.requirement_ids?.some((id) => must.has(id)) ? 1 : 0 };
  });
  const eligible = mode === 'all' ? items : items.filter((x) => !x.seen || x.dueMs <= now);
  eligible.sort((a, b) => a.rank - b.rank || b.must - a.must || a.dueMs - b.dueMs || a.i - b.i);
  return (limit ? eligible.slice(0, limit) : eligible).map((x) => x.id);
}

/** What has been covered and what has not, per card and per requirement, plus the weakest cards. */
export function summarize({ flashcards, requirements, progress, now, interviewAt = null }) {
  const stateOf = (c) => progress?.cards?.[c.id];
  const seen = flashcards.filter((c) => stateOf(c)?.reviews);
  const dueNow = flashcards.filter((c) => !stateOf(c)?.reviews || Date.parse(stateOf(c).due) <= now);
  const upcoming = seen.map((c) => Date.parse(stateOf(c).due)).filter((t) => t > now);

  const byRequirement = requirements.map((r) => {
    const cards = flashcards.filter((c) => c.requirement_ids?.includes(r.id));
    const reviewed = cards.filter((c) => stateOf(c)?.reviews);
    return {
      id: r.id, text: r.text, priority: r.priority,
      cards: cards.length, reviewed: reviewed.length,
      confident: reviewed.filter((c) => stateOf(c).box >= CONFIDENT_BOX).length,
      no_cards: cards.length === 0,
    };
  }).sort((a, b) => Number(b.priority === 'must') - Number(a.priority === 'must'));

  const weakest = seen
    .filter((c) => stateOf(c).box <= 2)
    .sort((a, b) => stateOf(a).box - stateOf(b).box || stateOf(a).last_confidence - stateOf(b).last_confidence || stateOf(b).reviews - stateOf(a).reviews)
    .slice(0, 5)
    .map((c) => ({ id: c.id, front: c.front, box: stateOf(c).box, last_confidence: stateOf(c).last_confidence }));

  return {
    total: flashcards.length,
    reviewed: seen.length,
    unseen: flashcards.length - seen.length,
    due_now: dueNow.length,
    confident: seen.filter((c) => stateOf(c).box >= CONFIDENT_BOX).length,
    next_due_at: upcoming.length ? new Date(Math.min(...upcoming)).toISOString() : null,
    days_left: interviewAt ? Math.max(0, Math.ceil((interviewAt - now) / DAY)) : null,
    by_requirement: byRequirement,
    weakest,
  };
}
