import { notImplemented } from '../lib/errors.js';
/**
 * PHASE 4 (DETERMINISTIC -- no model). Pure function:
 *   checkCoverage({ requirements, questions }) -> { uncovered: string[] }
 * A requirement is uncovered if no question lists its id. Must-haves are the ones that block shipping.
 */
export function checkCoverage(/* { requirements, questions } */) {
  throw notImplemented('checkCoverage', 'Phase 4');
}
