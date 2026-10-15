import net from 'node:net';
import dns from 'node:dns/promises';
import { AppError } from './errors.js';

const blocked = new net.BlockList();
for (const [addr, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], // incl. cloud metadata
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['224.0.0.0', 4], ['240.0.0.0', 4],
]) blocked.addSubnet(addr, prefix, 'ipv4');
for (const [addr, prefix] of [['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8]]) {
  blocked.addSubnet(addr, prefix, 'ipv6');
}

/** True for private, loopback, link-local, multicast, reserved (and anything that isn't an IP). */
export function isBlockedIp(ip) {
  const family = net.isIP(ip);
  if (!family) return true;
  if (family === 4) return blocked.check(ip, 'ipv4');
  const lower = ip.toLowerCase();
  const dotted = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/); // IPv4-mapped, dotted
  if (dotted) return isBlockedIp(dotted[1]);
  const hex = lower.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/); // IPv4-mapped, as URL normalises it
  if (hex) {
    const hi = parseInt(hex[1], 16);
    const lo = parseInt(hex[2], 16);
    return isBlockedIp(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
  }
  return blocked.check(ip, 'ipv6');
}

const defaultResolve = async (host) => (await dns.lookup(host, { all: true })).map((r) => r.address);
const LOCAL_NAMES = /(^|\.)(localhost|local|internal|localdomain)$/i;

function parseHttpUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new AppError('INVALID_URL', `Not a valid URL: ${String(raw).slice(0, 200)}`, { status: 400 });
  }
  if (!['http:', 'https:'].includes(url.protocol)) throw new AppError('INVALID_URL', 'Only http(s) URLs are allowed.', { status: 400 });
  if (url.username || url.password) throw new AppError('INVALID_URL', 'URLs with credentials are not allowed.', { status: 400 });
  return url;
}

/**
 * Throws AppError INVALID_URL | BLOCKED_ADDRESS | DNS_FAILURE, otherwise returns the parsed URL.
 * Resolves the hostname and rejects if ANY address is non-public.
 * Known limit: DNS is resolved here and again by fetch(), so a rebinding attacker could race the two.
 */
export async function assertPublicUrl(raw, { resolve = defaultResolve } = {}) {
  const url = parseHttpUrl(raw);
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const deny = () => new AppError('BLOCKED_ADDRESS', `Refusing to fetch non-public address: ${url.hostname}`, { status: 400 });

  if (net.isIP(host)) {
    if (isBlockedIp(host)) throw deny();
    return url;
  }
  if (LOCAL_NAMES.test(host)) throw deny();

  let addresses;
  try {
    addresses = await resolve(host);
  } catch {
    throw new AppError('DNS_FAILURE', `Could not resolve host: ${host}`, { status: 502 });
  }
  if (!addresses?.length) throw new AppError('DNS_FAILURE', `Could not resolve host: ${host}`, { status: 502 });
  if (addresses.some(isBlockedIp)) throw deny();
  return url;
}

/** Returns an async (url) => URL guard. blockPrivate=false still enforces scheme + no credentials. */
export const makeGuard = ({ blockPrivate, resolve } = {}) =>
  blockPrivate ? (raw) => assertPublicUrl(raw, { resolve }) : async (raw) => parseHttpUrl(raw);
