import { notImplemented } from './errors.js';

/**
 * PHASE 3. Provider-agnostic LLM client. Responsibilities:
 *  - one `completeJson({ system, user, schema })` entry point used by every step
 *  - token-per-minute budgeting + 429/5xx retry with exponential backoff + jitter (honour Retry-After)
 *  - parse + zod-validate JSON; on failure, one "repair" retry, then throw LLM_INVALID_JSON
 *  - wrap untrusted text in delimiters and instruct the model to treat it as data, never instructions
 */
export async function completeJson(/* { system, user, schema, untrusted } */) {
  throw notImplemented('LLM client', 'Phase 3');
}
