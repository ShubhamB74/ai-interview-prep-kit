import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyOpsToKit, applyToKit } from '../src/services/kitEditor.js';
import { regenerateBrief, regenerateQuestions, regenerateSchedule } from '../src/services/regenerate.js';
import { validateKit } from '../src/schema/kit.js';
import { createMockLlm } from '../test-support/mockLlm.js';
import { makeKit, readyKitRecord } from '../test-support/kitFixture.js';

const edit = (h, ops) => applyOpsToKit(h.repos.kits, h.id, h.user.id, ops);
const ids = (kit, category) => kit.questions.filter((q) => q.category === category).map((q) => q.id);
const scheduled = (kit) => new Set(kit.schedule.days.flatMap((d) => d.question_ids));
const mustIds = ['r1', 'r2', 'r3'];

let counter = 0;
const idsIn = (user) => [...user.matchAll(/^(r\d+):/gm)].map((m) => m[1]);
const freshQuestions = ({ name, user }) => ({ questions: idsIn(user).map((rid) => ({ requirement_ids: [rid], prompt: `Fresh ${name.split(':')[1]} question ${++counter} for ${rid}?`, answer_outline: 'o', difficulty: 2 })) });
const llmWith = (over = {}) => createMockLlm({ questions: freshQuestions, ...over });

// ---------------- the edit engine ----------------
test('an edit is saved, bumps the version, and the schedule/coverage follow the question set', async () => {
  const h = await readyKitRecord();
  const v0 = (await h.get()).version;
  const saved = await edit(h, [{ op: 'delete_question', id: 'q4' }, { op: 'add_question', question: { id: 'q-new001', category: 'behavioural', prompt: 'Tell me about mentoring?', requirement_ids: ['r3'] } }]);
  assert.equal(saved.version, v0 + 1);
  assert.equal(validateKit(saved.kit).ok, true);
  assert.equal(scheduled(saved.kit).has('q4'), false);
  assert.equal(scheduled(saved.kit).has('q-new001'), true);
  assert.deepEqual(saved.kit.coverage.uncovered_requirement_ids, []);
});

test('deleting the last question for a requirement is allowed and reported honestly in coverage', async () => {
  const h = await readyKitRecord();
  const saved = await edit(h, [{ op: 'delete_question', id: 'q4' }]); // only question for r3
  assert.deepEqual(saved.kit.coverage.uncovered_requirement_ids, ['r3']);
});

test('invalid results are rejected as a whole and nothing is saved', async () => {
  const h = await readyKitRecord();
  const before = await h.get();
  await assert.rejects(edit(h, [{ op: 'update_question', id: 'q1', patch: { requirement_ids: [] } }]), { code: 'INVALID_EDIT' });
  await assert.rejects(edit(h, [{ op: 'update_question', id: 'q1', patch: { requirement_ids: ['r99'] } }]), { code: 'INVALID_EDIT' });
  const after = await h.get();
  assert.equal(after.version, before.version);
  assert.deepEqual(after.kit, before.kit);
});

test('a batch is atomic: if the second op fails, the first is not applied', async () => {
  const h = await readyKitRecord();
  const before = await h.get();
  await assert.rejects(edit(h, [{ op: 'update_question', id: 'q1', patch: { prompt: 'Changed?' } }, { op: 'delete_question', id: 'ghost' }]), { code: 'ITEM_NOT_FOUND', status: 404 });
  assert.deepEqual((await h.get()).kit, before.kit);
});

test('a user-written question may cover no requirement; a generated one may not', async () => {
  const h = await readyKitRecord();
  const saved = await edit(h, [{ op: 'add_question', question: { id: 'q-free01', category: 'technical', prompt: 'Free-form question?' } }]);
  assert.deepEqual(saved.kit.questions.find((q) => q.id === 'q-free01').requirement_ids, []);
});

test('two writers racing: the loser re-reads and re-applies on the NEW document, so both edits survive', async () => {
  const h = await readyKitRecord();
  const original = h.repos.kits.replaceKit.bind(h.repos.kits);
  let injected = false;
  h.repos.kits.replaceKit = async (...args) => {
    if (!injected) { injected = true; await edit(h, [{ op: 'update_flashcard', id: 'f1', patch: { front: 'Edited elsewhere?' } }]); } // a competing writer gets in first
    return original(...args);
  };
  const v0 = (await h.get()).version;
  const saved = await edit(h, [{ op: 'update_question', id: 'q1', patch: { prompt: 'Mine?' } }]);
  assert.equal(saved.version, v0 + 2);
  assert.equal(saved.kit.questions.find((q) => q.id === 'q1').prompt, 'Mine?');
  assert.equal(saved.kit.flashcards.find((f) => f.id === 'f1').front, 'Edited elsewhere?');
});

test('constant conflicts end in EDIT_CONFLICT instead of looping forever', async () => {
  const h = await readyKitRecord();
  h.repos.kits.replaceKit = async () => null;
  await assert.rejects(edit(h, [{ op: 'update_question', id: 'q1', patch: { prompt: 'x?' } }]), { code: 'EDIT_CONFLICT' });
});

test('only ready kits are editable and only by their owner', async () => {
  const h = await readyKitRecord();
  const other = await h.repos.users.create({ email: 'other@x.com', passwordHash: 'h' });
  await assert.rejects(applyOpsToKit(h.repos.kits, h.id, other.id, [{ op: 'delete_question', id: 'q1' }]), { code: 'KIT_NOT_FOUND' });
  const pending = await h.repos.kits.create({ userId: h.user.id, title: 'p', inputHash: 'p', input: { jd: 'x', company_url: 'http://x', days: 1 } });
  await assert.rejects(applyOpsToKit(h.repos.kits, pending.id, h.user.id, [{ op: 'delete_question', id: 'q1' }]), { code: 'KIT_NOT_READY' });
});

// ---------------- schedule ----------------
test('hand-edited schedule days keep their focus/minutes when questions change; others are recomputed', async () => {
  const h = await readyKitRecord();
  await edit(h, [{ op: 'update_day', day: 1, patch: { focus: 'Warm-up day', minutes: 20 } }]);
  const saved = await edit(h, [{ op: 'delete_question', id: 'q1' }, { op: 'add_question', question: { id: 'q-new002', category: 'technical', prompt: 'Added?', requirement_ids: ['r1'], difficulty: 3 } }]);
  const [d1, d2] = saved.kit.schedule.days;
  assert.deepEqual([d1.focus, d1.minutes, d1.origin], ['Warm-up day', 20, 'edited']);
  assert.equal(d2.origin, undefined);
  assert.equal(saved.kit.schedule.days.length, 3);
});

test('regenerate schedule: fresh plan, optionally for a different number of days; instant and deterministic', async () => {
  const h = await readyKitRecord();
  await edit(h, [{ op: 'update_day', day: 1, patch: { focus: 'Mine', minutes: 5 } }]);
  const same = await regenerateSchedule({ kits: h.repos.kits, id: h.id, userId: h.user.id });
  assert.equal(same.kit.schedule.days[0].origin, undefined, 'explicit regeneration rebuilds from scratch');
  const longer = await regenerateSchedule({ kits: h.repos.kits, id: h.id, userId: h.user.id, days: 10 });
  assert.equal(longer.kit.schedule.days_available, 10);
  assert.equal(longer.kit.schedule.days.length, 10);
  const q = await regenerateSchedule({ kits: h.repos.kits, id: h.id, userId: h.user.id, days: 1 });
  assert.equal(q.kit.schedule.days.length, 1);
});

// ---------------- regenerating a question category ----------------
test('regenerating a category keeps edited, user-written and pinned questions and replaces only the untouched ones', async () => {
  const h = await readyKitRecord();
  await edit(h, [
    { op: 'update_question', id: 'q1', patch: { prompt: 'My reworded Node question?' } },   // edited
    { op: 'add_question', question: { id: 'q-mine01', category: 'technical', prompt: 'My own technical question?', requirement_ids: ['r1'] } }, // user
    { op: 'update_question', id: 'q3', patch: { pinned: true } },                           // pinned
  ]);
  const before = await h.get();
  const otherCategories = before.kit.questions.filter((q) => q.category !== 'technical');

  const saved = await regenerateQuestions({ kits: h.repos.kits, id: h.id, userId: h.user.id, category: 'technical', llm: llmWith() });
  const tech = saved.kit.questions.filter((q) => q.category === 'technical');
  const byId = (id) => tech.find((q) => q.id === id);

  assert.equal(byId('q1').prompt, 'My reworded Node question?');
  assert.equal(byId('q-mine01').origin, 'user');
  assert.equal(byId('q3').pinned, true);
  assert.equal(byId('q2'), undefined, 'the untouched generated question was replaced');
  const fresh = tech.filter((q) => !['q1', 'q-mine01', 'q3'].includes(q.id));
  assert.ok(fresh.length >= 1 && fresh.every((q) => q.origin === 'generated' && /^q-/.test(q.id) && q.prompt.startsWith('Fresh')));
  assert.deepEqual(saved.kit.questions.filter((q) => q.category !== 'technical'), otherCategories, 'other categories are untouched');
  assert.equal(validateKit(saved.kit).ok, true);
  for (const id of saved.kit.schedule.days.flatMap((d) => d.question_ids)) assert.ok(saved.kit.questions.some((q) => q.id === id));
  for (const q of saved.kit.questions) assert.ok(scheduled(saved.kit).has(q.id));
});

test('EDIT IN FLIGHT: changes the user makes while the model is still generating survive the commit', async () => {
  const h = await readyKitRecord();
  const llm = llmWith({
    questions: async (args) => {
      // the user keeps working while the model thinks
      await edit(h, [
        { op: 'update_question', id: 'q2', patch: { prompt: 'Edited during regeneration?' } },
        { op: 'add_question', question: { id: 'q-live01', category: 'technical', prompt: 'Added during regeneration?', requirement_ids: ['r2'] } },
        { op: 'delete_question', id: 'q1' },
      ]);
      return freshQuestions(args);
    },
  });
  const saved = await regenerateQuestions({ kits: h.repos.kits, id: h.id, userId: h.user.id, category: 'technical', llm });
  const prompts = saved.kit.questions.filter((q) => q.category === 'technical').map((q) => q.prompt);
  assert.ok(prompts.includes('Edited during regeneration?'), 'edited mid-flight => kept');
  assert.ok(prompts.includes('Added during regeneration?'), 'added mid-flight => kept');
  assert.equal(saved.kit.questions.some((q) => q.id === 'q1'), false, 'deleted mid-flight => not resurrected');
  assert.equal(validateKit(saved.kit).ok, true);
});

test('new questions never repeat a prompt that survived', async () => {
  const h = await readyKitRecord();
  await edit(h, [{ op: 'update_question', id: 'q1', patch: { prompt: 'Same wording both times?' } }]);
  const llm = llmWith({ questions: ({ user }) => ({ questions: [{ requirement_ids: [idsIn(user)[0]], prompt: 'same wording both times', answer_outline: '', difficulty: 2 }, { requirement_ids: [idsIn(user)[0]], prompt: 'A genuinely new one?', answer_outline: '', difficulty: 2 }] }) });
  const saved = await regenerateQuestions({ kits: h.repos.kits, id: h.id, userId: h.user.id, category: 'technical', llm });
  const prompts = saved.kit.questions.map((q) => q.prompt.toLowerCase());
  assert.equal(prompts.filter((p) => p.startsWith('same wording')).length, 1);
});

test('a model that returns nothing never destroys the existing questions', async () => {
  const h = await readyKitRecord();
  const before = await h.get();
  await assert.rejects(regenerateQuestions({ kits: h.repos.kits, id: h.id, userId: h.user.id, category: 'technical', llm: llmWith({ questions: () => ({ questions: [] }) }) }), { code: 'REGEN_EMPTY' });
  const after = await h.get();
  assert.deepEqual([after.version, after.kit], [before.version, before.kit]);
});

test('provider failure leaves the kit untouched', async () => {
  const h = await readyKitRecord();
  const before = await h.get();
  await assert.rejects(regenerateQuestions({ kits: h.repos.kits, id: h.id, userId: h.user.id, category: 'technical', llm: llmWith({ questions: () => { throw Object.assign(new Error('down'), { code: 'LLM_UNAVAILABLE' }); } }) }), { code: 'LLM_UNAVAILABLE' });
  assert.deepEqual((await h.get()).kit, before.kit);
});

test('nothing to regenerate in a category with no requirements and no generated questions', async () => {
  const h = await readyKitRecord(makeKit({ requirements: [{ id: 'r1', text: 'Behavioural only', kind: 'behavioural', priority: 'must' }], questions: [{ id: 'q1', requirement_ids: ['r1'], category: 'behavioural', prompt: 'Tell me?', answer_outline: '', difficulty: 2, origin: 'generated' }], flashcards: [] }));
  await assert.rejects(regenerateQuestions({ kits: h.repos.kits, id: h.id, userId: h.user.id, category: 'technical', llm: llmWith() }), { code: 'NOTHING_TO_REGENERATE' });
});

test('coverage is repaired for THIS category\'s requirements only: a requirement the user emptied elsewhere is not refilled', async () => {
  const h = await readyKitRecord();
  await edit(h, [{ op: 'delete_question', id: 'q5' }, { op: 'delete_question', id: 'q6' }]); // user removed the only question for r4 (company-fit), and the system-design one that also covered r2
  let calls = 0;
  const llm = llmWith({ questions: (args) => {
    calls++;
    const got = freshQuestions(args);
    return calls === 1 ? { questions: got.questions.filter((q) => q.requirement_ids[0] !== 'r2') } : got; // first pass skips r2; repair must fill it
  } });
  const saved = await regenerateQuestions({ kits: h.repos.kits, id: h.id, userId: h.user.id, category: 'technical', llm });
  assert.ok(saved.kit.questions.some((q) => q.requirement_ids.includes('r2') && q.category === 'technical' && q.prompt.startsWith('Fresh')));
  assert.deepEqual(saved.kit.coverage.uncovered_requirement_ids, ['r4'], 'r4 stays uncovered: the user deleted it');
  assert.ok(calls >= 2);
});

// ---------------- regenerating the brief ----------------
const home = { url: 'https://acme.test/', kind: 'home', title: 'Acme', text: 'Acme now builds instant payment rails for banks. '.repeat(6), hiring_score: 0 };
const researchOk = async () => ({ company: 'Acme', crawl: { reachable: true, pages: [home], skipped: [], hiringPage: null }, discussion: { searched: true, found: false, snippets: [], skipped: [] }, gaps: [], pagesUsed: [home.url], skipped: [] });
const researchDown = async () => ({ company: 'Acme', crawl: { reachable: false, pages: [], skipped: [{ code: 'NETWORK', reason: 'down' }], hiringPage: null }, discussion: { searched: true, found: false, snippets: [], skipped: [] }, gaps: [], pagesUsed: [], skipped: [] });
const briefLlm = (text = 'Acme builds instant payment rails.') => createMockLlm({ company_brief: () => ({ summary: text, what_they_do: 'Instant payments.', source_urls: [home.url] }) });

test('brief regeneration rewrites it from fresh research and marks it generated', async () => {
  const h = await readyKitRecord();
  const saved = await regenerateBrief({ kits: h.repos.kits, id: h.id, userId: h.user.id, llm: briefLlm(), retrievalCtx: {}, research: researchOk });
  assert.deepEqual([saved.kit.company_brief.summary, saved.kit.company_brief.origin], ['Acme builds instant payment rails.', 'generated']);
});

test('a failed re-crawl never replaces a good brief with an empty one', async () => {
  const h = await readyKitRecord();
  const before = await h.get();
  await assert.rejects(regenerateBrief({ kits: h.repos.kits, id: h.id, userId: h.user.id, llm: briefLlm(), retrievalCtx: {}, research: researchDown }), { code: 'REGEN_NO_NEW_INFO' });
  assert.deepEqual((await h.get()).kit.company_brief, before.kit.company_brief);
});

test('a brief the user edits WHILE it regenerates is kept (unless forced)', async () => {
  const slowResearch = (h) => async (...a) => { await edit(h, [{ op: 'update_brief', patch: { summary: 'My careful summary.' } }]); return researchOk(...a); };
  const h = await readyKitRecord();
  await assert.rejects(regenerateBrief({ kits: h.repos.kits, id: h.id, userId: h.user.id, llm: briefLlm(), retrievalCtx: {}, research: slowResearch(h) }), { code: 'REGEN_SUPERSEDED_BY_EDIT' });
  assert.equal((await h.get()).kit.company_brief.summary, 'My careful summary.');
  const forced = await regenerateBrief({ kits: h.repos.kits, id: h.id, userId: h.user.id, llm: briefLlm(), retrievalCtx: {}, research: researchOk, force: true });
  assert.equal(forced.kit.company_brief.summary, 'Acme builds instant payment rails.');
});

test('applyToKit is the only writer: a mutate that throws changes nothing', async () => {
  const h = await readyKitRecord();
  const before = await h.get();
  await assert.rejects(applyToKit(h.repos.kits, h.id, h.user.id, (kit) => { kit.questions.length = 0; throw new Error('boom'); }), /boom/);
  assert.deepEqual((await h.get()).kit, before.kit);
});
