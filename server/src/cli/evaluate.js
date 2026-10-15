import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import '../config/env.js';
import { runPipeline } from '../pipeline/index.js';
import { validateKit } from '../schema/kit.js';

const CaseSchema = z.object({
  id: z.string().min(1),
  jd: z.string(),
  company_url: z.string(),
  days: z.number().int().min(1),
});

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

async function runCase(raw) {
  const parsed = CaseSchema.safeParse(raw);
  const id = raw?.id ?? 'unknown';
  if (!parsed.success) {
    return { id, status: 'failed', kit: null, error: { code: 'INVALID_CASE', message: parsed.error.message } };
  }
  const c = parsed.data;
  try {
    // Same orchestrator the web app uses.
    const kit = await runPipeline({ jd: c.jd, companyUrl: c.company_url, days: c.days });
    const v = validateKit(kit);
    if (!v.ok) {
      return { id: c.id, status: 'failed', kit: null, error: { code: 'INVALID_KIT', message: v.errors.join('; ') } };
    }
    return { id: c.id, status: 'ok', kit: v.kit, error: null };
  } catch (err) {
    return {
      id: c.id,
      status: 'failed',
      kit: null,
      error: { code: err.code || 'UNEXPECTED', message: err.message },
    };
  }
}

async function main() {
  const { input, output } = parseArgs(process.argv.slice(2));
  if (!input || !output) {
    console.error('Usage: npm run evaluate -- --input <cases.json> --output <kits.json>');
    process.exit(2);
  }
  const cases = JSON.parse(await fs.readFile(abs(input), 'utf8'));
  if (!Array.isArray(cases)) throw new Error('Input must be a JSON array of cases.');

  const kits = [];
  for (const c of cases) {
    // Sequential on purpose: free-tier token limits. Revisit in Phase 5 if 5 cases/15 min is tight.
    const result = await runCase(c);
    console.log(`[evaluate] ${result.id}: ${result.status}${result.error ? ` (${result.error.code})` : ''}`);
    kits.push(result);
  }

  await fs.writeFile(
    abs(output),
    JSON.stringify({ version: '1.0', generated_at: new Date().toISOString(), kits }, null, 2)
  );
  console.log(`[evaluate] wrote ${kits.length} entries to ${output}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
