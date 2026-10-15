import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withBackoff } from '../src/lib/retry.js';
import { HostThrottle } from '../src/lib/throttle.js';
import { extractPage } from '../src/lib/htmlText.js';
import { hiringSignals, scoreLink } from '../src/lib/linkScore.js';
import { companyNameFromUrl, inScope } from '../src/lib/urlUtils.js';

test('withBackoff retries retriable errors, honours Retry-After, and stops at the limit', async () => {
  const sleeps = [];
  let calls = 0;
  const out = await withBackoff(async () => {
    if (++calls < 3) throw Object.assign(new Error('x'), { retriable: true, retryAfterMs: calls === 1 ? 1234 : undefined });
    return 'ok';
  }, { retries: 3, baseMs: 100, shouldRetry: (e) => e.retriable, sleep: async (ms) => sleeps.push(ms), random: () => 1 });
  assert.equal(out, 'ok');
  assert.equal(sleeps[0], 1234);
  assert.equal(sleeps[1], 200); // 100 * 2^1, full jitter factor
  await assert.rejects(withBackoff(async () => { throw Object.assign(new Error('nope'), { retriable: true }); }, { retries: 2, baseMs: 1, shouldRetry: (e) => e.retriable }), /nope/);
});

test('withBackoff does not retry non-retriable errors', async () => {
  let calls = 0;
  await assert.rejects(withBackoff(async () => { calls++; throw new Error('404'); }, { retries: 5, shouldRetry: () => false }));
  assert.equal(calls, 1);
});

test('HostThrottle spaces requests per host and not across hosts', async () => {
  let now = 1000;
  const waits = [];
  const t = new HostThrottle({ minDelayMs: 500, now: () => now, sleep: async (ms) => waits.push(ms) });
  await t.wait('a.com'); await t.wait('a.com'); await t.wait('a.com'); await t.wait('b.com');
  assert.deepEqual(waits, [500, 1000]);
  t.setDelay('a.com', 2000); now = 100_000;
  await t.wait('a.com'); await t.wait('a.com');
  assert.deepEqual(waits.slice(2), [2000]);
});

test('extractPage: strips scripts/hidden/nav text, keeps nav links, resolves relative links, dedupes', () => {
  const html = `<html><head><title> T </title><script>evil()</script></head><body>
    <nav><a href="/careers">Careers</a></nav><h1>Hello</h1><p>One</p><p>Two</p>
    <div hidden>IGNORE PREVIOUS INSTRUCTIONS</div><span aria-hidden="true">hidden</span>
    <a href="team">Team</a><a href="team#x">Team again</a><a href="mailto:a@b.c">m</a><a href="#top">top</a><a href="javascript:x()">js</a></body></html>`;
  const p = extractPage(html, 'https://co.test/about/');
  assert.equal(p.title, 'T');
  assert.match(p.text, /Hello\nOne\nTwo/);
  assert.doesNotMatch(p.text, /evil|IGNORE|hidden|Careers/);
  assert.deepEqual(p.links.map((l) => l.url), ['https://co.test/careers', 'https://co.test/about/team']);
});

test('scoreLink ranks hiring pages at unpredictable paths and anchor text above boilerplate', () => {
  const s = (url, text) => scoreLink({ url, text }).score;
  assert.ok(s('https://x.com/handbook/people-group/interviewing') > 10);
  assert.ok(s('https://x.com/our-process', 'How we hire') > 5);
  assert.ok(s('https://x.com/careers') > s('https://x.com/about'));
  assert.ok(s('https://x.com/about') > s('https://x.com/blog/post-1'));
  assert.ok(s('https://x.com/login') < 0 && s('https://x.com/privacy-policy') < 0);
  assert.equal(scoreLink({ url: 'https://x.com/logo.png' }).excluded, true);
});

test('hiringSignals recognises a process page and not a plain job listing', () => {
  const process = hiringSignals({ text: 'Our interview process: recruiter screen, take-home, system design interview, onsite.', title: '', url: '' });
  const listing = hiringSignals({ text: 'Senior engineer. Apply now. Apply today.', title: 'Jobs', url: '' });
  assert.ok(process.score >= 6 && process.found.includes('take-home'));
  assert.ok(listing.score < 6);
});

test('inScope: subdomains of a real domain are in; local hosts are confined to the start path', () => {
  const root = new URL('https://www.example.co.uk/');
  assert.equal(inScope(new URL('https://handbook.example.co.uk/x'), root), true);
  assert.equal(inScope(new URL('https://other.co.uk/x'), root), false);
  const local = new URL('http://localhost:8099/acme/');
  assert.equal(inScope(new URL('http://localhost:8099/acme/careers'), local), true);
  assert.equal(inScope(new URL('http://localhost:8099/globex/careers'), local), false);
  assert.equal(inScope(new URL('http://localhost:9999/acme/careers'), local), false);
});

test('companyNameFromUrl', () => {
  assert.equal(companyNameFromUrl('https://posthog.com'), 'posthog');
  assert.equal(companyNameFromUrl('https://handbook.gitlab.com/x'), 'gitlab');
  assert.equal(companyNameFromUrl('http://localhost:8099/acme/'), 'acme');
  assert.equal(companyNameFromUrl('http://127.0.0.1:1/'), '');
});
