import fs from 'node:fs/promises';
import '../config/env.js';
import { createLlmClient } from '../lib/llm.js';
import { createRetrievalContext } from '../pipeline/retrievalContext.js';
import { buildDraft } from '../pipeline/draft.js';

// Dev tool: npm run draft -- <jd-file.txt> <company-url>
const [jdFile, companyUrl] = process.argv.slice(2);
if (!jdFile || !companyUrl) {
  console.error('Usage: npm run draft -- <jd-file.txt> <company-url>');
  process.exit(2);
}
const llm = createLlmClient();
const draft = await buildDraft({
  jd: await fs.readFile(jdFile, 'utf8'),
  companyUrl,
  llm,
  retrievalCtx: createRetrievalContext(),
  onProgress: (e) => console.error(`[${e.step}] ${e.status}${e.detail ? ` - ${e.detail}` : ''}`),
});
console.log(JSON.stringify({ ...draft, research: { ...draft.research, crawl: { ...draft.research.crawl, pages: draft.research.crawl.pages.map((p) => ({ url: p.url, kind: p.kind, hiring_score: p.hiring_score })) } }, llm: llm.stats }, null, 2));
