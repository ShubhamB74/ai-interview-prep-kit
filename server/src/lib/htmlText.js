import * as cheerio from 'cheerio';

const BLOCKS = 'p,div,li,ul,ol,h1,h2,h3,h4,h5,h6,tr,section,article,header,main,pre,blockquote,table,dt,dd';
const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();

function normalizeText(s) {
  return s
    .replace(/\r/g, '')
    .split('\n')
    .map((l) => l.replace(/[ \t\u00a0]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function collectLinks($, baseUrl) {
  const seen = new Set();
  const links = [];
  $('a[href]').each((_, el) => {
    const href = ($(el).attr('href') || '').trim();
    if (!href || href.startsWith('#') || /^(mailto|tel|javascript|data):/i.test(href)) return;
    let url;
    try {
      url = new URL(href, baseUrl); // relative links resolved against the page, never a fixed host
    } catch {
      return;
    }
    if (!['http:', 'https:'].includes(url.protocol)) return;
    url.hash = '';
    if (seen.has(url.href)) return;
    seen.add(url.href);
    links.push({ url: url.href, text: clean($(el).text() || $(el).attr('aria-label') || $(el).attr('title')).slice(0, 120) });
  });
  return links;
}

/**
 * HTML -> { title, text, links }. Text drops scripts, styles, nav/footer boilerplate and hidden elements
 * (hidden text is a common prompt-injection hiding place). Links are collected BEFORE boilerplate removal,
 * because the careers link usually lives in the nav.
 */
export function extractPage(html, baseUrl, { maxChars = 12000 } = {}) {
  const $ = cheerio.load(html);
  const links = collectLinks($, baseUrl);

  $('script,style,noscript,svg,iframe,object,embed,template,nav,footer,[hidden],[aria-hidden="true"]').remove();
  $('[style]')
    .filter((_, el) => /display\s*:\s*none|visibility\s*:\s*hidden/i.test($(el).attr('style') || ''))
    .remove();

  const title = clean($('title').first().text()) || clean($('h1').first().text());
  $('br').replaceWith('\n');
  $(BLOCKS).after('\n');
  const main = $('main, article, [role="main"]').first();
  const root = main.length && main.text().trim().length > 200 ? main : $('body').length ? $('body') : $.root();
  const text = normalizeText(root.text());
  return { title, text: text.slice(0, maxChars), links, truncated: text.length > maxChars };
}

export function extractPlain(body, { maxChars = 12000 } = {}) {
  const text = normalizeText(body);
  return { title: '', text: text.slice(0, maxChars), links: [], truncated: text.length > maxChars };
}

/** For API snippets that contain inline HTML (e.g. Hacker News comments). */
export const htmlFragmentToText = (html) => extractPage(`<body>${html}</body>`, 'http://invalid.local/', { maxChars: 50_000 }).text;
