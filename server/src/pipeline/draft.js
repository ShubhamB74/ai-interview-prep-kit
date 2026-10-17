import { NO_BUDGET, SKIP_AT } from '../lib/timeBudget.js';
import { extractRequirements } from './extractRequirements.js';
import { researchCompany } from './research.js';
import { analyzeHiringProcess } from './hiringProcess.js';
import { buildCompanyBrief } from './companyBrief.js';
import { planCategories } from './questionPlan.js';
import { generateQuestions } from './generateQuestions.js';
import { generateFlashcards } from './generateFlashcards.js';

/**
 * Everything up to (not including) the coverage loop and the schedule:
 *   extract requirements -> research the company -> read the hiring process -> brief ->
 *   questions per category (each its own call) -> flashcards.
 * Each step reacts to the previous one's result. Only requirement extraction is fatal: every later step that
 * fails (or is skipped for time) is recorded in `failures` and the draft carries on, so the coverage loop can still
 * fill the gap.
 */
export async function buildDraft({ jd, companyUrl, retrievalCtx, llm, research: researchFn = researchCompany, onProgress = () => {}, budget = NO_BUDGET }) {
  const step = (name, status, detail) => onProgress({ step: name, status, detail });
  const failures = [];
  const skipForTime = (name) => {
    failures.push({ step: name, code: 'TIME_BUDGET', message: 'skipped to stay within the time budget' });
    step(name, 'skipped', 'time budget');
  };
  const attempt = async (name, fn, fallback) => {
    step(name, 'running');
    try {
      const r = await fn();
      step(name, 'done');
      return r;
    } catch (err) {
      failures.push({ step: name, code: err.code || 'UNEXPECTED', message: err.message });
      step(name, 'failed', err.message);
      return fallback;
    }
  };

  step('extract_requirements', 'running');
  const role = await extractRequirements(jd, { llm }); // fatal on purpose: no requirements step, no kit
  step('extract_requirements', 'done', `${role.requirements.length} requirements${role.thin ? ' (thin posting)' : ''}`);

  step('research', 'running');
  const research = await researchFn({ companyUrl, company: role.company }, retrievalCtx);
  step('research', 'done', `${research.crawl.pages.length} pages, ${research.discussion.snippets.length} discussion snippets`);

  const hiringProcess = analyzeHiringProcess(research);
  step('hiring_process', 'done', hiringProcess.confidence);

  const brief = await attempt('company_brief', () => buildCompanyBrief({ company: research.company, research }, { llm }), {
    summary: `The company brief could not be generated (${research.company || 'unknown company'}).`, what_they_do: 'Not available.', sources: [], grounded: false,
  });
  const hasCompanyInfo = brief.grounded;
  const briefFacts = hasCompanyInfo ? `${brief.summary}\n${brief.what_they_do}` : '';

  const plan = planCategories({ requirements: role.requirements, seniority: role.seniority, hiringProcess, hasCompanyInfo });
  const questions = [];
  for (const p of plan) {
    const name = `questions:${p.category}`;
    if (budget.exceeded(SKIP_AT.category)) { skipForTime(name); continue; } // the coverage loop still guarantees must-haves
    const r = await attempt(name, () => generateQuestions({
      category: p.category, requirements: p.requirements, role, company: research.company, briefFacts, hiringProcess,
      avoid: questions.map((q) => q.prompt), limitedCompanyInfo: p.limitedCompanyInfo,
    }, { llm }), { questions: [], dropped: 0 });
    for (const q of r.questions) questions.push({ id: `q${questions.length + 1}`, ...q, origin: 'generated' });
  }

  let cards = { flashcards: [], dropped: 0 };
  if (role.requirements.length) {
    if (budget.exceeded(SKIP_AT.flashcards)) skipForTime('flashcards');
    else cards = await attempt('flashcards', () => generateFlashcards({ requirements: role.requirements, role, company: research.company }, { llm }), cards);
  }
  const flashcards = cards.flashcards.map((c, i) => ({ id: `f${i + 1}`, ...c, origin: 'generated' }));

  return { role, research, hiringProcess, brief, plan: plan.map((p) => ({ category: p.category, requirement_ids: p.requirements.map((r) => r.id) })), questions, flashcards, failures };
}
