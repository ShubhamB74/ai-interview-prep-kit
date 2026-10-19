# AI Interview Prep Kit

Paste a job description + company URL + days until interview. The app researches the company,
then generates a company brief, role breakdown, question bank, flashcards, and a day-by-day schedule
you can edit and practise against.

> Status: **Phase 7 done**: practice mode with spaced repetition. Earlier: builder, background jobs, coverage + schedule, LLM steps, retrieval, auth. Contracts (kit schema, batch CLI) are real; pipeline steps are still stubs.

## Quick start

```bash
npm install
cp .env.example .env        # fill in LLM_API_KEY etc.
npm test                    # server tests (no Mongo needed); `npm run test:web` for the UI tests (builder + practice); `npm run test:all` for both
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
| 4 ✅ | Deterministic scheduler + coverage check + second-pass loop, real tests | 4, 8 |
| 5 ✅ | Async generation jobs: progress events, idempotency/dedupe, partial failure; harden evaluate (5 cases < 15 min) | 9, 13 |
| 6 ✅ | Builder UI: edit/reorder/move/add/delete, regenerate-without-clobber (origin/pinned) | 6, 12 |
| 7 ✅ | Practice mode: flashcard stepper, confidence, coverage, next-session ordering | 7 |
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

Phase 4 adds the coverage loop and the schedule (both deterministic code) and assembles the final kit.

**Honesty rules:** a stub posting yields few or no requirements and `thin: true`, never padding; an unreachable site
yields an explicit "nothing retrieved" brief; "no published process" is stated in the prompt so the model does not assume one.

## Coverage, schedule and the batch command (Phase 4)

**Second pass** (`coverageLoop.js`). After the first draft, code (`checkCoverage`) lists every requirement that no
question references. The loop then asks for questions for those gaps and checks again. Round 1 fills all gaps in
batches; rounds 2-3 go one must-have requirement per call. It stops when nothing is uncovered, after 3 repair rounds, or
on a fatal provider error (quota, auth). Nice-to-have gaps get one attempt and are then *reported*, not forced. A
must-have that is still uncovered gets a flagged template question, so a kit never ships with an uncovered must-have;
the kit's `research.gaps` says when that happened. `coverage.passes` counts coverage checks.

**Schedule** (`allocateSchedule.js`, no model). Questions are ordered by priority (covers a must-have first, then harder
first). With at least as many questions as days, that order is cut into consecutive blocks of roughly equal study time,
so the hardest must-have material is on day 1 and the lightest on the last day. With fewer questions than days, each
question gets a study day and the remaining days are review days that cycle through the same order (`type: "review"`).
Always exactly the requested number of days (1 and 60 both work); minutes are integers (10/15/25 per question by
difficulty; review days half).

**Batch** (`npm run evaluate -- --input cases.json --output kits.json`). One shared LLM client (shared rate budget),
cases run sequentially, a failing case is recorded and the run continues. `failed` means no kit at all; a kit with
research gaps (unreachable site, no hiring page, thin posting) is `ok` with the gaps written into the kit.

## Generation as a background job (Phase 5)

**Flow.** `POST /api/kits` validates, de-duplicates and creates a `pending` record, queues it, and returns at once.
`JobRunner` claims it (`pending -> running`, atomically), runs the pipeline, writes per-step progress, and finally stores
the validated kit (`ready`) or a coded error (`failed`). The UI polls `GET /api/kits/:id` every 1.5 s and renders the
steps; failed kits show the reason and a **Try again** button (`POST /api/kits/:id/retry`).

**When it takes ninety seconds.** Nothing blocks: the request returned long ago, progress is persisted, and a reload or
a second tab shows the same state. A deadline (`JOB_TIMEOUT_MS`) marks a stuck job `failed: JOB_TIMEOUT`; before that, the
pipeline's soft budget makes it skip optional steps (flashcards, late categories, nice-to-have gap rounds) and say so in the kit.

**When it fails halfway.** Only requirement extraction is fatal. Any other step that fails is recorded in the kit's
`research.gaps` and the kit still ships; must-have coverage is guaranteed by the second pass (Phase 4). If the whole run
fails, the record keeps `error: {code, message}` and can be retried.

**When it is triggered twice.** Three layers: a unique index on (user, hash of normalised posting + company URL), an
atomic `claim`, and an in-process enqueue guard. The second submit returns the existing kit with `duplicate: true`. Every
write from a job carries its `attempt` number, so a timed-out run that wakes up later cannot overwrite a retry.

**When the server restarts.** On boot, interrupted `running` jobs go back to `pending` and everything pending is re-queued
(up to `JOB_MAX_ATTEMPTS`, then `failed: JOB_INTERRUPTED`).

**Limits.** At most `JOB_MAX_ACTIVE_PER_USER` kits generating per user (429 otherwise) and 10 postings per upload
(`POST /api/kits/batch`; the client parses the file, each row is validated and reported separately).

**Known limitation.** The queue lives in the API process, so this assumes one instance (fine for a free-tier deploy). Running several instances
would need an external queue; the atomic `claim` already keeps them from double-running a kit.

## The builder and the state model (Phase 6)

**Representing generated, edited and pinned state.** Every question and flashcard carries `origin`
(`generated` | `edited` | `user`) and an optional `pinned`. The company brief and schedule days carry `origin` too.

| Action | Result |
|---|---|
| Pipeline creates an item | `origin: generated` |
| User changes text, difficulty, requirements, or moves it to another category | `generated -> edited` |
| User writes an item | `origin: user` |
| User pins / unpins | `pinned` set / removed (origin unchanged) |
| Pure reordering | no state change |

A regeneration replaces **exactly** the items where `origin` is not `edited`/`user` and `pinned` is not set
(`isReplaceable` in `shared/src/kitOps.js`); everything else is kept, and new questions never repeat a surviving prompt.

**Why a regeneration cannot clobber edits.**
1. *Edits are id-addressed ops*, applied to the latest document, so edits to different items commute.
2. *Every write is compare-and-swap on a `version`* (`applyToKit`): read, copy, mutate, validate against Appendix A,
   write only if the version is unchanged, otherwise re-read and re-apply. Two writers merge; neither overwrites.
3. *A regeneration decides what to delete at commit time*, against the latest document, not the snapshot the model saw.
   An edit, addition or deletion made while the model was thinking is therefore respected.
4. A regeneration that returns nothing, fails, or can no longer reach the company site changes nothing.
5. After a category regeneration, coverage is re-checked for *that category's* requirements only.

**What can be edited.** Brief (summary, what they do), questions (text, answer outline, difficulty, requirements,
category, order, pin), flashcards (front, back, order, pin), schedule days (focus, minutes), plus add/delete of
questions and flashcards. **Regenerate**: the brief (re-researches the site; asks first if you edited it), one question
category, or the schedule (instant; can change the number of days). Requirements are read-only.

**Schedule after edits.** It is derived from the questions, so adding or deleting a question re-flows it
deterministically; days you edited by hand keep their focus and minutes. "Rebuild schedule" starts from scratch.

**Interaction design.** Edits apply instantly in the browser using the *same* rule code as the server
(`@prepkit/shared/kitOps`), are sent in order in the background, and the server's version replaces the local one when the
queue drains. Background polls are ignored while edits are in flight; a rejected edit shows an error and restores the
server's version. The UI is a roving-tabindex tablist; every action is a real button, reordering uses arrow buttons
(keyboard-operable), inline editors save with Enter/Ctrl+Enter and cancel with Esc and return focus to their Edit button,
status changes are announced via live regions, and the layout wraps for phones.

**Uploading several roles.** The Upload tab accepts a `.json` list of `{ jd, company_url }` or a `.csv` with those
columns (max 10); each row is validated and reported separately.

**Known limitations.** Two tabs editing the *same field of the same item* is last-write-wins. Reordering has no
drag-and-drop. Requirements are not editable. Flashcards cannot be regenerated on their own.

## Practice mode (Phase 7)

**What it does.** Step through flashcards one at a time, reveal the answer, say how confident you were (1 didn't know,
2 shaky, 3 knew it), see what you've covered per requirement, and get the next session ordered by what you were least
confident about. Everything is keyboard-operable: Space/Enter reveals, 1/2/3 rate.

**The ordering I chose, and why: Leitner boxes.** Each card sits in a box from 1 to 5. A miss sends it to box 1 (due again
right away, and again later in the same session, at most twice), "shaky" keeps it where it is, "knew it" moves it up one box
(a card seen for the first time goes straight to box 2). Review intervals are 0, 1, 2, 4 and 7 days by box. A session is
ordered *least confident first*: lowest box first (never-seen cards sit between box 2 and box 3), then cards covering
a must-have requirement, then the most overdue, then kit order.

*Why not a plain confidence sort?* It forgets: a card you got right once looks "strong" forever and one you missed once looks
"weak" even after five correct answers. A box number carries the whole history in one value, so weak cards come back sooner and
more often, strong ones fade but still resurface. *Why not SM-2?* Per-card ease factors and fractional day intervals pay off over
months; interview prep is days. Boxes are a sentence to explain and trivial to test.

*One adaptation for a deadline:* Leitner assumes open-ended learning. Here every interval is capped to a third of the time left
before the interview (`schedule.starts_at + days_available`), so with two days left no card waits a week.

**State and trust.** The server stamps the time and applies the transition; the client sends only (card, confidence, review id)
and shows a local guess meanwhile, using the same rule code (`@prepkit/shared/leitner`). Progress is stored per card beside the
kit document, written with compare-and-swap on the card's review count, so rating while editing never conflicts, two parallel
ratings of one card both apply, and a retried request (same review id) counts once. Editing a card keeps its progress;
deleting it removes it from every queue.

**Covered vs not covered.** Per requirement: how many flashcards cover it, how many you've reviewed, how many are confident
(box 4+); requirements with no flashcards are flagged with a shortcut to add one. A weak-spots list shows the cards stuck in the low boxes.

**Known limitations.** Progress is per kit, not per user across kits. There is no daily reminder. A session is a snapshot of the queue
at its start (cards added during a session appear in the next one).

