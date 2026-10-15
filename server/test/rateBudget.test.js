import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RateBudget } from '../src/lib/rateBudget.js';

function fakeClock() {
  const c = { t: 0, sleeps: [] };
  c.now = () => c.t;
  c.sleep = async (ms) => { c.sleeps.push(ms); c.t += ms; };
  return c;
}

test('allows calls while under the token and request limits', async () => {
  const c = fakeClock();
  const b = new RateBudget({ tokensPerMinute: 1000, requestsPerMinute: 10, now: c.now, sleep: c.sleep });
  await b.acquire(400); await b.acquire(400);
  assert.deepEqual(c.sleeps, []);
});

test('waits for the window to free up when tokens would exceed the per-minute limit', async () => {
  const c = fakeClock();
  const b = new RateBudget({ tokensPerMinute: 1000, requestsPerMinute: 100, now: c.now, sleep: c.sleep });
  await b.acquire(700);           // t=0
  c.t = 10_000;
  await b.acquire(700);           // must wait until the first call leaves the window (t=60000)
  assert.equal(c.t, 60_000);
  assert.equal(b.waitedMs, 50_000);
});

test('request-per-minute limit is enforced independently of tokens', async () => {
  const c = fakeClock();
  const b = new RateBudget({ tokensPerMinute: 1_000_000, requestsPerMinute: 2, now: c.now, sleep: c.sleep });
  await b.acquire(1); await b.acquire(1);
  await b.acquire(1);
  assert.equal(c.t, 60_000);
});

test('settle() replaces the estimate with real usage, freeing budget', async () => {
  const c = fakeClock();
  const b = new RateBudget({ tokensPerMinute: 1000, requestsPerMinute: 100, now: c.now, sleep: c.sleep });
  const ev = await b.acquire(900);
  b.settle(ev, 100);
  await b.acquire(800);
  assert.deepEqual(c.sleeps, []);
});

test('a single call larger than the whole budget still runs (alone)', async () => {
  const c = fakeClock();
  const b = new RateBudget({ tokensPerMinute: 500, requestsPerMinute: 10, now: c.now, sleep: c.sleep });
  await b.acquire(5000);
  assert.deepEqual(c.sleeps, []);
});

test('concurrent callers are served in order and never exceed the limit', async () => {
  const c = fakeClock();
  const b = new RateBudget({ tokensPerMinute: 1000, requestsPerMinute: 100, now: c.now, sleep: c.sleep });
  const order = [];
  await Promise.all([1, 2, 3].map((n) => b.acquire(600).then(() => order.push([n, c.t]))));
  assert.deepEqual(order.map((o) => o[0]), [1, 2, 3]);
  assert.deepEqual(order.map((o) => o[1]), [0, 60_000, 120_000]);
});
