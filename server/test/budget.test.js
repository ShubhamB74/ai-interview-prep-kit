import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runPipeline } from '../src/pipeline/index.js';
import { evaluateCases } from '../src/cli/evaluateCore.js';
import { TimeBudget } from '../src/lib/timeBudget.js';
import { validateKit } from '../src/schema/kit.js';
import { createMockLlm } from '../test-support/mockLlm.js';

const JD = `Senior Backend Engineer at Acme
Requirements:
- 5+ years Node.js
- Experience mentoring junior engineers
We build payment rails for small banks and care a lot about reliability and happy customers every day.`;
const handlers = () => ({
  extract_requirements: () => ({ company: 'Acme', title: 'Senior Backend Engineer', seniority: 'senior', requirements: [
    { text: '5+ years Node.js', kind: 'technical', priority: 'must', evidence: '5+ years Node.js' },
    { text: 'Mentoring junior engineers', kind: 'behavioural', priority: 'must', evidence: 'Experience mentoring junior engineers' } ] }),
  company_brief: () => ({ summary: 's', what_they_do: 'w', source_urls: [] }),
  questions: ({ name, user }) => ({ questions: [...user.matchAll(/^(r\d+):/gm)].map((m) => ({ requirement_ids: [m[1]], prompt: `${name} q ${m[1]}?`, answer_outline: 'o', difficulty: 2 })) }),
  flashcards: ({ user }) => ({ flashcards: [...user.matchAll(/^(r\d+):/gm)].map((m) => ({ front: `Card ${m[1]}`, back: 'A short answer', requirement_ids: [m[1]] })) }),
});
const home = { url: 'https://acme.test/', kind: 'home', title: 'Acme', text: 'Acme builds payment rails for small banks. '.repeat(6), hiring_score: 0 };
const research = async () => ({ company: 'Acme', crawl: { reachable: true, pages: [home], skipped: [], hiringPage: null }, discussion: { searched: true, found: false, snippets: [], skipped: [] }, gaps: [], pagesUsed: [home.url], skipped: [] });
const upTo = (limit) => ({ exceeded: (f) => f <= limit, elapsedFraction: () => limit });

test('TimeBudget reports the fraction of the budget used', () => {
  let t = 1000;
  const b = new TimeBudget({ budgetMs: 100, now: () => t });
  assert.equal(b.exceeded(0.5), false);
  t = 1060;
  assert.equal(b.exceeded(0.5), true);
  assert.equal(b.exceeded(0.7), false);
});

test('running late (>=55% used): flashcards are skipped and the kit says so; everything else is intact', async () => {
  const kit = await runPipeline({ jd: JD, companyUrl: 'https://acme.test', days: 3, llm: createMockLlm(handlers()), research, budget: upTo(0.6) });
  assert.equal(kit.flashcards.length, 0);
  assert.ok(kit.questions.length >= 2);
  assert.ok(kit.research.gaps.some((g) => /flashcards.*time budget/.test(g)));
  assert.equal(validateKit(kit).ok, true);
});

test('badly late (budget exhausted): categories and repair are skipped, yet every must-have is still covered and scheduled', async () => {
  const llm = createMockLlm(handlers());
  const kit = await runPipeline({ jd: JD, companyUrl: 'https://acme.test', days: 4, llm, research, budget: upTo(1) });
  assert.deepEqual(llm.calls.map((c) => c.name), ['extract_requirements', 'company_brief']); // nothing optional was attempted
  assert.deepEqual(kit.coverage.uncovered_requirement_ids, []);
  assert.deepEqual(kit.questions.map((q) => q.template), [true, true]);
  assert.equal(kit.schedule.days.length, 4);
  assert.ok(kit.research.gaps.some((g) => /time budget/.test(g)));
  assert.equal(validateKit(kit).ok, true);
});

test('no budget (default): nothing is skipped', async () => {
  const kit = await runPipeline({ jd: JD, companyUrl: 'https://acme.test', days: 3, llm: createMockLlm(handlers()), research });
  assert.ok(kit.flashcards.length > 0);
  assert.equal(kit.research.gaps.some((g) => /time budget/.test(g)), false);
});

test('evaluate: the remaining time is shared by the remaining cases (with a floor), so a slow case cannot starve the rest', async () => {
  let t = 0;
  const budgets = [];
  const cases = Array.from({ length: 4 }, (_, i) => ({ id: `c${i}`, jd: 'x', company_url: 'u', days: 1 }));
  await evaluateCases(cases, { totalBudgetMs: 400_000, now: () => t, pipeline: async ({ budgetMs }) => { budgets.push(budgetMs); t += 40_000; throw new Error('stop'); } });
  assert.deepEqual(budgets, [100_000, 120_000, 160_000, 280_000]);

  const floor = [];
  t = 0;
  await evaluateCases(cases, { totalBudgetMs: 60_000, now: () => t, pipeline: async ({ budgetMs }) => { floor.push(budgetMs); t += 50_000; throw new Error('stop'); } });
  assert.ok(floor.every((b) => b >= 30_000));
});

test('evaluate without a total budget passes none', async () => {
  const seen = [];
  await evaluateCases([{ id: 'a', jd: 'x', company_url: 'u', days: 1 }], { pipeline: async ({ budgetMs }) => { seen.push(budgetMs); throw new Error('stop'); } });
  assert.deepEqual(seen, [undefined]);
});
