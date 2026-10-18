import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { RegenRunner } from '../src/jobs/regenRunner.js';
import { createMemoryRepos } from '../src/repos/memory.js';
import { createMockLlm } from '../test-support/mockLlm.js';
import { apiClient, waitFor } from '../test-support/apiClient.js';
import { makeKit } from '../test-support/kitFixture.js';

let server, base, repos, runner, gate;
const home = { url: 'https://acme.test/', kind: 'home', title: 'Acme', text: 'Acme builds payment rails for banks. '.repeat(6), hiring_score: 0 };
const research = async () => ({ company: 'Acme', crawl: { reachable: true, pages: [home], skipped: [], hiringPage: null }, discussion: { searched: true, found: false, snippets: [], skipped: [] }, gaps: [], pagesUsed: [home.url], skipped: [] });
let n = 0;
const llm = createMockLlm({
  company_brief: async () => { await gate; return { summary: 'Fresh brief.', what_they_do: 'Payments.', source_urls: [home.url] }; },
  questions: async ({ name, user }) => { await gate; return { questions: [...user.matchAll(/^(r\d+):/gm)].map((m) => ({ requirement_ids: [m[1]], prompt: `Fresh ${name} ${++n} ${m[1]}?`, answer_outline: 'o', difficulty: 2 })) }; },
});

before(() => {
  repos = createMemoryRepos();
  runner = new RegenRunner({ kits: repos.kits, llm, research });
  server = createApp({ repos, regen: runner }).listen(0);
  base = `http://127.0.0.1:${server.address().port}/api`;
  gate = Promise.resolve();
});
after(() => server.close());

async function setup() {
  const c = apiClient(base);
  const { body } = await c.call('/auth/register', { method: 'POST', body: { email: `b${++n}-${Math.random().toString(36).slice(2)}@x.com`, password: 'password123' } });
  const rec = await repos.kits.create({ userId: body.user.id, title: 'Kit', inputHash: `h${Math.random()}`, input: { jd: 'jd', company_url: 'https://acme.test/', days: 3 } });
  await repos.kits.claim(rec.id);
  await repos.kits.finish(rec.id, 1, makeKit());
  return { c, id: rec.id, userId: body.user.id };
}
const ops = (c, id, list) => c.call(`/kits/${id}/ops`, { method: 'POST', body: { ops: list } });
const regen = (c, id, body) => c.call(`/kits/${id}/regenerate`, { method: 'POST', body });

test('ops: an edit returns the new kit + version; the origin tracking is visible to the client', async () => {
  const { c, id } = await setup();
  const before = (await c.call(`/kits/${id}`)).body.kit;
  const res = await ops(c, id, [{ op: 'update_question', id: 'q1', patch: { prompt: 'Reworded?' } }]);
  assert.equal(res.status, 200);
  assert.equal(res.body.kit.version, before.version + 1);
  const q1 = res.body.kit.kit.questions.find((q) => q.id === 'q1');
  assert.deepEqual([q1.prompt, q1.origin], ['Reworded?', 'edited']);
  assert.equal((await c.call(`/kits/${id}`)).body.kit.version, before.version + 1);
});

test('ops: malformed requests are 400 with details; unknown items 404; invalid results 422', async () => {
  const { c, id } = await setup();
  for (const bad of [[], [{ op: 'nope' }], [{ op: 'update_question', id: 'q1', patch: {} }], [{ op: 'add_question', question: { id: 'bad id', category: 'technical', prompt: 'x?' } }], [{ op: 'update_question', id: 'q1', patch: { difficulty: 9 } }], [{ op: 'update_day', day: 1, patch: { minutes: 1.5 } }]]) {
    const r = await ops(c, id, bad);
    assert.equal(r.status, 400, JSON.stringify(bad));
    assert.equal(r.body.error.code, 'VALIDATION_ERROR');
  }
  assert.equal((await ops(c, id, [{ op: 'delete_question', id: 'ghost' }])).status, 404);
  const invalid = await ops(c, id, [{ op: 'update_question', id: 'q1', patch: { requirement_ids: ['r99'] } }]);
  assert.deepEqual([invalid.status, invalid.body.error.code], [422, 'INVALID_EDIT']);
  assert.equal((await ops(c, id, Array.from({ length: 51 }, () => ({ op: 'delete_question', id: 'q1' })))).status, 400);
});

test('ops and regenerate are private to the owner and need a session', async () => {
  const a = await setup();
  const b = apiClient(base);
  await b.call('/auth/register', { method: 'POST', body: { email: `x${++n}-${Math.random()}@x.com`, password: 'password123' } });
  assert.equal((await ops(b, a.id, [{ op: 'delete_question', id: 'q1' }])).status, 404);
  assert.equal((await regen(b, a.id, { section: 'schedule' })).status, 404);
  assert.equal((await ops(apiClient(base), a.id, [{ op: 'delete_question', id: 'q1' }])).status, 401);
});

test('a kit that is not ready cannot be edited or regenerated (409)', async () => {
  const c = apiClient(base);
  const { body } = await c.call('/auth/register', { method: 'POST', body: { email: `p${++n}-${Math.random()}@x.com`, password: 'password123' } });
  const rec = await repos.kits.create({ userId: body.user.id, title: 'p', inputHash: `p${Math.random()}`, input: { jd: 'x', company_url: 'http://x', days: 1 } });
  assert.equal((await ops(c, rec.id, [{ op: 'delete_question', id: 'q1' }])).body.error.code, 'KIT_NOT_READY');
  assert.equal((await regen(c, rec.id, { section: 'schedule' })).body.error.code, 'KIT_NOT_READY');
});

test('regenerate schedule: synchronous, optionally with a new number of days', async () => {
  const { c, id } = await setup();
  const res = await regen(c, id, { section: 'schedule', days: 7 });
  assert.equal(res.status, 200);
  assert.equal(res.body.kit.kit.schedule.days.length, 7);
  assert.equal((await regen(c, id, { section: 'schedule', days: 0 })).status, 400);
  assert.equal((await regen(c, id, { section: 'questions' })).status, 400, 'category is required');
  assert.equal((await regen(c, id, { section: 'questions', category: 'astrology' })).status, 400);
});

test('regenerate a category: 202, a regen marker while it runs, edits kept, marker cleared when done; a second one is refused meanwhile', async () => {
  const { c, id } = await setup();
  await ops(c, id, [{ op: 'update_question', id: 'q1', patch: { prompt: 'Keep me?' } }]);
  let release;
  gate = new Promise((r) => { release = r; });

  const started = await regen(c, id, { section: 'questions', category: 'technical' });
  assert.equal(started.status, 202);
  assert.deepEqual([started.body.kit.regen.section, started.body.kit.regen.category, started.body.kit.regen.status], ['questions', 'technical', 'running']);
  const second = await regen(c, id, { section: 'brief' });
  assert.deepEqual([second.status, second.body.error.code], [409, 'REGEN_IN_PROGRESS']);

  // the user keeps editing while it runs
  assert.equal((await ops(c, id, [{ op: 'add_question', question: { id: 'q-live99', category: 'technical', prompt: 'Typed while waiting?', requirement_ids: ['r1'] } }])).status, 200);
  release();
  const done = await waitFor(async () => { const k = (await c.call(`/kits/${id}`)).body.kit; return k.regen === null && k; });
  const prompts = done.kit.questions.filter((q) => q.category === 'technical').map((q) => q.prompt);
  assert.ok(prompts.includes('Keep me?') && prompts.includes('Typed while waiting?'));
  assert.ok(prompts.some((p) => p.startsWith('Fresh')));
  gate = Promise.resolve();
});

test('regenerating an EDITED brief needs confirmation (409) and then force', async () => {
  const { c, id } = await setup();
  await ops(c, id, [{ op: 'update_brief', patch: { summary: 'Mine.' } }]);
  const refused = await regen(c, id, { section: 'brief' });
  assert.deepEqual([refused.status, refused.body.error.code], [409, 'REGENERATE_WOULD_DISCARD_EDITS']);
  assert.equal((await regen(c, id, { section: 'brief', force: true })).status, 202);
  const done = await waitFor(async () => { const k = (await c.call(`/kits/${id}`)).body.kit; return k.regen === null && k; });
  assert.deepEqual([done.kit.company_brief.summary, done.kit.company_brief.origin], ['Fresh brief.', 'generated']);
});

test('a failed regeneration is reported on the kit (code + message) and the kit is unchanged; a retry is allowed', async () => {
  const { c, id } = await setup();
  const before = (await c.call(`/kits/${id}`)).body.kit.kit;
  const failing = new RegenRunner({ kits: repos.kits, llm: createMockLlm({ questions: () => { throw Object.assign(new Error('provider down'), { code: 'LLM_UNAVAILABLE' }); } }), research });
  await repos.kits.claimRegen(id, (await repos.kits.findById(id)).userId, { section: 'questions', category: 'technical' });
  failing.enqueue({ kitId: id, userId: (await repos.kits.findById(id)).userId, section: 'questions', category: 'technical' });
  const k = await waitFor(async () => { const x = (await c.call(`/kits/${id}`)).body.kit; return x.regen?.status === 'failed' && x; });
  assert.deepEqual(k.regen.error, { code: 'LLM_UNAVAILABLE', message: 'provider down' });
  assert.deepEqual(k.kit, before);
  assert.equal((await regen(c, id, { section: 'questions', category: 'technical' })).status, 202, 'a failed slot can be retried');
  await waitFor(async () => (await c.call(`/kits/${id}`)).body.kit.regen === null);
});
