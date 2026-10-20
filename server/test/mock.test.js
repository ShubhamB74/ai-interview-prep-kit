import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { MINUTES_PER_QUESTION, planMock, scoreAnswer, splitOutline, summarizeMock } from '@prepkit/shared/mock';
import { createApp } from '../src/app.js';
import { createMemoryRepos } from '../src/repos/memory.js';
import { apiClient } from '../test-support/apiClient.js';
import { makeKit } from '../test-support/kitFixture.js';

const q = (id, category, reqs, difficulty = 2, outline = 'Point A\nPoint B\nPoint C\nPoint D') => ({ id, category, requirement_ids: reqs, prompt: `Prompt ${id}?`, answer_outline: outline, difficulty, origin: 'generated' });
const withProcess = (kit, hp) => { kit.research.hiring_process = { confidence: 'published', ...hp }; return kit; };
const idsOf = (plan) => plan.rounds.map((r) => [r.id, r.question_ids]);

// ---------------- planning ----------------
test('default plan (no published process): technical, system design, behavioural, company fit, each with questions', () => {
  const plan = planMock(makeKit());
  assert.equal(plan.basis, 'default');
  assert.deepEqual(plan.rounds.map((r) => r.id), ['technical', 'system-design', 'behavioural', 'company-fit']);
  assert.equal(plan.total_questions, plan.rounds.reduce((n, r) => n + r.question_ids.length, 0));
  assert.equal(plan.total_minutes, plan.rounds.reduce((n, r) => n + r.suggested_minutes, 0));
});

test('a published process shapes the interview: screen -> technical -> system design, no behavioural round it never mentions', () => {
  const kit = withProcess(makeKit(), { known: true, signals: { phone_screen: true, take_home: true, system_design: true } });
  const plan = planMock(kit);
  assert.equal(plan.basis, 'published');
  assert.deepEqual(plan.rounds.map((r) => r.id), ['screen', 'technical', 'system-design']);
});

test('forum-only evidence is labelled "reported"; a known but unmappable process falls back to the default plan', () => {
  assert.equal(planMock(withProcess(makeKit(), { known: true, confidence: 'reported', signals: { onsite: true } })).basis, 'reported');
  const generic = planMock(withProcess(makeKit(), { known: true, signals: {} }));
  assert.deepEqual([generic.basis, generic.rounds.length], ['default', 4]);
});

test('a round only exists if the kit has questions for it (nothing is invented); a thin kit yields an empty plan', () => {
  const kit = withProcess(makeKit({ questions: [q('q1', 'technical', ['r1'])] }), { known: true, signals: { system_design: true, values_interview: true } });
  const fallback = planMock(kit);
  assert.deepEqual([fallback.basis, fallback.rounds.map((r) => r.id)], ['default', ['technical']], 'the process asks for rounds the kit has no questions for: run the default interview instead of an empty one');
  const thin = planMock(makeKit({ requirements: [], questions: [], flashcards: [] }));
  assert.deepEqual([thin.rounds, thin.total_questions, thin.total_minutes], [[], 0, 0]);
});

test('each question appears at most once; rounds are capped; easier questions come first within a round', () => {
  const questions = [q('a', 'technical', ['r1'], 3), q('b', 'technical', ['r2'], 1), q('c', 'technical', ['r1', 'r2'], 2), q('d', 'technical', ['r1'], 2), q('e', 'technical', ['r2'], 2)];
  const plan = planMock(makeKit({ questions }));
  const all = plan.rounds.flatMap((r) => r.question_ids);
  assert.equal(new Set(all).size, all.length);
  assert.equal(plan.rounds[0].question_ids.length, 3);
  const diff = (id) => questions.find((x) => x.id === id).difficulty;
  const d = plan.rounds[0].question_ids.map(diff);
  assert.deepEqual(d, [...d].sort((x, y) => x - y));
  assert.equal(planMock(makeKit({ questions }), { perRound: 5 }).rounds[0].question_ids.length, 5);
});

test('selection prefers questions that cover MUST-HAVE requirements not yet covered', () => {
  const questions = [q('nice1', 'technical', ['r4'], 1), q('must1', 'technical', ['r1'], 3), q('must2', 'technical', ['r2'], 3), q('dup', 'technical', ['r1'], 1)];
  const picked = planMock(makeKit({ questions }), { perRound: 2 }).rounds[0].question_ids;
  const covers = new Set(picked.flatMap((id) => questions.find((x) => x.id === id).requirement_ids));
  assert.ok(covers.has('r1') && covers.has('r2'), 'both must-haves are covered');
  assert.ok(!picked.includes('nice1'), 'the nice-to-have question is not chosen over must-have coverage');
});

test('planning is deterministic', () => {
  const kit = makeKit();
  assert.deepEqual(planMock(kit), planMock(structuredClone(kit)));
});

// ---------------- checklist and scoring ----------------
test('splitOutline: bullets, numbered lists, one-line sentences, empty outline, cap of 8', () => {
  assert.deepEqual(splitOutline('- First point\n- Second point\n* Third'), ['First point', 'Second point', 'Third']);
  assert.deepEqual(splitOutline('1. Alpha\n2) Beta'), ['Alpha', 'Beta']);
  assert.deepEqual(splitOutline('Clarify scope. Sketch components; Discuss trade-offs.'), ['Clarify scope.', 'Sketch components;', 'Discuss trade-offs.']);
  assert.deepEqual(splitOutline('   '), ['My answer was complete and specific']);
  assert.equal(splitOutline(Array.from({ length: 12 }, (_, i) => `p${i}`).join('\n')).length, 8);
});

test('scoreAnswer: fraction ticked; skipped = 0; empty checklist = 0', () => {
  assert.equal(scoreAnswer([true, false, true, true], 4), 0.75);
  assert.equal(scoreAnswer([true, true], 2, true), 0);
  assert.equal(scoreAnswer([], 0), 0);
  assert.equal(scoreAnswer([true, true, true], 2), 1, 'extra ticks beyond the checklist are ignored');
});

// ---------------- report ----------------
const attempt = (id, overall, answers, extra = {}) => ({ id, saved_at: `2026-10-1${id.slice(-1)}T00:00:00Z`, completed: true, basis: 'default', rounds: [{ id: 'technical', title: 'Technical interview', question_ids: answers.map((a) => a.question_id) }], answers, overall, ...extra });
const ans = (question_id, score, extra = {}) => ({ question_id, round_id: 'technical', prompt: `Prompt ${question_id}?`, answer_text: 'x', covered: [], seconds: 120, skipped: false, score, ...extra });

test('report: weakest requirements first, unasked must-haves listed, weakest questions, round scores, time, trend oldest -> newest', () => {
  const kit = makeKit();
  const latest = attempt('m-2', 0.5, [ans('q1', 0.2), ans('q2', 0.8), ans('q3', 0.5, { skipped: true, score: 0 })]);
  const first = attempt('m-1', 0.3, [ans('q1', 0.3)]);
  const rep = summarizeMock(kit, [latest, first]);
  assert.equal(rep.attempts, 2);
  assert.deepEqual(rep.trend.map((t) => t.id), ['m-1', 'm-2']);
  const L = rep.latest;
  assert.deepEqual(L.by_requirement.map((r) => r.id), ['r1', 'r2'], 'r1 (q1 0.2, q3 0) is weaker than r2');
  assert.ok(L.by_requirement[0].score < L.by_requirement[1].score);
  assert.deepEqual(L.unasked_musts.map((r) => r.id), ['r3'], 'r3 is a must-have that no asked question covers');
  assert.deepEqual(L.weakest.map((w) => w.question_id), ['q3', 'q1']);
  assert.equal(L.by_round[0].answered, 2);
  assert.equal(L.seconds_used, 360);
  assert.equal(L.seconds_suggested, (MINUTES_PER_QUESTION[2] + MINUTES_PER_QUESTION[2] + MINUTES_PER_QUESTION[3]) * 60);
  assert.deepEqual(summarizeMock(kit, []), { attempts: 0, latest: null, trend: [] });
});

// ---------------- API ----------------
let server, base, repos;
before(() => { repos = createMemoryRepos(); server = createApp({ repos }).listen(0); base = `http://127.0.0.1:${server.address().port}/api`; });
after(() => server.close());
let n = 0;
async function setup() {
  const c = apiClient(base);
  const { body } = await c.call('/auth/register', { method: 'POST', body: { email: `m${++n}-${Math.random().toString(36).slice(2)}@x.com`, password: 'password123' } });
  const rec = await repos.kits.create({ userId: body.user.id, title: 'Kit', inputHash: `h${Math.random()}`, input: { jd: 'jd', company_url: 'https://acme.test/', days: 3 } });
  await repos.kits.claim(rec.id);
  await repos.kits.finish(rec.id, 1, makeKit({ questions: [q('q1', 'technical', ['r1']), q('q2', 'technical', ['r2']), q('q3', 'behavioural', ['r3']), q('q4', 'company-fit', ['r4'])] }));
  return { c, id: rec.id };
}
const save = (c, id, body) => c.call(`/kits/${id}/mock/attempts`, { method: 'POST', body });
const good = (over = {}) => ({
  completed: true, basis: 'default', rounds: [{ id: 'technical', question_ids: ['q1', 'q2'] }],
  answers: [
    { question_id: 'q1', round_id: 'technical', answer_text: 'My answer', covered: [true, true, false, false], seconds: 90, skipped: false },
    { question_id: 'q2', round_id: 'technical', answer_text: '', covered: [], seconds: 5, skipped: true },
  ], ...over,
});

test('API: an attempt is saved with SERVER-computed scores and a report', async () => {
  const { c, id } = await setup();
  const r = await save(c, id, good({ overall: 1, answers: good().answers.map((a) => ({ ...a, score: 1 })) })); // client-supplied scores are ignored
  assert.equal(r.status, 201);
  assert.deepEqual(r.body.attempt.answers.map((a) => a.score), [0.5, 0]);
  assert.equal(r.body.attempt.overall, 0.25);
  assert.equal(r.body.attempt.rounds[0].title, 'Technical interview');
  assert.equal(r.body.report.latest.overall, 0.25);
  const got = (await c.call(`/kits/${id}/mock`)).body;
  assert.equal(got.attempts.length, 1);
  assert.equal(got.report.latest.weakest[0].skipped, true);
});

test('API: ticks beyond the checklist are ignored, short arrays are padded; a skipped question cannot score even if boxes were ticked', async () => {
  const { c, id } = await setup();
  const r = await save(c, id, good({ answers: [
    { question_id: 'q1', round_id: 'technical', answer_text: 'a', covered: [true, true, true, true, true, true, true, true], seconds: 10, skipped: false },
    { question_id: 'q2', round_id: 'technical', answer_text: 'b', covered: [true], seconds: 10, skipped: true },
  ] }));
  assert.deepEqual(r.body.attempt.answers.map((a) => [a.covered.length, a.score]), [[4, 1], [4, 0]]);
});

test('API: validation (empty answers, bad seconds, huge text, unknown round) 400; unknown question 404', async () => {
  const { c, id } = await setup();
  for (const bad of [good({ answers: [] }), good({ answers: [{ ...good().answers[0], seconds: -1 }] }), good({ answers: [{ ...good().answers[0], answer_text: 'x'.repeat(4001) }] }), good({ rounds: [{ id: 'astrology', question_ids: [] }] }), { completed: true }]) {
    assert.equal((await save(c, id, bad)).status, 400);
  }
  assert.equal((await save(c, id, good({ answers: [{ ...good().answers[0], question_id: 'ghost' }] }))).status, 404);
});

test('API: only the latest 10 attempts are kept; ownership, auth and readiness are enforced; reset clears', async () => {
  const a = await setup();
  for (let i = 0; i < 11; i++) await save(a.c, a.id, good());
  const got = (await a.c.call(`/kits/${a.id}/mock`)).body;
  assert.equal(got.attempts.length, 10);
  assert.equal(got.report.attempts, 10);

  const b = apiClient(base);
  await b.call('/auth/register', { method: 'POST', body: { email: `z${++n}-${Math.random()}@x.com`, password: 'password123' } });
  assert.equal((await b.call(`/kits/${a.id}/mock`)).status, 404);
  assert.equal((await save(b, a.id, good())).status, 404);
  assert.equal((await b.call(`/kits/${a.id}/mock`, { method: 'DELETE' })).status, 404);
  assert.equal((await save(apiClient(base), a.id, good())).status, 401);

  assert.equal((await a.c.call(`/kits/${a.id}/mock`, { method: 'DELETE' })).status, 204);
  assert.deepEqual((await a.c.call(`/kits/${a.id}/mock`)).body, { attempts: [], report: { attempts: 0, latest: null, trend: [] } });

  const pending = await repos.kits.create({ userId: (await repos.kits.findById(a.id)).userId, title: 'p', inputHash: `p${Math.random()}`, input: { jd: 'x', company_url: 'http://x', days: 1 } });
  assert.equal((await save(a.c, pending.id, good())).body.error.code, 'KIT_NOT_READY');
});

test('API: an answer for a question deleted after the attempt still shows in the report via its saved prompt', async () => {
  const { c, id } = await setup();
  await save(c, id, good());
  const rec = await repos.kits.findById(id);
  rec.kit.questions = rec.kit.questions.filter((x) => x.id !== 'q2');
  const got = (await c.call(`/kits/${id}/mock`)).body;
  assert.equal(got.report.latest.weakest.some((w) => w.prompt === 'Prompt q2?'), true);
});
