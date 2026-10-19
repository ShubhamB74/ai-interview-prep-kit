import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BOX_INTERVAL_DAYS, buildQueue, interviewAtMs, MAX_BOX, nextState, summarize } from '@prepkit/shared/leitner';

const DAY = 86_400_000;
const NOW = Date.parse('2026-10-18T10:00:00.000Z');
const card = (id, reqs = [], front = `Front ${id}`) => ({ id, front, back: 'b', requirement_ids: reqs });
const reqs = [{ id: 'r1', text: 'Must skill', priority: 'must' }, { id: 'r2', text: 'Nice skill', priority: 'nice' }, { id: 'r3', text: 'Uncovered', priority: 'must' }];
const st = (box, dueOffsetDays, extra = {}) => ({ box, due: new Date(NOW + dueOffsetDays * DAY).toISOString(), last_confidence: 2, reviews: 1, recent: [2], ...extra });

// ---------------- transitions ----------------
test('transitions: miss -> box 1; shaky holds; knew it promotes; first sight + knew it jumps to box 2; capped at the top box', () => {
  assert.equal(nextState(undefined, 1, { now: NOW }).box, 1);
  assert.equal(nextState({ box: 4 }, 1, { now: NOW }).box, 1, 'a miss always drops to box 1');
  assert.equal(nextState(undefined, 2, { now: NOW }).box, 1);
  assert.equal(nextState({ box: 3 }, 2, { now: NOW }).box, 3);
  assert.equal(nextState(undefined, 3, { now: NOW }).box, 2);
  assert.equal(nextState({ box: 2 }, 3, { now: NOW }).box, 3);
  assert.equal(nextState({ box: MAX_BOX }, 3, { now: NOW }).box, MAX_BOX);
});

test('due dates follow the box; box 1 is due immediately (comes back this session)', () => {
  for (const [box, rating] of [[1, 1], [2, 3], [3, 3], [4, 3], [5, 3]]) {
    const prev = { box: rating === 1 ? 1 : box - 1 };
    const s = nextState(prev, rating, { now: NOW });
    assert.equal(s.box, box);
    assert.equal(Date.parse(s.due) - NOW, BOX_INTERVAL_DAYS[box] * DAY);
  }
});

test('near the interview, intervals are capped to a third of the time left (so there are always more reviews before it)', () => {
  const interviewAt = NOW + 2 * DAY;
  const s = nextState({ box: 4 }, 3, { now: NOW, interviewAt }); // box 5 would be 7 days
  assert.equal(Date.parse(s.due) - NOW, Math.floor((2 * DAY) / 3));
  const far = nextState({ box: 4 }, 3, { now: NOW, interviewAt: NOW + 60 * DAY });
  assert.equal(Date.parse(far.due) - NOW, 7 * DAY, 'far from the interview: normal interval');
  const past = nextState({ box: 4 }, 3, { now: NOW, interviewAt: NOW - DAY });
  assert.equal(Date.parse(past.due) - NOW, 7 * DAY, 'after the date: no cap');
});

test('state bookkeeping: review count, recent history (last 5), review id, timestamps', () => {
  let s;
  for (const c of [1, 2, 3, 3, 2, 1, 3]) s = nextState(s, c, { now: NOW, reviewId: 'rid-123456' });
  assert.deepEqual([s.reviews, s.recent, s.last_confidence, s.last_review_id], [7, [3, 3, 2, 1, 3], 3, 'rid-123456']);
  assert.equal(s.last_reviewed_at, new Date(NOW).toISOString());
  assert.throws(() => nextState(undefined, 4, { now: NOW }), RangeError);
  assert.throws(() => nextState(undefined, 0, { now: NOW }), RangeError);
});

test('interviewAtMs = plan start + days; falls back to the research time; null when unknown', () => {
  const kit = { source: { researched_at: '2026-10-01T00:00:00.000Z' }, schedule: { days_available: 5, starts_at: '2026-10-10T00:00:00.000Z' } };
  assert.equal(interviewAtMs(kit), Date.parse('2026-10-15T00:00:00.000Z'));
  assert.equal(interviewAtMs({ ...kit, schedule: { days_available: 5 } }), Date.parse('2026-10-06T00:00:00.000Z'));
  assert.equal(interviewAtMs({ schedule: { days_available: 5 } }), null);
});

// ---------------- queue ----------------
test('queue: least confident first; never-seen cards sit between the weak boxes and the comfortable ones; not-due cards are left out', () => {
  const flashcards = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => card(id));
  const progress = { cards: { a: st(4, -1), b: st(1, -0.1), c: st(2, -1), e: st(3, 5) /* not due */, f: st(3, -2) } }; // d is unseen
  assert.deepEqual(buildQueue({ flashcards, progress, now: NOW }), ['b', 'c', 'd', 'f', 'a']);
});

test('queue: ties go to must-have cards, then the most overdue, then kit order', () => {
  const flashcards = [card('a', ['r2']), card('b', ['r1']), card('c', ['r2']), card('d', ['r2'])];
  const progress = { cards: { a: st(2, -1), b: st(2, -1), c: st(2, -5), d: st(2, -1) } };
  assert.deepEqual(buildQueue({ flashcards, requirements: reqs, progress, now: NOW }), ['b', 'c', 'a', 'd']);
});

test('queue: "all" mode includes cards that are not due, still weakest first; limit truncates', () => {
  const flashcards = ['a', 'b', 'c'].map((id) => card(id));
  const progress = { cards: { a: st(5, 3), b: st(2, 4), c: st(1, 2) } };
  assert.deepEqual(buildQueue({ flashcards, progress, now: NOW }), []);
  assert.deepEqual(buildQueue({ flashcards, progress, now: NOW, mode: 'all' }), ['c', 'b', 'a']);
  assert.deepEqual(buildQueue({ flashcards, progress, now: NOW, mode: 'all', limit: 2 }), ['c', 'b']);
});

test('queue: progress for deleted cards is ignored; no progress at all = every card, in kit order', () => {
  const flashcards = [card('x'), card('y')];
  assert.deepEqual(buildQueue({ flashcards, progress: { cards: { ghost: st(1, -1) } }, now: NOW }), ['x', 'y']);
  assert.deepEqual(buildQueue({ flashcards, progress: undefined, now: NOW }), ['x', 'y']);
  assert.deepEqual(buildQueue({ flashcards: [], progress: {}, now: NOW }), []);
});

test('property: the queue holds each eligible card exactly once, is deterministic, and weaker boxes never come after stronger ones', () => {
  let seed = 7;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  for (let round = 0; round < 50; round++) {
    const flashcards = Array.from({ length: 12 }, (_, i) => card(`c${i}`, rand() < 0.5 ? ['r1'] : ['r2']));
    const cards = {};
    for (const c of flashcards) if (rand() < 0.7) cards[c.id] = st(1 + Math.floor(rand() * 5), rand() * 6 - 3);
    const q1 = buildQueue({ flashcards, requirements: reqs, progress: { cards }, now: NOW, mode: 'all' });
    assert.deepEqual(q1, buildQueue({ flashcards, requirements: reqs, progress: { cards }, now: NOW, mode: 'all' }));
    assert.equal(new Set(q1).size, 12);
    const rank = (id) => (cards[id] ? cards[id].box : 2.5);
    for (let i = 1; i < q1.length; i++) assert.ok(rank(q1[i - 1]) <= rank(q1[i]));
  }
});

// ---------------- summary ----------------
test('summary: totals, due, confident, per-requirement coverage (flagging requirements with no cards), weakest cards', () => {
  const flashcards = [card('a', ['r1']), card('b', ['r1']), card('c', ['r2']), card('d', ['r2'])];
  const progress = { cards: { a: st(5, 3), b: st(1, -1, { last_confidence: 1 }), c: st(2, 1, { last_confidence: 2 }) } };
  const s = summarize({ flashcards, requirements: reqs, progress, now: NOW, interviewAt: NOW + 3.2 * DAY });
  assert.deepEqual([s.total, s.reviewed, s.unseen, s.due_now, s.confident, s.days_left], [4, 3, 1, 2, 1, 4]);
  assert.equal(s.next_due_at, new Date(NOW + DAY).toISOString());
  assert.deepEqual(s.by_requirement.map((r) => [r.id, r.cards, r.reviewed, r.confident, r.no_cards]), [['r1', 2, 2, 1, false], ['r3', 0, 0, 0, true], ['r2', 2, 1, 0, false]]);
  assert.deepEqual(s.weakest.map((w) => w.id), ['b', 'c']);
});

test('summary: empty kit and untouched progress are well-defined', () => {
  const s = summarize({ flashcards: [], requirements: [], progress: undefined, now: NOW });
  assert.deepEqual([s.total, s.reviewed, s.due_now, s.next_due_at, s.days_left, s.weakest], [0, 0, 0, null, null, []]);
});
