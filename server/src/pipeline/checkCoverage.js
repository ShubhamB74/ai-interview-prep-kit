/**
 * DETERMINISTIC (no model). A requirement is covered iff at least one question lists its id.
 * Question ids that point at unknown requirements are ignored; they cannot cover anything.
 * @returns {{ uncovered: string[], uncoveredMust: string[] }} requirement ids, in requirement order.
 */
export function checkCoverage({ requirements, questions }) {
  const covered = new Set();
  for (const q of questions) for (const id of q.requirement_ids) covered.add(id);
  const gaps = requirements.filter((r) => !covered.has(r.id));
  return { uncovered: gaps.map((r) => r.id), uncoveredMust: gaps.filter((r) => r.priority === 'must').map((r) => r.id) };
}
