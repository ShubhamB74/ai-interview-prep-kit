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
