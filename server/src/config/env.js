import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
dotenv.config({ path: path.join(root, '.env') });

const num = (v, d) => (v === undefined || v === '' ? d : Number(v));
const bool = (v, d) => (v === undefined || v === '' ? d : v === 'true');

const nodeEnv = process.env.NODE_ENV || 'development';

export const env = {
  nodeEnv,
  port: num(process.env.PORT, 4000),
  mongoUri: process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/prepkit',
  sessionSecret: process.env.SESSION_SECRET || 'dev-only-secret',
  sessionTtlDays: num(process.env.SESSION_TTL_DAYS, 7),
  webOrigin: process.env.WEB_ORIGIN || 'http://localhost:3000',
  llm: {
    provider: process.env.LLM_PROVIDER || 'groq',
    model: process.env.LLM_MODEL || '',
    apiKey: process.env.LLM_API_KEY || '',
    maxRetries: num(process.env.LLM_MAX_RETRIES, 5),
    tokensPerMinute: num(process.env.LLM_TOKENS_PER_MINUTE, 6000),
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
