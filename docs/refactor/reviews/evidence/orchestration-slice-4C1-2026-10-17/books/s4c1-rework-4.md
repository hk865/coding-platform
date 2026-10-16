# Task: 4C-1 rework, part 4 — the check of part 3; coordinator mode; test-driven

You are working in a copy of a TypeScript repository (the current directory). This is a NEW session. The spec, the
books and the lead's rulings are binding; do not make design decisions. Where they do not determine something, choose
nothing: report it under UNSPECIFIED with the smallest options.

**This run is headless. When your turn ends, the whole run ends.** Work in coordinator mode
(`./.dsh-ref/coordinator-mode.md`), **at most 3 subagents at once**, every vitest command `--maxWorkers=2`. **Finish
within 50 minutes** (the run stops at 60).

Tag `s4c1-d` (HEAD) = the build plus reworks 1–3 (`./.dsh-ref/s4c1-rework.md`, `s4c1-rework-2.md`, `s4c1-rework-3.md`;
your reply to part 3 is `./.dsh-ref/s4c1-rework3-final.md`). Codex checked part 3 read-only
(`./.dsh-ref/s4c1-r3.out.md`); the lead verified each finding in the code. The items below are binding; where they
differ from Codex's text, the items win.

## Items (each with a failing test first; literal expectations; memory and SQLite)

1. **One plan window per goal per call** (part 3 item 1 is only half done). `note-service.ts`
   `primaryAnchorRetiredNonFile` calls `readGoalPlanWindow(deps.records, goalRef)` once per stage target (about line
   740); only the stage sets are cached in `NoteCall.planStages`. **Fix:** cache the window outcome in `NoteCall` by
   `(projectId, goalId)` (a `Promise` like `planStages`) and use it for every stage target of that goal in the call.
   Test: one scribe disposition whose targets include two stage-anchored notes of the same goal → a count literal
   with the window read once (derive it in a comment; the counting wrapper of `S4C-write-read-bounds.test.ts`), and
   the continuity result unchanged for both.
2. **Path search in `views/graph-context-reader.ts` (`longestPathOwner`, `pathMatches`):**
   - (a) The owner's path is taken from the module's **raw** paths (`ownership.owner.paths`), while ownership was
     decided on normalised paths. A module path `Src` and the query `src/a.ts` lose the owner. **Fix:** build each
     candidate's value from the normalised, trailing-`/`-stripped paths, and take the owner path from them.
   - (b) The "directory under the query" check uses the unstripped path, so two modules that both declare `src/` match
     the query `src` through that branch. **Fix:** use the stripped path for that check too (`src/` is the query's own
     directory, not one under it).
   - (c) **Ruling change for a tie** (replaces part 3 item 4's "never two hits"): two modules both owning the query at
     the longest prefix are both returned as hits, so the reader sees that two modules claim the path; no module that
     owns it at a shorter prefix is returned. To get the tied modules, `pathOwnershipOf`'s tie variant becomes
     `{ status: 'tie'; owners: T[] }` (`notes/note-path-ownership.ts`); every other caller keeps "a tie owns
     nothing" and ignores `owners`. Update the file's header comment.
   - Tests: `Src` + `src/a.ts` → that module; two modules `src/` + query `src` → exactly those two; two modules `src`,
     a third `lib`, query `src/a.ts` → the two, not `lib`; a module `src/sub` and the query `src` → still found (a
     directory under the query). Your part-3 tie test (two modules both `src` → neither) changes to the new
     expectation; that is the only existing assertion (c) changes. Other S3 graph-context tests stay green; if one
     relied on the old tie behaviour, report it (test id, assertion) and do not edit it.
3. **Derivation comments that say what each read is** (readability):
   - `S4C-find-read-bounds.test.ts` (around lines 127 and 149): Codex's breakdown is 25 = three related anchor groups
     15 + Run index 1 + project anchor 5 + quota buckets 4; 37 = 25 + goal index 1 + two slots × three states 6 +
     module anchor 5. **Check it against the code**; write the comment from what the code does (if it differs from
     Codex's, write yours and say so in the reply).
   - `S4C-write-read-bounds.test.ts` RW-12b: replace "the catalog and plan/definition reads make up the remaining
     readMany batch" with the named reads (Codex: head 1 + catalog 2 + author Run 1 + bound plan 1; check it).
   - No literal changes in this item.
4. **Not changed:** RW-12b stays at the tool-factory level. The tool's reads all happen inside its handler, and
   RW-15 already proves the production wiring through the real Host; a scripted Run would add preparation reads that
   would have to be windowed out.

## Checks (close-out subagent)

`--maxWorkers=2`: `tests/work-graph/S4*.test.ts`, `tests/work-graph/SP-*.test.ts`, `tests/runtime/S4C-*.test.ts`,
`tests/runtime/S3-graph-tools.test.ts`, `tests/app/S4C-*.test.ts`, `tests/work-graph/S3-graph-context.test.ts`,
`tests/work-graph/S2C-node-detail-*.test.ts`, the goal-conflict tests, `tests/architecture/`, the new tests; then
`npm run typecheck`, `npm run check:architecture`, `npm run build`. No real model calls, no git writes, never ports
3080/3099/44797; probes under `./.dsh-scratch/`, deleted.

## Reply

Under 400 words: files changed (production net), each item RED → GREEN, the count literal and its derivation, checks
with numbers, UNSPECIFIED, subagents (most at once).
