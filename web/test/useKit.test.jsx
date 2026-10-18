import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { useKit } from '../lib/useKit.js';
import { makeKit } from '../../server/test-support/kitFixture.js';
import { applyOps } from '@prepkit/shared/kitOps';
import assert from 'node:assert/strict';

// useKit against a controllable fake server: optimistic edits, strictly ordered sends, polls ignored mid-edit, rollback on rejection.
const base = makeKit();
applyOps(base, [{ op: 'update_question', id: 'q1', patch: { prompt: 'Edited prompt?' } }]);
let server, pending, log;
function resetServer(over = {}) {
  server = { status: 'ready', version: 1, kit: structuredClone(base), regen: null, ...over };
  pending = []; log = [];
}
const rec = () => ({ id: 'abc', title: 'T', status: server.status, version: server.version, kit: structuredClone(server.kit), regen: server.regen, progress: [], error: null });
const respond = (status, body) => ({ ok: status < 400, status, json: async () => body });

// Fake network. POSTs to /ops wait until the test releases them.
global.fetch = (url, init = {}) => new Promise((resolve) => {
  const method = init.method || 'GET';
  const body = init.body ? JSON.parse(init.body) : null;
  if (method === 'GET') { log.push('GET'); return resolve(respond(200, { kit: rec() })); }
  if (url.endsWith('/ops')) {
    log.push(`POST ${body.ops.map((o) => o.op + ':' + (o.id || '')).join(',')}`);
    pending.push({ body, resolve: (fail) => {
      if (fail) return resolve(respond(404, { error: { code: 'ITEM_NOT_FOUND', message: 'gone' } }));
      applyOps(server.kit, body.ops); server.version++;
      resolve(respond(200, { kit: rec() }));
    } });
  }
});

let hook;
function T() { hook = useKit('abc'); return null; }
let mounts = 0;
const tick = (ms = 0) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
const q = (id) => hook.kit.questions.find((x) => x.id === id);

async function main() {
const root = createRoot(document.getElementById('root'));
async function mount(over) { resetServer(over); await act(async () => root.render(<T key={++mounts} />)); await tick(); }

const results = [];
async function t(name, fn) { try { await fn(); results.push(['ok  ', name]); } catch (e) { results.push(['FAIL', `${name}: ${e.message}`]); } }

await t('loads the kit', async () => { await mount(); assert.equal(hook.kit.questions.length, 6); assert.equal(hook.rec.version, 1); });

await t('an edit shows instantly, before the network answers; then the server version replaces it', async () => {
  await mount();
  await act(async () => hook.dispatch([{ op: 'update_question', id: 'q1', patch: { prompt: 'Instant!' } }]));
  assert.equal(q('q1').prompt, 'Instant!');           // optimistic
  assert.equal(q('q1').origin, 'edited');
  assert.equal(hook.saving, true);
  assert.equal(pending.length, 1);
  await act(async () => pending[0].resolve());
  await tick();
  assert.equal(hook.saving, false);
  assert.equal(hook.rec.version, 2);
  assert.equal(q('q1').prompt, 'Instant!');
});

await t('ops are sent strictly in order, one at a time', async () => {
  await mount();
  await act(async () => {
    hook.dispatch([{ op: 'update_question', id: 'q1', patch: { prompt: 'First?' } }]);
    hook.dispatch([{ op: 'delete_question', id: 'q2' }]);
    hook.dispatch([{ op: 'update_question', id: 'q1', patch: { prompt: 'Second?' } }]);
  });
  assert.equal(q('q1').prompt, 'Second?');             // all three applied locally
  assert.equal(q('q2'), undefined);
  assert.equal(pending.length, 1, 'only the first is in flight');
  await act(async () => pending[0].resolve()); await tick();
  assert.equal(pending.length, 2);
  await act(async () => pending[1].resolve()); await tick();
  await act(async () => pending[2].resolve()); await tick();
  assert.deepEqual(log.filter((l) => l.startsWith('POST')), ['POST update_question:q1', 'POST delete_question:q2', 'POST update_question:q1']);
  assert.equal(server.kit.questions.find((x) => x.id === 'q1').prompt, 'Second?');
  assert.equal(hook.saving, false);
});

await t('a background poll arriving mid-edit does NOT overwrite the local edit', async () => {
  await mount({ regen: { section: 'brief', status: 'running' } });   // regeneration running => the hook polls every 2s
  await act(async () => hook.dispatch([{ op: 'update_question', id: 'q1', patch: { prompt: 'Typing…' } }]));
  const gets = log.filter((l) => l === 'GET').length;
  await tick(2300);                                     // a poll fires while the POST is still pending
  assert.ok(log.filter((l) => l === 'GET').length > gets, 'a poll happened');
  assert.equal(q('q1').prompt, 'Typing…', 'poll result was ignored');
  await act(async () => pending[0].resolve()); await tick();
  assert.equal(q('q1').prompt, 'Typing…');
  server.regen = null; await tick(2300);               // regeneration finished -> next poll adopts the server doc and stops polling
  assert.equal(hook.rec.regen, null);
});

await t('a rejected edit is reported, the queue is dropped and the server version is restored', async () => {
  await mount();
  await act(async () => {
    hook.dispatch([{ op: 'update_question', id: 'q1', patch: { prompt: 'Will be rejected?' } }]);
    hook.dispatch([{ op: 'update_question', id: 'q2', patch: { prompt: 'Never sent?' } }]);
  });
  await act(async () => pending[0].resolve(true)); await tick();   // server says 404
  assert.equal(hook.error.code, 'ITEM_NOT_FOUND');
  assert.equal(pending.length, 1, 'second op was dropped, not sent');
  assert.equal(q('q1').prompt, 'Edited prompt?', 'rolled back to the server value, not the rejected one');
  assert.equal(q('q2').prompt, 'Original q2 question?');
  assert.equal(hook.saving, false);
});

await t('adding then immediately editing the new item works (client-chosen ids, no temp-id problem)', async () => {
  await mount();
  await act(async () => {
    hook.dispatch([{ op: 'add_question', question: { id: 'q-new123', category: 'technical', prompt: 'Brand new?' } }]);
    hook.dispatch([{ op: 'update_question', id: 'q-new123', patch: { prompt: 'Brand new, reworded?' } }]);
  });
  assert.equal(q('q-new123').prompt, 'Brand new, reworded?');
  await act(async () => pending[0].resolve()); await tick();
  await act(async () => pending[1].resolve()); await tick();
  assert.equal(server.kit.questions.find((x) => x.id === 'q-new123').prompt, 'Brand new, reworded?');
  assert.equal(server.kit.questions.find((x) => x.id === 'q-new123').origin, 'user');
});

for (const [s, m] of results) console.log(s, m);
process.exit(results.every(([s]) => s.trim() === 'ok') ? 0 : 1);

}
main();
