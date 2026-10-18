import { allocateSchedule } from '../src/pipeline/allocateSchedule.js';
import { validateKit } from '../src/schema/kit.js';
import { createMemoryRepos } from '../src/repos/memory.js';

export const REQS = [
  { id: 'r1', text: '5+ years Node.js', kind: 'technical', priority: 'must' },
  { id: 'r2', text: 'Design scalable APIs', kind: 'technical', priority: 'must' },
  { id: 'r3', text: 'Mentor junior engineers', kind: 'behavioural', priority: 'must' },
  { id: 'r4', text: 'Payments knowledge', kind: 'domain', priority: 'nice' },
];
const q = (id, category, reqs, difficulty = 2, extra = {}) => ({ id, requirement_ids: reqs, category, prompt: `Original ${id} question?`, answer_outline: 'outline', difficulty, origin: 'generated', ...extra });

/** A valid, ready Appendix A kit with a mix of categories. */
export function makeKit({ requirements = REQS, questions, flashcards, days = 3 } = {}) {
  const qs = questions ?? [
    q('q1', 'technical', ['r1']), q('q2', 'technical', ['r2']), q('q3', 'technical', ['r1', 'r2'], 3),
    q('q4', 'behavioural', ['r3']), q('q5', 'company-fit', ['r4'], 1), q('q6', 'system-design', ['r2'], 3),
  ];
  const kit = {
    source: { company: 'Acme', company_url: 'https://acme.test/', role: 'Senior Backend Engineer', location: '', jd_chars: 400, researched_at: '2026-01-01T00:00:00.000Z', pages_used: ['https://acme.test/'] },
    company_brief: { summary: 'Acme builds payment rails.', what_they_do: 'Payments for banks.', sources: ['https://acme.test/'], origin: 'generated' },
    role: { title: 'Senior Backend Engineer', seniority: 'senior', responsibilities: ['Build services'], requirements },
    questions: qs,
    flashcards: flashcards ?? [
      { id: 'f1', front: 'What is an event loop?', back: 'Node schedules callbacks.', requirement_ids: ['r1'], origin: 'generated' },
      { id: 'f2', front: 'Idempotency?', back: 'Repeating a call has the same effect.', requirement_ids: ['r2'], origin: 'generated' },
    ],
    schedule: allocateSchedule({ questions: qs, requirements, daysAvailable: days }),
    coverage: { uncovered_requirement_ids: [], passes: 1 },
    research: {
      gaps: [], hiring_page: null, hiring_process: { known: false, confidence: 'none', signals: {} },
      discussion_searched: true, discussion_found: false, discussion_sources: [], skipped_sources: [], thin_description: false,
    },
  };
  const v = validateKit(kit);
  if (!v.ok) throw new Error(`fixture invalid: ${v.errors.join('; ')}`);
  return v.kit;
}

/** Memory repos + a user + a READY kit record (version 1). */
export async function readyKitRecord(kit = makeKit(), repos = createMemoryRepos()) {
  const user = await repos.users.create({ email: `u${Math.random().toString(36).slice(2)}@x.com`, passwordHash: 'h' });
  const rec = await repos.kits.create({ userId: user.id, title: 'Kit', inputHash: `h${Math.random()}`, input: { jd: 'jd', company_url: 'https://acme.test/', days: kit.schedule.days_available } });
  await repos.kits.claim(rec.id);
  await repos.kits.finish(rec.id, 1, kit);
  return { repos, user, id: rec.id, get: () => repos.kits.findOwned(rec.id, user.id) };
}
