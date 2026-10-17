/** Tiny fetch client with its own cookie jar (one per simulated user). */
export function apiClient(base) {
  let cookie = '';
  return {
    async call(path, { method = 'GET', body, headers = {} } = {}) {
      const res = await fetch(base + path, {
        method,
        headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers },
        body: body ? JSON.stringify(body) : undefined,
      });
      const set = res.headers.getSetCookie?.()[0];
      if (set) cookie = set.startsWith('prepkit_session=;') ? '' : set.split(';')[0];
      const text = await res.text();
      return { status: res.status, body: text ? JSON.parse(text) : null };
    },
  };
}

export async function waitFor(fn, { timeout = 3000, every = 10 } = {}) {
  const start = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - start > timeout) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, every));
  }
}
