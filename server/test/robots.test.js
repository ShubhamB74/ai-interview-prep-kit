import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crawlDelayFor, isAllowed, parseRobots } from '../src/lib/robots.js';

const UA = 'PrepKitBot/0.1';

test('disallow / allow with longest match winning', () => {
  const r = parseRobots('User-agent: *\nDisallow: /private\nAllow: /private/public\n');
  assert.equal(isAllowed(r, '/private/x', UA), false);
  assert.equal(isAllowed(r, '/private/public/x', UA), true);
  assert.equal(isAllowed(r, '/careers', UA), true);
});

test('wildcards and end anchors', () => {
  const r = parseRobots('User-agent: *\nDisallow: /*.pdf$\nDisallow: /tmp*/cache\n');
  assert.equal(isAllowed(r, '/a/b.pdf', UA), false);
  assert.equal(isAllowed(r, '/a/b.pdf?x=1', UA), true);
  assert.equal(isAllowed(r, '/tmp1/cache', UA), false);
});

test('specific user-agent group beats *', () => {
  const r = parseRobots('User-agent: *\nDisallow: /\n\nUser-agent: prepkitbot\nAllow: /\n');
  assert.equal(isAllowed(r, '/anything', UA), true);
  assert.equal(isAllowed(r, '/anything', 'OtherBot'), false);
});

test('empty Disallow allows everything; "Disallow: /" blocks everything', () => {
  assert.equal(isAllowed(parseRobots('User-agent: *\nDisallow:\n'), '/x', UA), true);
  assert.equal(isAllowed(parseRobots('User-agent: *\nDisallow: /\n'), '/x', UA), false);
});

test('consecutive user-agent lines share a group; comments ignored; crawl-delay and sitemaps parsed', () => {
  const r = parseRobots('# hi\nUser-agent: a\nUser-agent: prepkitbot # me\nCrawl-delay: 3\nDisallow: /x\nSitemap: https://e.com/s.xml\n');
  assert.equal(isAllowed(r, '/x', UA), false);
  assert.equal(crawlDelayFor(r, UA), 3);
  assert.deepEqual(r.sitemaps, ['https://e.com/s.xml']);
});
