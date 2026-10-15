const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Minimum gap between requests to the same host. Slots are reserved synchronously, so callers queue fairly. */
export class HostThrottle {
  constructor({ minDelayMs = 1000, now = Date.now, sleep = defaultSleep } = {}) {
    this.minDelayMs = minDelayMs;
    this.now = now;
    this.sleep = sleep;
    this.nextSlot = new Map();
    this.delays = new Map();
  }

  /** Honour a site's Crawl-delay (never below our own minimum). */
  setDelay(host, ms) {
    this.delays.set(host, Math.max(ms, this.minDelayMs));
  }

  async wait(host) {
    const t = this.now();
    const gap = this.delays.get(host) ?? this.minDelayMs;
    const slot = Math.max(t, this.nextSlot.get(host) ?? 0);
    this.nextSlot.set(host, slot + gap);
    if (slot > t) await this.sleep(slot - t);
  }
}
