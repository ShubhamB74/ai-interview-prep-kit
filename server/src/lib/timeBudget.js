/**
 * A soft wall-clock budget for one pipeline run. Optional steps ask `exceeded(fraction)` and skip themselves when
 * the run is running late, so a slow provider degrades a kit (recorded as gaps) instead of blowing the deadline.
 * Must-have coverage never depends on it: template questions are instant.
 */
export class TimeBudget {
  constructor({ budgetMs, now = Date.now }) {
    this.budgetMs = budgetMs;
    this.now = now;
    this.startedAt = now();
  }

  elapsedFraction() {
    return (this.now() - this.startedAt) / this.budgetMs;
  }

  exceeded(fraction) {
    return this.elapsedFraction() >= fraction;
  }
}

export const NO_BUDGET = { exceeded: () => false, elapsedFraction: () => 0 };

/** Thresholds (fraction of the budget used) after which each optional step is skipped. */
export const SKIP_AT = { flashcards: 0.55, category: 0.8, niceGaps: 0.7, coverageRepair: 0.95 };
