import { z } from 'zod';

/**
 * Shapes we accept from the model. Deliberately forgiving about case, nulls and synonyms (models drift),
 * and strict about everything the code relies on. List items are validated one by one in the steps so a
 * single bad item is dropped and counted, instead of failing the whole response.
 */
const str = (max = 500) => z.string().nullish().transform((v) => String(v ?? '').trim().slice(0, max));
const strArr = (maxItems, maxLen = 300) =>
  z.array(z.string()).nullish().transform((v) => (v ?? []).map((s) => s.trim().slice(0, maxLen)).filter(Boolean).slice(0, maxItems));

const enumNorm = (synonyms, values) =>
  z.preprocess((v) => {
    if (typeof v !== 'string') return v;
    const s = v.trim().toLowerCase().replace(/[\s_]+/g, '-');
    return synonyms[s] ?? s;
  }, z.enum(values));

const KIND = enumNorm({ behavioral: 'behavioural', soft: 'behavioural', 'soft-skill': 'behavioural' }, ['technical', 'behavioural', 'domain']);
const PRIORITY = enumNorm(
  { required: 'must', 'must-have': 'must', mandatory: 'must', essential: 'must', preferred: 'nice', 'nice-to-have': 'nice', bonus: 'nice', optional: 'nice', plus: 'nice' },
  ['must', 'nice']
);

const SENIORITY = ['intern', 'junior', 'mid', 'senior', 'staff', 'lead', 'principal', 'manager', 'director'];
const SENIORITY_SYNONYMS = { 'mid-level': 'mid', intermediate: 'mid', associate: 'junior', sr: 'senior', 'sr.': 'senior', entry: 'junior', 'entry-level': 'junior' };
const seniority = str(30).transform((v) => {
  const s = v.toLowerCase().replace(/[\s_]+/g, '-');
  const n = SENIORITY_SYNONYMS[s] ?? s;
  return SENIORITY.includes(n) ? n : '';
});

const difficulty = z.preprocess((v) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(3, Math.max(1, Math.round(n))) : 2;
}, z.number().int().min(1).max(3));

const list = z.array(z.unknown()).nullish().transform((v) => v ?? []);

export const ExtractionOut = z.object({
  company: str(100), title: str(120), seniority, location: str(100),
  responsibilities: strArr(10, 200),
  requirements: list,
});
export const ExtractedRequirement = z.object({ text: str(300).pipe(z.string().min(2)), kind: KIND.catch('technical'), priority: PRIORITY.catch('must'), evidence: str(300) });

export const BriefOut = z.object({ summary: str(700), what_they_do: str(700), source_urls: strArr(8, 500) });

export const QuestionsOut = z.object({ questions: list });
export const GeneratedQuestion = z.object({
  requirement_ids: strArr(6, 20),
  prompt: str(400).pipe(z.string().min(5)),
  answer_outline: str(800),
  difficulty,
});

export const FlashcardsOut = z.object({ flashcards: list });
export const GeneratedFlashcard = z.object({
  front: str(300).pipe(z.string().min(2)),
  back: str(500).pipe(z.string().min(2)),
  requirement_ids: strArr(6, 20),
});
