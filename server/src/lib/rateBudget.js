const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const estimateTokens = (text) => Math.ceil(String(text).length / 3.5);

/**
 * Sliding 60s window over BOTH requests and tokens (free tiers limit tokens per minute, not just requests).
 * acquire(estimate) waits until the call fits, then reserves it; settle() replaces the estimate with the
 * provider-reported usage so the window stays honest. Callers are served in order.
 */
export class RateBudget {
  constructor({ tokensPerMinute, requestsPerMinute, now = Date.now, sleep = defaultSleep }) {
    this.tpm = tokensPerMinute;
    this.rpm = requestsPerMinute;
    this.now = now;
    this.sleep = sleep;
    this.events = [];
    this.tail = Promise.resolve();
    this.waitedMs = 0;
  }

  acquire(estimate) {
    const run = () => this.#reserve(Math.min(estimate, this.tpm)); // an oversized call may use an empty window
    const p = this.tail.then(run, run);
    this.tail = p.catch(() => {});
    return p;
  }

  settle(event, actualTokens) {
    if (Number.isFinite(actualTokens) && actualTokens > 0) event.tokens = actualTokens;
  }

  async #reserve(est) {
    for (;;) {
      const t = this.now();
      this.events = this.events.filter((e) => t - e.t < 60_000);
      const tokens = this.events.reduce((n, e) => n + e.tokens, 0);
      if (tokens + est <= this.tpm && this.events.length < this.rpm) {
        const ev = { t, tokens: est };
        this.events.push(ev);
        return ev;
      }
      let freeAt = t + 1000;
      let tok = tokens;
      let req = this.events.length;
      for (const e of this.events) {
        tok -= e.tokens;
        req -= 1;
        if (tok + est <= this.tpm && req < this.rpm) { freeAt = e.t + 60_000; break; }
      }
      const wait = Math.max(1, freeAt - t);
      this.waitedMs += wait;
      await this.sleep(wait);
    }
  }
}
