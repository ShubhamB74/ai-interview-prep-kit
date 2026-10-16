import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkCoverage } from '../src/pipeline/checkCoverage.js';
import { MAX_REPAIR_ROUNDS, nextQuestionId, runCoverageLoop, templateQuestion } from '../src/pipeline/coverageLoop.js';

const R = (id, priority = 'must', kind = 'technical') => ({ id, text: `Requirement ${id}`, kind, priority });
const Q = (id, ...reqIds) => ({ id, requirement_ids: reqIds, category: 'technical', prompt: `Prompt ${id}`, answer_outline: '', difficulty: 2 });
const fresh = (req, n = 1) => Array.from({ length: n }, (_, i) => ({ requirement_ids: [req], category: 'technical', prompt: `Filled ${req} #${i}`, answer_outline: 'o', difficulty: 2 }));

test('checkCoverage: finds gaps by id, separates must from nice, ignores unknown ids', () => {
  const reqs = [R('r1'), R('r2'), R('r3', 'nice')];
  assert.deepEqual(checkCoverage({ requirements: reqs, questions: [Q('q1', 'r1', 'r99')] }), { uncovered: ['r2', 'r3'], uncoveredMust: ['r2'] });
  assert.deepEqual(checkCoverage({ requirements: reqs, questions: [Q('q1', 'r1', 'r2', 'r3')] }), { uncovered: [], uncoveredMust: [] });
  assert.deepEqual(checkCoverage({ requirements: [], questions: [] }), { uncovered: [], uncoveredMust: [] });
});

test('loop: full coverage -> one check, fill never called', async () => {
  let calls = 0;
  const r = await runCoverageLoop({ requirements: [R('r1')], questions: [Q('q1', 'r1')], fill: async () => { calls++; return []; } });
  assert.equal(calls, 0);
  assert.deepEqual(r.coverage, { uncovered_requirement_ids: [], passes: 1 });
});

test('loop: a gap triggers generation and a second check (passes = 2); new ids continue the sequence', async () => {
  const seen = [];
  const r = await runCoverageLoop({
    requirements: [R('r1'), R('r2')], questions: [Q('q1', 'r1'), Q('q7', 'r1')],
    fill: async ({ requirements, round }) => { seen.push([round, requirements.map((x) => x.id)]); return fresh('r2'); },
  });
  assert.deepEqual(seen, [[1, ['r2']]]);
  assert.equal(r.coverage.passes, 2);
  assert.deepEqual(r.coverage.uncovered_requirement_ids, []);
  assert.equal(r.questions.at(-1).id, 'q8');
  assert.equal(r.questions.at(-1).origin, 'generated');
  assert.deepEqual(r.templated, []);
});

test('loop: a persistent must-have gap escalates each round and stops at the cap; then a template guarantees coverage', async () => {
  const rounds = [];
  const r = await runCoverageLoop({
    requirements: [R('r1'), R('r2')], questions: [Q('q1', 'r1')],
    fill: async ({ round }) => { rounds.push(round); return []; }, // the model never delivers
  });
  assert.deepEqual(rounds, [1, 2, 3]);
  assert.equal(rounds.length, MAX_REPAIR_ROUNDS);
  assert.deepEqual(r.templated, ['r2']);
  const t = r.questions.at(-1);
  assert.equal(t.template, true);
  assert.deepEqual(t.requirement_ids, ['r2']);
  assert.deepEqual(r.coverage.uncovered_requirement_ids, []);
  assert.equal(r.coverage.passes, 5); // initial + 3 repair rounds + final check after templating
});

test('loop: nice-to-have gaps are attempted once (round 1) and then REPORTED, not forced', async () => {
  const rounds = [];
  const r = await runCoverageLoop({
    requirements: [R('r1'), R('r2', 'nice')], questions: [Q('q1', 'r1')],
    fill: async ({ round }) => { rounds.push(round); return []; },
  });
  assert.deepEqual(rounds, [1]);
  assert.deepEqual(r.coverage.uncovered_requirement_ids, ['r2']);
  assert.deepEqual(r.templated, []);
});

test('loop: round 2 only targets must-haves still uncovered', async () => {
  const targets = [];
  await runCoverageLoop({
    requirements: [R('r1'), R('r2'), R('r3', 'nice')], questions: [],
    fill: async ({ requirements, round }) => { targets.push(requirements.map((x) => x.id)); return round === 1 ? fresh('r1') : []; },
  });
  assert.deepEqual(targets, [['r1', 'r2', 'r3'], ['r2'], ['r2']]);
});

test('loop: a fatal LLM error stops further rounds immediately and falls back to templates', async () => {
  let calls = 0;
  const r = await runCoverageLoop({
    requirements: [R('r1')], questions: [],
    fill: async () => { calls++; throw Object.assign(new Error('quota'), { code: 'LLM_QUOTA_EXHAUSTED' }); },
  });
  assert.equal(calls, 1);
  assert.deepEqual(r.templated, ['r1']);
  assert.equal(r.errors[0].code, 'LLM_QUOTA_EXHAUSTED');
});

test('loop: a transient error is recorded and the next round still runs', async () => {
  let calls = 0;
  const r = await runCoverageLoop({
    requirements: [R('r1')], questions: [],
    fill: async () => { if (++calls === 1) throw Object.assign(new Error('blip'), { code: 'LLM_UNAVAILABLE' }); return fresh('r1'); },
  });
  assert.equal(calls, 2);
  assert.deepEqual(r.templated, []);
  assert.equal(r.errors.length, 1);
});

test('template questions reference exactly their requirement and fit its kind', () => {
  assert.equal(templateQuestion(R('r5', 'must', 'behavioural')).category, 'behavioural');
  assert.equal(templateQuestion(R('r5', 'must', 'domain')).category, 'company-fit');
  assert.match(templateQuestion(R('r5')).prompt, /Requirement r5/);
  assert.equal(nextQuestionId([]), 'q1');
});
