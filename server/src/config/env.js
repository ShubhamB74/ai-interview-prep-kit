import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
dotenv.config({ path: path.join(root, '.env') });

const num = (v, d) => (v === undefined || v === '' ? d : Number(v));
const bool = (v, d) => (v === undefined || v === '' ? d : v === 'true');

const nodeEnv = process.env.NODE_ENV || 'development';

// Free-tier presets. Limits are per model and change; override with LLM_* vars (check your provider's console).
const LLM_PRESETS = {
  gemini: { baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-2.5-flash', requestsPerMinute: 9, tokensPerMinute: 200_000 },
  groq: { baseUrl: 'https://api.groq.com/openai/v1', model: 'openai/gpt-oss-120b', requestsPerMinute: 25, tokensPerMinute: 7_000 },
  'openai-compatible': { baseUrl: '', model: '', requestsPerMinute: 20, tokensPerMinute: 20_000 },
};
const llmProvider = process.env.LLM_PROVIDER || 'gemini';
const preset = LLM_PRESETS[llmProvider] ?? LLM_PRESETS['openai-compatible'];

export const env = {
  nodeEnv,
  port: num(process.env.PORT, 4000),
  mongoUri: process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/prepkit',
  sessionSecret: process.env.SESSION_SECRET || 'dev-only-secret',
  sessionTtlDays: num(process.env.SESSION_TTL_DAYS, 7),
  webOrigin: process.env.WEB_ORIGIN || 'http://localhost:3000',
  llm: {
    provider: llmProvider,
    baseUrl: process.env.LLM_BASE_URL || preset.baseUrl,
    model: process.env.LLM_MODEL || preset.model,
    apiKey: process.env.LLM_API_KEY || '',
    maxRetries: num(process.env.LLM_MAX_RETRIES, 4),
    requestsPerMinute: num(process.env.LLM_REQUESTS_PER_MINUTE, preset.requestsPerMinute),
    tokensPerMinute: num(process.env.LLM_TOKENS_PER_MINUTE, preset.tokensPerMinute),
    timeoutMs: num(process.env.LLM_TIMEOUT_MS, 60_000),
    // If the provider says "retry in N seconds" and N is above this, treat the quota as exhausted instead of waiting.
    maxWaitMs: num(process.env.LLM_MAX_WAIT_MS, 90_000),
    // Keeps reasoning models from spending the whole output budget on hidden "thinking". Empty = don't send.
    reasoningEffort: process.env.LLM_REASONING_EFFORT ?? 'low',
  },
  jobs: {
    concurrency: num(process.env.JOB_CONCURRENCY, 1),
    timeoutMs: num(process.env.JOB_TIMEOUT_MS, 600_000),
    maxAttempts: num(process.env.JOB_MAX_ATTEMPTS, 3),
    maxActivePerUser: num(process.env.JOB_MAX_ACTIVE_PER_USER, 5),
  },
  crawl: {
    maxPages: num(process.env.CRAWL_MAX_PAGES, 8),
    delayMs: num(process.env.CRAWL_DELAY_MS, 1000),
    timeoutMs: num(process.env.CRAWL_TIMEOUT_MS, 8000),
    maxBytes: num(process.env.CRAWL_MAX_BYTES, 1_500_000),
    retries: num(process.env.CRAWL_RETRIES, 2),
    // Private/loopback addresses are rejected in production. Outside production they are allowed
    // so `npm run evaluate` can crawl company sites served from localhost.
    blockPrivate: bool(process.env.BLOCK_PRIVATE_ADDRESSES, nodeEnv === 'production'),
    discussionEnabled: bool(process.env.DISCUSSION_ENABLED, true),
  },
};

if (env.nodeEnv === 'production' && env.sessionSecret === 'dev-only-secret') {
  throw new Error('SESSION_SECRET must be set in production.');
}
