import net from 'node:net';

const SECOND_LEVEL = new Set(['co', 'com', 'org', 'net', 'gov', 'edu', 'ac', 'or', 'ne']);

/** localhost, bare hostnames and IP literals have no registrable domain. */
export function isLocalLike(hostname) {
  const h = hostname.replace(/^\[|\]$/g, '');
  return net.isIP(h) !== 0 || !h.includes('.') || h.endsWith('.localhost');
}

/** Approximate registrable domain (handles co.uk-style suffixes; no public-suffix list on purpose). */
export function registrableDomain(hostname) {
  const parts = hostname.toLowerCase().split('.');
  if (parts.length <= 2) return parts.join('.');
  const tld = parts.at(-1);
  const sld = parts.at(-2);
  return (tld.length === 2 && SECOND_LEVEL.has(sld) ? parts.slice(-3) : parts.slice(-2)).join('.');
}

/** "Same site" key: sibling subdomains match (about.x.com / handbook.x.com); local hosts match host:port. */
export const siteKey = (u) => (isLocalLike(u.hostname) ? `${u.hostname}:${u.port || ''}` : registrableDomain(u.hostname));

/** Best-effort company name from a URL: posthog.com -> posthog; http://localhost:8099/acme/ -> acme. */
export function companyNameFromUrl(raw) {
  try {
    const u = new URL(raw);
    if (isLocalLike(u.hostname)) return u.pathname.split('/').filter(Boolean)[0] || '';
    return registrableDomain(u.hostname).split('.')[0];
  } catch {
    return '';
  }
}

/** Dedupe key: ignores #fragment and trailing slash. */
export const normalizeUrlKey = (u) => `${u.protocol}//${u.host}${u.pathname.replace(/\/+$/, '') || '/'}${u.search}`;

function dirPrefix(pathname) {
  if (pathname.endsWith('/')) return pathname;
  const last = pathname.split('/').pop();
  return last.includes('.') ? pathname.slice(0, pathname.lastIndexOf('/') + 1) : `${pathname}/`;
}

/**
 * Is `candidate` part of the company site that `root` points at?
 * Real domains: same site (incl. subdomains). Local hosts: same host:port AND under the start path,
 * so http://localhost:8099/acme/ never wanders into /globex/ served by the same fixture server.
 */
export function inScope(candidate, root) {
  if (siteKey(candidate) !== siteKey(root)) return false;
  if (!isLocalLike(root.hostname)) return true;
  const prefix = dirPrefix(root.pathname);
  return candidate.pathname.startsWith(prefix) || candidate.pathname === prefix.slice(0, -1);
}
