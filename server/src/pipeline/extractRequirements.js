import { ExtractedRequirement, ExtractionOut } from '../schema/llmOutputs.js';
import { extractionPrompt, EXTRACTION_MAX_JD_CHARS } from './prompts.js';
import { priorityFromContext, verifyEvidence, normalizeForMatch } from './jdEvidence.js';

const MAX_REQUIREMENTS = 25;
const THIN_CHARS = 300;
const THIN_REQUIREMENTS = 3;

/**
 * Job description -> { company, title, seniority, location, responsibilities[], requirements[], thin, thinReasons[], dropped }.
 * The model proposes; CODE decides what survives:
 *   - ids (r1..rn) are assigned here, in order, never by the model
 *   - a requirement whose quoted evidence is not in the posting is dropped (no invented requirements)
 *   - explicit wording in the posting ("Bonus:", "Nice to have" heading, "required") overrides the model's priority
 *   - a company name that does not appear in the posting is discarded
 * A stub posting yields few/no requirements and `thin: true`; it is never padded.
 */
export async function extractRequirements(jd, { llm }) {
  const jdForModel = jd.slice(0, EXTRACTION_MAX_JD_CHARS);
  const out = await llm.completeJson({
    name: 'extract_requirements',
    ...extractionPrompt(jdForModel),
    schema: ExtractionOut,
    maxTokens: 1800,
  });

  const requirements = [];
  const dropped = { invalid: 0, unverified: [], duplicate: 0, overCap: 0 };
  const seen = new Set();

  for (const raw of out.requirements) {
    const item = ExtractedRequirement.safeParse(raw);
    if (!item.success) { dropped.invalid++; continue; }
    const { text, kind, evidence } = item.data;
    const ev = verifyEvidence(jdForModel, evidence || text); // fall back to the text itself if no evidence was given
    if (!ev.ok) { dropped.unverified.push(text); continue; }
    const key = normalizeForMatch(text);
    if (seen.has(key)) { dropped.duplicate++; continue; }
    if (requirements.length >= MAX_REQUIREMENTS) { dropped.overCap++; continue; }
    seen.add(key);

    const cue = priorityFromContext(jdForModel, ev.lineIndex, evidence || text);
    requirements.push({
      id: `r${requirements.length + 1}`,
      text,
      kind,
      priority: cue.priority ?? item.data.priority,
      ...(cue.priority && cue.priority !== item.data.priority ? { priority_overridden: true } : {}),
    });
  }

  const company = out.company && normalizeForMatch(jd).includes(normalizeForMatch(out.company)) ? out.company : '';

  const thinReasons = [];
  if (jd.trim().length < THIN_CHARS) thinReasons.push(`The job description is very short (${jd.trim().length} characters).`);
  if (requirements.length < THIN_REQUIREMENTS) thinReasons.push(`Only ${requirements.length} requirement${requirements.length === 1 ? '' : 's'} could be found in the description.`);

  return {
    company,
    title: out.title,
    seniority: out.seniority,
    location: out.location,
    responsibilities: out.responsibilities,
    requirements,
    thin: thinReasons.length > 0,
    thinReasons,
    dropped,
  };
}
