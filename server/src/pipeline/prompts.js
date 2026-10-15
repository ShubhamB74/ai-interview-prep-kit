import { SAFETY_RULES, untrusted } from '../lib/promptSafety.js';

/** All model-facing text lives here. Each category gets its OWN system prompt: a technical question and a
 *  behavioural question are different tasks and must not come from the same instructions. */

export const EXTRACTION_MAX_JD_CHARS = 12_000;

export function extractionPrompt(jd) {
  return {
    system: `You extract structured facts from a job posting. ${SAFETY_RULES}
Rules:
- Use ONLY what the posting states. Never infer or invent. If it states few or no requirements, return few or none.
- A requirement is a skill, experience, qualification or trait the candidate should have. Not perks, benefits or company marketing.
- For each requirement copy a short VERBATIM "evidence" span (max 200 chars) from the posting.
- priority: "must" if the posting words it as required/needed/expected; "nice" if it is a bonus/preferred/plus/nice-to-have. Follow the posting's own wording, including headings and labels like "Required:" or "Bonus:". If unclear, "must".
- kind: "technical" (tools, languages, systems, years of a skill), "behavioural" (mentoring, communication, leadership, collaboration, ownership), "domain" (industry or domain knowledge).
- responsibilities: what the role does, short strings, max 8.
- title/seniority/location/company: copy from the posting; "" if absent. seniority is one of intern, junior, mid, senior, staff, lead, principal, manager, director, or "".
Return ONLY JSON: {"company":"","title":"","seniority":"","location":"","responsibilities":[""],"requirements":[{"text":"","kind":"technical","priority":"must","evidence":""}]}`,
    user: untrusted('job_posting', jd, { maxChars: EXTRACTION_MAX_JD_CHARS }),
  };
}

export function briefPrompt({ company, pages }) {
  return {
    system: `You write a short, factual company brief for interview preparation. ${SAFETY_RULES}
Rules:
- Use ONLY the provided pages. Do not use outside knowledge about this company. Do not guess.
- summary: max 3 sentences on who the company is and notable facts stated on the pages.
- what_they_do: max 3 sentences on products, services and customers stated on the pages. If the pages do not say, write exactly "The provided pages do not say."
- source_urls: only URLs from the provided pages that you actually used.
Return ONLY JSON: {"summary":"","what_they_do":"","source_urls":[""]}`,
    user: `Company: ${company || 'unknown'}\n\n${pages.map((p) => untrusted(`page ${p.url}`, p.text, { maxChars: p.budget })).join('\n\n')}`,
  };
}

const COMMON_QUESTION_RULES = `Each question must reference requirement ids from the list, using only those ids.
answer_outline: 3-5 short points a strong answer covers (max 80 words). difficulty: 1 easy, 2 medium, 3 hard, scaled to the seniority.
Do not repeat questions listed under "already have". Return ONLY JSON: {"questions":[{"requirement_ids":["r1"],"prompt":"","answer_outline":"","difficulty":2}]}`;

const CATEGORY_SYSTEM = {
  technical: `You write TECHNICAL interview questions that test real depth in a specific skill or tool.
Anchor every question in the named requirement: a concrete scenario, a debugging situation, a trade-off or code-level detail, never a definition lookup. For "N+ years" requirements, ask what that experience should have taught.`,
  behavioural: `You write BEHAVIOURAL interview questions about past situations, anchored in the named requirement (for example mentoring, ownership, conflict, communication).
Phrase each as "Tell me about a time..." or similar. answer_outline is a STAR structure (situation, action, result) plus what a strong answer demonstrates.`,
  'system-design': `You write SYSTEM DESIGN interview prompts: open-ended design problems relevant to the named requirements and, when given, the company's domain.
answer_outline lists: clarifying questions to ask, main components, data and scaling concerns, and key trade-offs. Keep each problem scoped to a 45-minute discussion.`,
  'company-fit': `You write COMPANY-FIT interview questions: motivation, domain understanding, product sense and how the candidate would work with this company.
Use ONLY the company facts provided. If none are provided, ask only about the domain knowledge in the requirement and never assume facts about the company.`,
};

function processText(hp) {
  if (!hp?.known) return 'Unknown. The company publishes nothing about its interview process that we could find. Do not assume any particular format.';
  const parts = [];
  const on = Object.entries(hp.signals).filter(([, v]) => v).map(([k]) => k.replace(/_/g, ' '));
  if (hp.confidence === 'published') parts.push(`Published by the company. Stages/signals mentioned: ${on.join(', ') || 'none specific'}.\n${hp.excerpt}`);
  if (hp.reported_excerpts?.length) parts.push(`Reported by commenters (unverified anecdotes):\n${hp.reported_excerpts.map((r) => `- ${r.text}`).join('\n')}`);
  return parts.join('\n');
}

export function questionsPrompt({ category, requirements, role, company, briefFacts, hiringProcess, count, avoid, limitedCompanyInfo }) {
  const facts = briefFacts && !limitedCompanyInfo ? `Company facts:\n${untrusted('company_facts', briefFacts, { maxChars: 1500 })}` : 'Company facts: none available.';
  return {
    system: `${CATEGORY_SYSTEM[category]}\n${SAFETY_RULES}\n${COMMON_QUESTION_RULES}`,
    user: [
      `Role: ${role?.title || 'unspecified'}${role?.seniority ? ` (${role.seniority})` : ''} at ${company || 'an unnamed company'}.`,
      facts,
      `Interview process:\n${untrusted('hiring_process', processText(hiringProcess), { maxChars: 2000 })}`,
      'Tailor the questions to that process where it is known, e.g. if a take-home or a system design round is described, prepare for it.',
      `Requirements (id: text [priority]):\n${untrusted('requirements', requirements.map((r) => `${r.id}: ${r.text} [${r.priority}]`).join('\n'), { maxChars: 3000 })}`,
      avoid.length ? `Already have (do not repeat):\n${avoid.slice(0, 12).map((a) => `- ${a.slice(0, 120)}`).join('\n')}` : '',
      `Write ${count} ${category} questions in total.`,
    ].filter(Boolean).join('\n\n'),
  };
}

export function flashcardsPrompt({ requirements, role, company, count }) {
  return {
    system: `You write study flashcards for interview preparation. ${SAFETY_RULES}
Each card: "front" is a short recall prompt, "back" a concise answer (max 40 words). For technical requirements use key concepts, trade-offs or gotchas; for behavioural requirements use a story prompt and what to include. Reference requirement ids from the list only.
Return ONLY JSON: {"flashcards":[{"front":"","back":"","requirement_ids":["r1"]}]}`,
    user: `Role: ${role?.title || 'unspecified'} at ${company || 'an unnamed company'}.\n\nRequirements (id: text [priority]):\n${untrusted('requirements', requirements.map((r) => `${r.id}: ${r.text} [${r.priority}]`).join('\n'), { maxChars: 3000 })}\n\nWrite ${count} flashcards in total.`,
  };
}
