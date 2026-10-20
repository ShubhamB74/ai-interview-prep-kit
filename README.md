# AI Interview Prep Kit

Paste a job description, the company's website and how many days you have. The app researches the company itself (it crawls the
site, looks for the hiring process, searches public discussion), then builds a structured kit: **company brief, role breakdown, a
categorised question bank, flashcards and a day-by-day schedule**. You can reshape any part of it, practise flashcards with spaced
repetition, and run a mock interview. (Yes, we are aware of the irony.)

Live app, API and walkthrough video links are in the submission. Deployment steps: [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).
Every design decision with its reasoning: [`docs/DECISIONS.md`](docs/DECISIONS.md) (70+ entries).

## Contents
1. [Stack](#stack) · 2. [Setup](#setup) · 3. [Batch entry point](#batch-entry-point) · 4. [LLM provider](#llm-provider-and-model) ·
5. [Architecture](#architecture) · 6. [Retrieval](#retrieval-approach-and-sources) · 7. [Research and generation sequence](#research-and-generation-sequence) ·
8. [The second pass](#the-second-pass-coverage) · 9. [Generated, edited and pinned state](#generated-edited-and-pinned-state) ·
10. [Schedule allocation](#schedule-allocation) · 11. [Practice mode](#practice-mode) · 12. [Creative feature](#creative-feature-mock-interview) ·
13. [Edge cases](#edge-cases-section-10) · 14. [Slow, failing, duplicated generation](#slow-failing-or-duplicated-generation-section-13) ·
15. [Security](#security-section-11) · 16. [Testing](#testing) · 17. [Trade-offs and limitations](#key-trade-offs-and-known-limitations)

## Stack
| Layer | Choice | Why |
|---|---|---|
| Frontend | Next.js 14 (App Router) + Tailwind CSS | As preferred |
| Backend | Node.js + Express | As preferred |
| Database | MongoDB (Mongoose) | As preferred. The kit is one document that matches Appendix A |
| Language | **JavaScript (ESM) + Zod** | The batch command must run from a clean clone with no build step. Zod validates model output and requests at runtime, which TypeScript types cannot |
| Scraping | `fetch` + `cheerio` | Pages are fetched through one guarded client (SSRF, size, type, robots, throttle); cheerio only parses |
| LLM | Gemini (default) or Groq via one OpenAI-compatible client | Genuine free tiers; see below |
| Shared code | npm workspace `shared/` | The edit rules, Leitner scheduling and mock-interview rules run in the browser (instant feedback) and on the server (authoritative) from the *same* code |

## Setup
Requires Node 20+. MongoDB is needed only for the web app, **not** for the batch command.
```bash
npm install                  # installs every workspace
cp .env.example .env         # then set LLM_API_KEY (and MONGODB_URI for the web app)
npm test                     # server tests (no Mongo needed)
npm run test:web             # UI tests
npm run dev:server           # API on :4000   (needs MongoDB at MONGODB_URI)
npm run dev:web              # UI on :3000
npm run research -- https://posthog.com      # try retrieval alone
npm run draft -- jd.txt https://posthog.com  # extraction -> research -> brief -> questions (needs LLM_API_KEY)
```
Optional: `TEST_MONGODB_URI=mongodb://127.0.0.1:27017/prepkit_test npm test` also runs the repository contract against a real MongoDB
(**the database is dropped first**; use a scratch one). **Deployed:** see `docs/DEPLOYMENT.md` (Atlas + Render + Vercel, all free tier).

## Batch entry point
```bash
npm install
cp .env.example .env         # set LLM_API_KEY, nothing else is required
npm run evaluate -- --input cases.json --output kits.json
```
* **Input:** `[{ "id", "jd", "company_url", "days" }]`. **Output:** `{ version: "1.0", generated_at, kits: [{ id, status, kit, error }] }` (Appendix B), one entry per case, in input order.
* It runs **the same `runPipeline`** the web app uses: retrieval, generation, coverage loop, schedule, validation.
* Company sites may be on `localhost` and links are followed relatively: private-address blocking is on only when `NODE_ENV=production`.
* `failed` means *no kit at all* (e.g. the model is unreachable, or the quota is exhausted). A missing hiring page, an unreachable company site or
  a thin posting is still `ok`, with the gaps written into the kit (`research.gaps`).
* **Time:** one LLM client (so one shared token budget) runs the cases sequentially under a total budget (`EVALUATE_BUDGET_MS`, default 13 min).
  The remaining time is shared by the remaining cases; when a case runs late it skips optional steps (flashcards, late categories, nice-to-have gap rounds)
  and says so in the kit, while must-have coverage is still guaranteed.
* CI runs it from a clean checkout on every push (without a key, every case is recorded as failed and the run still completes).

## LLM provider and model
One client (`server/src/lib/llm.js`) for any OpenAI-compatible endpoint. Presets: **Gemini `gemini-2.5-flash`** (default) and **Groq `openai/gpt-oss-120b`**.
Set `LLM_PROVIDER` and `LLM_API_KEY`. Free tiers limit *tokens per minute*, not just requests (Groq's is about 8k), so the client keeps a sliding-window
token and request budget, retries 429/5xx/timeouts with backoff using the provider's own retry hint, fails fast when a *daily* quota is exhausted, and
handles bad output (JSON extraction, schema validation, one repair call, a retry with more room if the reply was truncated). Limits and model names change:
override them with `LLM_*` variables to match your console.

## Architecture
```
                         ┌────────────── web (Next.js + Tailwind) ──────────────┐
 browser ── /api proxy ─►│ builder · practice · mock interview · @prepkit/shared │
                         └──────────────────────┬───────────────────────────────┘
                                                │ REST (cookie session)
 ┌──────────────────────────────────────────────▼─────────────────────────────────────────┐
 │ API (Express)   routes ─ services (edit engine, regenerate, practice, mock) ─ repos ─ Mongo│
 │      │                                                                                    │
 │      └─ JobRunner (queue, atomic claim, progress, timeout, restart recovery)              │
 │             └─ runPipeline  ◄── also called by `npm run evaluate`                         │
 │                  retrieval ─ extraction ─ generation ─ coverage ─ schedule ─ assemble    │
 └────────────────────────────────────────────────────────────────────────────────────────┘
```
`server/src`: `config/` · `schema/` (Appendix A kit, requests, LLM outputs) · `lib/` (LLM client, rate budget, URL guard, HTTP client, robots, throttle, retry)
· `pipeline/` (one file per step) · `services/` · `jobs/` · `repos/` (Mongo and an in-memory twin used by tests) · `routes/` · `cli/`.
Retrieval, extraction, generation, scheduling and persistence are separate concerns; the web app and the batch command share one pipeline.

## Retrieval approach and sources
**Sources used:** (1) the company's own website, crawled within its domain; (2) **Hacker News** through its official Algolia search API for public interview
discussion. Not used: Reddit, Glassdoor, LinkedIn (their terms restrict automated access). Job boards are never fetched (the JD is pasted).
**robots.txt** is obeyed (allow/disallow, `Crawl-delay`, `Sitemap:`); requests are throttled per host, identified with a User-Agent, and limited in count, size
and time. I do not parse a site's terms of service: the crawler only touches public pages, politely.

**Finding the hiring page without a fixed path list:** fetch the homepage, rank every in-scope link by the words in its URL *and* its anchor text
(`/our-process` is found through the anchor "How we hire"), fetch the best candidate, repeat (best-first, depth 3, `CRAWL_MAX_PAGES` pages). A page that reads like a
hiring process boosts the links it contains, so `/careers → /handbook/.../interviewing` is followed. Sitemaps add pages nothing links to. The *hiring page* is chosen by what
its text says (take-home, system design, ...), not by its URL; a `/careers` page that only lists jobs does not count.

Scope: same registrable domain (handbooks live on subdomains); for `localhost` hosts, confined to the start path so one fixture server can host several companies.
Every failure becomes `{code, reason, attempts}` in `skipped[]` (`HTTP_404`, `TIMEOUT`, `ROBOTS_DISALLOWED`, `BLOCKED_ADDRESS`, `TOO_LARGE`, ...); timeouts/5xx/429 are retried with backoff.

## Research and generation sequence
Each step reacts to what the previous one found. **Bold = deterministic code, no model.**

| # | Step | Responsibility |
|---|---|---|
| 1 | `extractRequirements` | Model proposes; **code decides**: ids assigned in code, a requirement is kept only if its quoted evidence is in the posting, explicit wording (`Bonus:`, a "Nice to have" heading, "required") overrides the model's must/nice call, an unknown company name is dropped |
| 2 | `researchCompany` | **Crawl + rank links** (above), then public-discussion search. Failures become `gaps`, never errors |
| 3 | **`analyzeHiringProcess`** | Regex signals over fetched text (take-home, system design, ...), labelled *published* (company site) or *reported* (forum) |
| 4 | `buildCompanyBrief` | Model, grounded only in crawled pages; cited sources must be pages it was given. **No pages ⇒ no model call** and an honest "nothing retrieved" brief |
| 5 | **`planCategories`** → `generateQuestions` | The category plan is code (a published system-design round, or a senior role, adds a system-design category). Then **one model call per category, each with its own instructions**, per chunk of 5 requirements. The model may only cite ids it was given |
| 6 | `generateFlashcards` | Model, must-haves first |
| 7 | **coverage loop** | See next section |
| 8 | **`allocateSchedule`** | Arithmetic (below) |
| 9 | **`validateKit`** | Zod structure + referential integrity (unique ids, every question/flashcard/schedule id exists, schedule length = days, integer minutes) before anything is saved |

Untrusted text (the JD, crawled pages, forum comments, even requirement text) reaches the model only inside random-id `<<<UNTRUSTED ...>>>` blocks, and the system prompt says never to follow instructions inside them.

## The second pass (coverage)
After the first draft, **code** lists every requirement that no question references. The loop then asks the model for questions for those gaps and checks again:
round 1 fills every gap in batches; rounds 2 and 3 go one must-have requirement per call (escalating, because a no-progress round says little about a stochastic model).
**At most 3 repair rounds**, stopping early when nothing is uncovered or on a fatal provider error (quota/auth). `coverage.passes` counts coverage checks. Nice-to-have gaps get one
attempt and are then *reported* (`coverage.uncovered_requirement_ids`, `research.gaps`), never forced. A must-have still uncovered gets a flagged template question
(`template: true`, named in `research.gaps`), so **a kit never ships with an uncovered must-have**.

## Generated, edited and pinned state
Every question and flashcard carries `origin` (`generated` | `edited` | `user`) and an optional `pinned`; the brief and schedule days carry `origin` too.

| Action | Result |
|---|---|
| Pipeline creates an item | `generated` |
| User changes text/difficulty/requirements, or moves it to another category | `generated → edited` |
| User writes an item | `user` |
| User pins / unpins | `pinned` set / removed (origin unchanged) |
| Pure reordering | no change |

A regeneration replaces **exactly** items that are not `edited`/`user` and not `pinned` (`isReplaceable`). Why it cannot clobber edits:
1. **Edits are id-addressed ops** (`update_question`, `move_question`, ...), applied to the latest document, so edits to different items commute.
2. **Every write is compare-and-swap on a document `version`**: read, copy, mutate, validate, write only if unchanged, else re-read and re-apply. Two writers merge.
3. **A regeneration decides what to delete at commit time**, against the latest document, so anything edited, added or deleted *while the model was thinking* is respected.
4. A regeneration that returns nothing, fails, or can no longer reach the company site **changes nothing**. After a category regeneration coverage is re-checked for that category's requirements only.
5. An edited brief asks for confirmation before regeneration, and if you edit it *while* it regenerates, your version wins.

The browser applies edits instantly with the same rule code, sends them in order, ignores background polls while edits are in flight, and rolls back with a visible error if the server rejects one.

## Schedule allocation
`allocateSchedule` is pure code. Questions are ordered by priority (covers a must-have first, then harder first), then cut into exactly *N* consecutive blocks of roughly equal study
time, so the hardest must-have material lands on day 1 and the lightest on the last day. With fewer questions than days (a 60-day plan for 12 questions), every question gets a study day and the
remaining days are **review days** cycling through the same order. Minutes are integers (10/15/25 per question by difficulty; review days half). 1 day and 60 days both work.
After edits the schedule re-flows deterministically; days you edited keep their focus and minutes; "Rebuild schedule" starts from scratch and can change the day count.

## Practice mode
Step through flashcards, reveal, rate 1 (didn't know) / 2 (shaky) / 3 (knew it); Space/Enter reveals and 1/2/3 rate. **Ordering: Leitner boxes.** A miss sends a card to box 1, "shaky" holds it,
"knew it" moves it up one box; intervals are 0/1/2/4/7 days. Sessions are *least confident first* (lowest box; never-seen cards between box 2 and 3; then must-have cards; then most overdue).
*Why not a plain confidence sort?* It forgets: a card you got right once stays "strong" forever. A box number carries the whole history in one value. *Why not SM-2?* Per-card ease factors pay off over months;
interview prep is days. **One adaptation for a deadline:** intervals are capped to a third of the time left before the interview. The server owns the clock and applies the transition (the client sends only card,
confidence and a review id, so retries and double-clicks count once); progress is stored per card beside the kit, so rating never conflicts with editing. A coverage view shows, per requirement, cards / reviewed /
confident, flags requirements with no flashcards, and lists weak spots.

## Creative feature: Mock interview
**The problem it solves:** people read their prep and feel ready, then freeze when they must produce an answer under time, in sequence, in front of someone. A kit you only read is a document; flashcards test recall, not answering.
**What it does:** runs the kit's questions as an interview, **round by round in the order the company's own process suggests** (recruiter screen, technical, system design, behavioural; labelled *published*, *reported* or a standard default
interview). Within it, questions are picked greedily to cover must-have requirements first and ordered easier-to-harder. For each question you answer in writing against a timer; then the model answer is shown as a **checklist** and you tick what you
actually covered. The report ranks your weakest requirements, lists must-haves that were not asked, the questions to redo, time used vs suggested, and the trend across attempts.
**Deliberate choice: no AI grading.** A free-tier model cannot judge free text honestly, and pretending to would burn the token budget on something untrustworthy. Self-scoring against the outline is how good mock-interview feedback works, costs no
tokens and makes the score reproducible. The server recomputes every score from the ticked boxes (a client cannot award itself marks). Audio/video simulation is out of scope per the brief.

## Edge cases (Section 10)
| Case | Behaviour |
|---|---|
| Company URL invalid / 404 / times out | Recorded in `research.skipped_sources` and `gaps`; the brief says nothing was retrieved (no model call); the kit is still `ok` (the discussion search still runs) |
| No discoverable hiring or about page | `hiring_page: null`, `hiring_process.known: false`, a gap note; the prompts state "unknown, do not assume a format" |
| Two-line stub JD | Few or no requirements, `thin_description: true`, reasons in `gaps`; nothing is invented; no questions are padded in |
| No public discussion found | `discussion_found: false` and a gap note; nothing fabricated |
| Model returns invalid JSON or an incomplete kit | Extraction + Zod validation, one repair call, truncation retry; per-item drops are counted; the final kit is validated against Appendix A before saving |
| Provider rate-limits or briefly fails | Token/request budgeting, backoff honouring the retry hint, fast-fail on exhausted quota; a failing step is recorded and the kit still ships (only requirement extraction is fatal) |
| Same description + company twice | Unique index on (user, hash of normalised JD + URL) + atomic claim + enqueue guard: the existing kit is returned |
| 1-day and 60-day schedules | Exactly the requested days; 60 days uses review days |

## Slow, failing or duplicated generation (Section 13)
Generation is a background job: the request creates a `pending` record and returns; progress is persisted per step and the UI polls it. **Ninety seconds:** nothing blocks, a reload shows the same state, a deadline marks a stuck
job `JOB_TIMEOUT`, and a soft time budget makes it skip optional steps first. **Fails halfway:** only requirement extraction is fatal; any other failing step is recorded in the kit and the coverage loop still guarantees must-haves. A
failed kit keeps a coded error and can be retried. **Triggered twice:** see above. Every write carries the job's attempt number, so a timed-out run that wakes up later cannot overwrite a retry. **Restart:** interrupted jobs resume (up to 3 attempts).
At most 5 kits generate per user at once (429 otherwise).

## Security (Section 11)
Only `http(s)` URLs, no embedded credentials; DNS is resolved and **any private, loopback, link-local or cloud-metadata address is rejected** (IPv4-mapped IPv6 and decimal-IP forms included) and re-checked on **every redirect hop** (production: `NODE_ENV=production`);
content-type allow-list; 1.5 MB cap with streaming enforcement; scripts, styles, nav and hidden elements are stripped from fetched text; untrusted text is delimited and never treated as instructions. Auth: bcrypt, httpOnly signed-cookie sessions with
distinct expired/invalid handling, an `Origin` check on state-changing requests, ownership enforced inside every query (another user's kit is a 404). **Known gap:** DNS is resolved by the guard and again by `fetch`, so a DNS-rebinding race is not fully closed.

## Testing
* **Server: 257 tests** (`npm test`), incl. schedule allocation (property tests over many shapes), coverage checking and its loop, structure validation, the LLM client against a fake provider, retrieval against a local fixture site, job lifecycle, the edit engine, regeneration, practice and mock interview.
* **UI: 42 tests** (`npm run test:web`; jsdom): every builder section renders in normal/empty/error states; the client state hook (optimistic apply, ordered sends, polls ignored mid-edit, rollback); practice and mock-interview flows with keyboard.
* A repository contract suite runs against the in-memory repo and, with `TEST_MONGODB_URI`, a real MongoDB.
* I checked that tests can fail: for each area I deliberately broke the code (wrong ordering, lost updates, missing validation, regeneration replacing edited items, ...) and confirmed a test caught it.

**What has *not* been verified here:** nothing has run against a real LLM, a real MongoDB, a real browser, or a deployment (the build environment had no keys, database or internet). The LLM client, crawler and UI are tested against fakes; the Mongo repository
is covered by a contract test you can run. Please run `npm run evaluate`, the Mongo contract test and the deployed smoke test (`docs/DEPLOYMENT.md`) once.

## Key trade-offs and known limitations
* **The model proposes, code decides.** Ids, priorities, coverage, the schedule, regeneration scope and scoring are deterministic; the cost is some rigidity (e.g. category plans are rules, not model judgement).
* **Polling, not streaming** for progress: works through any free proxy and survives reloads; costs up to 1.5 s latency.
* **In-process job queue:** assumes one API instance (fine on a free tier); several instances would need an external queue (the atomic `claim` already prevents double runs).
* **Self-scored mock interviews** are only as honest as the user; no AI grading by design.
* Two tabs editing the *same field of the same item* is last-write-wins. Reordering uses arrow buttons, not drag and drop. Requirements are read-only in the builder. Flashcards cannot be regenerated on their own.
* Practice progress is per kit; no reminders. The interview date is estimated as plan start + the number of days given.
* Only the hiring process of the company *site* and Hacker News are searched; companies that discuss interviews elsewhere will look "unknown".
* The crawler does not execute JavaScript, so client-rendered sites yield thin pages (reported as such).
* Free-tier LLM limits dominate latency: expect 1 to 3 minutes per kit, and a batch of five within the time budget by skipping optional steps if needed.

*Built with AI assistance (permitted by the brief); every design above is mine to explain, and the tests were written to check behaviour rather than to mirror the code.*
