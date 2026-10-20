// Development talks to the API on :4000 directly. In production the default is "same origin": next.config.js proxies /api/*
// to the backend (API_URL), so the session cookie is first-party and works in browsers that block third-party cookies.
const BASE = process.env.NEXT_PUBLIC_API_URL ?? (process.env.NODE_ENV === 'production' ? '' : 'http://localhost:4000');

/** Thin fetch wrapper. Server errors arrive as { error: { code, message } }. */
export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`${BASE}/api${path}`, {
    method,
    credentials: 'include',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data?.error?.message || `Request failed (${res.status})`);
    err.code = data?.error?.code;
    err.status = res.status;
    err.details = data?.error?.details;
    throw err;
  }
  return data;
}
