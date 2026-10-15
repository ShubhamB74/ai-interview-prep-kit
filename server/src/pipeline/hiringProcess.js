/**
 * Deterministic read of what research found about HOW the company hires. No model involved: regex signals over
 * the hiring pages and discussion snippets. "published" (company's own site) is kept apart from "reported"
 * (forum anecdotes) so the question prompts can label them differently.
 */
const SIGNALS = {
  take_home: /take[- ]?home|work sample|homework exercise/i,
  system_design: /system design|architecture (?:round|interview)|design (?:round|interview)/i,
  coding_round: /coding (?:challenge|interview|round|exercise|test)|live cod|technical (?:interview|screen)|algorithm/i,
  pair_programming: /pair(?:ing| programming)/i,
  phone_screen: /phone screen|recruiter (?:call|screen)|intro(?:ductory)? call/i,
  onsite: /on-?site|final (?:round|interview)/i,
  values_interview: /values (?:interview|round|fit)|culture (?:fit|interview)|behavio(?:u)?ral (?:interview|round)/i,
};
const RELEVANT = /interview|take[- ]?home|hiring|screen|on-?site|system design|round|stage|offer|process|challenge/i;
const MAX_EXCERPT = 1200;

const detect = (text) => Object.fromEntries(Object.entries(SIGNALS).map(([k, re]) => [k, re.test(text)]));
const orSignals = (a, b) => Object.fromEntries(Object.keys(SIGNALS).map((k) => [k, Boolean(a[k] || b[k])]));

function excerpt(text, max) {
  const sentences = text.replace(/\s+/g, ' ').split(/(?<=[.!?])\s+/);
  let out = '';
  for (const s of sentences) {
    if (!RELEVANT.test(s)) continue;
    if (out.length + s.length + 1 > max) break;
    out += `${out ? ' ' : ''}${s}`;
  }
  return out;
}

/** @param research result of researchCompany (or null) */
export function analyzeHiringProcess(research) {
  const pages = (research?.crawl?.pages ?? []).filter((p) => p.kind === 'hiring');
  const snippets = research?.discussion?.snippets ?? [];
  const published = detect(pages.map((p) => p.text).join('\n'));
  const reported = detect(snippets.map((s) => s.text).join('\n'));
  const best = [...pages].sort((a, b) => b.hiring_score - a.hiring_score)[0];
  return {
    known: pages.length > 0 || snippets.length > 0,
    confidence: pages.length ? 'published' : snippets.length ? 'reported' : 'none',
    signals: orSignals(published, reported),
    published_signals: published,
    reported_signals: reported,
    sources: [...pages.map((p) => p.url), ...snippets.map((s) => s.url)],
    excerpt: best ? excerpt(best.text, MAX_EXCERPT) : '',
    reported_excerpts: snippets.slice(0, 3).map((s) => ({ url: s.url, text: s.text.slice(0, 250) })),
  };
}
