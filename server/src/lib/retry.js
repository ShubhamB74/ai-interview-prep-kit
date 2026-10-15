const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Retry `fn` with exponential backoff + jitter. Honours err.retryAfterMs (e.g. a 429 Retry-After).
 * Reused by the LLM client in Phase 3.
 */
export async function withBackoff(
  fn,
  { retries = 2, baseMs = 500, maxMs = 8000, shouldRetry = () => true, sleep = defaultSleep, random = Math.random, onRetry } = {}
) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      if (attempt >= retries || !shouldRetry(err)) throw err;
      const exp = Math.min(maxMs, baseMs * 2 ** attempt) * (0.5 + random() / 2);
      const delay = err.retryAfterMs != null ? Math.min(err.retryAfterMs, 60_000) : exp;
      onRetry?.(err, attempt + 1, delay);
      await sleep(delay);
    }
  }
}
