import '../config/env.js';
import { createRetrievalContext } from '../pipeline/retrievalContext.js';
import { researchCompany } from '../pipeline/research.js';

// Dev tool: npm run research -- <company-url> [company-name]
const [url, company] = process.argv.slice(2);
if (!url) {
  console.error('Usage: npm run research -- <company-url> [company-name]');
  process.exit(2);
}
const ctx = createRetrievalContext({ onEvent: (e) => console.error(`[${e.type}] ${e.url}${e.code ? ` ${e.code}` : ''}`) });
const r = await researchCompany({ companyUrl: url, company }, ctx);
console.log(JSON.stringify({
  company: r.company,
  reachable: r.crawl.reachable,
  hiringPage: r.crawl.hiringPage,
  sitemapUsed: r.crawl.sitemapUsed,
  pages: r.crawl.pages.map((p) => ({ url: p.url, kind: p.kind, hiring_score: p.hiring_score, title: p.title })),
  discussion: { found: r.discussion.found, snippets: r.discussion.snippets.map((s) => s.url) },
  skipped: r.skipped,
  gaps: r.gaps,
}, null, 2));
