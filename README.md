# AI Interview Prep Kit

Paste a job description + company URL + days until interview. The app researches the company,
then generates a company brief, role breakdown, question bank, flashcards, and a day-by-day schedule
you can edit and practise against.

> Status: **Phase 3 done** (LLM client, extraction, brief, questions, flashcards). Phases 1-2: auth, CRUD, retrieval. Contracts (kit schema, batch CLI) are real; pipeline steps are still stubs.

## Quick start

```bash
npm install
cp .env.example .env        # fill in LLM_API_KEY etc.
npm test                    # schema + API tests (no Mongo needed)
npm run evaluate -- --input fixtures/cases.sample.json --output kits.json
npm run research -- https://example.com   # try retrieval on a real site
npm run draft -- jd.txt https://example.com  # extraction -> research -> brief -> questions -> flashcards (needs LLM_API_KEY)
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
| 2 ✅ | Retrieval: safe fetch, robots.txt, rate limit/backoff, link ranking crawler, public discussion | 2, 11 |
| 3 ✅ | LLM client (TPM budget, retries, JSON repair), requirement extraction, brief, per-category question generation | 3, 10 |
| 4 | Deterministic scheduler + coverage check + second-pass loop, real tests | 4, 8 |
| 5 | Async generation jobs: progress events, idempotency/dedupe, partial failure; harden evaluate (5 cases < 15 min) | 9, 13 |
| 6 | Builder UI: edit/reorder/move/add/delete, regenerate-without-clobber (origin/pinned) | 6, 12 |
| 7 | Practice mode: flashcard stepper, confidence, coverage, next-session ordering | 7 |
| 8 | Creative feature, deploy, README, walkthrough video | rest |

## Remaining README sections (fill as we build)
Provider/model · architecture · retrieval sources · step sequencing · state model · scheduling · edge cases · limitations.

## Retrieval (Phase 2)

**Sources used:** (1) the company's own website, crawled within its domain and obeying robots.txt (incl. Crawl-delay
and `Sitemap:`); (2) Hacker News via the official Algolia search API for public interview discussion. Not used:
Reddit, Glassdoor, LinkedIn (their terms restrict automated access). Job boards are never fetched; the JD is pasted.

**Flow:** `researchCompany` -> `crawlSite` (-> `fetchPage` -> `httpGet`) then `findPublicDiscussion`.
The crawler fetches the homepage, ranks every in-scope link by URL words + anchor text, fetches the best candidate,
and repeats up to `CRAWL_MAX_PAGES`. A fetched page that reads like a hiring process boosts its own links.
Sitemaps add candidates that nothing links to.

**Failure handling:** every external failure becomes `{ code, reason, attempts }` in `skipped[]`
(`HTTP_404`, `TIMEOUT`, `NETWORK`, `ROBOTS_DISALLOWED`, `BLOCKED_ADDRESS`, `TOO_LARGE`, `UNSUPPORTED_CONTENT_TYPE`, ...).
Timeouts/5xx/429 are retried with exponential backoff + jitter (honouring Retry-After). `gaps[]` states in plain
language what could not be found, so the brief can say so instead of inventing.

**Security (Section 11):** scheme/credential checks; DNS resolution with rejection of any private, loopback,
link-local or metadata address (production); re-validation on every redirect; content-type allow-list; 1.5 MB cap;
scripts, styles, nav and hidden elements stripped from fetched text. Fetched text is data only: Phase 3 passes it to
the model in delimited, untrusted blocks.

## LLM and generation (Phase 3)

**Provider:** any OpenAI-compatible chat endpoint. Presets: Gemini (`gemini-2.5-flash`, default) and Groq
(`openai/gpt-oss-120b`); set `LLM_PROVIDER` and `LLM_API_KEY`. Free-tier limits are per model and change, so the
request/token limits are configurable. Groq's free tier is tight on tokens per minute (~8k), so prompts are compact,
requirements are chunked (5 per call) and the client budgets tokens over a sliding minute instead of reacting to 429s.

**Draft sequence** (`pipeline/draft.js`; each step reacts to the one before):
1. `extractRequirements` (model proposes, code verifies: ids, evidence-in-posting, explicit priority wording)
2. `researchCompany` (crawl + discussion, Phase 2)
3. `analyzeHiringProcess` (deterministic signals: take-home, system design, ... "published" vs "reported")
4. `buildCompanyBrief` (grounded in crawled pages only; no model call when there are none)
5. `planCategories` (deterministic) then `generateQuestions` once per category, each with its own instructions
6. `generateFlashcards`

Phase 4 adds the coverage loop and the schedule (both deterministic) and assembles the final kit.

**Honesty rules:** a stub posting yields few or no requirements and `thin: true`, never padding; an unreachable site
yields an explicit "nothing retrieved" brief; "no published process" is stated in the prompt so the model does not assume one.

