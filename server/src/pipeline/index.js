import { PipelineError } from '../lib/errors.js';
import { createLlmClient } from '../lib/llm.js';
import { validateKit } from '../schema/kit.js';
import { allocateSchedule } from './allocateSchedule.js';
import { assembleKit } from './assembleKit.js';
import { runCoverageLoop } from './coverageLoop.js';
import { buildDraft } from './draft.js';
import { makeGapFiller } from './gapFill.js';
import { createRetrievalContext } from './retrievalContext.js';

/**
 * THE pipeline. Used by the web app and by `npm run evaluate` (no parallel implementation).
 *
 *   1  extract requirements            model proposes, code verifies         (fatal if it fails: no kit without it)
 *   2  research the company            crawl + public discussion             (failures become gaps, never fatal)
 *   3  read the hiring process         deterministic
 *   4  company brief                   model, grounded in crawled pages only
 *   5  questions per category          one call per category, process-aware
 *   6  flashcards                      model
 *   7  coverage loop                   DETERMINISTIC check -> fill gaps -> check again (<= 3 repair rounds)
 *   8  schedule                        DETERMINISTIC allocation over exactly `days`
 *   9  assemble + validate             fail loudly rather than save a malformed kit
 *
 * @param {{ jd: string, companyUrl: string, days: number, onProgress?: Function, llm?: object, retrievalCtx?: object, research?: Function }} input
 *   llm / retrievalCtx / research are injectable (tests, and so a batch run can share one LLM budget).
 * @returns {Promise<object>} a kit conforming to Appendix A
 */
export async function runPipeline({ jd, companyUrl, days, onProgress = () => {}, llm, retrievalCtx, research }) {
  if (typeof jd !== 'string' || !jd.trim()) throw new PipelineError('INVALID_INPUT', 'Job description is empty.');
  if (!Number.isInteger(days) || days < 1) throw new PipelineError('INVALID_INPUT', 'days must be a positive integer.');
  if (typeof companyUrl !== 'string' || !companyUrl.trim()) throw new PipelineError('INVALID_INPUT', 'company_url is required.');

  const client = llm ?? createLlmClient();
  const draft = await buildDraft({
    jd, companyUrl, llm: client, onProgress,
    retrievalCtx: retrievalCtx ?? createRetrievalContext(),
    ...(research ? { research } : {}),
  });
  const { role, brief, hiringProcess } = draft;

  const loop = await runCoverageLoop({
    requirements: role.requirements,
    questions: draft.questions,
    fill: makeGapFiller({
      role, company: draft.research.company, hiringProcess, llm: client,
      briefFacts: brief.grounded ? `${brief.summary}\n${brief.what_they_do}` : '',
    }),
    onProgress,
  });

  onProgress({ step: 'schedule', status: 'running' });
  const schedule = allocateSchedule({ questions: loop.questions, requirements: role.requirements, daysAvailable: days });
  onProgress({ step: 'schedule', status: 'done', detail: `${schedule.days.length} days` });

  const kit = assembleKit({
    jd, companyUrl, draft, questions: loop.questions, coverage: loop.coverage, schedule,
    templated: loop.templated, coverageErrors: loop.errors,
  });
  const checked = validateKit(kit);
  if (!checked.ok) throw new PipelineError('INVALID_KIT', `Generated kit failed validation: ${checked.errors.slice(0, 5).join('; ')}`);
  return checked.kit;
}
