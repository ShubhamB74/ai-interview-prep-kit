import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allocateSchedule, questionMinutes } from '../src/pipeline/allocateSchedule.js';

// deterministic PRNG so "random" cases are reproducible
function rng(seed) { let s = seed; return () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296); }

function build(N, nReq, rand) {
  const requirements = Array.from({ length: nReq }, (_, i) => ({ id: `r${i + 1}`, text: `Requirement number ${i + 1}`, kind: 'technical', priority: rand() < 0.6 ? 'must' : 'nice' }));
  const questions = Array.from({ length: N }, (_, i) => ({
    id: `q${i + 1}`, category: ['technical', 'behavioural', 'system-design'][i % 3], prompt: `p${i}`, answer_outline: '',
    difficulty: 1 + Math.floor(rand() * 3), requirement_ids: [`r${1 + (i % nReq)}`].concat(rand() < 0.2 ? [`r${1 + Math.floor(rand() * nReq)}`] : []),
  }));
  return { requirements, questions };
}

function assertInvariants({ requirements, questions }, D, sched) {
  const label = `N=${questions.length} D=${D}`;
  assert.equal(sched.days_available, D, label);
  assert.equal(sched.days.length, D, `${label}: day count`);
  assert.deepEqual(sched.days.map((d) => d.day), Array.from({ length: D }, (_, i) => i + 1), label);
  const qIds = new Set(questions.map((q) => q.id));
  const firstDay = new Map();
  for (const d of sched.days) {
    assert.ok(Number.isInteger(d.minutes) && d.minutes >= 0, `${label}: integer minutes`);
    assert.equal(typeof d.focus, 'string');
    assert.ok(d.focus.length > 0);
    if (questions.length) assert.ok(d.question_ids.length > 0, `${label}: day ${d.day} is empty`);
    for (const id of d.question_ids) { assert.ok(qIds.has(id), `${label}: unknown question ${id}`); if (!firstDay.has(id)) firstDay.set(id, d.day); }
  }
  for (const q of questions) assert.ok(firstDay.has(q.id), `${label}: ${q.id} never scheduled`);
  // every must-have that has a question appears in the schedule
  const scheduled = new Set(sched.days.flatMap((d) => d.question_ids));
  for (const r of requirements.filter((x) => x.priority === 'must')) {
    const qs = questions.filter((q) => q.requirement_ids.includes(r.id));
    if (qs.length) assert.ok(qs.some((q) => scheduled.has(q.id)), `${label}: must ${r.id} missing`);
  }
  // harder / higher-priority first: must-covering questions are first studied no later than nice-only ones
  const must = new Set(requirements.filter((r) => r.priority === 'must').map((r) => r.id));
  const mustDays = questions.filter((q) => q.requirement_ids.some((id) => must.has(id))).map((q) => firstDay.get(q.id));
  const niceDays = questions.filter((q) => !q.requirement_ids.some((id) => must.has(id))).map((q) => firstDay.get(q.id));
  if (mustDays.length && niceDays.length) assert.ok(Math.max(...mustDays) <= Math.max(...niceDays), `${label}: must material not ahead of nice`);
  if (mustDays.length && niceDays.length) assert.ok(Math.min(...mustDays) <= Math.min(...niceDays), `${label}: first must day <= first nice day`);
  // within a priority tier, harder questions are first studied no later than easier ones
  for (const tier of [questions.filter((q) => q.requirement_ids.some((id) => must.has(id))), questions.filter((q) => !q.requirement_ids.some((id) => must.has(id)))]) {
    for (const a of tier) for (const b of tier) {
      if (a.difficulty > b.difficulty) assert.ok(firstDay.get(a.id) <= firstDay.get(b.id), `${label}: harder ${a.id} studied after easier ${b.id}`);
    }
  }
}

test('invariants hold across many question/day shapes (incl. 1 day, 60 days, more days than questions)', () => {
  const rand = rng(42);
  for (let N = 0; N <= 24; N += 1) {
    for (const D of [1, 2, 3, 5, 7, 14, 30, 60]) {
      const data = build(N, Math.max(1, Math.min(N, 6)), rand);
      assertInvariants(data, D, allocateSchedule({ ...data, daysAvailable: D }));
    }
  }
});

test('1-day schedule: everything on day 1, minutes = sum of question minutes', () => {
  const data = build(6, 3, rng(1));
  const s = allocateSchedule({ ...data, daysAvailable: 1 });
  assert.equal(s.days.length, 1);
  assert.equal(s.days[0].question_ids.length, 6);
  assert.equal(s.days[0].minutes, data.questions.reduce((n, q) => n + questionMinutes(q), 0));
});

test('60 days with 12 questions: every question studied once, then review days cycle through them', () => {
  const data = build(12, 4, rng(2));
  const s = allocateSchedule({ ...data, daysAvailable: 60 });
  assert.equal(s.days.length, 60);
  assert.equal(s.days.filter((d) => d.type === 'study').length, 12);
  assert.equal(s.days.filter((d) => d.type === 'review').length, 48);
  assert.ok(s.days.slice(12).every((d) => d.focus.startsWith('Review: ')));
  assert.ok(s.days.slice(0, 12).every((d) => d.type === 'study'));
});

test('hardest must-have material lands on day 1; the last study day is the lightest tier', () => {
  const requirements = [{ id: 'r1', text: 'Core skill', kind: 'technical', priority: 'must' }, { id: 'r2', text: 'Bonus skill', kind: 'technical', priority: 'nice' }];
  const mk = (id, req, difficulty) => ({ id, requirement_ids: [req], category: 'technical', prompt: id, answer_outline: '', difficulty });
  // deliberately listed in the "wrong" order
  const questions = [mk('q1', 'r2', 3), mk('q2', 'r1', 1), mk('q3', 'r1', 3), mk('q4', 'r2', 1)];
  const s = allocateSchedule({ questions, requirements, daysAvailable: 4 });
  assert.deepEqual(s.days.map((d) => d.question_ids[0]), ['q3', 'q2', 'q1', 'q4']);
});

test('study time is balanced: no study day exceeds about twice the average', () => {
  const data = build(20, 5, rng(7));
  const s = allocateSchedule({ ...data, daysAvailable: 5 });
  const avg = s.days.reduce((n, d) => n + d.minutes, 0) / 5;
  for (const d of s.days) assert.ok(d.minutes <= avg * 2, `day ${d.day}: ${d.minutes} vs avg ${avg}`);
});

test('no questions (thin posting): exactly the requested days, empty, with an honest focus', () => {
  const s = allocateSchedule({ questions: [], requirements: [], daysAvailable: 3 });
  assert.equal(s.days.length, 3);
  assert.ok(s.days.every((d) => d.minutes === 0 && d.question_ids.length === 0 && /too little/.test(d.focus)));
});

test('rejects invalid day counts', () => {
  for (const bad of [0, -1, 2.5, NaN, '5']) assert.throws(() => allocateSchedule({ questions: [], requirements: [], daysAvailable: bad }), RangeError);
});

test('focus names the requirements and categories covered that day', () => {
  const requirements = [{ id: 'r1', text: '5+ years React', kind: 'technical', priority: 'must' }];
  const questions = [{ id: 'q1', requirement_ids: ['r1'], category: 'system-design', prompt: 'p', answer_outline: '', difficulty: 2 }];
  assert.equal(allocateSchedule({ questions, requirements, daysAvailable: 1 }).days[0].focus, 'System design: 5+ years React');
});
