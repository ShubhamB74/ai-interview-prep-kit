import { crawlSite } from './crawlSite.js';
import { findPublicDiscussion } from './findPublicDiscussion.js';
import { companyNameFromUrl } from '../lib/urlUtils.js';

/**
 * Retrieval stage of the pipeline: crawl the company site, then look for public discussion.
 * Never throws for external failures; instead returns `gaps` -- plain-language notes about what could NOT
 * be found. Phase 3 feeds these into the brief so it stays honest instead of fabricating.
 */
export async function researchCompany({ companyUrl, company }, ctx) {
  const name = company || companyNameFromUrl(companyUrl);
  const crawl = await crawlSite(companyUrl, ctx);
  const discussion = await findPublicDiscussion({ company: name }, ctx); // runs even if the site was unreachable

  const gaps = [];
  if (!crawl.reachable) {
    const why = crawl.skipped[0];
    gaps.push(`The company site could not be retrieved${why ? ` (${why.code}: ${why.reason})` : ''}.`);
  } else if (!crawl.hiringPage) {
    gaps.push('No page describing the hiring or interview process was found on the company site.');
  }
  if (!discussion.found) {
    gaps.push(discussion.searched
      ? 'No public discussion of this company’s interview process was found.'
      : `Public discussion was not searched (${discussion.skipped[0]?.code ?? 'unknown'}).`);
  }

  return {
    company: name,
    crawl,
    discussion,
    gaps,
    pagesUsed: crawl.pages.map((p) => p.url),
    skipped: [...crawl.skipped, ...discussion.skipped],
  };
}
