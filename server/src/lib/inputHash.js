import crypto from 'node:crypto';

/** Same posting + company => same hash, regardless of whitespace/case/trailing slash. */
export function inputHash(jd, companyUrl) {
  const normJd = jd.toLowerCase().replace(/\s+/g, ' ').trim();
  let normUrl = companyUrl.trim().toLowerCase();
  try {
    const u = new URL(companyUrl);
    normUrl = `${u.protocol}//${u.host}${u.pathname.replace(/\/+$/, '')}`.toLowerCase();
  } catch {
    /* validated upstream; fall back to raw */
  }
  return crypto.createHash('sha256').update(`${normJd}|${normUrl}`).digest('hex');
}

export const titleFromJd = (jd) => (jd.split('\n').find((l) => l.trim()) || 'Untitled').trim().slice(0, 80);
