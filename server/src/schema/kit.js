import { z } from 'zod';

/**
 * Appendix A, exactly. Field names must not change.
 * Extensions (allowed by the brief) are marked OPTIONAL EXTENSION.
 */

// OPTIONAL EXTENSION: edit-state tracking for the builder (Phase 6).
//   generated = model output, safe to overwrite on regenerate
//   edited    = user changed it, survives regeneration
//   user      = user wrote it, survives regeneration
// `pinned` additionally protects an item from being dropped/moved by regeneration.
const origin = z.enum(['generated', 'edited', 'user']).optional();
const pinned = z.boolean().optional();

export const Requirement = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  kind: z.enum(['technical', 'behavioural', 'domain']),
  priority: z.enum(['must', 'nice']),
});

export const Question = z.object({
  id: z.string().min(1),
  requirement_ids: z.array(z.string()),
  category: z.enum(['technical', 'behavioural', 'system-design', 'company-fit']),
  prompt: z.string().min(1),
  answer_outline: z.string(),
  difficulty: z.number().int().min(1).max(3),
  origin,
  pinned,
  // OPTIONAL EXTENSION: true when the question was built from a fixed template because the model never produced
  // one for a must-have requirement (last-resort coverage guarantee).
  template: z.boolean().optional(),
}).superRefine((q, ctx) => {
  // Appendix A: every question references the requirement ids it covers. A question the user wrote by hand may cover none.
  if (q.requirement_ids.length === 0 && q.origin !== 'user') {
    ctx.addIssue({ code: 'custom', path: ['requirement_ids'], message: 'must reference at least one requirement' });
  }
});

export const Flashcard = z.object({
  id: z.string().min(1),
  front: z.string().min(1),
  back: z.string().min(1),
  requirement_ids: z.array(z.string()),
  origin,
  pinned,
});

export const ScheduleDay = z.object({
  day: z.number().int().min(1),
  focus: z.string(),
  question_ids: z.array(z.string()),
  minutes: z.number().int().min(0), // integer minutes, never floats
  type: z.enum(['study', 'review']).optional(), // OPTIONAL EXTENSION: review days revisit earlier questions
  origin: z.enum(['generated', 'edited']).optional(), // OPTIONAL EXTENSION: edited focus/minutes survive re-allocation
});

// OPTIONAL EXTENSION: what research found and what it could not. Lets a kit say "thin" / "not found" honestly.
export const ResearchNotes = z.object({
  gaps: z.array(z.string()),
  hiring_page: z.string().nullable(),
  hiring_process: z.object({
    known: z.boolean(),
    confidence: z.enum(['published', 'reported', 'none']),
    signals: z.record(z.boolean()),
    // kept so a single category can be regenerated later with the same context the first draft had
    excerpt: z.string().optional(),
    reported_excerpts: z.array(z.object({ url: z.string(), text: z.string() })).optional(),
  }),
  discussion_searched: z.boolean(),
  discussion_found: z.boolean(),
  discussion_sources: z.array(z.string()),
  skipped_sources: z.array(z.object({ url: z.string().optional(), code: z.string(), reason: z.string() })),
  thin_description: z.boolean(),
});

export const KitSchema = z.object({
  source: z.object({
    company: z.string(),
    company_url: z.string(),
    role: z.string(),
    location: z.string(),
    jd_chars: z.number().int().min(0),
    researched_at: z.string(),
    pages_used: z.array(z.string()),
  }),
  company_brief: z.object({
    summary: z.string(),
    what_they_do: z.string(),
    sources: z.array(z.string()),
    origin: z.enum(['generated', 'edited']).optional(), // OPTIONAL EXTENSION: 'edited' => regenerating asks for confirmation
  }),
  role: z.object({
    title: z.string(),
    seniority: z.string(),
    responsibilities: z.array(z.string()),
    requirements: z.array(Requirement),
  }),
  questions: z.array(Question),
  flashcards: z.array(Flashcard),
  schedule: z.object({
    days_available: z.number().int().min(1),
    days: z.array(ScheduleDay),
  }),
  coverage: z.object({
    uncovered_requirement_ids: z.array(z.string()),
    passes: z.number().int().min(0),
  }),
  research: ResearchNotes.optional(),
});

const dupes = (ids) => ids.filter((id, i) => ids.indexOf(id) !== i);

/**
 * Shape validation (zod) + referential integrity the brief requires:
 * stable unique ids, question/flashcard requirement ids exist,
 * schedule question_ids exist, schedule length == days_available.
 * @returns {{ ok: true, kit } | { ok: false, errors: string[] }}
 */
export function validateKit(input) {
  const parsed = KitSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
    };
  }
  const kit = parsed.data;
  const errors = [];

  const reqIds = new Set(kit.role.requirements.map((r) => r.id));
  const qIds = new Set(kit.questions.map((q) => q.id));

  for (const d of dupes(kit.role.requirements.map((r) => r.id))) errors.push(`duplicate requirement id: ${d}`);
  for (const d of dupes(kit.questions.map((q) => q.id))) errors.push(`duplicate question id: ${d}`);
  for (const d of dupes(kit.flashcards.map((f) => f.id))) errors.push(`duplicate flashcard id: ${d}`);

  for (const q of kit.questions)
    for (const id of q.requirement_ids)
      if (!reqIds.has(id)) errors.push(`question ${q.id} references unknown requirement ${id}`);
  for (const f of kit.flashcards)
    for (const id of f.requirement_ids)
      if (!reqIds.has(id)) errors.push(`flashcard ${f.id} references unknown requirement ${id}`);
  for (const day of kit.schedule.days)
    for (const id of day.question_ids)
      if (!qIds.has(id)) errors.push(`schedule day ${day.day} references unknown question ${id}`);
  for (const id of kit.coverage.uncovered_requirement_ids)
    if (!reqIds.has(id)) errors.push(`coverage lists unknown requirement ${id}`);

  if (kit.schedule.days.length !== kit.schedule.days_available)
    errors.push(
      `schedule has ${kit.schedule.days.length} days but days_available is ${kit.schedule.days_available}`
    );

  return errors.length ? { ok: false, errors } : { ok: true, kit };
}
