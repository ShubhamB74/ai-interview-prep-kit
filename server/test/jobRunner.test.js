import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JobRunner } from '../src/jobs/jobRunner.js';
import { createMemoryRepos } from '../src/repos/memory.js';

const okKit = (title = 'T') => ({
  source: { company: 'A', company_url: 'u', role: title, location: '', jd_chars: 1, researched_at: 't', pages_used: [] },
  company_brief: { summary: '', what_they_do: '', sources: [] }, role: { title, seniority: '', responsibilities: [], requirements: [] },
  questions: [], flashcards: [], schedule: { days_available: 1, days: [{ day: 1, focus: 'f', question_ids: [], minutes: 0 }] },
  coverage: { uncovered_requirement_ids: [], passes: 1 },
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };

async function setup(pipeline, opts = {}, nKits = 1) {
  const repos = createMemoryRepos();
  const user = await repos.users.create({ email: 'a@x.com', passwordHash: 'h' });
  const kits = [];
  for (let i = 0; i < nKits; i++) kits.push(await repos.kits.create({ userId: user.id, title: `T${i}`, inputHash: `h${i}`, input: { jd: `jd${i}`, company_url: 'http://x', days: 4 } }));
  const runner = new JobRunner({ kits: repos.kits, pipeline, ...opts });
  const get = (k) => repos.kits.findOwned(k.id, user.id);
  return { repos, user, kits, runner, get };
}

test('success: pending -> running -> ready; progress kept per step in order; kit validated and stored', async () => {
  const { runner, kits, get } = await setup(async ({ onProgress, days }) => {
    onProgress({ step: 'extract_requirements', status: 'running' });
    onProgress({ step: 'extract_requirements', status: 'done', detail: '3 requirements' });
    onProgress({ step: 'research', status: 'running' });
    return okKit(`days=${days}`);
  });
  runner.enqueue(kits[0].id);
  await runner.drain();
  const k = await get(kits[0]);
  assert.equal(k.status, 'ready');
  assert.equal(k.kit.role.title, 'days=4');
  assert.equal(k.attempt, 1);
  assert.deepEqual(Object.keys(k.progress), ['extract_requirements', 'research']);
  assert.deepEqual([k.progress.extract_requirements.status, k.progress.extract_requirements.detail], ['done', '3 requirements']);
  assert.ok(k.progress.research.seq > k.progress.extract_requirements.seq);
});

test('pipeline error is recorded with its code and message', async () => {
  const { runner, kits, get } = await setup(async () => { throw Object.assign(new Error('provider down'), { code: 'LLM_UNAVAILABLE' }); });
  runner.enqueue(kits[0].id);
  await runner.drain();
  const k = await get(kits[0]);
  assert.deepEqual([k.status, k.error], ['failed', { code: 'LLM_UNAVAILABLE', message: 'provider down' }]);
  assert.equal(k.kit, null);
});

test('a kit that fails Appendix A validation is never stored', async () => {
  const { runner, kits, get } = await setup(async () => ({ not: 'a kit' }));
  runner.enqueue(kits[0].id);
  await runner.drain();
  const k = await get(kits[0]);
  assert.deepEqual([k.status, k.error.code, k.kit], ['failed', 'INVALID_KIT', null]);
});

test('timeout: marked JOB_TIMEOUT; the orphaned pipeline finishing later changes nothing', async () => {
  const late = deferred();
  const { runner, kits, get } = await setup(() => late.promise, { timeoutMs: 40 });
  runner.enqueue(kits[0].id);
  await runner.drain();
  assert.equal((await get(kits[0])).error.code, 'JOB_TIMEOUT');
  late.resolve(okKit('too late'));
  await sleep(20);
  const k = await get(kits[0]);
  assert.deepEqual([k.status, k.kit], ['failed', null]);
});

test('the pipeline gets a soft budget of 80% of the job deadline', async () => {
  let seen;
  const { runner, kits } = await setup(async ({ budgetMs }) => { seen = budgetMs; return okKit(); }, { timeoutMs: 100_000 });
  runner.enqueue(kits[0].id);
  await runner.drain();
  assert.equal(seen, 80_000);
});

test('triggering the same kit twice runs it once; a finished kit is never re-run', async () => {
  let calls = 0;
  const gate = deferred();
  const { runner, kits } = await setup(async () => { calls++; await gate.promise; return okKit(); });
  assert.equal(runner.enqueue(kits[0].id), true);
  await sleep(5);
  assert.equal(runner.enqueue(kits[0].id), false, 'already running');
  gate.resolve();
  await runner.drain();
  runner.enqueue(kits[0].id);
  await runner.drain();
  assert.equal(calls, 1);
});

test('concurrency cap is respected and every queued kit still completes', async () => {
  let running = 0, peak = 0;
  const { runner, kits, get } = await setup(async () => { peak = Math.max(peak, ++running); await sleep(15); running--; return okKit(); }, { concurrency: 2 }, 5);
  kits.forEach((k) => runner.enqueue(k.id));
  await runner.drain();
  assert.equal(peak, 2);
  for (const k of kits) assert.equal((await get(k)).status, 'ready');
});

test('deleting a kit mid-generation is safe: no crash, nothing resurrected', async () => {
  const gate = deferred();
  const logs = [];
  const { runner, kits, repos, user, get } = await setup(async ({ onProgress }) => { onProgress({ step: 'research', status: 'running' }); await gate.promise; return okKit(); }, { log: (m) => logs.push(m) });
  runner.enqueue(kits[0].id);
  await sleep(10);
  assert.equal(await repos.kits.remove(kits[0].id, user.id), true);
  gate.resolve();
  await runner.drain();
  assert.equal(await get(kits[0]), null);
  assert.deepEqual(logs, []);
});

test('retry after failure runs as attempt 2; progress from the orphaned first attempt cannot leak in', async () => {
  const stuck = deferred();
  let call = 0;
  let orphanProgress;
  const { runner, kits, repos, user, get } = await setup(({ onProgress }) => {
    if (++call === 1) { orphanProgress = onProgress; return stuck.promise; }
    onProgress({ step: 'fresh_step', status: 'done' });
    return Promise.resolve(okKit('second'));
  }, { timeoutMs: 30 });

  runner.enqueue(kits[0].id);
  await runner.drain();
  assert.equal((await get(kits[0])).status, 'failed');

  assert.equal((await repos.kits.requeue(kits[0].id, user.id)).status, 'pending');
  runner.enqueue(kits[0].id);
  await runner.drain();
  orphanProgress({ step: 'zombie_step', status: 'running' }); // attempt 1 wakes up after attempt 2 finished
  stuck.resolve(okKit('first'));
  await sleep(20);

  const k = await get(kits[0]);
  assert.deepEqual([k.status, k.attempt, k.kit.role.title], ['ready', 2, 'second']);
  assert.deepEqual(Object.keys(k.progress), ['fresh_step']);
});

test('restart recovery: interrupted + pending kits are re-run; kits interrupted too many times fail', async () => {
  const { runner, kits, repos, user, get } = await setup(async () => okKit(), { maxAttempts: 2 }, 3);
  await repos.kits.claim(kits[0].id);                          // was running when the server died (attempt 1)
  await repos.kits.claim(kits[1].id);                          // ... and has already been tried twice
  await repos.kits.fail(kits[1].id, 1, { code: 'E', message: 'm' });
  await repos.kits.requeue(kits[1].id, user.id);
  await repos.kits.claim(kits[1].id);                          // running, attempt 2 = cap
  // kits[2] never started: pending
  assert.equal(await runner.recover(), 2);
  await runner.drain();
  assert.equal((await get(kits[0])).status, 'ready');
  assert.equal((await get(kits[2])).status, 'ready');
  const capped = await get(kits[1]);
  assert.deepEqual([capped.status, capped.error.code], ['failed', 'JOB_INTERRUPTED']);
});

test('a failing progress write never fails the job', async () => {
  const logs = [];
  const { runner, kits, repos, get } = await setup(async ({ onProgress }) => { onProgress({ step: 'research', status: 'running' }); return okKit(); }, { log: (m) => logs.push(m) });
  repos.kits.setProgress = async () => { throw new Error('db hiccup'); };
  runner.enqueue(kits[0].id);
  await runner.drain();
  assert.equal((await get(kits[0])).status, 'ready');
  assert.match(logs[0], /progress write failed: db hiccup/);
});
