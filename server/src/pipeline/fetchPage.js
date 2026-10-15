import { notImplemented } from '../lib/errors.js';
/**
 * PHASE 2. Retrieve + clean ONE page -> { url, title, text, links[] }.
 * Must: validate URL (scheme, no private/loopback in prod), honour robots.txt,
 * enforce content-type + size + timeout limits, follow relative links, rate-limit per host,
 * retry with backoff. Records a skip on failure -- never fails the whole run.
 */
export async function fetchPage(/* url, ctx */) {
  throw notImplemented('fetchPage', 'Phase 2');
}
