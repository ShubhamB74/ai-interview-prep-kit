import { httpGet } from '../lib/httpClient.js';
import { withBackoff } from '../lib/retry.js';
import { extractPage, extractPlain } from '../lib/htmlText.js';

const skip = (ctx, url, code, reason, attempts) => {
  ctx.onEvent?.({ type: 'skipped', url, code, reason });
  return { ok: false, skip: { url, code, reason, attempts } };
};

/**
 * Guarded, robots-aware, retrying GET. Never throws for external failures: returns
 * { ok: true, doc } or { ok: false, skip: { url, code, reason, attempts } } so one bad source can't fail a run.
 */
export async function retrieve(url, ctx, { allowedTypes, skipRobots = false } = {}) {
  let parsed;
  try {
    parsed = await ctx.guard(url);
  } catch (err) {
    return skip(ctx, url, err.code || 'INVALID_URL', err.message, 0);
  }
  if (!skipRobots) {
    const verdict = await ctx.robots.check(parsed.href);
    if (!verdict.allowed) return skip(ctx, url, verdict.code, verdict.reason, 0);
  }
  let attempts = 0;
  try {
    const doc = await withBackoff(
      () => { attempts++; return httpGet(parsed.href, ctx, { allowedTypes }); },
      { retries: ctx.config.retries, baseMs: ctx.config.backoffBaseMs, shouldRetry: (e) => e.retriable, sleep: ctx.sleep }
    );
    ctx.onEvent?.({ type: 'fetched', url: doc.url });
    return { ok: true, doc };
  } catch (err) {
    return skip(ctx, url, err.code || 'NETWORK', err.message, attempts);
  }
}

/**
 * Retrieve and clean one page -> { ok: true, page: { url, requested_url, title, text, links[] } }.
 * Final URL (after redirects) is reported; relative links are resolved against it.
 */
export async function fetchPage(url, ctx) {
  const r = await retrieve(url, ctx);
  if (!r.ok) return r;
  const { doc } = r;
  const extracted = doc.contentType === 'text/plain'
    ? extractPlain(doc.body, { maxChars: ctx.config.maxPageChars })
    : extractPage(doc.body, doc.url, { maxChars: ctx.config.maxPageChars });
  if (!extracted.text && !extracted.links.length) return skip(ctx, url, 'EMPTY_PAGE', 'Page had no readable text or links.', 1);
  return { ok: true, page: { url: doc.url, requested_url: url, ...extracted } };
}
