import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runPipeline } from '../src/pipeline/index.js';
import { validateKit } from '../src/schema/kit.js';
import { createMockLlm } from '../test-support/mockLlm.js';

const JD = `Senior Backend Engineer at Acme
Requirements:
- 5+ years Node.js
- Experience mentoring junior engineers
- Knowledge of payments
Nice to have:
- Kubernetes
We build payment rails for small banks and care a lot about reliability and happy customers.`;

const reqOut = { company: 'Acme', title: 'Senior Backend Engineer', seniority: 'senior', location: 'Berlin', responsibilities: ['Build services'], requirements: [
  { text: '5+ years Node.js', kind: 'technical', priority: 'must', evidence: '5+ years Node.js' },
  { text: 'Mentoring junior engineers', kind: 'behavioural', priority: 'must', evidence: 'Experience mentoring junior engineers' },
  { text: 'Payments knowledge', kind: 'domain', priority: 'must', evidence: 'Knowledge of payments' },
  { text: 'Kubernetes', kind: 'technical', priority: 'nice', evidence: 'Kubernetes' },
] };
const idsIn = (user) => [...user.matchAll(/^(r\d+):/gm)].map((m) => m[1]);
const questionsFor = ({ name, user }) => ({ questions: idsIn(user).map((id) => ({ requirement_ids: [id], prompt: `${name} question about ${id}?`, answer_outline: 'o', difficulty: 2 })) });

const handlers = (over = {}) => ({
  extract_requirements: () => reqOut,
  company_brief: () => ({ summary: 'Acme builds payment rails.', what_they_do: 'Payments.', source_urls: ['https://acme.test/'] }),
  questions: questionsFor,
  flashcards: ({ user }) => ({ flashcards: idsIn(user).map((id) => ({ front: `Card ${id}`, back: 'a', requirement_ids: [id] })) }),
  ...over,
});
const home = { url: 'https://acme.test/', kind: 'home', title: 'Acme', text: 'Acme builds payment rails for small banks. '.repeat(6), hiring_score: 0 };
const research = (pages = [home], { reachable = true, snippets = [] } = {}) => async () => ({
  company: 'Acme', crawl: { reachable, pages, skipped: reachable ? [] : [{ url: 'http://x', code: 'NETWORK', reason: 'down', attempts: 3 }], hiringPage: null },
  discussion: { searched: true, found: snippets.length > 0, snippets, skipped: [] },
  gaps: [...(reachable ? ['No page describing the hiring or interview process was found on the company site.'] : ['The company site could not be retrieved (NETWORK: down).']), ...(snippets.length ? [] : ['No public discussion of this company’s interview process was found.'])],
  pagesUsed: pages.map((p) => p.url), skipped: reachable ? [] : [{ url: 'http://x', code: 'NETWORK', reason: 'down', attempts: 3 }],
});
const run = (days, llm, res = research(), jd = JD) => runPipeline({ jd, companyUrl: 'https://acme.test', days, llm, research: res });
const mustIds = (kit) => kit.role.requirements.filter((r) => r.priority === 'must').map((r) => r.id);

test('end to end: a valid Appendix A kit, schedule spans exactly the requested days, all must-haves covered AND scheduled', async () => {
  for (const days of [1, 5, 30]) {
    const kit = await run(days, createMockLlm(handlers()));
    assert.equal(validateKit(kit).ok, true, `days=${days}`);
    assert.equal(kit.schedule.days_available, days);
    assert.equal(kit.schedule.days.length, days);
    assert.deepEqual(kit.coverage.uncovered_requirement_ids, []);
    const scheduled = new Set(kit.schedule.days.flatMap((d) => d.question_ids));
    for (const id of mustIds(kit)) assert.ok(kit.questions.some((q) => q.requirement_ids.includes(id) && scheduled.has(q.id)), `${id} (days=${days})`);
  }
});

test('second pass: a requirement the model skipped is found by code and filled, passes = 2', async () => {
  let behavioural = 0;
  const llm = createMockLlm(handlers({ 'questions:behavioural': (a) => (++behavioural === 1 ? { questions: [] } : questionsFor(a)) }));
  const kit = await run(3, llm);
  assert.equal(kit.coverage.passes, 2);
  assert.deepEqual(kit.coverage.uncovered_requirement_ids, []);
  assert.ok(kit.questions.some((q) => q.requirement_ids.includes('r2')));
  assert.equal(kit.questions.some((q) => q.template), false);
  assert.equal(behavioural, 2);
});

test('model never produces a question for a must-have -> bounded retries, then a flagged template; kit says so', async () => {
  let calls = 0;
  const llm = createMockLlm(handlers({ 'questions:behavioural': () => { calls++; return { questions: [] }; } }));
  const kit = await run(3, llm);
  assert.equal(calls, 4); // draft + 3 repair rounds, never more
  const t = kit.questions.find((q) => q.template);
  assert.deepEqual(t.requirement_ids, ['r2']);
  assert.deepEqual(kit.coverage.uncovered_requirement_ids, []);
  assert.ok(kit.research.gaps.some((g) => /template/.test(g) && /r2/.test(g)));
});

test('quota exhausted during gap filling: stops calling the model, still ships a covered kit', async () => {
  let behavioural = 0;
  const llm = createMockLlm(handlers({ 'questions:behavioural': (a) => {
    if (++behavioural === 1) return { questions: [] };
    throw Object.assign(new Error('quota'), { code: 'LLM_QUOTA_EXHAUSTED' });
  } }));
  const kit = await run(3, llm);
  assert.equal(behavioural, 2);
  assert.deepEqual(kit.coverage.uncovered_requirement_ids, []);
  assert.ok(kit.research.gaps.some((g) => /LLM_QUOTA_EXHAUSTED/.test(g)));
});

test('a nice-to-have that never gets a question is reported in coverage and gaps, not forced', async () => {
  const llm = createMockLlm(handlers({ questions: (a) => ({ questions: questionsFor(a).questions.filter((q) => q.requirement_ids[0] !== 'r4') }) }));
  const kit = await run(3, llm);
  assert.deepEqual(kit.coverage.uncovered_requirement_ids, ['r4']);
  assert.equal(kit.questions.some((q) => q.template), false);
  assert.ok(kit.research.gaps.some((g) => /nice-to-have/.test(g) && /r4/.test(g)));
  assert.equal(validateKit(kit).ok, true);
});

test('thin two-line posting: a thin kit that says so, requested day count kept, nothing invented', async () => {
  const llm = createMockLlm(handlers({ extract_requirements: () => ({ title: 'Backend dev', requirements: [{ text: 'Rust', kind: 'technical', priority: 'must', evidence: 'Rust and Kafka expertise' }] }) }));
  const kit = await run(4, llm, research(), 'Backend dev wanted.\nApply now.');
  assert.equal(kit.role.requirements.length, 0);
  assert.equal(kit.questions.length, 0);
  assert.equal(kit.schedule.days.length, 4);
  assert.equal(kit.research.thin_description, true);
  assert.ok(kit.research.gaps.some((g) => /very short/.test(g)));
  assert.equal(validateKit(kit).ok, true);
});

test('company site unreachable: still ok, honest empty brief, gaps and skipped sources recorded', async () => {
  const llm = createMockLlm(handlers());
  const kit = await run(3, llm, research([], { reachable: false }));
  assert.equal(llm.calls.some((c) => c.name === 'company_brief'), false);
  assert.deepEqual(kit.company_brief.sources, []);
  assert.match(kit.company_brief.summary, /intentionally empty/);
  assert.ok(kit.research.gaps.some((g) => /could not be retrieved/.test(g)));
  assert.deepEqual(kit.research.skipped_sources[0], { url: 'http://x', code: 'NETWORK', reason: 'down' });
  assert.ok(kit.questions.length > 0);
});

test('site with no hiring page: kit says so and no process is assumed', async () => {
  const kit = await run(3, createMockLlm(handlers()));
  assert.equal(kit.research.hiring_page, null);
  assert.deepEqual([kit.research.hiring_process.known, kit.research.hiring_process.confidence], [false, 'none']);
  assert.ok(kit.research.gaps.some((g) => /hiring or interview process/.test(g)));
});

test('invalid input is rejected before any work', async () => {
  const llm = createMockLlm(handlers());
  for (const bad of [{ jd: '  ', days: 3 }, { jd: JD, days: 0 }, { jd: JD, days: 2.5 }]) {
    await assert.rejects(runPipeline({ companyUrl: 'https://acme.test', llm, research: research(), ...bad }), { code: 'INVALID_INPUT' });
  }
  assert.equal(llm.calls.length, 0);
});

test('extraction failure is fatal and keeps its error code (so the batch records the right reason)', async () => {
  const llm = createMockLlm(handlers({ extract_requirements: () => { throw Object.assign(new Error('rate limited'), { code: 'LLM_RATE_LIMITED' }); } }));
  await assert.rejects(run(3, llm), { code: 'LLM_RATE_LIMITED' });
});

test('source block is filled from the posting and research', async () => {
  const kit = await run(2, createMockLlm(handlers()), research([home], { snippets: [{ url: 'https://news.ycombinator.com/item?id=1', text: 'Acme interview: onsite.', source: 'hackernews' }] }));
  assert.equal(kit.source.company, 'Acme');
  assert.equal(kit.source.role, 'Senior Backend Engineer');
  assert.equal(kit.source.jd_chars, JD.length);
  assert.deepEqual(kit.source.pages_used, ['https://acme.test/', 'https://news.ycombinator.com/item?id=1']);
  assert.equal(kit.research.discussion_found, true);
  assert.ok(!Number.isNaN(Date.parse(kit.source.researched_at)));
});
