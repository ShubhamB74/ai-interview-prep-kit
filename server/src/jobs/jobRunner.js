import { validateKit } from '../schema/kit.js';

/**
 * Runs kit generation in the background of the API process. Generation is slow (tens of seconds to minutes),
 * external and failure-prone, so the HTTP request only creates a `pending` record and returns; this runner does the work
 * and the client polls the record. Design points:
 *
 *  - Queue + concurrency cap, because the free LLM budget is shared (one client for all jobs).
 *  - Idempotent: enqueueing an id that is already queued or running is a no-op, and `claim` is an atomic
 *    pending -> running transition, so a double trigger can never run the same kit twice.
 *  - Every write carries the job's `attempt`, so a job that timed out (but whose promise is still alive) or was
 *    superseded by a retry cannot overwrite newer state.
 *  - A deadline (`timeoutMs`): on expiry the kit is marked failed JOB_TIMEOUT. The pipeline also gets a soft time budget
 *    (80% of the deadline) so it degrades by skipping optional steps rather than hitting the wall.
 *  - Progress is written per step (latest state wins) so the UI can show it; a failed write never fails the job.
 *  - Restart recovery: interrupted `running` jobs go back to `pending` (up to `maxAttempts`), and everything pending is re-enqueued.
 */
export class JobRunner {
  constructor({ kits, pipeline, concurrency = 1, timeoutMs = 10 * 60_000, maxAttempts = 3, log = () => {} }) {
    this.kits = kits;
    this.pipeline = pipeline;
    this.concurrency = concurrency;
    this.timeoutMs = timeoutMs;
    this.maxAttempts = maxAttempts;
    this.log = log;
    this.queue = [];
    this.queued = new Set();
    this.active = new Map();
  }

  /** @returns {boolean} false if the kit was already queued or running here. */
  enqueue(id) {
    if (this.queued.has(id) || this.active.has(id)) return false;
    this.queued.add(id);
    this.queue.push(id);
    this.#pump();
    return true;
  }

  /** Call once at startup. */
  async recover() {
    const ids = await this.kits.recoverInterrupted(this.maxAttempts);
    ids.forEach((id) => this.enqueue(id));
    return ids.length;
  }

  /** Resolves when nothing is queued or running (tests, graceful shutdown). */
  async drain() {
    while (this.queue.length || this.active.size) await Promise.all([...this.active.values()]).then(() => new Promise((r) => setImmediate(r)));
  }

  stats() {
    return { queued: this.queue.length, running: this.active.size };
  }

  #pump() {
    while (this.active.size < this.concurrency && this.queue.length) {
      const id = this.queue.shift();
      this.queued.delete(id);
      const p = this.#run(id)
        .catch((err) => this.log(`[jobs] ${id} crashed: ${err.stack || err}`))
        .finally(() => { this.active.delete(id); this.#pump(); });
      this.active.set(id, p);
    }
  }

  async #run(id) {
    const rec = await this.kits.claim(id);
    if (!rec) return; // already running elsewhere, finished, or deleted: nothing to do
    const { attempt } = rec;

    let seq = 0;
    let writes = Promise.resolve();
    const onProgress = (e) => {
      const n = ++seq;
      writes = writes.then(() => this.kits.setProgress(id, attempt, e.step, { status: e.status, detail: e.detail ?? null, seq: n })).catch((err) => this.log(`[jobs] progress write failed: ${err.message}`));
    };

    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(Object.assign(new Error(`Generation did not finish within ${Math.round(this.timeoutMs / 1000)}s.`), { code: 'JOB_TIMEOUT' })), this.timeoutMs);
    });

    try {
      const kit = await Promise.race([
        this.pipeline({ jd: rec.input.jd, companyUrl: rec.input.company_url, days: rec.input.days, onProgress, budgetMs: Math.round(this.timeoutMs * 0.8) }),
        timeout,
      ]);
      const checked = validateKit(kit); // never persist something that doesn't match Appendix A
      await writes;
      if (!checked.ok) await this.kits.fail(id, attempt, { code: 'INVALID_KIT', message: checked.errors.slice(0, 5).join('; ') });
      else await this.kits.finish(id, attempt, checked.kit);
    } catch (err) {
      await writes;
      await this.kits.fail(id, attempt, { code: err.code || 'UNEXPECTED', message: String(err.message || err).slice(0, 500) });
    } finally {
      clearTimeout(timer);
    }
  }
}
