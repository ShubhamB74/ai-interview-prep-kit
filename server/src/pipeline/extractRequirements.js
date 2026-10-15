import { notImplemented } from '../lib/errors.js';
/**
 * PHASE 3 (LLM). JD text -> { title, seniority, location, company?, responsibilities[], requirements[] }
 * Rules: stable ids r1..rn; priority from the posting's own wording ("required" vs "bonus");
 * NEVER invent. A two-line stub yields few/zero requirements and a flag `thin: true`.
 */
export async function extractRequirements(/* jd */) {
  throw notImplemented('extractRequirements', 'Phase 3');
}
