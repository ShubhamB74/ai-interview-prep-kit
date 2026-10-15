/**
 * Deterministic checks on what the model claims about a job description.
 *  - verifyEvidence: a requirement only survives if its quoted evidence really is in the posting.
 *  - priorityFromContext: explicit wording ("Bonus:", a "Nice to have" heading, "required") overrides the model.
 */
export const normalizeForMatch = (s) =>
  String(s).toLowerCase()
    .replace(/[`*_#>•·●▪◦‣\-–—]+/g, ' ')
    .replace(/[^\p{L}\p{N}+#.\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Key for "is this the same question/card?": letters and digits only, so punctuation and case don't hide duplicates. */
export const dedupeKey = (s) => String(s).toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();

const words = (s) => [...new Set(normalizeForMatch(s).split(' ').filter((w) => w.length >= 3 || /\d/.test(w)))];

/** @returns {{ ok: boolean, lineIndex?: number }} */
export function verifyEvidence(jd, evidence) {
  const lines = jd.split(/\r?\n/);
  const nl = lines.map(normalizeForMatch);
  const ne = normalizeForMatch(evidence);
  if (ne.length < 3) return { ok: false };
  // Prefer a match inside a single line; only then allow a quote that wraps across two lines.
  // (Otherwise the LAST words of one line plus the first of the next could point at the wrong line.)
  for (let i = 0; i < nl.length; i++) if (nl[i].includes(ne)) return { ok: true, lineIndex: i };
  for (let i = 0; i + 1 < nl.length; i++) {
    if (`${nl[i]} ${nl[i + 1]}`.includes(ne)) return { ok: true, lineIndex: nl[i + 1].includes(ne.split(' ').at(-1)) && !nl[i].includes(ne.split(' ')[0]) ? i + 1 : i };
  }
  const tokens = words(evidence); // fuzzy fallback for lightly reworded quotes; needs 3+ distinctive words
  if (tokens.length >= 3) {
    for (let i = 0; i < nl.length; i++) {
      const window = `${nl[i]} ${nl[i + 1] ?? ''}`;
      if (tokens.filter((t) => window.includes(t)).length / tokens.length >= 0.75) return { ok: true, lineIndex: i };
    }
  }
  return { ok: false };
}

const NICE = /\b(nice[ -]to[ -]have|bonus|preferred|pluses|plus|a plus|ideally|good to have|desirable|optional|extra credit|would be (?:great|nice)|not required)\b/i;
const MUST = /\b(required|must|essential|mandatory|minimum)\b/i;
const HEADING_MUST = /\b(required|requirements?|must[ -]haves?|minimum|essential|mandatory|qualifications|what you(?:'ll| will)? (?:need|bring)|you have)\b/i;

function isHeading(line) {
  const l = line.trim();
  if (!l || l.length > 70 || /^[-*•·●▪]\s/.test(l)) return false;
  if (/[:：]$/.test(l) || /^#{1,6}\s/.test(l) || /^\*\*[^*]+\*\*:?$/.test(l) || (l === l.toUpperCase() && /[A-Z]/.test(l))) return true;
  return !/[.!?,;]$/.test(l) && (NICE.test(l) || HEADING_MUST.test(l));
}

function bestClause(line, evidence) {
  const clauses = line.split(/(?<=[.;!?])\s+|\s+[•·●▪]\s+/).filter(Boolean);
  if (clauses.length <= 1) return line;
  const ev = words(evidence);
  let best = clauses[0];
  let bestScore = -1;
  for (const c of clauses) {
    const n = normalizeForMatch(c);
    const score = ev.filter((w) => n.includes(w)).length;
    if (score > bestScore) { best = c; bestScore = score; }
  }
  return best;
}

/** @returns {{ priority: 'must'|'nice'|null, cue: 'clause'|'heading'|null }} null = no explicit cue, keep the model's call. */
export function priorityFromContext(jd, lineIndex, evidence) {
  const lines = jd.split(/\r?\n/);
  const clause = bestClause(lines[lineIndex] ?? '', evidence);
  if (NICE.test(clause)) return { priority: 'nice', cue: 'clause' };
  if (MUST.test(clause)) return { priority: 'must', cue: 'clause' };
  let seen = 0;
  for (let i = lineIndex - 1; i >= 0 && seen < 20; i--) {
    if (!lines[i].trim()) continue;
    seen++;
    if (isHeading(lines[i])) {
      if (NICE.test(lines[i])) return { priority: 'nice', cue: 'heading' };
      if (HEADING_MUST.test(lines[i])) return { priority: 'must', cue: 'heading' };
      break; // nearest heading has no cue: don't look further up
    }
  }
  return { priority: null, cue: null };
}
