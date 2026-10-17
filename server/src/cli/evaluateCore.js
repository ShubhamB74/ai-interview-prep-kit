import { z } from 'zod';
import { validateKit } from '../schema/kit.js';

const MIN_CASE_BUDGET_MS = 30_000;

const CaseSchema = z.object({
  id: z.string().min(1),
  jd: z.string(),
  company_url: z.string(),
  days: z.number().int().min(1),
});

/**
 * Runs every case through `pipeline` and returns Appendix B entries, one per input case, in input order.
 * A case that throws is recorded as failed and the run continues. `failed` means "no kit at all":
 * a kit with research gaps (no hiring page, unreachable site, thin posting) is still `ok`.
 * @param {unknown[]} cases
 * @param {{ pipeline: (i: {jd: string, companyUrl: string, days: number, budgetMs?: number, onProgress?: Function}) => Promise<object>, log?: (s: string) => void, totalBudgetMs?: number }} deps
 */
export async function evaluateCases(cases, { pipeline, log = () => {}, totalBudgetMs, now = Date.now }) {
  const results = [];
  const deadline = totalBudgetMs ? now() + totalBudgetMs : null;
  for (const [index, raw] of cases.entries()) {
    const id = typeof raw?.id === 'string' ? raw.id : 'unknown';
    const started = Date.now();
    const parsed = CaseSchema.safeParse(raw);
    let entry;
    if (!parsed.success) {
      entry = { id, status: 'failed', kit: null, error: { code: 'INVALID_CASE', message: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') } };
    } else {
      const c = parsed.data;
      // Whatever time is left is shared equally by the cases still to run, so one slow case can't starve the rest.
      const budgetMs = deadline ? Math.max(MIN_CASE_BUDGET_MS, (deadline - now()) / (cases.length - index)) : undefined;
      try {
        const kit = await pipeline({ jd: c.jd, companyUrl: c.company_url, days: c.days, budgetMs, onProgress: (e) => log(`  ${c.id} ${e.step}: ${e.status}${e.detail ? ` (${e.detail})` : ''}`) });
        const v = validateKit(kit);
        entry = v.ok
          ? { id: c.id, status: 'ok', kit: v.kit, error: null }
          : { id: c.id, status: 'failed', kit: null, error: { code: 'INVALID_KIT', message: v.errors.slice(0, 5).join('; ') } };
      } catch (err) {
        entry = { id: c.id, status: 'failed', kit: null, error: { code: err.code || 'UNEXPECTED', message: err.message } };
      }
    }
    log(`[evaluate] ${entry.id}: ${entry.status}${entry.error ? ` (${entry.error.code})` : ''} in ${((Date.now() - started) / 1000).toFixed(1)}s`);
    results.push(entry);
  }
  return results;
}
