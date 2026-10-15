import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertPublicUrl, isBlockedIp, makeGuard } from '../src/lib/urlGuard.js';

const publicResolver = async () => ['93.184.216.34'];

test('blocks private, loopback, link-local and metadata IPs', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '0.0.0.0', '100.64.0.1', '::1', 'fe80::1', 'fd00::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:a00:1']) {
    assert.equal(isBlockedIp(ip), true, ip);
  }
  for (const ip of ['93.184.216.34', '8.8.8.8', '172.32.0.1', '2606:4700:4700::1111']) assert.equal(isBlockedIp(ip), false, ip);
});

test('rejects bad schemes, credentials and local hostnames', async () => {
  for (const [url, code] of [
    ['file:///etc/passwd', 'INVALID_URL'], ['ftp://x.com', 'INVALID_URL'], ['not a url', 'INVALID_URL'],
    ['http://user:pw@example.com', 'INVALID_URL'], ['http://localhost:3000', 'BLOCKED_ADDRESS'],
    ['http://foo.internal', 'BLOCKED_ADDRESS'], ['http://127.0.0.1', 'BLOCKED_ADDRESS'],
    ['http://[::1]/', 'BLOCKED_ADDRESS'], ['http://169.254.169.254/latest/meta-data', 'BLOCKED_ADDRESS'],
    ['http://2130706433/', 'BLOCKED_ADDRESS'], // decimal form of 127.0.0.1
  ]) {
    await assert.rejects(assertPublicUrl(url, { resolve: publicResolver }), { code }, url);
  }
});

test('rejects hostnames that RESOLVE to private addresses (any one bad record is enough)', async () => {
  await assert.rejects(assertPublicUrl('http://evil.test', { resolve: async () => ['10.0.0.5'] }), { code: 'BLOCKED_ADDRESS' });
  await assert.rejects(assertPublicUrl('http://mixed.test', { resolve: async () => ['93.184.216.34', '127.0.0.1'] }), { code: 'BLOCKED_ADDRESS' });
});

test('DNS failure is its own code; public hosts pass', async () => {
  await assert.rejects(assertPublicUrl('http://nx.test', { resolve: async () => { throw new Error('ENOTFOUND'); } }), { code: 'DNS_FAILURE' });
  assert.equal((await assertPublicUrl('https://example.com/a?b=1', { resolve: publicResolver })).hostname, 'example.com');
});

test('makeGuard(blockPrivate=false) allows localhost but still enforces scheme + credentials', async () => {
  const guard = makeGuard({ blockPrivate: false });
  assert.equal((await guard('http://127.0.0.1:8099/acme/')).port, '8099');
  await assert.rejects(guard('file:///etc/passwd'), { code: 'INVALID_URL' });
  await assert.rejects(guard('http://u:p@127.0.0.1'), { code: 'INVALID_URL' });
});
