import { applyOps, OpError } from '@prepkit/shared/kitOps';
import { AppError } from '../lib/errors.js';
import { checkCoverage } from '../pipeline/checkCoverage.js';
import { reconcileSchedule } from '../pipeline/reconcileSchedule.js';
import { validateKit } from '../schema/kit.js';

const MAX_TRIES = 8;

export const refreshCoverage = (kit) => {
  kit.coverage.uncovered_requirement_ids = checkCoverage({ requirements: kit.role.requirements, questions: kit.questions }).uncovered;
};

/**
 * The ONLY way a kit document is modified after generation (user edits and regeneration commits alike).
 * Read -> copy -> `mutate(copy)` -> validate against Appendix A -> write only if the version is unchanged.
 * If someone else wrote in between, re-read and re-apply `mutate` to the NEW document, so concurrent changes merge
 * instead of one silently overwriting the other. `mutate` must therefore be a pure function of the document it is given.
 * @returns the saved record
 */
export async function applyToKit(kits, id, userId, mutate) {
  for (let attempt = 0; attempt < MAX_TRIES; attempt++) {
    const rec = await kits.findOwned(id, userId);
    if (!rec) throw new AppError('KIT_NOT_FOUND', 'Kit not found.', { status: 404 });
    if (rec.status !== 'ready' || !rec.kit) throw new AppError('KIT_NOT_READY', 'This kit is not ready to edit yet.', { status: 409 });

    const draft = structuredClone(rec.kit);
    mutate(draft, rec);
    refreshCoverage(draft);
    const checked = validateKit(draft);
    if (!checked.ok) throw new AppError('INVALID_EDIT', `That change would make the kit invalid: ${checked.errors.slice(0, 3).join('; ')}`, { status: 422 });

    const saved = await kits.replaceKit(id, userId, rec.version, checked.kit);
    if (saved) return saved;
  }
  throw new AppError('EDIT_CONFLICT', 'The kit is being changed too quickly. Please try again.', { status: 409 });
}

/** A batch of edit ops, applied atomically (all or nothing). */
export function applyOpsToKit(kits, id, userId, ops) {
  return applyToKit(kits, id, userId, (kit) => {
    try {
      const { resched } = applyOps(kit, ops);
      if (resched) reconcileSchedule(kit);
    } catch (err) {
      if (err instanceof OpError) throw new AppError(err.code, err.message, { status: err.code === 'ITEM_NOT_FOUND' ? 404 : 409 });
      throw err;
    }
  });
}
