/**
 * The edit rules for a kit, in one place. Pure functions over the kit document (Appendix A + optional extensions),
 * used by BOTH the server (authoritative) and the browser (optimistic, so edits feel instant).
 *
 * Edit state lives on each question / flashcard:
 *   origin: 'generated'  produced by the pipeline; a regeneration may replace it
 *           'edited'     a generated item the user changed or moved; survives regeneration
 *           'user'       written by the user; survives regeneration
 *   pinned: true         survives regeneration even if untouched
 * Regeneration therefore replaces exactly: origin !== edited/user AND not pinned.
 * Ops address items by id, never by position, so edits made in parallel (two tabs, or an edit during a
 * regeneration) commute instead of overwriting each other.
 */
export class OpError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'OpError';
    this.code = code;
  }
}

/** Items that a regeneration is allowed to throw away. `origin` undefined counts as generated. */
export const isReplaceable = (item) => item.origin !== 'edited' && item.origin !== 'user' && !item.pinned;

const find = (list, id, what) => {
  const i = list.findIndex((x) => x.id === id);
  if (i < 0) throw new OpError('ITEM_NOT_FOUND', `${what} ${id} not found`);
  return i;
};

const markEdited = (item) => {
  if (item.origin === undefined || item.origin === 'generated') item.origin = 'edited';
};

/** Insert before `beforeId` if it exists, else at the end of the item's category block (or the end of the list). */
function insert(list, item, { category, beforeId } = {}) {
  let at = beforeId ? list.findIndex((x) => x.id === beforeId) : -1;
  if (at < 0) {
    let last = -1;
    if (category !== undefined) list.forEach((x, i) => { if (x.category === category) last = i; });
    at = last >= 0 ? last + 1 : list.length;
  }
  list.splice(at, 0, item);
}

function setPinned(item, pinned) {
  if (pinned) item.pinned = true;
  else delete item.pinned;
}

const HANDLERS = {
  update_question(kit, op, out) {
    const q = kit.questions[find(kit.questions, op.id, 'Question')];
    const { patch } = op;
    let changed = false;
    for (const key of ['prompt', 'answer_outline', 'difficulty', 'requirement_ids']) {
      if (key in patch && JSON.stringify(patch[key]) !== JSON.stringify(q[key])) {
        q[key] = patch[key];
        changed = true;
        if (key === 'difficulty' || key === 'requirement_ids') out.resched = true;
        if (key === 'prompt') delete q.template; // no longer the fixed template text
      }
    }
    if ('category' in patch && patch.category !== q.category) {
      kit.questions.splice(kit.questions.indexOf(q), 1);
      q.category = patch.category;
      insert(kit.questions, q, { category: q.category });
      changed = true;
    }
    if ('pinned' in patch) setPinned(q, patch.pinned);
    if (changed) markEdited(q);
  },

  add_question(kit, op, out) {
    const a = op.question;
    if ([...kit.questions, ...kit.flashcards].some((x) => x.id === a.id)) throw new OpError('ID_IN_USE', `Id ${a.id} is already used`);
    const q = {
      id: a.id, requirement_ids: a.requirement_ids ?? [], category: a.category, prompt: a.prompt,
      answer_outline: a.answer_outline ?? '', difficulty: a.difficulty ?? 2, origin: 'user',
    };
    insert(kit.questions, q, { category: q.category, beforeId: a.before_id });
    out.resched = true;
  },

  delete_question(kit, op, out) {
    kit.questions.splice(find(kit.questions, op.id, 'Question'), 1);
    out.resched = true;
  },

  move_question(kit, op) {
    const q = kit.questions[find(kit.questions, op.id, 'Question')];
    if (op.before_id === op.id) return;
    kit.questions.splice(kit.questions.indexOf(q), 1);
    const categoryChanged = op.category !== q.category;
    q.category = op.category;
    insert(kit.questions, q, { category: q.category, beforeId: op.before_id });
    if (categoryChanged) markEdited(q); // moving between categories is the user's decision: keep it through regeneration
  },

  update_flashcard(kit, op) {
    const f = kit.flashcards[find(kit.flashcards, op.id, 'Flashcard')];
    let changed = false;
    for (const key of ['front', 'back', 'requirement_ids']) {
      if (key in op.patch && JSON.stringify(op.patch[key]) !== JSON.stringify(f[key])) { f[key] = op.patch[key]; changed = true; }
    }
    if ('pinned' in op.patch) setPinned(f, op.patch.pinned);
    if (changed) markEdited(f);
  },

  add_flashcard(kit, op) {
    const a = op.flashcard;
    if ([...kit.questions, ...kit.flashcards].some((x) => x.id === a.id)) throw new OpError('ID_IN_USE', `Id ${a.id} is already used`);
    insert(kit.flashcards, { id: a.id, front: a.front, back: a.back, requirement_ids: a.requirement_ids ?? [], origin: 'user' }, { beforeId: a.before_id });
  },

  delete_flashcard(kit, op) {
    kit.flashcards.splice(find(kit.flashcards, op.id, 'Flashcard'), 1);
  },

  move_flashcard(kit, op) {
    const f = kit.flashcards[find(kit.flashcards, op.id, 'Flashcard')];
    if (op.before_id === op.id) return;
    kit.flashcards.splice(kit.flashcards.indexOf(f), 1);
    insert(kit.flashcards, f, { beforeId: op.before_id });
  },

  update_brief(kit, op) {
    let changed = false;
    for (const key of ['summary', 'what_they_do']) {
      if (key in op.patch && op.patch[key] !== kit.company_brief[key]) { kit.company_brief[key] = op.patch[key]; changed = true; }
    }
    if (changed) kit.company_brief.origin = 'edited';
  },

  update_day(kit, op) {
    const d = kit.schedule.days[find(kit.schedule.days.map((x) => ({ ...x, id: x.day })), op.day, 'Day')];
    let changed = false;
    for (const key of ['focus', 'minutes']) {
      if (key in op.patch && op.patch[key] !== d[key]) { d[key] = op.patch[key]; changed = true; }
    }
    if (changed) d.origin = 'edited';
  },
};

/**
 * Applies ops in order to `kit` (mutating it) and reports what else the caller must do.
 * @returns {{ resched: boolean }} resched: question structure changed, so the schedule needs reconciling.
 * @throws {OpError} ITEM_NOT_FOUND | ID_IN_USE | UNKNOWN_OP (the kit may be partly modified: apply to a copy).
 */
export function applyOps(kit, ops) {
  const out = { resched: false };
  for (const op of ops) {
    const handler = HANDLERS[op.op];
    if (!handler) throw new OpError('UNKNOWN_OP', `Unknown op ${op.op}`);
    handler(kit, op, out);
  }
  return out;
}

/** Client-side id for a new item; the server accepts it if unused, so follow-up edits never need a temp id. */
export const newId = (prefix) => `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
