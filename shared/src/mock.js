/**
 * Mock interview: a timed run through the kit's questions, in the order the company's process suggests, answered in
 * writing and self-scored against each question's answer outline. Pure functions, shared by server and browser.
 *
 * Scoring is deliberately NOT done by a model. The app cannot judge free text, and pretending to would be dishonest and would
 * burn the free-tier token budget. Instead the outline is turned into a checklist and the user ticks what they covered. That is
 * what a good mock interview feedback round does anyway, and it makes the score reproducible and the weak spots real.
 */
const ROUNDS = {
  screen: { title: 'Recruiter screen', categories: ['company-fit', 'behavioural'], perRound: 2, blurb: 'A short intro conversation: why you, why them.' },
  technical: { title: 'Technical interview', categories: ['technical'], perRound: 3, blurb: 'Depth in the skills the role asks for.' },
  'system-design': { title: 'System design', categories: ['system-design'], perRound: 2, blurb: 'An open-ended design problem.' },
  behavioural: { title: 'Behavioural interview', categories: ['behavioural'], perRound: 3, blurb: 'Past situations that show how you work.' },
  'company-fit': { title: 'Motivation and company fit', categories: ['company-fit'], perRound: 2, blurb: 'Why this company and this role.' },
};
export const ROUND_TITLE = Object.fromEntries(Object.entries(ROUNDS).map(([k, v]) => [k, v.title]));
export const MINUTES_PER_QUESTION = { 1: 5, 2: 8, 3: 12 };
export const WEAK_BELOW = 0.6;
const DEFAULT_STAGES = ['technical', 'system-design', 'behavioural', 'company-fit'];

function pick(pool, n, covered, mustIds) {
  const chosen = [];
  const rest = pool.map((q, i) => ({ q, i }));
  while (chosen.length < n && rest.length) {
    const score = ({ q, i }) => [
      q.requirement_ids.filter((id) => mustIds.has(id) && !covered.has(id)).length,
      q.requirement_ids.filter((id) => !covered.has(id)).length,
      -q.difficulty,
      -i,
    ];
    let best = 0;
    rest.forEach((c, idx) => {
      const a = score(c);
      const b = score(rest[best]);
      for (let k = 0; k < a.length; k++) { if (a[k] !== b[k]) { if (a[k] > b[k]) best = idx; break; } }
    });
    const [taken] = rest.splice(best, 1);
    taken.q.requirement_ids.forEach((id) => covered.add(id));
    chosen.push(taken);
  }
  return chosen.sort((a, b) => a.q.difficulty - b.q.difficulty || a.i - b.i).map((x) => x.q); // warm up with the easier ones
}

/**
 * Which rounds to run and which questions go in each. Deterministic.
 *  - If the company's process is known, the rounds follow what it says (phone screen, coding/take-home, system design, values/onsite),
 *    labelled "published" or "reported" (forum anecdotes). A round only exists if the kit has questions for it: nothing is invented.
 *  - Otherwise: technical, system design, behavioural, company fit.
 *  - Within the whole interview, questions are chosen greedily to cover not-yet-covered MUST-HAVE requirements first.
 * @returns {{ basis: 'published'|'reported'|'default', rounds: Array<{id,title,blurb,question_ids,suggested_minutes}>, total_questions, total_minutes }}
 */
export function planMock(kit, { perRound } = {}) {
  const hp = kit.research?.hiring_process;
  const sig = hp?.signals ?? {};
  const has = (cats) => kit.questions.some((q) => cats.includes(q.category));

  let stages = null;
  let basis = 'default';
  if (hp?.known) {
    const s = [];
    if (sig.phone_screen) s.push('screen');
    if ((sig.coding_round || sig.take_home || sig.pair_programming) && has(['technical'])) s.push('technical');
    if (sig.system_design) s.push('system-design');
    if (sig.values_interview || sig.onsite) s.push('behavioural');
    if (s.length) { stages = s; basis = hp.confidence === 'published' ? 'published' : 'reported'; }
  }
  const mustIds = new Set(kit.role.requirements.filter((r) => r.priority === 'must').map((r) => r.id));
  const build = (list) => {
    const covered = new Set();
    const used = new Set();
    const out = [];
    for (const stage of list) {
      const meta = ROUNDS[stage];
      const pool = kit.questions.filter((q) => meta.categories.includes(q.category) && !used.has(q.id));
      if (!pool.length) continue;
      const questions = pick(pool, perRound ?? meta.perRound, covered, mustIds);
      questions.forEach((q) => used.add(q.id));
      out.push({
        id: stage, title: meta.title, blurb: meta.blurb, question_ids: questions.map((q) => q.id),
        suggested_minutes: questions.reduce((n, q) => n + MINUTES_PER_QUESTION[q.difficulty], 0),
      });
    }
    return out;
  };

  let rounds = stages ? build(stages) : [];
  if (!rounds.length) { // no process, or a process whose rounds the kit has no questions for: use the default interview
    rounds = build(DEFAULT_STAGES);
    basis = 'default';
  }
  return {
    basis, rounds,
    total_questions: rounds.reduce((n, r) => n + r.question_ids.length, 0),
    total_minutes: rounds.reduce((n, r) => n + r.suggested_minutes, 0),
  };
}

/** The answer outline as a checklist (max 8 points). An empty outline becomes one generic point so every question is scoreable. */
export function splitOutline(text) {
  const raw = String(text ?? '').trim();
  if (!raw) return ['My answer was complete and specific'];
  let parts = raw.split(/\r?\n+/).map((l) => l.replace(/^\s*(?:[-*•·]|\d+[.)])\s*/, '').trim()).filter(Boolean);
  if (parts.length === 1) parts = parts[0].split(/(?<=[.;])\s+(?=[A-Z0-9(])/).map((s) => s.trim()).filter(Boolean);
  return parts.slice(0, 8);
}

/** Fraction of the checklist covered. A skipped question scores 0. */
export const scoreAnswer = (covered, pointCount, skipped = false) => (skipped || pointCount === 0 ? 0 : covered.slice(0, pointCount).filter(Boolean).length / pointCount);

const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/** Report for the latest attempt (attempts are newest first) plus the trend across attempts. */
export function summarizeMock(kit, attempts) {
  if (!attempts?.length) return { attempts: 0, latest: null, trend: [] };
  const latest = attempts[0];
  const qById = new Map(kit.questions.map((q) => [q.id, q]));
  const byReq = new Map();
  for (const a of latest.answers) {
    const q = qById.get(a.question_id);
    for (const id of q?.requirement_ids ?? []) byReq.set(id, [...(byReq.get(id) ?? []), a.score]);
  }
  const by_requirement = kit.role.requirements
    .filter((r) => byReq.has(r.id))
    .map((r) => ({ id: r.id, text: r.text, priority: r.priority, score: avg(byReq.get(r.id)), asked: byReq.get(r.id).length }))
    .sort((a, b) => a.score - b.score || Number(b.priority === 'must') - Number(a.priority === 'must'));
  return {
    attempts: attempts.length,
    trend: [...attempts].reverse().map((a) => ({ id: a.id, saved_at: a.saved_at, overall: a.overall, completed: a.completed })),
    latest: {
      id: latest.id, overall: latest.overall, completed: latest.completed, basis: latest.basis,
      by_round: latest.rounds.map((r) => ({ id: r.id, title: r.title, score: avg(latest.answers.filter((a) => a.round_id === r.id).map((a) => a.score)), answered: latest.answers.filter((a) => a.round_id === r.id && !a.skipped).length, planned: r.question_ids.length })),
      by_requirement,
      unasked_musts: kit.role.requirements.filter((r) => r.priority === 'must' && !byReq.has(r.id)).map((r) => ({ id: r.id, text: r.text })),
      weakest: [...latest.answers].filter((a) => a.score < WEAK_BELOW).sort((a, b) => a.score - b.score).slice(0, 3).map((a) => ({ question_id: a.question_id, prompt: a.prompt, score: a.score, skipped: a.skipped })),
      seconds_used: latest.answers.reduce((n, a) => n + a.seconds, 0),
      seconds_suggested: latest.answers.reduce((n, a) => n + MINUTES_PER_QUESTION[qById.get(a.question_id)?.difficulty ?? 2] * 60, 0),
    },
  };
}
