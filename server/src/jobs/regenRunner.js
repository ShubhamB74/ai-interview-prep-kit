import { createRetrievalContext } from '../pipeline/retrievalContext.js';
import { regenerateBrief, regenerateQuestions } from '../services/regenerate.js';

/**
 * Runs section regenerations (brief, one question category) in the background, a few at a time.
 * The API claims the kit's single regen slot first (`kits.claimRegen`, atomic), so a section can't be regenerated twice
 * at once; this runner clears the slot on success or records a failed state the UI can show.
 */
export class RegenRunner {
  constructor({ kits, llm, concurrency = 2, timeoutMs = 3 * 60_000, retrievalCtx = () => createRetrievalContext(), research, log = () => {} }) {
    Object.assign(this, { kits, llm, concurrency, timeoutMs, retrievalCtx, research, log });
    this.queue = [];
    this.active = new Set();
  }

  enqueue(job) {
    this.queue.push(job);
    this.#pump();
  }

  async drain() {
    while (this.queue.length || this.active.size) await new Promise((r) => setTimeout(r, 5));
  }

  #pump() {
    while (this.active.size < this.concurrency && this.queue.length) {
      const job = this.queue.shift();
      const p = this.#run(job).catch((e) => this.log(`[regen] crashed: ${e.stack || e}`)).finally(() => { this.active.delete(p); this.#pump(); });
      this.active.add(p);
    }
  }

  async #run({ kitId, userId, section, category, force }) {
    let timer;
    const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(Object.assign(new Error('Regeneration took too long.'), { code: 'REGEN_TIMEOUT' })), this.timeoutMs); });
    try {
      const work = section === 'brief'
        ? regenerateBrief({ kits: this.kits, id: kitId, userId, llm: this.llm, retrievalCtx: this.retrievalCtx(), force, ...(this.research ? { research: this.research } : {}) })
        : regenerateQuestions({ kits: this.kits, id: kitId, userId, category, llm: this.llm });
      await Promise.race([work, timeout]);
      await this.kits.setRegen(kitId, null);
    } catch (err) {
      await this.kits.setRegen(kitId, { section, category, status: 'failed', error: { code: err.code || 'UNEXPECTED', message: String(err.message || err).slice(0, 300) } });
    } finally {
      clearTimeout(timer);
    }
  }
}
