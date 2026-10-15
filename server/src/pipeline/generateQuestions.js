import { notImplemented } from '../lib/errors.js';
/**
 * PHASE 3 (LLM). Generate questions for a GIVEN set of requirements and ONE category.
 * Called separately per category with category-specific instructions (technical != behavioural),
 * and informed by hiring-process findings (e.g. take-home + system design round).
 * Every question must reference requirement_ids.
 */
export async function generateQuestions(/* { requirements, category, hiringProcess } */) {
  throw notImplemented('generateQuestions', 'Phase 3');
}
