import { checkCoverage } from './checkCoverage.js';

/** Max REPAIR rounds after the first check. A pass = one coverage check, so passes <= MAX_REPAIR_ROUNDS + 1. */
export const MAX_REPAIR_ROUNDS = 3;
/** Errors where trying again cannot help: stop spending calls and fall back to templates. */
const FATAL = new Set(['LLM_QUOTA_EXHAUSTED', 'LLM_AUTH', 'LLM_NOT_CONFIGURED', 'LLM_BAD_REQUEST']);

const TEMPLATES = {
  technical: (t) => `Walk me through your hands-on experience with: ${t}. What was the hardest problem you solved, and what would you do differently now?`,
  behavioural: (t) => `Tell me about a time that shows this in practice: ${t}. What was the situation, what did you do, and what was the result?`,
  domain: (t) => `What do you know about ${t}, and how would that knowledge apply in this role?`,
};
const TEMPLATE_OUTLINE = 'Be specific: give the context, your own role, a concrete outcome with numbers if you have them, and the trade-offs you weighed.';

/** Deterministic last resort for a must-have the model never produced a question for. Flagged `template: true`. */
export const templateQuestion = (req) => ({
  requirement_ids: [req.id], category: req.kind === 'behavioural' ? 'behavioural' : req.kind === 'domain' ? 'company-fit' : 'technical',
  prompt: (TEMPLATES[req.kind] ?? TEMPLATES.technical)(req.text), answer_outline: TEMPLATE_OUTLINE, difficulty: 2, template: true,
});

export function nextQuestionId(questions) {
  return `q${questions.reduce((m, q) => Math.max(m, Number(String(q.id).replace(/^q/, '')) || 0), 0) + 1}`;
}

/**
 * The second pass. Compares questions against requirements IN CODE, then acts on the gaps by asking `fill` for
 * questions, and checks again.
 *   round 1: every gap (must and nice), batched
 *   round 2+: must-have gaps only, escalating (`fill` receives the round number and goes one requirement at a time)
 * Stops when: nothing is uncovered, MAX_REPAIR_ROUNDS is used, or `fill` raises a fatal LLM error.
 * Nice-to-have gaps left after round 1 are reported, not forced. A must-have still uncovered at the end gets a
 * template question, so a kit never ships with an uncovered must-have.
 *
 * @param {{ requirements, questions, fill: (a: {requirements: object[], round: number, existing: object[]}) => Promise<object[]>, maxRounds?: number, onProgress?: Function }} a
 * @returns {Promise<{ questions: object[], coverage: { uncovered_requirement_ids: string[], passes: number }, rounds: object[], templated: string[], errors: object[] }>}
 */
export async function runCoverageLoop({ requirements, questions, fill, maxRounds = MAX_REPAIR_ROUNDS, onProgress = () => {} }) {
  const byId = new Map(requirements.map((r) => [r.id, r]));
  const all = [...questions];
  const rounds = [];
  const errors = [];
  let check = checkCoverage({ requirements, questions: all });
  let passes = 1;
  const add = (qs, extra = {}) => { for (const q of qs) all.push({ id: nextQuestionId(all), ...q, origin: 'generated', ...extra }); };

  for (let round = 1; round <= maxRounds; round++) {
    const targetIds = round === 1 ? check.uncovered : check.uncoveredMust;
    if (!targetIds.length) break;
    onProgress({ step: 'coverage', status: 'running', detail: `round ${round}: ${targetIds.length} uncovered requirement(s)` });
    let stop = false;
    let added = 0;
    try {
      const fresh = await fill({ requirements: targetIds.map((id) => byId.get(id)), round, existing: all });
      add(fresh);
      added = fresh.length;
    } catch (err) {
      errors.push({ round, code: err.code || 'UNEXPECTED', message: err.message });
      stop = FATAL.has(err.code);
    }
    check = checkCoverage({ requirements, questions: all });
    passes++;
    rounds.push({ round, targeted: targetIds, added, uncovered_after: check.uncovered });
    if (stop) break;
  }

  const templated = [];
  for (const id of check.uncoveredMust) {
    add([templateQuestion(byId.get(id))]);
    templated.push(id);
  }
  if (templated.length) { check = checkCoverage({ requirements, questions: all }); passes++; }

  onProgress({ step: 'coverage', status: 'done', detail: `${check.uncovered.length} uncovered after ${passes} check(s)` });
  return { questions: all, coverage: { uncovered_requirement_ids: check.uncovered, passes }, rounds, templated, errors };
}
