/**
 * Deterministic link ranking. No fixed path list: a link is judged by the words in its URL path AND its
 * anchor text, so "How we hire" -> /our-process and /handbook/people/interviewing both rank high.
 */
const compile = (table) => table.map(([kw, w]) => [kw, w, new RegExp(`\\b${kw}`)]);

const HIRING = compile([
  ['interview', 8], ['hiring process', 8], ['how we hire', 8], ['hiring', 6], ['recruit', 5], ['application process', 6],
  ['candidate', 4], ['careers', 5], ['career', 4], ['jobs', 4], ['join us', 4], ['join our team', 4], ['work with us', 4],
  ['working at', 3], ['life at', 3], ['open positions', 3], ['open roles', 3], ['handbook', 4], ['culture', 2], ['people', 1],
]);
const ABOUT = compile([
  ['about', 3], ['company', 2], ['what we do', 3], ['mission', 2], ['values', 2], ['engineering', 2],
  ['team', 1], ['product', 1], ['blog', 1], ['story', 1],
]);
const NEGATIVE = compile([
  ['login', -10], ['log in', -10], ['sign in', -10], ['signin', -10], ['sign up', -6], ['signup', -6], ['privacy', -8],
  ['terms', -8], ['cookie', -8], ['legal', -6], ['cart', -8], ['checkout', -8], ['unsubscribe', -8],
  ['press', -1], ['contact', -1], ['pricing', -2], ['docs', -1],
]);

const EXCLUDED_EXT = /\.(pdf|jpe?g|png|gif|svg|webp|ico|zip|gz|mp4|mp3|mov|css|js|json|xml|woff2?|ttf|eot|dmg|exe)$/i;

const decode = (s) => {
  try { return decodeURIComponent(s); } catch { return s; }
};
const tokens = (s) => decode(s).toLowerCase().replace(/[-_/.+]+/g, ' ').replace(/\s+/g, ' ').trim();

function sum(haystack, table) {
  let total = 0;
  for (const [, w, re] of table) if (re.test(haystack)) total += w;
  return total;
}

/** @returns {{ score: number, kind: 'hiring'|'about'|'other', excluded: boolean }} */
export function scoreLink({ url, text = '' }) {
  const u = typeof url === 'string' ? new URL(url) : url;
  if (EXCLUDED_EXT.test(u.pathname)) return { score: -Infinity, kind: 'other', excluded: true };
  const path = tokens(u.pathname);
  const anchor = tokens(text);
  const both = (table) => sum(path, table) + 0.8 * sum(anchor, table); // path counts fully, anchor text at 80%
  const hiring = both(HIRING);
  const about = both(ABOUT);
  const depth = u.pathname.split('/').filter(Boolean).length;
  const score = hiring + about + both(NEGATIVE) - (u.search ? 1 : 0) - 0.15 * depth;
  return { score, kind: hiring >= about && hiring >= 3 ? 'hiring' : about > 0 ? 'about' : 'other', excluded: false };
}

const PAGE_TERMS = [
  ['interview', 2, 5], ['take-home', 3, 2], ['take home', 3, 2], ['hiring process', 4, 2], ['how we hire', 4, 2],
  ['system design', 2, 2], ['onsite', 1, 2], ['on-site', 1, 2], ['phone screen', 2, 2], ['recruiter', 1, 2],
  ['coding challenge', 2, 2], ['pair programming', 1, 2], ['we hire', 2, 2], ['apply', 0.5, 3],
];

/** Page-level evidence that this page describes how the company hires (checked on fetched text, not links). */
export function hiringSignals({ text, title = '', url = '' }) {
  const t = text.toLowerCase();
  let score = 0;
  const found = [];
  for (const [term, weight, cap] of PAGE_TERMS) {
    const n = t.split(term).length - 1;
    if (n) { score += Math.min(n, cap) * weight; found.push(term); }
  }
  if (/interview|hiring|careers|jobs/.test(`${title} ${url}`.toLowerCase())) score += 3;
  return { score, found };
}
