import { htmlFragmentToText } from '../lib/htmlText.js';
import { retrieve } from './fetchPage.js';

const HN_SEARCH = 'https://hn.algolia.com/api/v1/search';
const INTERVIEW_TERMS = /interview|hiring process|take-?home|on-?site|phone screen|coding challenge|recruiter/i;
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Public discussion of how a company interviews. Source: Hacker News via its official public search API
 * (no scraping). Reddit/Glassdoor are deliberately NOT used: their terms restrict automated access.
 * An empty result is a valid, honest outcome -- callers must report it, not paper over it.
 *
 * @returns {{ searched, source, query, found, snippets[{url,source,title,text,points}], skipped[] }}
 */
export async function findPublicDiscussion({ company }, ctx) {
  const result = { searched: false, source: 'hackernews', query: null, found: false, snippets: [], skipped: [] };
  if (!ctx.config.discussionEnabled) {
    return { ...result, skipped: [{ code: 'DISABLED', reason: 'Public discussion search is disabled.' }] };
  }
  if (!company) {
    return { ...result, skipped: [{ code: 'NO_COMPANY_NAME', reason: 'No company name to search for.' }] };
  }

  result.searched = true;
  result.query = `"${company}" interview`;
  const url = `${HN_SEARCH}?${new URLSearchParams({ query: result.query, tags: '(story,comment)', hitsPerPage: '20' })}`;

  // robots.txt is for crawlers; this is a documented public JSON API, so only the guard/limits apply.
  const r = await retrieve(url, ctx, { allowedTypes: ['application/json'], skipRobots: true });
  if (!r.ok) return { ...result, skipped: [r.skip] };

  let hits;
  try {
    hits = JSON.parse(r.doc.body).hits;
    if (!Array.isArray(hits)) throw new Error('missing hits');
  } catch {
    return { ...result, skipped: [{ url, code: 'INVALID_RESPONSE', reason: 'Search API returned unexpected data.' }] };
  }

  const nameRe = new RegExp(`\\b${escapeRe(company)}\\b`, 'i');
  const seen = new Set();
  for (const hit of hits) {
    if (!hit.objectID || seen.has(hit.objectID)) continue;
    seen.add(hit.objectID);
    const text = htmlFragmentToText(hit.comment_text || hit.story_text || hit.title || '');
    const m = text.match(INTERVIEW_TERMS);
    // Precision over recall: must name the company AND talk about interviewing.
    if (!m || !nameRe.test(`${text} ${hit.story_title || ''} ${hit.title || ''}`)) continue;
    const at = m.index ?? 0;
    result.snippets.push({
      url: `https://news.ycombinator.com/item?id=${hit.objectID}`,
      source: 'hackernews',
      title: hit.title || hit.story_title || null,
      text: text.slice(Math.max(0, at - 200), at + 300).trim(),
      points: hit.points ?? null,
    });
    if (result.snippets.length >= 5) break;
  }
  result.found = result.snippets.length > 0;
  return result;
}
