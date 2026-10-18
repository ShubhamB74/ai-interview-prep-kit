import { createApp } from './app.js';
import { env } from './config/env.js';
import { createLlmClient } from './lib/llm.js';
import { JobRunner } from './jobs/jobRunner.js';
import { RegenRunner } from './jobs/regenRunner.js';
import { connectDb } from './models/db.js';
import { runPipeline } from './pipeline/index.js';
import { createMongoRepos } from './repos/mongo.js';

await connectDb(); // auth, kits and jobs all need the database; fail fast if it's down
const repos = createMongoRepos();

// One LLM client for every job: the token/request budget is shared, so parallel users can't blow the provider limit.
const llm = createLlmClient();
const jobs = new JobRunner({
  kits: repos.kits,
  pipeline: (input) => runPipeline({ ...input, llm }),
  concurrency: env.jobs.concurrency,
  timeoutMs: env.jobs.timeoutMs,
  maxAttempts: env.jobs.maxAttempts,
  log: (m) => console.log(m),
});

const regen = new RegenRunner({ kits: repos.kits, llm, log: (m) => console.log(m) });

const resumed = await jobs.recover(); // jobs interrupted by the last shutdown continue instead of hanging forever
if (resumed) console.log(`[jobs] resumed ${resumed} pending kit(s)`);

createApp({ repos, jobs, regen }).listen(env.port, () => console.log(`[server] http://localhost:${env.port}`));
