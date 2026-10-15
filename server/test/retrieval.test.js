import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startFixtureSite } from '../test-support/fixtureSite.js';
import { createRetrievalContext } from '../src/pipeline/retrievalContext.js';
import { fetchPage } from '../src/pipeline/fetchPage.js';
import { crawlSite } from '../src/pipeline/crawlSite.js';
import { findPublicDiscussion } from '../src/pipeline/findPublicDiscussion.js';
import { researchCompany } from '../src/pipeline/research.js';

let site;
before(async () => { site = await startFixtureSite(); });
after(() => site.close());
beforeEach(() => site.resetHits());

const ctxFor = (config = {}, extra = {}) =>
  createRetrievalContext({
    config: { delayMs: 0, retries: 1, backoffBaseMs: 1, timeoutMs: 400, maxBytes: 200_000, blockPrivate: false, maxPages: 8, discussionEnabled: true, ...config },
    ...extra,
  });

// ---------- fetchPage ----------
test('fetchPage: cleans a page and resolves relative links', async () => {
  const r = await fetchPage(`${site.base}/acme/`, ctxFor());
  assert.equal(r.ok, true);
  assert.equal(r.page.title, 'Acme Rockets');
  assert.match(r.page.text, /rocket-powered skates/);
  assert.doesNotMatch(r.page.text, /SECRET HIDDEN|ignore_me/);
  assert.ok(r.page.links.some((l) => l.url === `${site.base}/acme/about`));
});

test('fetchPage: 404, wrong content-type and oversize are skipped with specific codes', async () => {
  const ctx = ctxFor();
  assert.equal((await fetchPage(`${site.base}/acme/missing`, ctx)).skip.code, 'HTTP_404');
  assert.equal((await fetchPage(`${site.base}/acme/img`, ctx)).skip.code, 'UNSUPPORTED_CONTENT_TYPE');
  assert.equal((await fetchPage(`${site.base}/acme/big`, ctx)).skip.code, 'TOO_LARGE');        // via content-length
  assert.equal((await fetchPage(`${site.base}/acme/big-stream`, ctx)).skip.code, 'TOO_LARGE'); // via streaming cap
});

test('fetchPage: timeouts are retried then reported as TIMEOUT', async () => {
  const r = await fetchPage(`${site.base}/acme/slow`, ctxFor({ timeoutMs: 150, retries: 1 }));
  assert.equal(r.ok, false);
  assert.equal(r.skip.code, 'TIMEOUT');
  assert.equal(r.skip.attempts, 2);
});

test('fetchPage: a 503 with Retry-After is retried and succeeds', async () => {
  const r = await fetchPage(`${site.base}/acme/flaky`, ctxFor());
  assert.equal(r.ok, true);
  assert.match(r.page.text, /recovered/);
});

test('fetchPage: follows redirects, reports the final URL', async () => {
  const r = await fetchPage(`${site.base}/acme/redir`, ctxFor());
  assert.equal(r.ok, true);
  assert.equal(r.page.url, `${site.base}/acme/about`);
});

test('fetchPage: every redirect hop is re-validated by the guard', async () => {
  const guard = async (u) => {
    if (new URL(u).pathname.startsWith('/secret')) throw Object.assign(new Error('blocked'), { code: 'BLOCKED_ADDRESS' });
    return new URL(u);
  };
  const r = await fetchPage(`${site.base}/acme/redir-secret`, ctxFor({}, { guard }));
  assert.equal(r.skip.code, 'BLOCKED_ADDRESS');
  assert.ok(!site.hits.includes('/secret/admin'), 'must not have requested the blocked target');
});

test('fetchPage: production-style guard refuses loopback before any request is made', async () => {
  const r = await fetchPage(`${site.base}/acme/`, ctxFor({ blockPrivate: true }));
  assert.equal(r.skip.code, 'BLOCKED_ADDRESS');
  assert.equal(site.hits.length, 0);
});

test('fetchPage: robots-disallowed path is not requested', async () => {
  const r = await fetchPage(`${site.base}/acme/private/careers`, ctxFor());
  assert.equal(r.skip.code, 'ROBOTS_DISALLOWED');
  assert.ok(!site.hits.includes('/acme/private/careers'));
});

// ---------- crawlSite ----------
test('crawl: finds a hiring page at an unpredictable path, via anchor text AND sitemap', async () => {
  const out = await crawlSite(`${site.base}/acme/`, ctxFor());
  const urls = out.pages.map((p) => p.url);
  assert.equal(out.reachable, true);
  assert.ok(urls.includes(`${site.base}/acme/handbook/people/our-process`), 'found via careers -> "How we hire"');
  assert.ok(urls.includes(`${site.base}/acme/p/engineering-interviews`), 'found via sitemap only');
  assert.ok(urls.includes(`${site.base}/acme/about`), 'relative link followed');
  assert.equal(out.sitemapUsed, true);
  assert.ok([`${site.base}/acme/handbook/people/our-process`, `${site.base}/acme/p/engineering-interviews`].includes(out.hiringPage));
});

test('crawl: stays on the company, honours robots, skips boilerplate and assets', async () => {
  await crawlSite(`${site.base}/acme/`, ctxFor());
  for (const bad of ['/globex/careers', '/globex/p/careers', '/acme/private/careers', '/acme/login', '/acme/privacy', '/acme/static/logo.png']) {
    assert.ok(!site.hits.includes(bad), `should not have requested ${bad}`);
  }
});

test('crawl: robots-disallowed links are recorded as skipped when they look promising', async () => {
  const out = await crawlSite(`${site.base}/acme/`, ctxFor());
  assert.ok(out.skipped.some((s) => s.code === 'ROBOTS_DISALLOWED' && s.url.endsWith('/acme/private/careers')));
});

test('crawl: a site with no hiring page is reachable with hiringPage = null', async () => {
  const out = await crawlSite(`${site.base}/plain/`, ctxFor());
  assert.equal(out.reachable, true);
  assert.equal(out.hiringPage, null);
  assert.ok(out.pages.some((p) => p.url.endsWith('/plain/about')));
});

test('crawl: unreachable, 404 and invalid URLs are recorded, never thrown', async () => {
  const down = await crawlSite('http://127.0.0.1:1/', ctxFor());
  assert.equal(down.reachable, false);
  assert.ok(['NETWORK', 'TIMEOUT'].includes(down.skipped[0].code), down.skipped[0].code);
  assert.equal((await crawlSite(`${site.base}/acme/missing`, ctxFor())).skipped[0].code, 'HTTP_404');
  assert.equal((await crawlSite('definitely not a url', ctxFor())).skipped[0].code, 'INVALID_URL');
});

test('crawl: maxPages is a hard cap', async () => {
  const out = await crawlSite(`${site.base}/acme/`, ctxFor({ maxPages: 2 }));
  assert.ok(out.pages.length <= 2);
});

// ---------- discussion ----------
const hn = (hits) => async (url) =>
  String(url).includes('hn.algolia.com')
    ? new Response(JSON.stringify({ hits }), { headers: { 'content-type': 'application/json' } })
    : new Response('nf', { status: 404 });

test('discussion: keeps hits that name the company AND talk about interviewing; strips HTML', async () => {
  const hits = [
    { objectID: '1', comment_text: 'Their <b>Acme</b> interview was a 4h take-home. Brutal.<p>Then system design.', points: null },
    { objectID: '2', comment_text: 'Acme makes great skates.' },                 // no interview talk
    { objectID: '3', comment_text: 'My interview at Globex went fine.' },        // wrong company
    { objectID: '1', comment_text: 'duplicate id' },
  ];
  const r = await findPublicDiscussion({ company: 'Acme' }, ctxFor({}, { fetchImpl: hn(hits) }));
  assert.equal(r.found, true);
  assert.equal(r.snippets.length, 1);
  assert.equal(r.snippets[0].url, 'https://news.ycombinator.com/item?id=1');
  assert.match(r.snippets[0].text, /Acme interview was a 4h take-home/);
  assert.doesNotMatch(r.snippets[0].text, /<b>/);
});

test('discussion: nothing found, API failure and missing name are all honest non-failures', async () => {
  const none = await findPublicDiscussion({ company: 'Acme' }, ctxFor({}, { fetchImpl: hn([]) }));
  assert.deepEqual([none.searched, none.found, none.snippets.length], [true, false, 0]);

  const down = await findPublicDiscussion({ company: 'Acme' }, ctxFor({}, { fetchImpl: async () => { throw new TypeError('fetch failed'); } }));
  assert.equal(down.found, false);
  assert.equal(down.skipped[0].code, 'NETWORK');

  const bad = await findPublicDiscussion({ company: 'Acme' }, ctxFor({}, { fetchImpl: async () => new Response('<html>', { headers: { 'content-type': 'application/json' } }) }));
  assert.equal(bad.skipped[0].code, 'INVALID_RESPONSE');

  assert.equal((await findPublicDiscussion({ company: '' }, ctxFor())).skipped[0].code, 'NO_COMPANY_NAME');
  assert.equal((await findPublicDiscussion({ company: 'Acme' }, ctxFor({ discussionEnabled: false }))).searched, false);
});

// ---------- research ----------
test('research: reports honest gaps when there is no hiring page and no discussion', async () => {
  const r = await researchCompany({ companyUrl: `${site.base}/plain/` }, ctxFor({}, { fetchImpl: (u, o) => (String(u).includes('hn.algolia.com') ? hn([])(u) : fetch(u, o)) }));
  assert.equal(r.company, 'plain');
  assert.equal(r.gaps.length, 2);
  assert.match(r.gaps[0], /No page describing the hiring/);
  assert.match(r.gaps[1], /No public discussion/);
});

test('research: unreachable company site still runs discussion search and reports the gap', async () => {
  const r = await researchCompany({ companyUrl: 'http://127.0.0.1:1/', company: 'Acme' }, ctxFor({}, { fetchImpl: (u, o) => (String(u).includes('hn.algolia.com') ? hn([{ objectID: '9', comment_text: 'Acme interview: onsite, 5 rounds.' }])(u) : fetch(u, o)) }));
  assert.equal(r.crawl.reachable, false);
  assert.equal(r.discussion.found, true);
  assert.match(r.gaps[0], /could not be retrieved/);
  assert.equal(r.gaps.length, 1);
});
