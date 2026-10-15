import { env } from '../config/env.js';
import { httpGet } from '../lib/httpClient.js';
import { RobotsCache } from '../lib/robots.js';
import { withBackoff } from '../lib/retry.js';
import { HostThrottle } from '../lib/throttle.js';
import { makeGuard } from '../lib/urlGuard.js';

export const USER_AGENT = 'PrepKitBot/0.1 (interview-prep research; obeys robots.txt)';

const DEFAULTS = {
  backoffBaseMs: 500,
  maxDepth: 3,        // links followed from the homepage: home=0, careers=1, handbook page=2, ...
  minLinkScore: 2,    // don't spend fetches on links that look irrelevant
  maxPageChars: 12000,
  hiringPageMin: 6,   // page-level evidence needed to call a page "the hiring page"
};

/**
 * One context per research run: robots cache and throttle state live exactly as long as the run.
 * Everything external (fetch, DNS, sleep, guard) is injectable so tests never touch the network.
 */
export function createRetrievalContext({ config = {}, fetchImpl = fetch, resolve, sleep, guard, onEvent } = {}) {
  const cfg = { ...DEFAULTS, ...env.crawl, ...config };
  const throttle = new HostThrottle({ minDelayMs: cfg.delayMs, sleep });
  const ctx = {
    config: cfg,
    fetchImpl,
    sleep,
    onEvent,
    userAgent: USER_AGENT,
    throttle,
    guard: guard ?? makeGuard({ blockPrivate: cfg.blockPrivate, resolve }),
  };
  ctx.robots = new RobotsCache({
    userAgent: USER_AGENT,
    throttle,
    load: (url) =>
      withBackoff(() => httpGet(url, ctx, { allowedTypes: ['text/plain', 'text/html'] }), {
        retries: 1, baseMs: cfg.backoffBaseMs, shouldRetry: (e) => e.retriable, sleep,
      }),
  });
  return ctx;
}
