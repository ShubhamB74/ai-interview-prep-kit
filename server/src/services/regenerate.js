import { isReplaceable } from '@prepkit/shared/kitOps';
import { AppError } from '../lib/errors.js';
import { allocateSchedule } from '../pipeline/allocateSchedule.js';
import { buildCompanyBrief } from '../pipeline/companyBrief.js';
import { runCoverageLoop } from '../pipeline/coverageLoop.js';
import { dedupeKey } from '../pipeline/jdEvidence.js';
import { generateQuestions } from '../pipeline/generateQuestions.js';
import { makeGapFiller } from '../pipeline/gapFill.js';
import { planCategories } from '../pipeline/questionPlan.js';
import { reconcileSchedule } from '../pipeline/reconcileSchedule.js';
import { researchCompany } from '../pipeline/research.js';
import { checkCoverage } from '../pipeline/checkCoverage.js';
import { applyToKit } from './kitEditor.js';

const notReady = () => new AppError('KIT_NOT_READY', 'This kit is not ready to edit yet.', { status: 409 });
const randomId = () => `q-${Math.random().toString(36).slice(2, 8)}`;

/** Rebuilds the context the first draft had, from what the kit stored. Older kits without it fall back to "unknown". */
export function contextFromKit(kit) {
  const hp = kit.research?.hiring_process;
  const hasCompanyInfo = kit.company_brief.sources.length > 0;
  return {
    role: { title: kit.role.title, seniority: kit.role.seniority },
    company: kit.source.company,
    hasCompanyInfo,
    briefFacts: hasCompanyInfo ? `${kit.company_brief.summary}\n${kit.company_brief.what_they_do}` : '',
    hiringProcess: hp
      ? { known: hp.known, confidence: hp.confidence, signals: hp.signals, excerpt: hp.excerpt ?? '', reported_excerpts: hp.reported_excerpts ?? [] }
      : { known: false, confidence: 'none', signals: {}, excerpt: '', reported_excerpts: [] },
  };
}

/** Adds new generated questions at the end of their category block, with ids that are never reused. */
function addGenerated(kit, incoming) {
  const used = new Set([...kit.questions, ...kit.flashcards].map((x) => x.id));
  for (const q of incoming) {
    let id = randomId();
    while (used.has(id)) id = randomId();
    used.add(id);
    let last = -1;
    kit.questions.forEach((x, i) => { if (x.category === q.category) last = i; });
    const { id: _drop, ...rest } = q;
    kit.questions.splice(last >= 0 ? last + 1 : kit.questions.length, 0, { ...rest, id, origin: 'generated' });
  }
}

/**
 * Regenerate ONE question category.
 * What is replaced is decided at COMMIT time against the latest document, not against the snapshot the model saw:
 * anything the user edited, wrote, moved or pinned (even while the model was thinking) is kept, and new questions
 * never repeat a prompt that survived. Afterwards the requirements of this category are re-checked for coverage.
 */
export async function regenerateQuestions({ kits, id, userId, category, llm }) {
  const rec = await kits.findOwned(id, userId);
  if (!rec) throw new AppError('KIT_NOT_FOUND', 'Kit not found.', { status: 404 });
  if (rec.status !== 'ready' || !rec.kit) throw notReady();
  const snap = rec.kit;
  const ctx = contextFromKit(snap);
  const requirements = snap.role.requirements;

  const planned = planCategories({ requirements, seniority: snap.role.seniority, hiringProcess: ctx.hiringProcess, hasCompanyInfo: ctx.hasCompanyInfo }).find((p) => p.category === category);
  const replaceable = snap.questions.filter((q) => q.category === category && isReplaceable(q));
  const wanted = new Set([...(planned?.requirements ?? []).map((r) => r.id), ...replaceable.flatMap((q) => q.requirement_ids)]);
  const reqs = requirements.filter((r) => wanted.has(r.id));
  if (!reqs.length) throw new AppError('NOTHING_TO_REGENERATE', `There is nothing to regenerate in "${category}".`, { status: 409 });

  const { questions: fresh } = await generateQuestions({
    category, requirements: reqs, role: ctx.role, company: ctx.company, briefFacts: ctx.briefFacts, hiringProcess: ctx.hiringProcess,
    avoid: snap.questions.map((q) => q.prompt), limitedCompanyInfo: planned?.limitedCompanyInfo,
  }, { llm });
  if (!fresh.length && replaceable.length) {
    throw new AppError('REGEN_EMPTY', 'The model returned no new questions, so your existing questions were kept.', { status: 502 });
  }

  const saved = await applyToKit(kits, id, userId, (kit) => {
    kit.questions = kit.questions.filter((q) => !(q.category === category && isReplaceable(q))); // latest doc, not the snapshot
    const keep = new Set(kit.questions.map((q) => dedupeKey(q.prompt)));
    addGenerated(kit, fresh.filter((q) => !keep.has(dedupeKey(q.prompt))));
    reconcileSchedule(kit);
  });

  // Second pass, scoped to this category's requirements: never refill something the user deleted elsewhere.
  const gaps = checkCoverage({ requirements: reqs, questions: saved.kit.questions });
  if (gaps.uncovered.length) {
    const have = new Set(saved.kit.questions.map((q) => q.id));
    const loop = await runCoverageLoop({
      requirements: reqs, questions: saved.kit.questions,
      fill: makeGapFiller({ ...ctx, llm }),
    });
    const extra = loop.questions.filter((q) => !have.has(q.id));
    if (extra.length) {
      return applyToKit(kits, id, userId, (kit) => {
        addGenerated(kit, extra);
        kit.coverage.passes += loop.coverage.passes;
        reconcileSchedule(kit);
      });
    }
  }
  return saved;
}

/** Re-research the company and rewrite the brief. Never replaces a good brief with an empty one, nor a brief the user edited meanwhile. */
export async function regenerateBrief({ kits, id, userId, llm, retrievalCtx, research = researchCompany, force = false }) {
  const rec = await kits.findOwned(id, userId);
  if (!rec) throw new AppError('KIT_NOT_FOUND', 'Kit not found.', { status: 404 });
  if (rec.status !== 'ready' || !rec.kit) throw notReady();
  const snap = rec.kit;

  const r = await research({ companyUrl: snap.source.company_url, company: snap.source.company }, retrievalCtx);
  const brief = await buildCompanyBrief({ company: r.company, research: r }, { llm });
  if (!brief.grounded && snap.company_brief.sources.length) {
    throw new AppError('REGEN_NO_NEW_INFO', 'The company site could not be read this time, so your existing brief was kept.', { status: 502 });
  }

  return applyToKit(kits, id, userId, (kit) => {
    if (kit.company_brief.origin === 'edited' && !force) {
      throw new AppError('REGEN_SUPERSEDED_BY_EDIT', 'You edited the brief while it was regenerating, so your version was kept.', { status: 409 });
    }
    kit.company_brief = { summary: brief.summary, what_they_do: brief.what_they_do, sources: brief.sources, origin: 'generated' };
    kit.source.pages_used = [...new Set([...kit.source.pages_used, ...r.pagesUsed])];
  });
}

/** Instant and deterministic. Starts from scratch (this is the explicit "rebuild the plan" action); optionally for a new number of days. */
export function regenerateSchedule({ kits, id, userId, days }) {
  return applyToKit(kits, id, userId, (kit) => {
    kit.schedule = allocateSchedule({ questions: kit.questions, requirements: kit.role.requirements, daysAvailable: days ?? kit.schedule.days_available });
  });
}
