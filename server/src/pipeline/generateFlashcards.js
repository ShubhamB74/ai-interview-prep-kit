import { FlashcardsOut, GeneratedFlashcard } from '../schema/llmOutputs.js';
import { flashcardsPrompt } from './prompts.js';
import { dedupeKey } from './jdEvidence.js';

const CHUNK = 8;
const MAX_CARDS = 24;

/** Flashcards for the requirements, must-haves first. Same id discipline as questions. */
export async function generateFlashcards({ requirements, role, company }, { llm }) {
  const ordered = [...requirements].sort((a, b) => Number(b.priority === 'must') - Number(a.priority === 'must'));
  const valid = new Set(requirements.map((r) => r.id));
  const seen = new Set();
  const cards = [];
  let dropped = 0;

  for (let i = 0; i < ordered.length && cards.length < MAX_CARDS; i += CHUNK) {
    const chunk = ordered.slice(i, i + CHUNK);
    const count = Math.min(MAX_CARDS - cards.length, chunk.reduce((n, r) => n + (r.priority === 'must' ? 2 : 1), 0));
    const out = await llm.completeJson({
      name: 'flashcards',
      ...flashcardsPrompt({ requirements: chunk, role, company, count }),
      schema: FlashcardsOut,
      maxTokens: Math.min(4096, 400 + 170 * count),
    });
    for (const raw of out.flashcards) {
      const p = GeneratedFlashcard.safeParse(raw);
      if (!p.success) { dropped++; continue; }
      const ids = [...new Set(p.data.requirement_ids.filter((id) => valid.has(id)))];
      const key = dedupeKey(p.data.front);
      if (!ids.length || seen.has(key)) { dropped++; continue; }
      seen.add(key);
      cards.push({ front: p.data.front, back: p.data.back, requirement_ids: ids });
    }
  }
  return { flashcards: cards.slice(0, MAX_CARDS), dropped };
}
