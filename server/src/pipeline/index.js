import { PipelineError, notImplemented } from '../lib/errors.js';

/**
 * Single orchestrator used by BOTH the web app and `npm run evaluate`.
 * (No parallel implementation -- the brief checks this.)
 *
 * Planned sequence (each step responds to what the previous found):
 *   1. extractRequirements(jd)                                  LLM
 *   2. crawlSite(companyUrl) -> fetchPage()                     deterministic + ranking; failures recorded, not fatal
 *   3. findPublicDiscussion(company)                            best-effort
 *   4. buildCompanyBrief(research)                              LLM, honest when empty
 *   5. generateQuestions() per category                         LLM, one call per category, hiring-process aware
 *   6. checkCoverage() -> generate for gaps -> checkCoverage()  LOOP, capped passes (Phase 4)
 *   7. flashcards                                               LLM
 *   8. allocateSchedule()                                       deterministic
 *   9. validateKit()                                            fail loudly before saving
 *
 * @param {{ jd: string, companyUrl: string, days: number, onProgress?: (e: {step: string, status: string, detail?: string}) => void }} input
 * @returns {Promise<object>} a kit conforming to Appendix A
 */
export async function runPipeline(input) {
  const { jd, companyUrl, days } = input;
  if (!jd || !jd.trim()) throw new PipelineError('INVALID_INPUT', 'Job description is empty.');
  if (!Number.isInteger(days) || days < 1) throw new PipelineError('INVALID_INPUT', 'days must be a positive integer.');
  if (!companyUrl) throw new PipelineError('INVALID_INPUT', 'company_url is required.');
  throw notImplemented('Kit pipeline', 'Phases 2-4');
}
