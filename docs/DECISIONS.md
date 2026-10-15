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
| 7 | LLM provider + model | TBD, pick in Phase 3 after checking current free-tier TPM limits | open |
| 8 | Practice ordering: confidence-weighted sort vs SM-2 | TBD in Phase 7 | open |
| 9 | Coverage loop: max passes + stop rule | TBD in Phase 4 | open |
| 10 | Public discussion source | TBD in Phase 2 (must respect ToS/robots) | open |
| 11 | Auth = bcrypt + stateless signed JWT in an httpOnly cookie (7d expiry) | Minimal per brief; no session store to run. Trade-off: no server-side revocation (logout just clears the cookie) | decided |
| 12 | Cookie `SameSite=None; Secure` in prod + Origin check on non-GET | Web and API deploy to different origins; Origin check stands in for SameSite as CSRF defence | decided |
| 13 | Repo interface (`repos/mongo.js` / `repos/memory.js`) injected into `createApp` | Route tests run without Mongo; persistence stays a separate concern | decided |
| 14 | Ownership enforced in the query (`{_id, userId}`); other users' kits return 404 not 403 | No existence leak; impossible to forget a check after the fetch | decided |
| 15 | Duplicate posting = unique index on (userId, sha256(normalised jd + company url)); POST returns the existing kit with `duplicate: true` | Idempotent even under double-click races; `days` isn't part of the hash (re-scheduling is a regenerate, not a new kit) | decided |
