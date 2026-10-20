import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import assert from 'node:assert/strict';
import { planMock, summarizeMock } from '@prepkit/shared/mock';
import { Intro, Report, Runner } from '../components/builder/MockInterviewSection.jsx';
import { makeKit } from '../../server/test-support/kitFixture.js';

// Mock interview UI: plan preview, a full run (answer -> tick checklist -> next), skip, end early, and the report.
const q = (id, category, reqs, difficulty, outline) => ({ id, category, requirement_ids: reqs, prompt: `Prompt ${id}?`, answer_outline: outline, difficulty, origin: 'generated' });
const kit = makeKit({ questions: [
  q('q1', 'technical', ['r1'], 1, '- Explain the event loop\n- Mention the microtask queue\n- Give a blocking example'),
  q('q2', 'technical', ['r2'], 2, 'Define idempotency. Show a retry-safe endpoint.'),
  q('q3', 'behavioural', ['r3'], 2, ''),
] });
const plan = planMock(kit, { perRound: 2 });
const text = () => document.body.textContent;
const results = [];
const test = async (name, fn) => { try { await fn(); results.push(['ok  ', name]); } catch (e) { results.push(['FAIL', `${name}: ${e.message}`]); } };
const tick = (ms = 0) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
const button = (label) => [...document.querySelectorAll('button')].find((b) => b.textContent.includes(label));
const click = (label) => act(async () => { button(label).click(); });
const typeInto = (el, value) => act(async () => {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
  setter.call(el, value); el.dispatchEvent(new window.Event('input', { bubbles: true }));
});
const tickBox = (i) => act(async () => { document.querySelectorAll('input[type=checkbox]')[i].click(); });
const html = (el) => renderToString(el).replace(/<!-- -->/g, '');

async function mount(props = {}) {
  const finished = [];
  let cancelled = 0;
  document.body.innerHTML = '<div id="root"></div>';
  const root = createRoot(document.getElementById('root'));
  await act(async () => root.render(<Runner kit={kit} plan={plan} onFinish={(b) => finished.push(b)} onCancel={() => { cancelled++; }} {...props} />));
  return { finished, cancelled: () => cancelled };
}

async function main() {
  await test('plan: rounds follow the kit (technical then behavioural), warm-up first, each question once', () => {
    assert.deepEqual(plan.rounds.map((r) => r.id), ['technical', 'behavioural']);
    assert.deepEqual(plan.rounds[0].question_ids, ['q1', 'q2']);
  });

  await test('intro: shows rounds, counts, timing and an honest note about how the interview was planned', () => {
    const h = html(<Intro plan={plan} attempts={0} onStart={() => {}} onShowReport={() => {}} />);
    assert.match(h, /Round 1: Technical interview/);
    assert.match(h, /3 questions, about \d+ minutes/);
    assert.match(h, /doesn’t publish its process/);
    assert.match(h, /Nothing is graded by AI/);
    assert.ok(!h.includes('See my last result'));
    assert.match(html(<Intro plan={plan} attempts={2} onStart={() => {}} onShowReport={() => {}} />), /See my last result \(2 attempts\)/);
    const published = { ...plan, basis: 'published' };
    assert.match(html(<Intro plan={published} attempts={0} onStart={() => {}} onShowReport={() => {}} />), /process this company publishes/);
  });

  await test('intro: a kit with too few questions explains itself and offers no start button', () => {
    const h = html(<Intro plan={{ basis: 'default', rounds: [], total_questions: 0, total_minutes: 0 }} attempts={0} onStart={() => {}} onShowReport={() => {}} />);
    assert.match(h, /doesn’t have enough questions/);
    assert.ok(!h.includes('Start mock interview'));
  });

  await test('runner: the submit button needs an answer; the checklist comes from the answer outline', async () => {
    await mount();
    assert.match(text(), /Technical interview · question 1 of 3/);
    assert.match(text(), /Prompt q1\?/);
    assert.equal(button('Submit answer').disabled, true);
    await typeInto(document.querySelector('textarea'), 'The event loop schedules callbacks.');
    assert.equal(button('Submit answer').disabled, false);
    await click('Submit answer');
    assert.match(text(), /Which of these did your answer cover\?/);
    assert.match(text(), /Explain the event loop/);
    assert.equal(document.querySelectorAll('input[type=checkbox]').length, 3);
    assert.match(text(), /0 of 3 covered/);
    await tickBox(0); await tickBox(2);
    assert.match(text(), /2 of 3 covered/);
  });

  await test('runner: a complete run sends exactly what the server needs (ticks per checklist, skipped flag, integer seconds, round ids)', async () => {
    const s = await mount();
    await typeInto(document.querySelector('textarea'), 'Answer one');
    await tick(1100);
    await click('Submit answer'); await tickBox(0); await tickBox(1); await click('Next question');
    assert.match(text(), /question 2 of 3/);
    await click('Skip this question');
    assert.match(text(), /Behavioural interview · question 3 of 3/);
    await typeInto(document.querySelector('textarea'), 'Third answer');
    await click('Submit answer');
    assert.equal(document.querySelectorAll('input[type=checkbox]').length, 1, 'an empty outline becomes one generic checklist item');
    assert.equal(button('Finish interview') !== undefined, true);
    await tickBox(0); await click('Finish interview');

    assert.equal(s.finished.length, 1);
    const body = s.finished[0];
    assert.deepEqual([body.completed, body.basis], [true, 'default']);
    assert.deepEqual(body.rounds, [{ id: 'technical', question_ids: ['q1', 'q2'] }, { id: 'behavioural', question_ids: ['q3'] }]);
    assert.deepEqual(body.answers.map((a) => [a.question_id, a.round_id, a.skipped, a.covered]), [['q1', 'technical', false, [true, true, false]], ['q2', 'technical', true, []], ['q3', 'behavioural', false, [true]]]);
    assert.ok(body.answers.every((a) => Number.isInteger(a.seconds) && a.seconds >= 0));
    assert.ok(body.answers[0].seconds >= 1, 'the timer ran while answering');
    assert.equal(body.answers[1].answer_text, '');
  });

  await test('runner: ending early saves what has been answered as a partial attempt; with nothing answered it just cancels', async () => {
    const s = await mount();
    await typeInto(document.querySelector('textarea'), 'Only this');
    await click('Submit answer'); await tickBox(1);
    await click('End interview now');
    assert.equal(s.finished.length, 1);
    assert.equal(s.finished[0].completed, false);
    assert.deepEqual(s.finished[0].answers.map((a) => a.covered), [[false, true, false]], 'ticks on the open question are kept');

    const t = await mount();
    await click('End interview now');
    assert.equal(t.finished.length, 0);
    assert.equal(t.cancelled(), 1);
  });

  await test('runner: Ctrl+Enter submits; a question deleted mid-run is skipped', async () => {
    await mount();
    const field = document.querySelector('textarea');
    await typeInto(field, 'Via keyboard');
    await act(async () => { field.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true })); });
    assert.match(text(), /Which of these did your answer cover\?/);

    const trimmed = { ...kit, questions: kit.questions.filter((x) => x.id !== 'q1') };
    document.body.innerHTML = '<div id="root"></div>';
    const root = createRoot(document.getElementById('root'));
    await act(async () => root.render(<Runner kit={trimmed} plan={plan} onFinish={() => {}} onCancel={() => {}} />));
    await tick();
    assert.match(text(), /Prompt q2\?/);
  });

  await test('runner: focus goes to the answer box, then to the Next button after submitting', async () => {
    await mount();
    assert.equal(document.activeElement?.tagName, 'TEXTAREA');
    await typeInto(document.querySelector('textarea'), 'x');
    await click('Submit answer');
    assert.match(document.activeElement?.textContent ?? '', /Next question/);
  });

  const attempt = (id, overall, answers) => ({ id, saved_at: '2026-10-18T00:00:00Z', completed: true, basis: 'default', rounds: [{ id: 'technical', title: 'Technical interview', question_ids: answers.map((a) => a.question_id) }], answers, overall });
  const ans = (question_id, score, extra = {}) => ({ question_id, round_id: 'technical', prompt: `Prompt ${question_id}?`, answer_text: 'x', covered: [], seconds: 100, skipped: false, score, ...extra });

  await test('report: overall verdict, rounds, weakest requirements first, unasked must-haves, redo list, trend', () => {
    const rep = summarizeMock(kit, [attempt('m-2', 0.4, [ans('q1', 0.2), ans('q2', 0.9, { skipped: false })]), attempt('m-1', 0.7, [ans('q1', 0.7)])]);
    const h = html(<Report report={rep} saving={false} onAgain={() => {}} onBack={() => {}} onReset={() => {}} />);
    assert.match(h, /40%/);
    assert.match(h, /Needs work/);
    assert.ok(h.indexOf('5+ years Node.js') < h.indexOf('Design scalable APIs'), 'weakest requirement first');
    assert.match(h, /revisit/);
    assert.match(h, /Not asked this time: Mentor junior engineers/);
    assert.match(h, /Questions to redo/);
    assert.match(h, /70% → 40%/);
    assert.match(h, /Delete all attempts/);
  });

  await test('report: strong result, ended-early label, empty state', () => {
    const strong = summarizeMock(kit, [{ ...attempt('m-1', 0.9, [ans('q1', 0.9)]), completed: false }]);
    const h = html(<Report report={strong} saving={false} onAgain={() => {}} onBack={() => {}} onReset={() => {}} />);
    assert.match(h, /Strong/);
    assert.match(h, /ended early/);
    assert.match(html(<Report report={{ attempts: 0, latest: null, trend: [] }} onAgain={() => {}} onBack={() => {}} onReset={() => {}} />), /No mock interviews yet/);
  });

  for (const [s, m] of results) console.log(s, m);
  process.exit(results.every(([s]) => s.trim() === 'ok') ? 0 : 1);
}
main();
