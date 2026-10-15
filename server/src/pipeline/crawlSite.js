import { notImplemented } from '../lib/errors.js';
/**
 * PHASE 2. Start at the company URL, collect links, RANK them (anchor text / path / depth
 * heuristics: careers, jobs, hiring, interview, handbook, about, engineering, blog...), fetch the top N.
 * A fixed path list must not be the only strategy.
 * Returns { pages[], skipped[{url, reason}], hiringPage? }.
 */
export async function crawlSite(/* companyUrl, ctx */) {
  throw notImplemented('crawlSite', 'Phase 2');
}
