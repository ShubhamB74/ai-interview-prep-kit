import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDraft } from '../src/pipeline/draft.js';
import { createMockLlm } from '../test-support/mockLlm.js';
import { validateKit } from '../src/schema/kit.js';

const JD = `Senior Backend Engineer at Acme
Requirements:
- 5+ years Node.js
- Experience mentoring junior engineers
Nice to have:
- Kubernetes
We build payment rails for small banks and care a lot about reliability and happy customers.`;

const makeLlm = (over = {}) => createMockLlm({
  extract_requirements: () => ({ company: 'Acme', title: 'Senior Backend Engineer', seniority: 'senior', location: '', responsibilities: [], requirements: [
    { text: '5+ years Node.js', kind: 'technical', priority: 'must', evidence: '5+ years Node.js' },
    { text: 'Mentoring junior engineers', kind: 'behavioural', priority: 'must', evidence: 'Experience mentoring junior engineers' },
    { text: 'Kubernetes', kind: 'technical', priority: 'must', evidence: 'Kubernetes' },
  ] }),
  company_brief: () => ({ summary: 'Acme builds payment rails.', what_they_do: 'Payments for banks.', source_urls: ['https://acme.test/'] }),
  'questions': ({ name, user }) => {
    const ids = [...user.matchAll(/^(r\d+):/gm)].map((m) => m[1]);
    return { questions: ids.map((id) => ({ requirement_ids: [id], prompt: `${name} question for ${id}?`, answer_outline: 'outline', difficulty: 2 })) };
  },
  flashcards: ({ user }) => ({ flashcards: [...user.matchAll(/^(r\d+):/gm)].map((m) => ({ front: `Card ${m[1]}`, back: 'answer', requirement_ids: [m[1]] })) }),
  ...over,
});

const researchWith = (pages, discussion = { found: false, snippets: [], searched: true, skipped: [] }, reachable = true) => async () => ({
  company: 'Acme', crawl: { reachable, pages, skipped: [], hiringPage: null }, discussion, gaps: [], pagesUsed: pages.map((p) => p.url), skipped: [],
});
const home = { url: 'https://acme.test/', kind: 'home', title: 'Acme', text: 'Acme builds payment rails for small banks. '.repeat(6), hiring_score: 0 };

test('draft: runs the steps in order, assigns stable ids, every question references real requirements', async () => {
  const events = [];
  const d = await buildDraft({ jd: JD, companyUrl: 'https://acme.test', llm: makeLlm(), research: researchWith([home]), onProgress: (e) => events.push(`${e.step}:${e.status}`) });
  assert.deepEqual(d.role.requirements.map((r) => r.id), ['r1', 'r2', 'r3']);
  assert.equal(d.role.requirements[2].priority, 'nice'); // "Nice to have:" heading overrides the model
  assert.ok(d.questions.length >= 4);
  assert.deepEqual(d.questions.map((q) => q.id), d.questions.map((_, i) => `q${i + 1}`));
  const reqIds = new Set(d.role.requirements.map((r) => r.id));
  for (const q of d.questions) q.requirement_ids.forEach((id) => assert.ok(reqIds.has(id)));
  assert.ok(events.indexOf('extract_requirements:done') < events.indexOf('research:running'));
  assert.ok(events.indexOf('research:done') < events.indexOf('company_brief:running'));
  assert.deepEqual(d.failures, []);
});

test('draft: a published hiring process changes the plan and the prompts (different kit)', async () => {
  const hiring = { url: 'https://acme.test/hire', kind: 'hiring', title: 'Hiring', hiring_score: 12, text: 'Our interview process: a take-home exercise, then a system design interview with two engineers.' };
  const junior = { extract_requirements: () => ({ company: 'Acme', title: 'Junior Backend Engineer', seniority: 'junior', requirements: [{ text: '5+ years Node.js', kind: 'technical', priority: 'must', evidence: '5+ years Node.js' }] }) };
  const plain = await buildDraft({ jd: JD.replace('Senior', 'Junior'), companyUrl: 'https://acme.test', llm: makeLlm(junior), research: researchWith([home]) });
  const llm = makeLlm(junior);
  const rich = await buildDraft({ jd: JD.replace('Senior', 'Junior'), companyUrl: 'https://acme.test', llm, research: researchWith([home, hiring]) });
  assert.equal(plain.plan.some((p) => p.category === 'system-design'), false);
  assert.equal(rich.plan.some((p) => p.category === 'system-design'), true);
  assert.ok(llm.calls.some((c) => c.name.startsWith('questions') && /take-home/.test(c.user)));
});

test('draft: unreachable company -> honest brief, no brief call, no company-fit, kit still produced', async () => {
  const llm = makeLlm();
  const d = await buildDraft({ jd: JD, companyUrl: 'http://down.test', llm, research: researchWith([], undefined, false) });
  assert.equal(d.brief.grounded, false);
  assert.equal(llm.calls.some((c) => c.name === 'company_brief'), false);
  assert.equal(d.plan.some((p) => p.category === 'company-fit'), false);
  assert.ok(d.questions.length > 0);
});

test('draft: a failing category is recorded and the rest continue', async () => {
  const llm = makeLlm({ 'questions:behavioural': () => { throw Object.assign(new Error('provider down'), { code: 'LLM_UNAVAILABLE' }); } });
  const d = await buildDraft({ jd: JD, companyUrl: 'https://acme.test', llm, research: researchWith([home]) });
  assert.deepEqual(d.failures.map((f) => [f.step, f.code]), [['questions:behavioural', 'LLM_UNAVAILABLE']]);
  assert.ok(d.questions.some((q) => q.category === 'technical'));
  assert.equal(d.questions.some((q) => q.category === 'behavioural'), false);
});

test('draft: requirement extraction failure is fatal (no kit without requirements)', async () => {
  const llm = makeLlm({ extract_requirements: () => { throw Object.assign(new Error('quota'), { code: 'LLM_QUOTA_EXHAUSTED' }); } });
  await assert.rejects(buildDraft({ jd: JD, companyUrl: 'https://acme.test', llm, research: researchWith([home]) }), { code: 'LLM_QUOTA_EXHAUSTED' });
});

test('draft: two-line stub yields a thin draft with no questions or cards, and no fabricated content', async () => {
  const llm = makeLlm({ extract_requirements: () => ({ title: 'Backend dev', requirements: [] }) });
  const d = await buildDraft({ jd: 'Backend dev wanted.\nApply now.', companyUrl: 'https://acme.test', llm, research: researchWith([home]) });
  assert.equal(d.role.thin, true);
  assert.equal(d.questions.length, 0);
  assert.equal(d.flashcards.length, 0);
  assert.equal(llm.calls.some((c) => c.name.startsWith('questions') || c.name === 'flashcards'), false);
});

test('kit schema accepts the optional research block (and still rejects malformed ones)', () => {
  const kit = {
    source: { company: 'A', company_url: 'u', role: 'r', location: '', jd_chars: 1, researched_at: 't', pages_used: [] },
    company_brief: { summary: '', what_they_do: '', sources: [] },
    role: { title: '', seniority: '', responsibilities: [], requirements: [] },
    questions: [], flashcards: [], schedule: { days_available: 1, days: [{ day: 1, focus: '', question_ids: [], minutes: 0 }] },
    coverage: { uncovered_requirement_ids: [], passes: 0 },
    research: { gaps: ['x'], hiring_page: null, hiring_process: { known: false, confidence: 'none', signals: {} }, discussion_searched: true, discussion_found: false, discussion_sources: [], skipped_sources: [{ code: 'HTTP_404', reason: 'nf' }], thin_description: true },
  };
  assert.equal(validateKit(kit).ok, true);
  assert.equal(validateKit({ ...kit, research: { gaps: 'x' } }).ok, false);
});
