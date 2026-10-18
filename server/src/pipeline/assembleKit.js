import { companyNameFromUrl } from '../lib/urlUtils.js';

const uniq = (xs) => [...new Set(xs)];

/**
 * Pure: turns the pipeline's parts into an Appendix A kit (plus the optional `research` block).
 * Everything the kit says about what could NOT be found is collected into research.gaps here, in plain language.
 */
export function assembleKit({ jd, companyUrl, draft, questions, coverage, schedule, templated = [], coverageErrors = [], now = () => new Date() }) {
  const { role, research, hiringProcess, brief, flashcards, failures } = draft;
  const niceLeft = coverage.uncovered_requirement_ids;

  const gaps = [
    ...role.thinReasons,
    ...research.gaps,
    ...failures.map((f) => (f.code === 'TIME_BUDGET' ? `Step "${f.step}" was skipped to stay within the time budget.` : `Step "${f.step}" failed (${f.code}): ${f.message}`)),
    ...coverageErrors.map((e) => (e.code === 'TIME_BUDGET' ? e.message : `Coverage round ${e.round} hit an error (${e.code}): ${e.message}`)),
    ...(templated.length ? [`The model produced no question for requirement(s) ${templated.join(', ')}, so a generic template question was used.`] : []),
    ...(niceLeft.length ? [`No question could be generated for nice-to-have requirement(s) ${niceLeft.join(', ')}.`] : []),
  ];

  return {
    source: {
      company: role.company || research.company || companyNameFromUrl(companyUrl),
      company_url: companyUrl,
      role: role.title,
      location: role.location,
      jd_chars: jd.length,
      researched_at: now().toISOString(),
      pages_used: uniq([...research.crawl.pages.map((p) => p.url), ...research.discussion.snippets.map((s) => s.url)]),
    },
    company_brief: { summary: brief.summary, what_they_do: brief.what_they_do, sources: brief.sources },
    role: {
      title: role.title,
      seniority: role.seniority,
      responsibilities: role.responsibilities,
      requirements: role.requirements.map(({ id, text, kind, priority }) => ({ id, text, kind, priority })),
    },
    questions,
    flashcards,
    schedule,
    coverage,
    research: {
      gaps,
      hiring_page: research.crawl.hiringPage,
      hiring_process: {
        known: hiringProcess.known, confidence: hiringProcess.confidence, signals: hiringProcess.signals,
        excerpt: hiringProcess.excerpt, reported_excerpts: hiringProcess.reported_excerpts,
      },
      discussion_searched: research.discussion.searched,
      discussion_found: research.discussion.found,
      discussion_sources: research.discussion.snippets.map((s) => s.url),
      skipped_sources: research.skipped.map((s) => ({ ...(s.url ? { url: s.url } : {}), code: s.code, reason: s.reason })),
      thin_description: role.thin,
    },
  };
}
