import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyOps, isReplaceable, OpError } from '@prepkit/shared/kitOps';
import { parseCasesFile } from '@prepkit/shared/parseCases';
import { makeKit } from '../test-support/kitFixture.js';

const run = (ops, kit = makeKit()) => { const out = applyOps(kit, ops); return { kit, ...out }; };
const ids = (kit, category) => kit.questions.filter((q) => !category || q.category === category).map((q) => q.id);
const get = (kit, id) => kit.questions.find((q) => q.id === id);

test('editing a generated question marks it edited; a user question stays user; an unchanged value is not an edit', () => {
  const { kit } = run([{ op: 'update_question', id: 'q1', patch: { prompt: 'My own wording?' } }]);
  assert.deepEqual([get(kit, 'q1').prompt, get(kit, 'q1').origin], ['My own wording?', 'edited']);
  const same = run([{ op: 'update_question', id: 'q2', patch: { prompt: 'Original q2 question?' } }]);
  assert.equal(get(same.kit, 'q2').origin, 'generated');
  const mine = run([{ op: 'add_question', question: { id: 'q-mine1', category: 'technical', prompt: 'Mine?' } }, { op: 'update_question', id: 'q-mine1', patch: { prompt: 'Mine, reworded?' } }]);
  assert.equal(get(mine.kit, 'q-mine1').origin, 'user');
});

test('pinning protects an item without marking it edited; unpinning removes the flag', () => {
  const { kit } = run([{ op: 'update_question', id: 'q1', patch: { pinned: true } }]);
  assert.deepEqual([get(kit, 'q1').pinned, get(kit, 'q1').origin, isReplaceable(get(kit, 'q1'))], [true, 'generated', false]);
  run([{ op: 'update_question', id: 'q1', patch: { pinned: false } }], kit);
  assert.equal('pinned' in get(kit, 'q1'), false);
  assert.equal(isReplaceable(get(kit, 'q1')), true);
});

test('isReplaceable: only untouched, unpinned, generated (or legacy origin-less) items', () => {
  assert.deepEqual([{}, { origin: 'generated' }, { origin: 'edited' }, { origin: 'user' }, { origin: 'generated', pinned: true }].map(isReplaceable), [true, true, false, false, false]);
});

test('changing a question\'s category moves it to the end of that category and marks it edited', () => {
  const { kit } = run([{ op: 'update_question', id: 'q1', patch: { category: 'system-design' } }]);
  assert.equal(get(kit, 'q1').category, 'system-design');
  assert.equal(get(kit, 'q1').origin, 'edited');
  assert.deepEqual(ids(kit, 'system-design'), ['q6', 'q1']);
});

test('difficulty and requirement edits request a schedule re-flow; text edits do not', () => {
  assert.equal(run([{ op: 'update_question', id: 'q1', patch: { prompt: 'x?' } }]).resched, false);
  assert.equal(run([{ op: 'update_question', id: 'q1', patch: { difficulty: 3 } }]).resched, true);
  assert.equal(run([{ op: 'update_question', id: 'q1', patch: { requirement_ids: ['r2'] } }]).resched, true);
});

test('editing a template question drops the template flag', () => {
  const kit = makeKit();
  kit.questions[0].template = true;
  run([{ op: 'update_question', id: 'q1', patch: { prompt: 'Better?' } }], kit);
  assert.equal('template' in kit.questions[0], false);
});

test('add: origin user, at the end of its category block, or before a given id; duplicate ids are rejected', () => {
  const { kit, resched } = run([{ op: 'add_question', question: { id: 'q-a1b2c3', category: 'technical', prompt: 'New one?', difficulty: 3, requirement_ids: ['r1'] } }]);
  assert.deepEqual(ids(kit, 'technical'), ['q1', 'q2', 'q3', 'q-a1b2c3']);
  assert.deepEqual([get(kit, 'q-a1b2c3').origin, get(kit, 'q-a1b2c3').difficulty, resched], ['user', 3, true]);
  const before = run([{ op: 'add_question', question: { id: 'q-zzzz11', category: 'technical', prompt: 'First?', before_id: 'q1' } }]);
  assert.deepEqual(ids(before.kit, 'technical').slice(0, 2), ['q-zzzz11', 'q1']);
  assert.throws(() => run([{ op: 'add_question', question: { id: 'q1', category: 'technical', prompt: 'Dup?' } }]), { code: 'ID_IN_USE' });
});

test('delete removes the item; unknown ids raise ITEM_NOT_FOUND', () => {
  const { kit, resched } = run([{ op: 'delete_question', id: 'q2' }]);
  assert.equal(get(kit, 'q2'), undefined);
  assert.equal(resched, true);
  assert.throws(() => run([{ op: 'delete_question', id: 'nope' }]), (e) => e instanceof OpError && e.code === 'ITEM_NOT_FOUND');
});

test('move: reorder inside a category (before an id / to the end) and across categories', () => {
  assert.deepEqual(ids(run([{ op: 'move_question', id: 'q3', category: 'technical', before_id: 'q1' }]).kit, 'technical'), ['q3', 'q1', 'q2']);
  assert.deepEqual(ids(run([{ op: 'move_question', id: 'q1', category: 'technical', before_id: null }]).kit, 'technical'), ['q2', 'q3', 'q1']);
  const reorder = run([{ op: 'move_question', id: 'q3', category: 'technical', before_id: 'q1' }]).kit;
  assert.equal(get(reorder, 'q3').origin, 'generated', 'pure reordering is not an edit');
  const across = run([{ op: 'move_question', id: 'q2', category: 'behavioural' }]).kit;
  assert.deepEqual([get(across, 'q2').category, get(across, 'q2').origin], ['behavioural', 'edited']);
  assert.deepEqual(ids(across, 'behavioural'), ['q4', 'q2']);
});

test('flashcards: edit, add (user), delete, move', () => {
  const { kit } = run([
    { op: 'update_flashcard', id: 'f1', patch: { back: 'Better answer.' } },
    { op: 'add_flashcard', flashcard: { id: 'f-abc123', front: 'Mine?', back: 'Yes.' } },
    { op: 'move_flashcard', id: 'f-abc123', before_id: 'f1' },
    { op: 'delete_flashcard', id: 'f2' },
  ]);
  assert.deepEqual(kit.flashcards.map((f) => [f.id, f.origin]), [['f-abc123', 'user'], ['f1', 'edited']]);
});

test('brief and schedule-day edits are tracked', () => {
  const { kit } = run([{ op: 'update_brief', patch: { summary: 'My summary.' } }, { op: 'update_day', day: 2, patch: { focus: 'Rest and review', minutes: 20 } }]);
  assert.deepEqual([kit.company_brief.summary, kit.company_brief.origin], ['My summary.', 'edited']);
  assert.deepEqual([kit.schedule.days[1].focus, kit.schedule.days[1].minutes, kit.schedule.days[1].origin], ['Rest and review', 20, 'edited']);
  assert.equal(run([{ op: 'update_brief', patch: { summary: 'Acme builds payment rails.' } }]).kit.company_brief.origin, 'generated');
  assert.throws(() => run([{ op: 'update_day', day: 99, patch: { focus: 'x' } }]), { code: 'ITEM_NOT_FOUND' });
});

test('edits to DIFFERENT items commute: any order gives the same document (what makes parallel edits safe)', () => {
  const a = { op: 'update_question', id: 'q1', patch: { prompt: 'A?' } };
  const b = { op: 'delete_question', id: 'q2' };
  const c = { op: 'update_flashcard', id: 'f1', patch: { front: 'F?' } };
  const orders = [[a, b, c], [c, b, a], [b, a, c]].map((ops) => run(ops).kit);
  assert.deepEqual(orders[0], orders[1]);
  assert.deepEqual(orders[0], orders[2]);
});

test('parseCasesFile: JSON array / wrapped object, forgiving keys, row errors', () => {
  const json = JSON.stringify([{ jd: 'Backend role', company_url: 'https://a.test', days: 4 }, { description: 'Front role', website: 'https://b.test' }, { jd: 'No company' }, 'junk']);
  const r = parseCasesFile(json, 'x.json');
  assert.deepEqual(r.items, [{ jd: 'Backend role', company_url: 'https://a.test', days: 4 }, { jd: 'Front role', company_url: 'https://b.test' }]);
  assert.equal(r.errors.length, 2);
  assert.match(r.errors[0], /Row 3.*company website/);
  assert.equal(parseCasesFile('{"items":[{"jd":"x","url":"https://c.test"}]}').items.length, 1);
  assert.match(parseCasesFile('{oops', 'a.json').errors[0], /not valid JSON/);
  assert.match(parseCasesFile('   ').errors[0], /empty/);
});

test('parseCasesFile: CSV with quotes, commas, newlines in fields, CRLF and a BOM', () => {
  const csv = '\uFEFFjd,Company URL,days\r\n"Senior Engineer, Backend\nMust know ""Node""",https://a.test,5\r\nFrontend dev,https://b.test,\r\n';
  const r = parseCasesFile(csv, 'cases.csv');
  assert.equal(r.items.length, 2);
  assert.equal(r.items[0].jd, 'Senior Engineer, Backend\nMust know "Node"');
  assert.deepEqual([r.items[0].days, r.items[1].days], [5, undefined]);
  assert.deepEqual(r.errors, []);
});
