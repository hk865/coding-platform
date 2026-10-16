# Task: 4C-1 rework, part 2 — two small fixes; coordinator mode; test-driven

You are working in a copy of a TypeScript repository (the current directory). This is a NEW session. The spec, the
books and the lead's rulings are binding; do not make design decisions. Where they do not determine something, choose
nothing: report it under UNSPECIFIED with the smallest options.

**This run is headless. When your turn ends, the whole run ends.** Work in coordinator mode
(`./.dsh-ref/coordinator-mode.md`), at most 2 subagents at once; every vitest command `--maxWorkers=3`. **Finish within
45 minutes** (the run stops at 55).

Tag `s4c1-b` (HEAD) = the 4C-1 build plus the first rework (`./.dsh-ref/s4c1-rework.md`, your reply
`./.dsh-ref/s4c1-rework-final.md`).

## Items (binding; each with a failing test first)

1. **A model mistake must not fail the Run.** Your reply's UNSPECIFIED (1): a `record_note` `write` without `body`
   for a general kind (e.g. `convention`) reaches the service, which rejects it, and the tool returns an envelope with
   `body: undefined`; the Kernel rejects the envelope and fails the Run. **Fix in `agent-runtime/note-tool.ts`:** every
   rejected write (and review/withdraw) returns a well-formed tool result that the model can correct (the rejection
   status and reason as text, as the tool already does for other `invalid` results), never an envelope with an
   undefined field. Validate `body`/`sections` per kind before calling the service where the schema allows it.
   Test through a scripted-model Work Run (as GTN02): the bodyless write gets a correctable error, the Run goes on, a
   second valid write commits. Keep GTN02 and RW-14's assertions; if one must change, report it and do not edit it.
2. **Node detail keeps the containment aggregation.** The first rework's `underModule`
   (`views/node-detail-reader.ts:743-748`) now counts only files whose owner is the module itself; before, a module's
   files included its declared children's (`childrenOf`, containment). **Fix:** a file is under the module when its single
   owner (`pathOwnershipOf` over all catalog modules) is the module or one of `childrenOf(module, catalog)`; a tie owns
   nothing. Test: parent P (`src`), child C (`src/c`) declared by containment, file `src/c/x.ts` → in P's and C's
   detail; with C not declared as P's child → only in C's.

## Checks (close-out subagent)

`--maxWorkers=3`: `tests/runtime/S4C-*.test.ts`, `tests/runtime/S3-graph-tools.test.ts`, `tests/app/S4C-*.test.ts`,
`tests/work-graph/S2C-node-detail-*.test.ts`, `tests/work-graph/S4C-*.test.ts`, the new tests; then
`npm run typecheck`, `npm run check:architecture`, `npm run build`. No real model calls, no git writes, never ports
3080/3099/44797; probes under `./.dsh-scratch/`, deleted.

## Reply

Under 400 words: files changed (production net), each item RED → GREEN, checks with numbers, UNSPECIFIED.
