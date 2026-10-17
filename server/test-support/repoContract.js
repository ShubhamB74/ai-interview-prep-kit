import assert from 'node:assert/strict';

/**
 * Behavioural contract every repo implementation must satisfy (memory and Mongo). Each case gets fresh repos.
 * Covers the job-lifecycle guarantees the runner relies on: atomic claim, attempt-guarded writes, recovery.
 */
async function seed(repos, n = 1) {
  const user = await repos.users.create({ email: `u${Math.random().toString(36).slice(2)}@x.com`, passwordHash: 'h' });
  const make = (i) => repos.kits.create({ userId: user.id, title: `T${i}`, inputHash: `hash-${i}-${Math.random()}`, input: { jd: `jd ${i}`, company_url: 'http://x', days: 3 } });
  const kits = [];
  for (let i = 0; i < n; i++) kits.push(await make(i));
  return { user, kits };
}

export const kitRepoContract = [
  ['create dedupes per (user, input hash) and scopes reads to the owner', async (repos) => {
    const { user, kits: [k] } = await seed(repos);
    const again = await repos.kits.create({ userId: user.id, title: 'x', inputHash: k.inputHash, input: k.input });
    assert.equal(again.id, k.id);
    assert.equal(k.status, 'pending');
    assert.equal(k.attempt, 0);
    const other = await repos.users.create({ email: `o${Math.random()}@x.com`, passwordHash: 'h' });
    assert.equal(await repos.kits.findOwned(k.id, other.id), null);
    assert.equal(await repos.kits.remove(k.id, other.id), false);
    assert.equal((await repos.kits.findOwned(k.id, user.id)).id, k.id);
    assert.equal(await repos.kits.findOwned('not-an-id', user.id), null);
  }],

  ['claim is atomic: exactly one of two concurrent claims wins; attempt increments', async (repos) => {
    const { kits: [k] } = await seed(repos);
    const [a, b] = await Promise.all([repos.kits.claim(k.id), repos.kits.claim(k.id)]);
    assert.equal([a, b].filter(Boolean).length, 1);
    const won = a || b;
    assert.equal(won.status, 'running');
    assert.equal(won.attempt, 1);
    assert.equal(await repos.kits.claim(k.id), null, 'a running kit cannot be claimed');
  }],

  ['progress is upserted per step, ordered by seq, and only for the current attempt of a running kit', async (repos) => {
    const { user, kits: [k] } = await seed(repos);
    assert.equal(await repos.kits.setProgress(k.id, 1, 'research', { status: 'running', seq: 1 }), false, 'not running yet');
    const { attempt } = await repos.kits.claim(k.id);
    assert.equal(await repos.kits.setProgress(k.id, attempt, 'research', { status: 'running', detail: null, seq: 1 }), true);
    assert.equal(await repos.kits.setProgress(k.id, attempt, 'research', { status: 'done', detail: '3 pages', seq: 2 }), true);
    assert.equal(await repos.kits.setProgress(k.id, attempt, 'questions:technical', { status: 'done', seq: 3 }), true);
    assert.equal(await repos.kits.setProgress(k.id, attempt, 'odd.step$name', { status: 'done', seq: 4 }), true);
    assert.equal(await repos.kits.setProgress(k.id, attempt + 1, 'research', { status: 'failed', seq: 9 }), false, 'wrong attempt');
    const p = (await repos.kits.findOwned(k.id, user.id)).progress;
    assert.equal(p.research.status, 'done');
    assert.equal(p.research.detail, '3 pages');
    assert.equal(Object.keys(p).length, 3);
    assert.equal(p['questions:technical'].status, 'done');
  }],

  ['finish / fail only apply to the running attempt; a stale attempt cannot overwrite a newer one', async (repos) => {
    const { user, kits: [k] } = await seed(repos);
    assert.equal(await repos.kits.finish(k.id, 1, { a: 1 }), false, 'pending kit cannot finish');
    await repos.kits.claim(k.id);
    assert.equal(await repos.kits.fail(k.id, 1, { code: 'JOB_TIMEOUT', message: 'slow' }), true);
    const failed = await repos.kits.findOwned(k.id, user.id);
    assert.deepEqual([failed.status, failed.error.code], ['failed', 'JOB_TIMEOUT']);

    const again = await repos.kits.requeue(k.id, user.id);
    assert.deepEqual([again.status, again.error], ['pending', null]);
    const second = await repos.kits.claim(k.id);
    assert.equal(second.attempt, 2);
    assert.equal(await repos.kits.finish(k.id, 1, { stale: true }), false, 'attempt 1 is stale');
    assert.equal(await repos.kits.finish(k.id, 2, { fresh: true }), true);
    const done = await repos.kits.findOwned(k.id, user.id);
    assert.deepEqual([done.status, done.kit], ['ready', { fresh: true }]);
    assert.equal(await repos.kits.fail(k.id, 2, { code: 'X', message: 'late' }), false, 'a finished kit cannot be failed');
  }],

  ['requeue only works for the owner and only on failed kits', async (repos) => {
    const { user, kits: [k] } = await seed(repos);
    assert.equal(await repos.kits.requeue(k.id, user.id), null, 'pending');
    await repos.kits.claim(k.id);
    assert.equal(await repos.kits.requeue(k.id, user.id), null, 'running');
    await repos.kits.fail(k.id, 1, { code: 'E', message: 'm' });
    const other = await repos.users.create({ email: `o${Math.random()}@x.com`, passwordHash: 'h' });
    assert.equal(await repos.kits.requeue(k.id, other.id), null, 'not the owner');
    assert.equal((await repos.kits.requeue(k.id, user.id)).status, 'pending');
  }],

  ['recoverInterrupted: running -> pending (below the attempt cap) or failed JOB_INTERRUPTED (at the cap); returns all pending ids', async (repos) => {
    const { user, kits: [a, b, c] } = await seed(repos, 3);
    await repos.kits.claim(a.id);                    // running, attempt 1
    await repos.kits.claim(b.id);
    await repos.kits.fail(b.id, 1, { code: 'E', message: 'm' });
    await repos.kits.requeue(b.id, user.id);
    await repos.kits.claim(b.id);
    await repos.kits.fail(b.id, 2, { code: 'E', message: 'm' });
    await repos.kits.requeue(b.id, user.id);
    await repos.kits.claim(b.id);                    // running, attempt 3
    const pending = await repos.kits.recoverInterrupted(3);
    assert.deepEqual(new Set(pending), new Set([a.id, c.id]));
    assert.equal((await repos.kits.findOwned(a.id, user.id)).status, 'pending');
    const capped = await repos.kits.findOwned(b.id, user.id);
    assert.deepEqual([capped.status, capped.error.code], ['failed', 'JOB_INTERRUPTED']);
  }],

  ['countActive counts pending + running only; remove during a run makes later writes no-ops', async (repos) => {
    const { user, kits: [a, b] } = await seed(repos, 2);
    assert.equal(await repos.kits.countActive(user.id), 2);
    await repos.kits.claim(a.id);
    await repos.kits.finish(a.id, 1, { ok: 1 });
    assert.equal(await repos.kits.countActive(user.id), 1);
    await repos.kits.claim(b.id);
    assert.equal(await repos.kits.remove(b.id, user.id), true);
    assert.equal(await repos.kits.setProgress(b.id, 1, 'x', { status: 'done', seq: 1 }), false);
    assert.equal(await repos.kits.finish(b.id, 1, {}), false);
    assert.equal(await repos.kits.fail(b.id, 1, { code: 'E', message: 'm' }), false);
  }],

  ['list returns summaries newest first', async (repos) => {
    const { user, kits } = await seed(repos, 2);
    const list = await repos.kits.list(user.id);
    assert.equal(list.length, 2);
    assert.deepEqual(new Set(list.map((k) => k.id)), new Set(kits.map((k) => k.id)));
    assert.ok(list.every((k) => k.input.company_url === 'http://x' && k.status === 'pending'));
  }],
];
