import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import assert from 'node:assert/strict';
import { summarize } from '@prepkit/shared/leitner';
import { Overview, Session } from '../components/builder/PracticeSection.jsx';
import { usePractice } from '../lib/usePractice.js';
import { makeKit } from '../../server/test-support/kitFixture.js';

// Practice mode: the overview states, the session (reveal, rate, keyboard, re-queue) and the progress hook against a fake server.
const NOW = Date.parse('2026-10-18T10:00:00.000Z');
const noop = () => {};
const kit = makeKit();
const cards = [
  { id: 'c1', front: 'Front one?', back: 'Back one.', requirement_ids: ['r1'] },
  { id: 'c2', front: 'Front two?', back: 'Back two.', requirement_ids: ['r2'] },
  { id: 'c3', front: 'Front three?', back: 'Back three.', requirement_ids: ['r3'] },
];
const cardsById = new Map(cards.map((c) => [c.id, c]));
const text = () => document.body.textContent;
const results = [];
const test = async (name, fn) => { try { await fn(); results.push(['ok  ', name]); } catch (e) { results.push(['FAIL', `${name}: ${e.message}`]); } };
const tick = (ms = 0) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
const key = (k, target = document.body) => act(async () => { target.dispatchEvent(new window.KeyboardEvent('keydown', { key: k, bubbles: true })); });
const button = (label) => [...document.querySelectorAll('button')].find((b) => b.textContent.includes(label));
const click = (label) => act(async () => { button(label).click(); });

async function main() {
  const html = (el) => renderToString(el).replace(/<!-- -->/g, '');
  const due = (reviewed, extra = {}) => ({ cards: reviewed, ...extra });
  const base = { flashcards: kit.flashcards, requirements: kit.role.requirements, now: NOW, interviewAt: NOW + 3 * 86_400_000 };

  // ---------- overview ----------
  await test('overview: no flashcards -> explains and offers nothing to start', async () => {
    const h = html(<Overview summary={summarize({ ...base, flashcards: [], progress: {} })} now={NOW} onStart={noop} onReset={noop} onGoToCards={noop} />);
    assert.match(h, /no flashcards to practise yet/);
  });
  await test('overview: fresh kit shows new cards, the interview countdown, and per-requirement coverage (must-haves first)', async () => {
    const h = html(<Overview summary={summarize({ ...base, progress: {} })} now={NOW} onStart={noop} onReset={noop} onGoToCards={noop} />);
    assert.match(h, /Start session \(2 cards, weakest first\)/);
    assert.match(h, /About 3 days until your interview/);
    assert.match(h, /Not started/);
    assert.match(h, /No flashcards/); // r3 / r4 have no cards
    assert.ok(h.indexOf('5+ years Node.js') < h.indexOf('Payments knowledge'), 'must before nice');
    assert.ok(!h.includes('Reset practice progress'), 'nothing to reset yet');
  });
  await test('overview: caught up message with the next review time, weak spots and reset appear after practising', async () => {
    const st = (box, d, c) => ({ box, due: new Date(NOW + d * 3600_000).toISOString(), last_confidence: c, reviews: 2, recent: [c] });
    const progress = { cards: { f1: st(1, 5, 1), f2: st(4, 5, 3) } };
    const h = html(<Overview summary={summarize({ ...base, progress })} now={NOW} onStart={noop} onReset={noop} onGoToCards={noop} />);
    assert.match(h, /You’re caught up\. Next review in 5 hours/);
    assert.match(h, /Weak spots/);
    assert.match(h, /What idempotency|Idempotency\?|event loop/);
    assert.match(h, /Reset practice progress/);
    assert.match(h, /disabled=""[^>]*>Start session \(0 cards/);
  });

  // ---------- session ----------
  const mountSession = async (props = {}) => {
    const rated = [];
    let exited = 0, again = 0;
    document.body.innerHTML = '<div id="root"></div>';
    const root = createRoot(document.getElementById('root'));
    await act(async () => root.render(<Session queueIds={['c1', 'c2', 'c3']} cardsById={cardsById} requirements={kit.role.requirements} onRate={(id, v) => rated.push([id, v])} onExit={() => { exited++; }} onAgain={() => { again++; }} {...props} />));
    return { rated, root, counts: () => ({ exited, again }) };
  };

  await test('session: the answer is hidden until revealed; ratings are ignored before the reveal', async () => {
    const s = await mountSession();
    assert.match(text(), /Card 1 of 3/);
    assert.match(text(), /Front one\?/);
    assert.ok(!text().includes('Back one.'));
    await key('3');
    assert.deepEqual(s.rated, []);
    await key(' ');
    assert.match(text(), /Back one\./);
    assert.ok(button('Knew it') && button("Didn't know") && button('Shaky'));
  });

  await test('session: keyboard 1/2/3 rate; Space/Enter reveal; buttons work too; order is respected', async () => {
    const s = await mountSession();
    await key(' '); await key('3');
    assert.match(text(), /Card 2 of 3/);
    await click('Show answer'); await click('Shaky');
    await key('Enter'); await key('1');
    assert.deepEqual(s.rated, [['c1', 3], ['c2', 2], ['c3', 1]]);
  });

  await test('session: a missed card comes back later in the same run, at most twice; then the summary is shown', async () => {
    const s = await mountSession({ queueIds: ['c1'] });
    for (let i = 0; i < 3; i++) { await key(' '); await key('1'); }
    assert.equal(s.rated.length, 3);
    assert.ok(s.rated.every(([id, v]) => id === 'c1' && v === 1));
    assert.match(text(), /Session complete/);
    assert.match(text(), /3 ratings: 0 knew it, 0 shaky, 3 didn’t know/);
  });

  await test('session: the "Card N of M" counter grows when a missed card is re-queued', async () => {
    await mountSession();
    await key(' '); await key('1');
    assert.match(text(), /Card 2 of 4/);
  });

  await test('session: keys are ignored while typing in a field, and with modifier keys', async () => {
    const s = await mountSession();
    await key(' ');
    const input = document.createElement('input'); document.body.appendChild(input);
    await key('3', input);
    await act(async () => { document.body.dispatchEvent(new window.KeyboardEvent('keydown', { key: '3', ctrlKey: true, bubbles: true })); });
    assert.deepEqual(s.rated, []);
  });

  await test('session: a card deleted while the run is open is skipped; completing shows buttons that call back', async () => {
    const s = await mountSession({ queueIds: ['ghost', 'c2'] });
    assert.match(text(), /Front two\?/);
    await key(' '); await key('3');
    assert.match(text(), /Session complete/);
    await click('Study again'); await click('Back to overview');
    assert.deepEqual(s.counts(), { exited: 1, again: 1 });
  });

  await test('session: focus moves to the answer controls after reveal (keyboard users never lose their place)', async () => {
    await mountSession();
    assert.equal(document.activeElement?.textContent.includes('Show answer'), true);
    await key(' ');
    assert.equal(document.activeElement?.textContent.includes("Didn't know"), true);
  });

  // ---------- usePractice against a fake server ----------
  let server, pending, log;
  const reset = () => { server = { cards: {}, interview_at: new Date(NOW + 3 * 86_400_000).toISOString() }; pending = []; log = []; };
  const ok = (body) => ({ ok: true, status: 200, json: async () => body });
  global.fetch = (url, init = {}) => new Promise((resolve) => {
    const method = init.method || 'GET';
    if (method === 'GET') { log.push('GET'); return resolve(ok({ practice: { cards: structuredClone(server.cards), interview_at: server.interview_at, server_time: new Date().toISOString() } })); }
    if (method === 'DELETE') { log.push('DELETE'); server.cards = {}; return resolve({ ok: true, status: 204, json: async () => ({}) }); }
    const body = JSON.parse(init.body);
    log.push(`POST ${body.card_id}:${body.confidence}`);
    pending.push({ body, release: (fail) => {
      if (fail) return resolve({ ok: false, status: 500, json: async () => ({ error: { code: 'BOOM', message: 'server error' } }) });
      const prev = server.cards[body.card_id];
      server.cards[body.card_id] = { box: body.confidence === 1 ? 1 : (prev?.box ?? 1) + 1, due: new Date(NOW).toISOString(), last_confidence: body.confidence, reviews: (prev?.reviews ?? 0) + 1, recent: [body.confidence], last_review_id: body.review_id };
      resolve(ok({ card_id: body.card_id, state: server.cards[body.card_id], duplicate: false }));
    } });
  });
  let hook, mounts = 0;
  function H() { hook = usePractice('kit1'); return null; }
  const mountHook = async () => { reset(); document.body.innerHTML = '<div id="root"></div>'; const root = createRoot(document.getElementById('root')); await act(async () => root.render(<H key={++mounts} />)); await tick(); };

  await test('hook: loads progress; a rating shows instantly, is sent with a review id, and the server state replaces the guess', async () => {
    await mountHook();
    assert.deepEqual(hook.progress.cards, {});
    await act(async () => hook.review('f1', 3));
    assert.equal(hook.progress.cards.f1.box, 2, 'optimistic Leitner result, before the network answers');
    assert.match(pending[0].body.review_id, /^rv-[a-z0-9]{8}$/);
    server.cards = {}; // make the server's answer distinguishable
    await act(async () => pending[0].release()); await tick();
    assert.equal(hook.progress.cards.f1.last_review_id, pending[0].body.review_id);
    assert.equal(hook.progress.cards.f1.reviews, 1);
  });

  await test('hook: ratings are sent strictly one at a time, in order', async () => {
    await mountHook();
    await act(async () => { hook.review('f1', 3); hook.review('f2', 1); hook.review('f1', 3); });
    assert.equal(pending.length, 1);
    await act(async () => pending[0].release()); await tick();
    assert.equal(pending.length, 2);
    await act(async () => pending[1].release()); await tick();
    await act(async () => pending[2].release()); await tick();
    assert.deepEqual(log.filter((l) => l.startsWith('POST')), ['POST f1:3', 'POST f2:1', 'POST f1:3']);
    assert.equal(hook.progress.cards.f1.reviews, 2);
    assert.equal(new Set(pending.map((p) => p.body.review_id)).size, 3, 'every rating has its own id');
  });

  await test('hook: a rating that cannot be saved shows an error and the screen goes back to what the server has', async () => {
    await mountHook();
    await act(async () => hook.review('f1', 3));
    assert.equal(hook.progress.cards.f1.box, 2);
    await act(async () => pending[0].release(true)); await tick();
    assert.match(hook.error, /server error/);
    assert.equal(hook.progress.cards.f1, undefined, 'local guess dropped; reloaded from the server');
  });

  await test('hook: reset clears progress', async () => {
    await mountHook();
    server.cards = { f1: { box: 3, due: new Date(NOW).toISOString(), last_confidence: 3, reviews: 2, recent: [3, 3] } };
    await act(async () => hook.reset()); await tick();
    assert.deepEqual(hook.progress.cards, {});
    assert.ok(log.includes('DELETE'));
  });

  for (const [s, m] of results) console.log(s, m);
  process.exit(results.every(([s]) => s.trim() === 'ok') ? 0 : 1);
}
main();
