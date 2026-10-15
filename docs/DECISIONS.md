# Decisions log

Short ADR-style notes. These feed the README sections the brief requires.

| # | Decision | Why | Status |
|---|----------|-----|--------|
| 1 | JavaScript (ESM) + Zod, no TS build step | `npm run evaluate` must run from a clean clone with zero setup; Zod gives runtime validation of untrusted model output, which TS types cannot | decided |
| 2 | npm workspaces monorepo (`server`, `web`) | One install step, one repo, shared root `.env` | decided |
| 3 | Single `runPipeline()` shared by web + CLI | Brief forbids a parallel implementation | decided |
| 4 | Node built-in test runner | No test deps; fast | decided |
| 5 | Deterministic: `allocateSchedule`, `checkCoverage` | Brief: must not be handed to the model | decided |
| 6 | Edit-state: `origin` (generated/edited/user) + `pinned` on questions/flashcards | Regeneration replaces only `generated && !pinned` items in the target section | proposed (Phase 6) |
| 7 | LLM: one OpenAI-compatible client, presets for Gemini (default, `gemini-2.5-flash`) and Groq (`openai/gpt-oss-120b`) | Groq free tier is ~8k tokens/min per model, which makes "5 cases in 15 min" tight; Gemini's free token budget is far larger but ~10 requests/min. Both supported so a reviewer can use whichever key they have | decided |
| 8 | Practice ordering: confidence-weighted sort vs SM-2 | TBD in Phase 7 | open |
| 9 | Coverage loop: max passes + stop rule | TBD in Phase 4 | open |
| 10 | Public discussion source | TBD in Phase 2 (must respect ToS/robots) | open |
| 11 | Auth = bcrypt + stateless signed JWT in an httpOnly cookie (7d expiry) | Minimal per brief; no session store to run. Trade-off: no server-side revocation (logout just clears the cookie) | decided |
| 12 | Cookie `SameSite=None; Secure` in prod + Origin check on non-GET | Web and API deploy to different origins; Origin check stands in for SameSite as CSRF defence | decided |
| 13 | Repo interface (`repos/mongo.js` / `repos/memory.js`) injected into `createApp` | Route tests run without Mongo; persistence stays a separate concern | decided |
| 14 | Ownership enforced in the query (`{_id, userId}`); other users' kits return 404 not 403 | No existence leak; impossible to forget a check after the fetch | decided |
| 15 | Duplicate posting = unique index on (userId, sha256(normalised jd + company url)); POST returns the existing kit with `duplicate: true` | Idempotent even under double-click races; `days` isn't part of the hash (re-scheduling is a regenerate, not a new kit) | decided |
| 16 | Single `httpClient.httpGet` is the only network path: guard on every redirect hop, per-host throttle, timeout, content-type allow-list, streaming size cap | Section 11 controls live in one auditable place; fetchPage/crawler/robots/discussion all reuse it | decided |
| 17 | SSRF guard resolves DNS and rejects if ANY record is non-public; blocks IPv4-mapped IPv6 and decimal-IP forms | Covers the common bypasses. Known gap: resolve-then-fetch is not pinned, so DNS rebinding is not fully closed | decided |
| 18 | Private-address blocking defaults to ON only when NODE_ENV=production | Brief requires rejection in production but `evaluate` must crawl localhost fixtures from a clean clone | decided |
| 19 | Crawl = best-first by link score (URL words + anchor text), pages that look like hiring pages boost their own links, sitemaps seed extra candidates | "Fixed list of paths is not sufficient"; finds `/careers -> /handbook/.../interviewing` and sitemap-only pages | decided |
| 20 | Hiring page chosen by page-TEXT evidence (`hiringSignals` >= 6), not by URL | A page named /careers that is only job listings must not count as "how they hire" | decided |
| 21 | robots.txt: 4xx = allow, 5xx = disallow, network error = surface as unreachable; cache lives for one run | RFC 9309; avoids stale rules across kits | decided |
| 22 | Crawl scope: same registrable domain (subdomains ok); localhost/IP hosts are confined to the start path prefix | Handbooks live on subdomains; local fixtures serve several companies from one host | decided |
| 23 | Public discussion = Hacker News Algolia API only (no Reddit/Glassdoor) | Official public API, no scraping; those sites restrict automated access. Precision filter: must name the company AND mention interviewing | decided |
| 24 | Unreachable company site is NOT a failed case; `researchCompany` returns `gaps[]` and the kit says so | Brief: "unreachable sites are recorded rather than fatal"; failed is reserved for no kit at all | decided (confirm in Phase 5) |
| 25 | LLM client owns: sliding-window token + request budget, retry/backoff honouring provider hints, quota-exhausted fast-fail, JSON extraction, schema validation, ONE repair call, truncation retry with more `max_tokens`, drop-unsupported-param fallback | Section 10 "invalid JSON", "rate-limits or briefly fails"; every step goes through one entry point (`completeJson`) | decided |
| 26 | The model proposes, code decides: ids assigned by code; a requirement is kept only if its quoted evidence is found in the posting; explicit wording ("Bonus:", "Nice to have" heading, "required") overrides the model's priority | Extraction is 20 of 55 automated points and "nothing invented" is part of it | decided |
| 27 | Category plan is deterministic (`planCategories`); each category has its OWN system prompt; hiring-process signals (regex over fetched text) and seniority change which categories exist | Brief: technical vs behavioural must not share a call; a published take-home + system design round must produce a different kit | decided |
| 28 | Model may only cite requirement ids it was given; unknown ids removed, a question left with none is dropped (never re-attached) | Keeps coverage checkable rather than a matter of opinion | decided |
| 29 | Untrusted text (JD, pages, forum snippets, even requirement text) is only ever sent inside `<<<UNTRUSTED label id>>>` blocks with a random id; lookalike delimiters defused; system prompt says never to follow instructions inside | Section 11 | decided |
| 30 | Company brief makes NO model call when there are no usable pages; cited sources must be a subset of pages supplied | "Honest brief rather than a fabricated one" | decided |
| 31 | Only requirement extraction is fatal in the draft; brief/category/flashcard failures are recorded in `failures` and the draft continues | Lets Phase 4's coverage loop retry gaps; `failed` is reserved for no kit at all | decided |
| 32 | Kit extension: optional `research` block (gaps, hiring page, discussion sources, skipped sources, thin_description) | Lets a thin or poorly-researched kit say so inside the kit itself | decided |

