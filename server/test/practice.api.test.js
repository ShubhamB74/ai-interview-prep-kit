import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { createMemoryRepos } from '../src/repos/memory.js';
import { apiClient } from '../test-support/apiClient.js';
import { makeKit } from '../test-support/kitFixture.js';
import { recordReview } from '../src/services/practice.js';
import { applyOpsToKit } from '../src/services/kitEditor.js';
import { regenerateSchedule } from '../src/services/regenerate.js';
import { assembleKit } from '../src/pipeline/assembleKit.js';

let server, base, repos;
before(() => {
  repos = createMemoryRepos();
  server = createApp({ repos }).listen(0);
  base = `http://127.0.0.1:${server.address().port}/api`;
});
after(() => server.close());

let n = 0;
async function setup(kit = makeKit()) {
  const c = apiClient(base);
  const { body } = await c.call('/auth/register', { method: 'POST', body: { email: `p${++n}-${Math.random().toString(36).slice(2)}@x.com`, password: 'password123' } });
  const rec = await repos.kits.create({ userId: body.user.id, title: 'Kit', inputHash: `h${Math.random()}`, input: { jd: 'jd', company_url: 'https://acme.test/', days: 3 } });
  await repos.kits.claim(rec.id);
  await repos.kits.finish(rec.id, 1, kit);
  return { c, id: rec.id, userId: body.user.id };
}
const review = (c, id, body) => c.call(`/kits/${id}/practice/reviews`, { method: 'POST', body });
const progress = async (c, id) => (await c.call(`/kits/${id}/practice`)).body.practice;

test('a fresh kit has no progress; the response carries the interview time and the server clock', async () => {
  const { c, id } = await setup();
  const p = await progress(c, id);
  assert.deepEqual(p.cards, {});
  assert.equal(Date.parse(p.interview_at), Date.parse('2026-01-01T00:00:00.000Z') + 3 * 86_400_000);
  assert.ok(Math.abs(Date.parse(p.server_time) - Date.now()) < 5000);
});

test('ratings move a card through the boxes and are persisted', async () => {
  const { c, id } = await setup();
  let r = await review(c, id, { card_id: 'f1', confidence: 3 });
  assert.equal(r.status, 200);
  assert.deepEqual([r.body.state.box, r.body.state.reviews, r.body.duplicate], [2, 1, false]);
  r = await review(c, id, { card_id: 'f1', confidence: 3 });
  assert.equal(r.body.state.box, 3);
  r = await review(c, id, { card_id: 'f1', confidence: 1 });
  assert.deepEqual([r.body.state.box, r.body.state.reviews, r.body.state.recent], [1, 3, [3, 3, 1]]);
  const p = await progress(c, id);
  assert.equal(p.cards.f1.box, 1);
  assert.equal(p.cards.f2, undefined, 'other cards untouched');
});

test('the server owns the clock: a client-supplied time is ignored', async () => {
  const { c, id } = await setup();
  const before = Date.now();
  const r = await review(c, id, { card_id: 'f1', confidence: 3, at: '1999-01-01T00:00:00Z', now: 0, due: '1999-01-01' });
  assert.equal(r.status, 200);
  assert.ok(Date.parse(r.body.state.last_reviewed_at) >= before - 1000);
});

test('the same review id is applied once (double-click, retried request)', async () => {
  const { c, id } = await setup();
  const a = await review(c, id, { card_id: 'f1', confidence: 3, review_id: 'click-0001' });
  const b = await review(c, id, { card_id: 'f1', confidence: 3, review_id: 'click-0001' });
  assert.deepEqual([a.body.duplicate, b.body.duplicate, b.body.state.reviews], [false, true, 1]);
  const next = await review(c, id, { card_id: 'f1', confidence: 3, review_id: 'click-0002' });
  assert.equal(next.body.state.reviews, 2);
});

test('parallel ratings of the same card are both applied, one after the other (no lost update)', async () => {
  const { id, userId } = await setup();
  await Promise.all([1, 2, 3, 4].map((i) => recordReview(repos.kits, id, userId, { cardId: 'f1', confidence: 3, reviewId: `par-00000${i}` })));
  const cards = (await repos.kits.findOwned(id, userId)).practice.cards;
  assert.equal(cards.f1.reviews, 4);
  assert.equal(cards.f1.box, 5);
});

test('validation and ownership: bad confidence/ids 400, unknown card 404, other users 404, signed out 401', async () => {
  const a = await setup();
  const b = apiClient(base);
  await b.call('/auth/register', { method: 'POST', body: { email: `q${++n}-${Math.random()}@x.com`, password: 'password123' } });
  for (const bad of [{ card_id: 'f1', confidence: 0 }, { card_id: 'f1', confidence: 4 }, { card_id: 'f1', confidence: 2.5 }, { card_id: 'a.b', confidence: 2 }, { confidence: 2 }, { card_id: 'f1', confidence: 2, review_id: 'x' }]) {
    assert.equal((await review(a.c, a.id, bad)).status, 400, JSON.stringify(bad));
  }
  assert.equal((await review(a.c, a.id, { card_id: 'ghost', confidence: 2 })).status, 404);
  assert.equal((await review(b, a.id, { card_id: 'f1', confidence: 2 })).status, 404);
  assert.equal((await b.call(`/kits/${a.id}/practice`)).status, 404);
  assert.equal((await b.call(`/kits/${a.id}/practice`, { method: 'DELETE' })).status, 404);
  assert.equal((await review(apiClient(base), a.id, { card_id: 'f1', confidence: 2 })).status, 401);
});

test('a kit that is not ready has no practice', async () => {
  const c = apiClient(base);
  const { body } = await c.call('/auth/register', { method: 'POST', body: { email: `r${++n}-${Math.random()}@x.com`, password: 'password123' } });
  const rec = await repos.kits.create({ userId: body.user.id, title: 'p', inputHash: `p${Math.random()}`, input: { jd: 'x', company_url: 'http://x', days: 1 } });
  assert.equal((await c.call(`/kits/${rec.id}/practice`)).body.error.code, 'KIT_NOT_READY');
});

test('reset clears progress', async () => {
  const { c, id } = await setup();
  await review(c, id, { card_id: 'f1', confidence: 3 });
  assert.equal((await c.call(`/kits/${id}/practice`, { method: 'DELETE' })).status, 204);
  assert.deepEqual((await progress(c, id)).cards, {});
});

test('editing or deleting cards does not corrupt progress: edits keep it, deleted cards are refused, others unaffected', async () => {
  const { c, id, userId } = await setup();
  await review(c, id, { card_id: 'f1', confidence: 3 });
  await review(c, id, { card_id: 'f2', confidence: 1 });
  await applyOpsToKit(repos.kits, id, userId, [{ op: 'update_flashcard', id: 'f1', patch: { front: 'Reworded front?' } }, { op: 'delete_flashcard', id: 'f2' }]);
  const p = await progress(c, id);
  assert.equal(p.cards.f1.box, 2, 'an edited card keeps its progress');
  assert.equal((await review(c, id, { card_id: 'f2', confidence: 3 })).status, 404, 'a deleted card cannot be rated');
  assert.equal((await review(c, id, { card_id: 'f1', confidence: 3 })).body.state.box, 3);
});

test('rating while the kit is being edited and regenerated never fails (practice lives beside the kit document)', async () => {
  const { c, id, userId } = await setup();
  const results = await Promise.all([
    review(c, id, { card_id: 'f1', confidence: 3 }),
    applyOpsToKit(repos.kits, id, userId, [{ op: 'update_question', id: 'q1', patch: { prompt: 'Edit during practice?' } }]),
    review(c, id, { card_id: 'f2', confidence: 2 }),
    regenerateSchedule({ kits: repos.kits, id, userId }),
  ]);
  assert.equal(results[0].status, 200);
  assert.equal(results[2].status, 200);
  const p = await progress(c, id);
  assert.deepEqual([p.cards.f1.reviews, p.cards.f2.reviews], [1, 1]);
});

test('interview deadline: assembleKit stamps the plan start; rebuilding with a NEW day count restarts the clock, the same count does not', async () => {
  const stamped = assembleKit({
    jd: 'x', companyUrl: 'https://acme.test', questions: [], coverage: { uncovered_requirement_ids: [], passes: 1 }, schedule: { days_available: 2, days: [] },
    now: () => new Date('2026-05-05T00:00:00.000Z'),
    draft: { role: { company: 'A', title: 't', location: '', seniority: '', responsibilities: [], requirements: [], thinReasons: [] }, research: { company: 'A', gaps: [], crawl: { pages: [], hiringPage: null }, discussion: { searched: true, found: false, snippets: [] }, skipped: [] }, hiringProcess: { known: false, confidence: 'none', signals: {} }, brief: { summary: '', what_they_do: '', sources: [] }, flashcards: [], failures: [] },
  });
  assert.equal(stamped.schedule.starts_at, '2026-05-05T00:00:00.000Z');

  const { id, userId } = await setup();
  const start = (await repos.kits.findOwned(id, userId)).kit.schedule.starts_at;
  const same = await regenerateSchedule({ kits: repos.kits, id, userId, days: 3 });
  assert.equal(same.kit.schedule.starts_at, start, 'same day count: the clock keeps running');
  const changed = await regenerateSchedule({ kits: repos.kits, id, userId, days: 10 });
  assert.ok(Date.parse(changed.kit.schedule.starts_at) > Date.now() - 5000, 'new day count: counted from now');
  await applyOpsToKit(repos.kits, id, userId, [{ op: 'delete_question', id: 'q1' }]);
  assert.equal((await repos.kits.findOwned(id, userId)).kit.schedule.starts_at, changed.kit.schedule.starts_at, 'edits preserve it');
});
