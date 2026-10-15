import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { createApp } from '../src/app.js';
import { createMemoryRepos } from '../src/repos/memory.js';
import { env } from '../src/config/env.js';
import { COOKIE_NAME } from '../src/lib/session.js';

let server, base;
before(async () => {
  server = createApp({ repos: createMemoryRepos() }).listen(0);
  base = `http://127.0.0.1:${server.address().port}/api`;
});
after(() => server.close());

/** Minimal client with its own cookie jar (one per simulated user). */
function client() {
  let cookie = '';
  return {
    setCookie: (c) => (cookie = c),
    async call(path, { method = 'GET', body, headers = {} } = {}) {
      const res = await fetch(base + path, {
        method,
        headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers },
        body: body ? JSON.stringify(body) : undefined,
      });
      const set = res.headers.getSetCookie?.()[0];
      if (set) cookie = set.startsWith(`${COOKIE_NAME}=;`) ? '' : set.split(';')[0];
      const text = await res.text();
      return { status: res.status, body: text ? JSON.parse(text) : null };
    },
  };
}

const creds = (n) => ({ email: `user${n}-${Math.random().toString(36).slice(2)}@x.com`, password: 'password123' });
const kitInput = { jd: 'Senior Backend Engineer\nRequired: Node.js', company_url: 'https://acme.test/', days: 5 };

test('protected endpoints reject signed-out visitors', async () => {
  const c = client();
  for (const p of ['/kits', '/auth/me']) assert.equal((await c.call(p)).status, 401);
  const r = await c.call('/kits', { method: 'POST', body: kitInput });
  assert.equal(r.status, 401);
  assert.equal(r.body.error.code, 'UNAUTHENTICATED');
});

test('register -> me -> logout -> me is 401', async () => {
  const c = client();
  assert.equal((await c.call('/auth/register', { method: 'POST', body: creds(1) })).status, 201);
  assert.equal((await c.call('/auth/me')).status, 200);
  assert.equal((await c.call('/auth/logout', { method: 'POST' })).status, 204);
  assert.equal((await c.call('/auth/me')).status, 401);
});

test('duplicate email -> 409; wrong password / unknown email -> same 401', async () => {
  const a = client(), cr = creds(2);
  await a.call('/auth/register', { method: 'POST', body: cr });
  assert.equal((await client().call('/auth/register', { method: 'POST', body: cr })).status, 409);
  const wrong = await client().call('/auth/login', { method: 'POST', body: { ...cr, password: 'nope-nope' } });
  const unknown = await client().call('/auth/login', { method: 'POST', body: creds(3) });
  assert.equal(wrong.status, 401);
  assert.deepEqual(wrong.body.error.message, unknown.body.error.message);
});

test('weak password and malformed email are rejected with details', async () => {
  const r = await client().call('/auth/register', { method: 'POST', body: { email: 'nope', password: 'short' } });
  assert.equal(r.status, 400);
  assert.equal(r.body.error.code, 'VALIDATION_ERROR');
  assert.ok(r.body.error.details.length >= 2);
});

test('expired and tampered sessions get distinct, structured 401s', async () => {
  const c = client();
  const expired = jwt.sign({ sub: 'abc', exp: Math.floor(Date.now() / 1000) - 10 }, env.sessionSecret);
  c.setCookie(`${COOKIE_NAME}=${expired}`);
  assert.equal((await c.call('/kits')).body.error.code, 'SESSION_EXPIRED');
  c.setCookie(`${COOKIE_NAME}=garbage.token.value`);
  assert.equal((await c.call('/kits')).body.error.code, 'INVALID_SESSION');
});

test('kit input validation: days 0, bad url, empty jd', async () => {
  const c = client();
  await c.call('/auth/register', { method: 'POST', body: creds(4) });
  for (const bad of [{ ...kitInput, days: 0 }, { ...kitInput, days: 1.5 }, { ...kitInput, company_url: 'ftp://x' }, { ...kitInput, jd: '   ' }]) {
    assert.equal((await c.call('/kits', { method: 'POST', body: bad })).status, 400);
  }
});

test('1-day and 60-day requests are accepted', async () => {
  const c = client();
  await c.call('/auth/register', { method: 'POST', body: creds(5) });
  assert.equal((await c.call('/kits', { method: 'POST', body: { ...kitInput, jd: 'one day', days: 1 } })).status, 201);
  assert.equal((await c.call('/kits', { method: 'POST', body: { ...kitInput, jd: 'sixty days', days: 60 } })).status, 201);
});

test('same posting + company submitted twice returns the existing kit', async () => {
  const c = client();
  await c.call('/auth/register', { method: 'POST', body: creds(6) });
  const first = await c.call('/kits', { method: 'POST', body: kitInput });
  const again = await c.call('/kits', {
    method: 'POST',
    body: { ...kitInput, jd: kitInput.jd.toUpperCase() + '  ', company_url: 'https://ACME.test' },
  });
  assert.equal(first.status, 201);
  assert.equal(again.status, 200);
  assert.equal(again.body.duplicate, true);
  assert.equal(again.body.kit.id, first.body.kit.id);
  assert.equal((await c.call('/kits')).body.kits.length, 1);
});

test('users can read and delete only their own kits', async () => {
  const alice = client(), bob = client();
  await alice.call('/auth/register', { method: 'POST', body: creds(7) });
  await bob.call('/auth/register', { method: 'POST', body: creds(8) });
  const { body } = await alice.call('/kits', { method: 'POST', body: kitInput });
  const id = body.kit.id;

  assert.equal((await bob.call(`/kits/${id}`)).status, 404);
  assert.equal((await bob.call(`/kits/${id}`, { method: 'DELETE' })).status, 404);
  assert.equal((await bob.call('/kits')).body.kits.length, 0);

  assert.equal((await alice.call(`/kits/${id}`)).status, 200);
  assert.equal((await alice.call(`/kits/${id}`, { method: 'DELETE' })).status, 204);
  assert.equal((await alice.call(`/kits/${id}`)).status, 404);
});

test('state-changing request from a foreign origin is rejected', async () => {
  const r = await client().call('/auth/register', { method: 'POST', body: creds(9), headers: { Origin: 'https://evil.example' } });
  assert.equal(r.status, 403);
  assert.equal(r.body.error.code, 'BAD_ORIGIN');
});

test('malformed JSON body gives a structured 400', async () => {
  const res = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{oops' });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error.code, 'INVALID_JSON');
});
