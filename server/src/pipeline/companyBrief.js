import { BriefOut } from '../schema/llmOutputs.js';
import { briefPrompt } from './prompts.js';

const PAGE_BUDGETS = [2500, 1500, 1500]; // chars per page: homepage first, then up to two more
const MIN_USABLE_CHARS = 80;
const ABOUT = /about|company|who-we-are|what-we-do|mission|product/i;

/** Homepage first, then pages that look like "about" pages, then the rest. Deterministic. */
export function selectBriefPages(pages) {
  const usable = pages.filter((p) => p.text && p.text.length >= MIN_USABLE_CHARS);
  const home = usable.find((p) => p.kind === 'home');
  const rest = usable.filter((p) => p !== home).sort((a, b) => Number(ABOUT.test(`${b.url} ${b.title}`)) - Number(ABOUT.test(`${a.url} ${a.title}`)));
  return [home, ...rest].filter(Boolean).slice(0, PAGE_BUDGETS.length).map((p, i) => ({ url: p.url, text: p.text, budget: PAGE_BUDGETS[i] }));
}

/**
 * Company brief grounded ONLY in crawled pages. With nothing usable it makes NO model call and says so plainly:
 * an honest empty brief beats a fabricated one.
 */
export async function buildCompanyBrief({ company, research }, { llm }) {
  const pages = selectBriefPages(research?.crawl?.pages ?? []);
  const name = company || 'this company';

  if (pages.length === 0) {
    const reachable = research?.crawl?.reachable;
    return {
      summary: reachable
        ? `The ${name} website was reachable but contained no readable text, so there is nothing to summarise. This kit is based on the job description only.`
        : `No information about ${name} could be retrieved from its website, so this brief is intentionally empty. This kit is based on the job description only.`,
      what_they_do: 'Not available.',
      sources: [],
      grounded: false,
    };
  }

  const out = await llm.completeJson({
    name: 'company_brief',
    ...briefPrompt({ company, pages }),
    schema: BriefOut,
    maxTokens: 700,
  });

  const allowed = new Set(pages.map((p) => p.url));
  const cited = out.source_urls.filter((u) => allowed.has(u)); // the model may not cite anything we didn't give it
  return {
    summary: out.summary,
    what_they_do: out.what_they_do,
    sources: cited.length ? cited : pages.map((p) => p.url),
    grounded: true,
  };
}
