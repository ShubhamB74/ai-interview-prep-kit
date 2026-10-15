/**
 * The only place that talks to the network for retrieval. Enforces, per request:
 *  URL guard on every redirect hop, per-host throttle, timeout, content-type allow-list, size cap.
 * Throws FetchError with a stable `code`; `retriable` tells withBackoff whether to try again.
 */
export class FetchError extends Error {
  constructor(code, message, { retriable = false, retryAfterMs, status } = {}) {
    super(message);
    this.name = 'FetchError';
    this.code = code;
    this.retriable = retriable;
    this.retryAfterMs = retryAfterMs;
    this.status = status;
  }
}

export const HTML_TYPES = ['text/html', 'application/xhtml+xml', 'text/plain'];
const MAX_REDIRECTS = 5;

function parseRetryAfter(value) {
  if (!value) return undefined;
  const secs = Number(value);
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
  const at = Date.parse(value);
  return Number.isNaN(at) ? undefined : Math.max(0, at - Date.now());
}

const isTimeout = (e) => e?.name === 'TimeoutError' || e?.name === 'AbortError';

async function readCapped(res, maxBytes) {
  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new FetchError('TOO_LARGE', `Response exceeded ${maxBytes} bytes.`);
    }
    chunks.push(value);
  }
  return new TextDecoder('utf-8').decode(Buffer.concat(chunks));
}

/** @returns {Promise<{url: string, status: number, contentType: string, body: string}>} */
export async function httpGet(rawUrl, ctx, { allowedTypes = HTML_TYPES, skipGuard = false } = {}) {
  const { guard, throttle, fetchImpl, userAgent, config } = ctx;
  let current = rawUrl;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    let url;
    try {
      url = skipGuard ? new URL(current) : await guard(current); // re-validated on EVERY hop
    } catch (err) {
      throw new FetchError(err.code || 'INVALID_URL', err.message);
    }
    await throttle?.wait(url.host);

    let res;
    try {
      res = await fetchImpl(url, {
        redirect: 'manual',
        headers: { 'user-agent': userAgent, accept: allowedTypes.join(', ') + ';q=0.9,*/*;q=0.1' },
        signal: AbortSignal.timeout(config.timeoutMs),
      });
    } catch (err) {
      if (isTimeout(err)) throw new FetchError('TIMEOUT', `Timed out after ${config.timeoutMs}ms`, { retriable: true });
      throw new FetchError('NETWORK', `Network error: ${err.cause?.code || err.message}`, { retriable: true });
    }

    const location = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && location) {
      await res.body?.cancel().catch(() => {});
      current = new URL(location, url).href;
      continue;
    }
    if (res.status === 429 || res.status >= 500) {
      await res.body?.cancel().catch(() => {});
      throw new FetchError(`HTTP_${res.status}`, `Server responded ${res.status}`, {
        retriable: true,
        retryAfterMs: parseRetryAfter(res.headers.get('retry-after')),
        status: res.status,
      });
    }
    if (res.status >= 400) {
      await res.body?.cancel().catch(() => {});
      throw new FetchError(`HTTP_${res.status}`, `Server responded ${res.status}`, { status: res.status });
    }

    // A missing content-type is treated as html; anything declared must be on the allow-list.
    const contentType = (res.headers.get('content-type') || 'text/html').split(';')[0].trim().toLowerCase();
    if (!allowedTypes.includes(contentType)) {
      await res.body?.cancel().catch(() => {});
      throw new FetchError('UNSUPPORTED_CONTENT_TYPE', `Unsupported content type: ${contentType}`);
    }
    const declared = Number(res.headers.get('content-length'));
    if (declared > config.maxBytes) {
      await res.body?.cancel().catch(() => {});
      throw new FetchError('TOO_LARGE', `Response is ${declared} bytes (limit ${config.maxBytes}).`);
    }
    try {
      return { url: url.href, status: res.status, contentType, body: await readCapped(res, config.maxBytes) };
    } catch (err) {
      if (err instanceof FetchError) throw err;
      if (isTimeout(err)) throw new FetchError('TIMEOUT', `Timed out reading body after ${config.timeoutMs}ms`, { retriable: true });
      throw new FetchError('NETWORK', `Network error while reading body: ${err.message}`, { retriable: true });
    }
  }
  throw new FetchError('TOO_MANY_REDIRECTS', `More than ${MAX_REDIRECTS} redirects.`);
}
