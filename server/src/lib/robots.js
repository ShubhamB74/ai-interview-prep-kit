const escapeRe = (s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&');

/** Minimal RFC 9309 parser: groups of user-agents with allow/disallow rules, crawl-delay, sitemaps. */
export function parseRobots(text) {
  const groups = [];
  const sitemaps = [];
  let cur = null;
  let lastWasAgent = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    const i = line.indexOf(':');
    if (i < 0) continue;
    const field = line.slice(0, i).trim().toLowerCase();
    const value = line.slice(i + 1).trim();
    if (field === 'user-agent') {
      if (!cur || !lastWasAgent) {
        cur = { agents: [], rules: [], crawlDelay: null };
        groups.push(cur);
      }
      cur.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (field === 'sitemap') sitemaps.push(value);
    else if (!cur) continue;
    else if (field === 'allow' || field === 'disallow') cur.rules.push({ allow: field === 'allow', pattern: value });
    else if (field === 'crawl-delay' && Number.isFinite(Number(value)) && Number(value) >= 0) cur.crawlDelay = Number(value);
  }
  return { groups, sitemaps };
}

/** Most specific user-agent group wins; "*" is the fallback. */
function groupFor(parsed, userAgent) {
  const ua = userAgent.toLowerCase();
  let best = null;
  let bestLen = -1;
  for (const g of parsed.groups) {
    for (const agent of g.agents) {
      if (agent === '*') {
        if (bestLen < 0) { best = g; bestLen = 0; }
      } else if (ua.includes(agent) && agent.length > bestLen) {
        best = g;
        bestLen = agent.length;
      }
    }
  }
  return best;
}

function toRegex(pattern) {
  const anchored = pattern.endsWith('$');
  const body = (anchored ? pattern.slice(0, -1) : pattern).split('*').map(escapeRe).join('.*');
  return new RegExp(`^${body}${anchored ? '$' : ''}`);
}

/** Longest matching pattern wins; on a tie Allow beats Disallow; empty Disallow matches nothing. */
export function isAllowed(parsed, pathWithQuery, userAgent) {
  const group = groupFor(parsed, userAgent);
  if (!group) return true;
  let best = null;
  for (const rule of group.rules) {
    if (rule.pattern === '' || !toRegex(rule.pattern).test(pathWithQuery)) continue;
    if (!best || rule.pattern.length > best.pattern.length || (rule.pattern.length === best.pattern.length && rule.allow)) best = rule;
  }
  return best ? best.allow : true;
}

export const crawlDelayFor = (parsed, userAgent) => groupFor(parsed, userAgent)?.crawlDelay ?? null;

/**
 * Per-origin robots.txt cache (lifetime = one research run).
 *  - 200: parse it.  - 4xx: no robots => allowed.
 *  - 5xx: treat as "disallow all" (RFC 9309 says unreachable robots must be assumed restrictive).
 *  - network/timeout/blocked: surface that code, so the skip reads "unreachable" not "robots".
 */
export class RobotsCache {
  constructor({ load, userAgent, throttle, maxDelayMs = 5000 }) {
    this.load = load; // (robotsUrl) => Promise<{ body }>
    this.userAgent = userAgent;
    this.throttle = throttle;
    this.maxDelayMs = maxDelayMs;
    this.cache = new Map();
  }

  entry(origin) {
    if (!this.cache.has(origin)) this.cache.set(origin, this.#fetch(origin));
    return this.cache.get(origin);
  }

  async #fetch(origin) {
    try {
      const { body } = await this.load(`${origin}/robots.txt`);
      return { parsed: parseRobots(body) };
    } catch (err) {
      if (err.status >= 400 && err.status < 500) return { parsed: { groups: [], sitemaps: [] } };
      const code = String(err.code || '').startsWith('HTTP_') ? 'ROBOTS_UNAVAILABLE' : err.code || 'ROBOTS_UNAVAILABLE';
      return { error: code, message: `robots.txt could not be read: ${err.message}` };
    }
  }

  /** @returns {Promise<{allowed: true} | {allowed: false, code: string, reason: string}>} */
  async check(url) {
    const u = new URL(url);
    const e = await this.entry(u.origin);
    if (e.error) return { allowed: false, code: e.error, reason: e.message };
    const delay = crawlDelayFor(e.parsed, this.userAgent);
    if (delay != null) this.throttle?.setDelay(u.host, Math.min(delay * 1000, this.maxDelayMs));
    return isAllowed(e.parsed, u.pathname + u.search, this.userAgent)
      ? { allowed: true }
      : { allowed: false, code: 'ROBOTS_DISALLOWED', reason: 'Disallowed by robots.txt' };
  }

  async sitemaps(origin) {
    return (await this.entry(origin)).parsed?.sitemaps ?? [];
  }
}
