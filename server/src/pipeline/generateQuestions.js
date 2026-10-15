import { GeneratedQuestion, QuestionsOut } from '../schema/llmOutputs.js';
import { questionsPrompt } from './prompts.js';
import { dedupeKey } from './jdEvidence.js';

const CHUNK = 5;                       // requirements per model call: keeps output small for free-tier token limits
const MAX_PER_CALL = { 'system-design': 3, 'company-fit': 4, technical: 8, behavioural: 6 };

/** must requirements get two questions, nice ones one (capped per category). */
export const questionCount = (category, reqs) =>
  Math.min(MAX_PER_CALL[category] ?? 6, reqs.reduce((n, r) => n + (r.priority === 'must' && category !== 'company-fit' ? 2 : 1), 0));

/**
 * Questions for ONE category and a given set of requirements. Separate call per category, with category-specific
 * instructions and the hiring-process context. The model may only reference the ids it was given: unknown ids are
 * removed, and a question left with no valid id is dropped (never silently re-attached to something else).
 * `category` is set here, not by the model.
 * @returns {Promise<{ questions: object[], dropped: number }>}  questions have no ids yet; the caller assigns them.
 */
export async function generateQuestions({ category, requirements, role, company, briefFacts, hiringProcess, avoid = [], limitedCompanyInfo = false }, { llm }) {
  const valid = new Set(requirements.map((r) => r.id));
  const seen = new Set(avoid.map(dedupeKey));
  const questions = [];
  let dropped = 0;

  const chunks = category === 'system-design' ? [requirements] : Array.from({ length: Math.ceil(requirements.length / CHUNK) }, (_, i) => requirements.slice(i * CHUNK, (i + 1) * CHUNK));

  for (const chunk of chunks) {
    const count = questionCount(category, chunk);
    const out = await llm.completeJson({
      name: `questions:${category}`,
      ...questionsPrompt({
        category, requirements: chunk, role, company, briefFacts, hiringProcess, count, limitedCompanyInfo,
        avoid: [...avoid, ...questions.map((q) => q.prompt)],
      }),
      schema: QuestionsOut,
      maxTokens: Math.min(4096, 500 + 260 * count),
    });

    for (const raw of out.questions) {
      const parsed = GeneratedQuestion.safeParse(raw);
      if (!parsed.success) { dropped++; continue; }
      const ids = [...new Set(parsed.data.requirement_ids.filter((id) => valid.has(id)))];
      const key = dedupeKey(parsed.data.prompt);
      if (!ids.length || seen.has(key)) { dropped++; continue; }
      seen.add(key);
      questions.push({ requirement_ids: ids, category, prompt: parsed.data.prompt, answer_outline: parsed.data.answer_outline, difficulty: parsed.data.difficulty });
    }
  }
  return { questions, dropped };
}
