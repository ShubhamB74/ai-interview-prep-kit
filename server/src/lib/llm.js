import { env } from '../config/env.js';
import { AppError } from './errors.js';
import { RateBudget, estimateTokens } from './rateBudget.js';
import { withBackoff } from './retry.js';

export class LlmError extends AppError {
  constructor(code, message, { status = 502, retriable = false, retryAfterMs } = {}) {
    super(code, message, { status });
    this.name = 'LlmError';
    this.retriable = retriable;
    this.retryAfterMs = retryAfterMs;
  }
}

/** "try again in 1m20.5s" / "340ms" (Groq) and "retryDelay": "34s" (Gemini). */
export function parseRetryDelayMs(text = '') {
  const g = text.match(/"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/);
  if (g) return Math.ceil(Number(g[1]) * 1000);
  const m = text.match(/try again in\s+(?:(\d+)h)?(?:(\d+)m(?!s))?(?:(\d+(?:\.\d+)?)s)?(?:(\d+(?:\.\d+)?)ms)?/i);
  if (!m || m.slice(1).every((x) => x === undefined)) return undefined;
  const [, h = 0, min = 0, s = 0, ms = 0] = m;
  return Math.ceil(Number(h) * 3_600_000 + Number(min) * 60_000 + Number(s) * 1000 + Number(ms));
}

export function extractJson(content) {
  const text = String(content ?? '').replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
  if (!text) throw new Error('empty response');
  try {
    return JSON.parse(text);
  } catch {
    const a = text.indexOf('{');
    const b = text.lastIndexOf('}');
    if (a >= 0 && b > a) return JSON.parse(text.slice(a, b + 1));
    throw new Error('response is not JSON');
  }
}

/**
 * Provider-agnostic client for OpenAI-compatible chat endpoints (Gemini, Groq, OpenRouter, ...).
 * One entry point -- completeJson -- used by every pipeline step. It owns: token+request budgeting,
 * retry with backoff on 429/5xx/timeouts (honouring the provider's retry hint), "quota exhausted" detection,
 * JSON extraction, schema validation, one repair attempt, and tolerance for providers that reject optional params.
 */
export function createLlmClient({ config = env.llm, fetchImpl = fetch, sleep, now = Date.now } = {}) {
  const budget = new RateBudget({ tokensPerMinute: config.tokensPerMinute, requestsPerMinute: config.requestsPerMinute, now, sleep });
  const optional = { json: true, reasoning: Boolean(config.reasoningEffort) };
  const stats = { calls: 0, retries: 0, repairs: 0, invalidJson: 0, promptTokens: 0, completionTokens: 0 };

  function errorFromResponse(res, text) {
    const status = res.status;
    const snippet = text.slice(0, 300);
    if (status === 401 || status === 403) return new LlmError('LLM_AUTH', `LLM provider rejected the credentials (${status}). Check LLM_API_KEY.`, { status: 502 });
    if (status === 429) {
      const hdr = Number(res.headers.get('retry-after'));
      const retryAfterMs = Number.isFinite(hdr) && res.headers.get('retry-after') !== null ? hdr * 1000 : parseRetryDelayMs(text);
      if (retryAfterMs != null && retryAfterMs > config.maxWaitMs) {
        return new LlmError('LLM_QUOTA_EXHAUSTED', `LLM quota exhausted; provider asks to wait ~${Math.round(retryAfterMs / 1000)}s.`, { status: 503 });
      }
      return new LlmError('LLM_RATE_LIMITED', 'LLM provider rate limit hit.', { status: 503, retriable: true, retryAfterMs });
    }
    if (status >= 500) return new LlmError('LLM_UNAVAILABLE', `LLM provider error (${status}).`, { retriable: true });
    return new LlmError('LLM_BAD_REQUEST', `LLM request rejected (${status}): ${snippet}`);
  }

  async function callOnce(messages, maxTokens) {
    if (!config.apiKey) throw new LlmError('LLM_NOT_CONFIGURED', 'LLM_API_KEY is not set. See .env.example.', { status: 500 });
    if (!config.baseUrl || !config.model) throw new LlmError('LLM_NOT_CONFIGURED', 'LLM_BASE_URL and LLM_MODEL must be set for this provider.', { status: 500 });

    const estimate = estimateTokens(messages.map((m) => m.content).join('\n')) + Math.ceil(maxTokens * 0.6);
    const slot = await budget.acquire(estimate);

    const body = { model: config.model, messages, temperature: 0.3, max_tokens: maxTokens };
    if (optional.json) body.response_format = { type: 'json_object' };
    if (optional.reasoning) body.reasoning_effort = config.reasoningEffort;

    let res;
    try {
      res = await fetchImpl(`${config.baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${config.apiKey}` },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(config.timeoutMs),
      });
    } catch (err) {
      const timeout = err?.name === 'TimeoutError' || err?.name === 'AbortError';
      throw new LlmError(timeout ? 'LLM_TIMEOUT' : 'LLM_UNAVAILABLE', timeout ? `LLM call timed out after ${config.timeoutMs}ms.` : `LLM network error: ${err.message}`, { retriable: true });
    }
    const text = await res.text();

    if (res.status === 400) {
      // Some providers reject optional params; drop the offender once and retry immediately.
      if (optional.json && /response_format|json_object/i.test(text)) { optional.json = false; return callOnce(messages, maxTokens); }
      if (optional.reasoning && /reasoning_effort|reasoning/i.test(text)) { optional.reasoning = false; return callOnce(messages, maxTokens); }
    }
    if (!res.ok) throw errorFromResponse(res, text);

    let data;
    try { data = JSON.parse(text); } catch { throw new LlmError('LLM_UNAVAILABLE', 'LLM returned a non-JSON HTTP body.', { retriable: true }); }
    const choice = data.choices?.[0];
    const usage = data.usage ?? {};
    budget.settle(slot, usage.total_tokens);
    stats.calls++;
    stats.promptTokens += usage.prompt_tokens ?? 0;
    stats.completionTokens += usage.completion_tokens ?? 0;
    return { content: choice?.message?.content ?? '', finishReason: choice?.finish_reason };
  }

  const request = (messages, maxTokens) =>
    withBackoff(() => callOnce(messages, maxTokens), {
      retries: config.maxRetries, baseMs: 1000, maxMs: 20_000, sleep,
      shouldRetry: (e) => e.retriable,
      onRetry: () => { stats.retries++; },
    });

  function parseAndValidate(content, schema) {
    try {
      const parsed = schema.safeParse(extractJson(content));
      if (parsed.success) return { ok: true, data: parsed.data };
      return { ok: false, error: parsed.error.issues.slice(0, 5).map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ') };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  /**
   * @param {{ name: string, system: string, user: string, schema: import('zod').ZodTypeAny, maxTokens?: number }} args
   * @returns {Promise<any>} schema-validated data. Throws LlmError (LLM_INVALID_JSON after one repair attempt).
   */
  async function completeJson({ name, system, user, schema, maxTokens = 1500 }) {
    let messages = [{ role: 'system', content: system }, { role: 'user', content: user }];
    let tokens = maxTokens;
    let lastError = 'unknown';
    for (let attempt = 0; attempt < 2; attempt++) {
      const r = await request(messages, tokens);
      const out = parseAndValidate(r.content, schema);
      if (out.ok) return out.data;
      lastError = out.error;
      stats.invalidJson++;
      if (r.finishReason === 'length') {
        tokens = Math.min(Math.ceil(tokens * 1.6), 4096); // output was cut off: more room, same question
      } else {
        stats.repairs++;
        messages = [
          ...messages,
          { role: 'assistant', content: String(r.content).slice(0, 3000) },
          { role: 'user', content: `That reply was not valid. Problems: ${out.error}\nReturn ONLY the corrected JSON object, nothing else.` },
        ];
      }
    }
    throw new LlmError('LLM_INVALID_JSON', `Model returned invalid JSON for "${name}": ${lastError}`);
  }

  return { completeJson, get stats() { return { ...stats, waitedMs: budget.waitedMs }; } };
}
