import { allocateSchedule } from './allocateSchedule.js';

/**
 * Re-flows the schedule after the question set changed (add/delete/regenerate/difficulty edits). Deterministic.
 * Days the user edited by hand keep their focus text and minutes; everything else is recomputed, so a deleted question
 * disappears from the plan and a new one appears in it. Mutates `kit`.
 */
export function reconcileSchedule(kit) {
  const fresh = allocateSchedule({ questions: kit.questions, requirements: kit.role.requirements, daysAvailable: kit.schedule.days_available });
  const edited = new Map(kit.schedule.days.filter((d) => d.origin === 'edited').map((d) => [d.day, d]));
  kit.schedule = {
    ...(kit.schedule.starts_at ? { starts_at: kit.schedule.starts_at } : {}),
    days_available: fresh.days_available,
    days: fresh.days.map((d) => (edited.has(d.day) ? { ...d, focus: edited.get(d.day).focus, minutes: edited.get(d.day).minutes, origin: 'edited' } : d)),
  };
}
