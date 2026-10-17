import fs from 'node:fs/promises';
import path from 'node:path';
import '../config/env.js';
import { createLlmClient } from '../lib/llm.js';
import { runPipeline } from '../pipeline/index.js';
import { evaluateCases } from './evaluateCore.js';

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--input') out.input = argv[++i];
    else if (argv[i] === '--output') out.output = argv[++i];
  }
  return out;
}

/** Resolve relative to where the user ran the command. */
const abs = (p) => path.resolve(process.env.INIT_CWD || process.cwd(), p);

async function main() {
  const { input, output } = parseArgs(process.argv.slice(2));
  if (!input || !output) {
    console.error('Usage: npm run evaluate -- --input <cases.json> --output <kits.json>');
    process.exit(2);
  }
  const cases = JSON.parse(await fs.readFile(abs(input), 'utf8'));
  if (!Array.isArray(cases)) throw new Error('Input must be a JSON array of cases.');

  // ONE client for the whole batch: the token/request budget is shared, so case 2 doesn't blow through the
  // per-minute limit that case 1 already used. Cases run sequentially for the same reason.
  const llm = createLlmClient();
  const kits = await evaluateCases(cases, { pipeline: (i) => runPipeline({ ...i, llm }), log: (s) => console.log(s), totalBudgetMs: Number(process.env.EVALUATE_BUDGET_MS) || 780_000 });

  await fs.writeFile(abs(output), JSON.stringify({ version: '1.0', generated_at: new Date().toISOString(), kits }, null, 2));
  const s = llm.stats;
  console.log(`[evaluate] wrote ${kits.length} entries to ${output} | llm: ${s.calls} calls, ${s.promptTokens + s.completionTokens} tokens, ${s.retries} retries, waited ${(s.waitedMs / 1000).toFixed(0)}s on rate limits`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
