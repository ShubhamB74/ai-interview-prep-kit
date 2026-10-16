import { generateQuestions } from './generateQuestions.js';
import { categoryForRequirement } from './questionPlan.js';

/**
 * Builds the `fill` function the coverage loop calls. One question per uncovered requirement.
 *   round 1: batched per category (cheap)
 *   round 2+: one requirement per call, which is the most reliable way to get the model to address that requirement
 * Already-asked prompts are passed as "do not repeat".
 */
export function makeGapFiller({ role, company, briefFacts, hiringProcess, llm }) {
  return async function fill({ requirements, round, existing }) {
    const avoid = existing.map((q) => q.prompt);
    const out = [];
    const run = async (category, reqs) => {
      const r = await generateQuestions({
        category, requirements: reqs, role, company, briefFacts, hiringProcess, perRequirement: 1,
        limitedCompanyInfo: category === 'company-fit' && !briefFacts, avoid: [...avoid, ...out.map((q) => q.prompt)],
      }, { llm });
      out.push(...r.questions);
    };

    if (round === 1) {
      const groups = new Map();
      for (const req of requirements) {
        const c = categoryForRequirement(req);
        groups.set(c, [...(groups.get(c) ?? []), req]);
      }
      for (const [category, reqs] of groups) await run(category, reqs);
    } else {
      for (const req of requirements) await run(categoryForRequirement(req), [req]);
    }
    return out;
  };
}
