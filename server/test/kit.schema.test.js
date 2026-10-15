import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateKit } from '../src/schema/kit.js';

const validKit = () => ({
  source: { company: 'Acme', company_url: 'http://x', role: 'BE', location: '', jd_chars: 10, researched_at: '2026-01-01T00:00:00Z', pages_used: [] },
  company_brief: { summary: '', what_they_do: '', sources: [] },
  role: { title: 'BE', seniority: 'senior', responsibilities: [], requirements: [{ id: 'r1', text: '5+ years React', kind: 'technical', priority: 'must' }] },
  questions: [{ id: 'q1', requirement_ids: ['r1'], category: 'technical', prompt: 'Explain hooks', answer_outline: '', difficulty: 2 }],
  flashcards: [{ id: 'f1', front: 'a', back: 'b', requirement_ids: ['r1'] }],
  schedule: { days_available: 1, days: [{ day: 1, focus: 'React', question_ids: ['q1'], minutes: 60 }] },
  coverage: { uncovered_requirement_ids: [], passes: 1 },
});

test('accepts a valid kit', () => assert.equal(validateKit(validKit()).ok, true));

test('rejects float minutes', () => {
  const k = validKit(); k.schedule.days[0].minutes = 59.5;
  assert.equal(validateKit(k).ok, false);
});

test('rejects difficulty out of range', () => {
  const k = validKit(); k.questions[0].difficulty = 4;
  assert.equal(validateKit(k).ok, false);
});

test('rejects dangling schedule question id', () => {
  const k = validKit(); k.schedule.days[0].question_ids = ['q99'];
  const r = validateKit(k);
  assert.equal(r.ok, false);
  assert.match(r.errors.join(), /unknown question q99/);
});

test('rejects question referencing unknown requirement', () => {
  const k = validKit(); k.questions[0].requirement_ids = ['r9'];
  assert.equal(validateKit(k).ok, false);
});

test('rejects schedule length != days_available', () => {
  const k = validKit(); k.schedule.days_available = 3;
  assert.equal(validateKit(k).ok, false);
});
