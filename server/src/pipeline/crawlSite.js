import { fetchPage, retrieve } from './fetchPage.js';
import { hiringSignals, scoreLink } from '../lib/linkScore.js';
import { inScope, normalizeUrlKey } from '../lib/urlUtils.js';

const HIRING_BONUS_FOR_LINKS_ON_HIRING_PAGE = 2;
const MAX_SITEMAP_FETCHES = 3;
const MAX_SITEMAP_URLS = 3000;

const decodeXml = (s) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
const locs = (xml) => [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => decodeXml(m[1]));

/**
 * Best-first crawl of ONE company site. No fixed path list: links are ranked by URL words + anchor text,
 * the best unvisited candidate is fetched next, and pages that turn out to describe hiring boost the links
 * they contain (so /careers -> /handbook/.../interviewing is followed). Sitemaps seed extra candidates.
 *
 * Never throws for external failures. Returns:
 *  { start_url, reachable, pages[{url,title,text,kind,depth,hiring_score,hiring_terms}],
 *    skipped[{url,code,reason,attempts}], hiringPage: url|null, sitemapUsed }
 */
export async function crawlSite(companyUrl, ctx) {
  const { config } = ctx;
  const out = { start_url: companyUrl, reachable: false, pages: [], skipped: [], hiringPage: null, sitemapUsed: false };

  let start;
  try {
    start = new URL(companyUrl);
  } catch {
    out.skipped.push({ url: companyUrl, code: 'INVALID_URL', reason: 'Not a valid URL.', attempts: 0 });
    return out;
  }

  const home = await fetchPage(start.href, ctx);
  if (!home.ok) {
    out.skipped.push(home.skip);
    return out;
  }
  out.reachable = true;
  const scopeRoot = new URL(home.page.url); // follow the redirect target (http->https, www, etc.)
  out.start_url = scopeRoot.href;

  const seen = new Set([normalizeUrlKey(start), normalizeUrlKey(scopeRoot)]);
  const queue = [];

  function enqueue(links, depth, bonus = 0) {
    if (depth > config.maxDepth) return;
    for (const { url, text } of links) {
      let u;
      try { u = new URL(url); } catch { continue; }
      if (!inScope(u, scopeRoot)) continue;
      const key = normalizeUrlKey(u);
      if (seen.has(key)) continue;
      const s = scoreLink({ url: u, text });
      if (s.excluded) continue;
      seen.add(key);
      queue.push({ url: u.href, score: s.score + bonus, depth, order: queue.length });
    }
  }

  function addPage(page, depth, isHome) {
    const sig = hiringSignals(page);
    const isHiring = sig.score >= config.hiringPageMin;
    out.pages.push({
      url: page.url, title: page.title, text: page.text, depth,
      kind: isHome ? 'home' : isHiring ? 'hiring' : 'other',
      hiring_score: sig.score, hiring_terms: sig.found,
    });
    enqueue(page.links, depth + 1, isHiring ? HIRING_BONUS_FOR_LINKS_ON_HIRING_PAGE : 0);
  }

  addPage(home.page, 0, true);
  await seedFromSitemaps(scopeRoot, ctx, out, enqueue);

  let attempts = 0;
  while (out.pages.length < config.maxPages && attempts < config.maxPages * 2) {
    const best = takeBest(queue, config.minLinkScore);
    if (!best) break;
    attempts++;
    const r = await fetchPage(best.url, ctx);
    if (!r.ok) { out.skipped.push(r.skip); continue; }
    const key = normalizeUrlKey(new URL(r.page.url));
    if (out.pages.some((p) => normalizeUrlKey(new URL(p.url)) === key)) continue; // redirect landed on a known page
    seen.add(key);
    addPage(r.page, best.depth, false);
  }

  const top = out.pages.filter((p) => p.kind !== 'home' || p.hiring_score >= config.hiringPageMin)
    .sort((a, b) => b.hiring_score - a.hiring_score)[0];
  if (top && top.hiring_score >= config.hiringPageMin) out.hiringPage = top.url;
  return out;
}

/** Highest score first; ties -> shallower, then earliest discovered. Removes and returns it. */
function takeBest(queue, minScore) {
  let bestIdx = -1;
  for (let i = 0; i < queue.length; i++) {
    const c = queue[i];
    const b = queue[bestIdx];
    if (c.score < minScore) continue;
    if (bestIdx < 0 || c.score > b.score || (c.score === b.score && (c.depth < b.depth || (c.depth === b.depth && c.order < b.order)))) bestIdx = i;
  }
  return bestIdx < 0 ? null : queue.splice(bestIdx, 1)[0];
}

/** robots.txt Sitemap lines + conventional locations; one level of sitemap index; failures are recorded, not fatal. */
async function seedFromSitemaps(scopeRoot, ctx, out, enqueue) {
  const declared = await ctx.robots.sitemaps(scopeRoot.origin).catch(() => []);
  const candidates = [...declared, new URL('sitemap.xml', scopeRoot).href, `${scopeRoot.origin}/sitemap.xml`];
  const queue = [...new Set(candidates)].filter((u) => {
    try { return inScope(new URL(u), scopeRoot); } catch { return false; }
  });
  const XML = ['application/xml', 'text/xml', 'text/plain'];
  let fetches = 0;
  let total = 0;

  while (queue.length && fetches < MAX_SITEMAP_FETCHES) {
    const url = queue.shift();
    fetches++;
    const r = await retrieve(url, ctx, { allowedTypes: XML });
    if (!r.ok) {
      if (!['HTTP_404', 'HTTP_410'].includes(r.skip.code)) out.skipped.push(r.skip); // a missing sitemap is normal
      continue;
    }
    const found = locs(r.doc.body);
    if (/<sitemapindex/i.test(r.doc.body)) {
      queue.push(...found.slice(0, 2)); // child sitemaps; one extra level only
      continue;
    }
    const pages = found.slice(0, Math.max(0, MAX_SITEMAP_URLS - total));
    total += pages.length;
    if (pages.length) out.sitemapUsed = true;
    enqueue(pages.map((url) => ({ url, text: '' })), 1);
  }
}
