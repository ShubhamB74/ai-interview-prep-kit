import { notImplemented } from '../lib/errors.js';
/**
 * PHASE 4 (DETERMINISTIC -- no model). Pure function:
 *   allocateSchedule({ questions, requirements, daysAvailable }) -> { days_available, days[] }
 * Invariants (test these):
 *  - days.length === daysAvailable (1-day and 60-day both work)
 *  - every must-have requirement appears in some day's questions
 *  - harder + must-priority questions land earlier
 *  - minutes are integers; every question_id exists
 */
export function allocateSchedule(/* { questions, requirements, daysAvailable } */) {
  throw notImplemented('allocateSchedule', 'Phase 4');
}
