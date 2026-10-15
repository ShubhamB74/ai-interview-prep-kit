# AI Interview Prep Kit

Paste a job description + company URL + days until interview. The app researches the company,
then generates a company brief, role breakdown, question bank, flashcards, and a day-by-day schedule
you can edit and practise against.

> Status: **Phase 1 done** (auth + kit CRUD). Contracts (kit schema, batch CLI) are real; pipeline steps are still stubs.

## Quick start

```bash
npm install
cp .env.example .env        # fill in LLM_API_KEY etc.
npm test                    # schema + API tests (no Mongo needed)
npm run evaluate -- --input fixtures/cases.sample.json --output kits.json
npm run dev:server          # API on :4000 (needs MongoDB running at MONGODB_URI)
npm run dev:web             # UI on :3000
```

## Layout

```
server/src
  config/     env parsing
  schema/     Appendix A kit schema + validateKit()   <- exact contract
  pipeline/   one file per step; index.js orchestrates (used by web AND CLI)
  lib/        errors, LLM client
  routes/     HTTP (auth/kits come in Phase 1)
  models/     Mongo
  cli/        evaluate.js  <- exact contract (Appendix B)
web/          Next.js + Tailwind
fixtures/     sample batch cases
docs/         DECISIONS.md
```

## Build phases

| Phase | Scope | Brief sections |
|-------|-------|----------------|
| 0 ✅ | Scaffold, schema, evaluate CLI shell, tests harness | 5, 9 |
| 1 ✅ | Auth, sessions, Kit model, CRUD with ownership checks | 1, 13 |
| 2 | Retrieval: safe fetch, robots.txt, rate limit/backoff, link ranking crawler, public discussion | 2, 11 |
| 3 | LLM client (TPM budget, retries, JSON repair), requirement extraction, brief, per-category question generation | 3, 10 |
| 4 | Deterministic scheduler + coverage check + second-pass loop, real tests | 4, 8 |
| 5 | Async generation jobs: progress events, idempotency/dedupe, partial failure; harden evaluate (5 cases < 15 min) | 9, 13 |
| 6 | Builder UI: edit/reorder/move/add/delete, regenerate-without-clobber (origin/pinned) | 6, 12 |
| 7 | Practice mode: flashcard stepper, confidence, coverage, next-session ordering | 7 |
| 8 | Creative feature, deploy, README, walkthrough video | rest |

## Remaining README sections (fill as we build)
Provider/model · architecture · retrieval sources · step sequencing · state model · scheduling · edge cases · limitations.
