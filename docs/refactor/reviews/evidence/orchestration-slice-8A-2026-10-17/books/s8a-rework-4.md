# Task: slice 8A rework 4 — one regression found by the full suite; test-driven

You are working in a copy of a TypeScript repository (the current directory). This is a NEW session. Do not make design
decisions; report anything undetermined under UNSPECIFIED. Work alone (no subagents needed), every vitest command
`--maxWorkers=2`. **This run is headless; finish within 30 minutes** (the run stops at 40).

## 1. What this copy is

Tag `s8a-d` (HEAD) = 8A after rework 3. The lead ran the full suite on the merged tree (with bubblewrap): 510 files,
one failure, an existing test that 8A broke:

`tests/composition/A1-graph-session-platform.test.ts` ~289, "revises the adopted catalog with explicit containment,
links the new module, and replays across reopen": the current catalog read after a revision must equal the revision's
write result, but the write result has `catalog.since: null` while the read has the bound cursor (`"c0000000004"`).

## 2. The item (binding)

`src/core/work-graph/architecture/catalog-service.ts` ~756: a fresh (not replayed) catalog revision returns the
pre-bind record (`since: null`, built at ~708) although the commit binds `since` through `commitCursorBindings` (~742).
Return the committed record with `since` set to the value the store bound (the commit's cursor — confirm it equals what
the read returns). The replay path already restores from the store. Do not edit the A1 test: it must go green as it is.
Add one test in `tests/work-graph/S8A-catalog-version-time.test.ts`: a revision's write result `catalog.since` equals the
current read's `catalog.since` and is not null, on memory and SQLite.

## 3. Checks

`tests/composition/A1-graph-session-platform.test.ts`, every `S8A-*` test, `tests/architecture/`, the catalog tests, with
`--maxWorkers=2`; `npm run typecheck`. No real model calls, no git writes, never ports 3080/3099/44797.

## 4. Reply

Under 150 words: files changed, RED → GREEN, checks with numbers.
