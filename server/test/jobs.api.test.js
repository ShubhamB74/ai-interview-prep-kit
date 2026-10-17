import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { JobRunner } from '../src/jobs/jobRunner.js';
import { createMemoryRepos } from '../src/repos/memory.js';
import { apiClient, waitFor } from '../test-support/apiClient.js';

const okKit = (title) => ({
  source: { company: 'A', company_url: 'u', role: title, location: '', jd_chars: 1, researched_at: 't', pages_used: [] },
  company_brief: { summary: '', what_they_do: '', sources: [] }, role: { title, seniority: '', responsibilities: [], requirements: [] },
  questions: [], flashcards: [], schedule: { days_available: 2, days: [{ day: 1, focus: 'f', question_ids: [], minutes: 0 }, { day: 2, focus: 'f', question_ids: [], minutes: 0 }] },
  coverage: { uncovered_requirement_ids: [], passes: 1 },
});

let server, base, runner, impl, calls;
before(() => {
  const repos = createMemoryRepos();
  calls = 0;
  runner = new JobRunner({ kits: repos.kits, pipeline: (input) => { calls++; return impl(input); }, concurrency: 2 });
  server = createApp({ repos, jobs: runner, limits: { maxActivePerUser: 2 } }).listen(0);
  base = `http://127.0.0.1:${server.address().port}/api`;
});
after(() => server.close());

let n = 0;
async function user() {
  const c = apiClient(base);
  await c.call('/auth/register', { method: 'POST', body: { email: `u${++n}-${Math.random().toString(36).slice(2)}@x.com`, password: 'password123' } });
  return c;
}
const input = (jd, extra = {}) => ({ jd, company_url: `https://acme.test/${encodeURIComponent(jd)}`, days: 2, ...extra });
const kitStatus = async (c, id) => (await c.call(`/kits/${id}`)).body.kit;

test('create returns immediately as pending; the kit is generated in the background and polled to ready', async () => {
  impl = async ({ onProgress }) => { onProgress({ step: 'research', status: 'done', detail: '2 pages' }); await new Promise((r) => setTimeout(r, 30)); return okKit('Result'); };
  const c = await user();
  const created = await c.call('/kits', { method: 'POST', body: input('create-1') });
  assert.equal(created.status, 201);
  assert.equal(created.body.kit.status, 'pending');
  assert.equal(created.body.kit.kit, null);

  const done = await waitFor(async () => { const k = await kitStatus(c, created.body.kit.id); return k.status === 'ready' && k; });
  assert.equal(done.kit.role.title, 'Result');
  assert.deepEqual(done.progress.map((p) => [p.step, p.status, p.detail]), [['research', 'done', '2 pages']]);
  assert.equal((await c.call('/kits')).body.kits[0].status, 'ready');
  assert.equal((await c.call('/kits')).body.kits[0].kit, undefined, 'list is summaries only');
});

test('progress and "running" are visible while generation is in flight', async () => {
  let release;
  impl = ({ onProgress }) => { onProgress({ step: 'extract_requirements', status: 'done', detail: '4 requirements' }); onProgress({ step: 'research', status: 'running' }); return new Promise((r) => { release = () => r(okKit('x')); }); };
  const c = await user();
  const { body } = await c.call('/kits', { method: 'POST', body: input('inflight') });
  const k = await waitFor(async () => { const x = await kitStatus(c, body.kit.id); return x.progress.length === 2 && x; });
  assert.equal(k.status, 'running');
  assert.deepEqual(k.progress.map((p) => p.step), ['extract_requirements', 'research']);
  release();
  await waitFor(async () => (await kitStatus(c, body.kit.id)).status === 'ready');
});

test('submitting the same posting again (even while running) returns the same kit and does not run twice', async () => {
  let release;
  impl = () => new Promise((r) => { release = () => r(okKit('x')); });
  const before = calls;
  const c = await user();
  const a = await c.call('/kits', { method: 'POST', body: input('dupe', { company_url: 'https://acme.test/same' }) });
  const b = await c.call('/kits', { method: 'POST', body: input('DUPE ', { company_url: 'https://ACME.test/same/', days: 9 }) });
  assert.equal(b.status, 200);
  assert.equal(b.body.duplicate, true);
  assert.equal(b.body.kit.id, a.body.kit.id);
  await waitFor(() => release);
  release();
  await runner.drain();
  assert.equal(calls - before, 1);
});

test('failure is surfaced with a code; retry re-runs it; retrying a non-failed kit is 409', async () => {
  let fail = true;
  impl = async () => { if (fail) throw Object.assign(new Error('provider down'), { code: 'LLM_UNAVAILABLE' }); return okKit('Recovered'); };
  const c = await user();
  const { body } = await c.call('/kits', { method: 'POST', body: input('retry-me') });
  const failed = await waitFor(async () => { const k = await kitStatus(c, body.kit.id); return k.status === 'failed' && k; });
  assert.deepEqual(failed.error, { code: 'LLM_UNAVAILABLE', message: 'provider down' });

  fail = false;
  const retry = await c.call(`/kits/${body.kit.id}/retry`, { method: 'POST' });
  assert.equal(retry.status, 202);
  assert.equal(retry.body.kit.status, 'pending');
  const ok = await waitFor(async () => { const k = await kitStatus(c, body.kit.id); return k.status === 'ready' && k; });
  assert.equal(ok.attempt, 2);
  assert.equal(ok.error, null);

  const again = await c.call(`/kits/${body.kit.id}/retry`, { method: 'POST' });
  assert.equal(again.status, 409);
  assert.equal(again.body.error.code, 'NOT_RETRYABLE');
});

test("users cannot see, retry or delete each other's kits (404)", async () => {
  impl = async () => okKit('x');
  const alice = await user(), bob = await user();
  const { body } = await alice.call('/kits', { method: 'POST', body: input('private') });
  await runner.drain();
  for (const [method, path] of [['GET', ''], ['POST', '/retry'], ['DELETE', '']]) {
    assert.equal((await bob.call(`/kits/${body.kit.id}${path}`, { method })).status, 404, `${method}${path}`);
  }
});

test('per-user cap on concurrently generating kits (429); duplicates and finished kits do not count', async () => {
  const releases = [];
  impl = () => new Promise((r) => releases.push(() => r(okKit('x'))));
  const c = await user();
  assert.equal((await c.call('/kits', { method: 'POST', body: input('cap-1') })).status, 201);
  assert.equal((await c.call('/kits', { method: 'POST', body: input('cap-2') })).status, 201);
  const third = await c.call('/kits', { method: 'POST', body: input('cap-3') });
  assert.equal(third.status, 429);
  assert.equal(third.body.error.code, 'TOO_MANY_ACTIVE_JOBS');
  assert.equal((await c.call('/kits', { method: 'POST', body: input('cap-1') })).status, 200, 'a duplicate is not a new job');
  await waitFor(() => releases.length === 2);
  releases.forEach((r) => r());
  await runner.drain();
  assert.equal((await c.call('/kits', { method: 'POST', body: input('cap-3') })).status, 201);
  await waitFor(() => releases.length === 3);
  releases[2]();
  await runner.drain();
});

test('batch upload: valid, invalid, duplicate and over-limit rows are each reported; one bad row does not sink the rest', async () => {
  impl = async () => okKit('x');
  const c = await user();
  const res = await c.call('/kits/batch', { method: 'POST', body: { days: 3, items: [
    { jd: 'Backend role', company_url: 'https://a.test' },
    { jd: 'Frontend role', company_url: 'ftp://nope' },
    { jd: 'backend role', company_url: 'https://a.test/' },
    { company_url: 'https://b.test' },
    'not even an object',
  ] } });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.results.map((r) => r.status), ['created', 'invalid', 'duplicate', 'invalid', 'invalid']);
  assert.equal(res.body.results[2].kit_id, res.body.results[0].kit_id);
  assert.ok(res.body.results[1].errors.some((e) => /company_url/.test(e)));
  await runner.drain();
  assert.equal((await c.call('/kits')).body.kits.length, 1);

  assert.equal((await c.call('/kits/batch', { method: 'POST', body: { days: 3, items: [] } })).status, 400);
  const tooMany = Array.from({ length: 11 }, (_, i) => ({ jd: `r${i}`, company_url: 'https://a.test' }));
  assert.equal((await c.call('/kits/batch', { method: 'POST', body: { days: 3, items: tooMany } })).status, 400);
});

test('batch respects the active-job cap per item and reports rejected rows', async () => {
  const releases = [];
  impl = () => new Promise((r) => releases.push(() => r(okKit('x'))));
  const c = await user();
  const res = await c.call('/kits/batch', { method: 'POST', body: { days: 2, items: ['a', 'b', 'c'].map((x) => ({ jd: `role ${x}`, company_url: `https://${x}.test` })) } });
  assert.deepEqual(res.body.results.map((r) => r.status), ['created', 'created', 'rejected']);
  assert.equal(res.body.results[2].error.code, 'TOO_MANY_ACTIVE_JOBS');
  await waitFor(() => releases.length === 2);
  releases.forEach((r) => r());
  await runner.drain();
});

test('deleting a kit while it generates returns 204 and the server stays healthy', async () => {
  let release;
  impl = () => new Promise((r) => { release = () => r(okKit('x')); });
  const c = await user();
  const { body } = await c.call('/kits', { method: 'POST', body: input('delete-me') });
  await waitFor(() => release);
  assert.equal((await c.call(`/kits/${body.kit.id}`, { method: 'DELETE' })).status, 204);
  release();
  await runner.drain();
  assert.equal((await c.call(`/kits/${body.kit.id}`)).status, 404);
  assert.equal((await c.call('/kits')).status, 200);
});
