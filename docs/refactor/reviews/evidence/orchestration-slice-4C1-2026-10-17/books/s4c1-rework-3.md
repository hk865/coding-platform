# Task: 4C-1 rework, part 3 — the quick check's findings; coordinator mode; test-driven

You are working in a copy of a TypeScript repository (the current directory). This is a NEW session. The spec, the
books and the lead's rulings are binding; do not make design decisions. Where they do not determine something, choose
nothing: report it under UNSPECIFIED with the smallest options.

**This run is headless. When your turn ends, the whole run ends.** Work in coordinator mode
(`./.dsh-ref/coordinator-mode.md`), **at most 3 subagents at once**, every vitest command `--maxWorkers=2`. **Finish
within 70 minutes** (the run stops at 80).

Tag `s4c1-c` (HEAD) = the build plus reworks 1 and 2 (`./.dsh-ref/s4c1-rework.md`, `s4c1-rework-2.md`; replies
`s4c1-rework-final.md`, `s4c1-rework2-final.md`). Codex made one quick read-only check of the reworks; the lead
confirmed the items below in the code. Binding.

## Items (each with a failing test first; literal expectations)

1. **Per-call caches must not outlive the call.** `scribe-scope.ts:257` (`factsByCall`) and `note-service.ts:692`
   (`planStagesCache`) are `WeakMap`s keyed by the caller's `ctx`; a Run's tool context (and a test's) is reused across
   calls, so a later call can use facts from an earlier one. **Fix:** each public operation (`writeNote`, `reviewNote`,
   `withdrawNote`, and any read that uses them) creates its own cache object at entry and passes it down; no
   module-level or `ctx`-keyed cache. Within one call, a goal's plan window is read once (also for several stage
   targets). Test: the same `ctx` object used for two dispositions, with a plan revision adopted (stage S removed) and
   the scribe's responsibility moved between them → the second call sees both changes.
2. **`resolution_not_applicable` comes first** (rework item 8): check `resolution` against the verdict before
   `managingScopeOf` and any relation or target read (`note-service.ts:1226,1245`; `scribe-scope.ts:304`). Test with
   the store-wrapper making the relation read fail: the answer is still `resolution_not_applicable`.
3. **Coverage on a byte trim, as ruled** (rework item 10): while the project header is kept, every checked norm stays
   counted in coverage, `filesRead` and `observedFiles`, including norms trimmed from the shown list
   (`note-read-model.ts:1667` removes them — undo that); only when the header itself is dropped do its norms leave the
   counts. Test with the injected `resultMaxBytes`: a trim that removes one shown norm keeps `checkedItems` and the
   file observation.
4. **Path search keeps module identity** (`graph-context-reader.ts:205,217,1567`): group the normalised paths by
   module and call `pathOwnershipOf` with module candidates (one candidate per module, all its paths), so `src` and
   `src/` of one module are not a tie; a real tie (two modules both `src`) is reported as a tie, never two hits; the
   "path equals the query" branch obeys the same ownership result. Tests for both cases.
5. **Count tests that match §11.7** (`S4C-find-read-bounds.test.ts`, `S4C-write-read-bounds.test.ts`):
   - the lookup page's 4 goal status-bucket lookups are the existing `overQuota` derivation (4B; §11.7's first bullet:
     unchanged reads keep round-1's numbers) — keep the literal, fix the comment to say so;
   - a segmented find reads each goal's plan window once per call (`note-related-scope.ts:385` and
     `note-views.ts:393` read it twice) — fix, and update the literal;
   - a write's relation targets are read in one batched `readMany` (`note-service.ts:887` reads them one by one) — fix,
     and update RW-12a's literal;
   - add one count test through the real `record_note` tool entry (a scripted Work Run, as RW-15): one write with two
     relations plus its post-write check `C(1)`; the expected numbers derived in a comment from §11.7's write row.
6. **Not changed:** presence validation of `body`/`sections` in the tool (the service's rejection is already a
   correctable tool error since rework 2).

## Checks (close-out subagent)

`--maxWorkers=2`: `tests/work-graph/S4*.test.ts`, `tests/work-graph/SP-*.test.ts`, `tests/runtime/S4C-*.test.ts`,
`tests/runtime/S3-graph-tools.test.ts`, `tests/app/S4C-*.test.ts`, `tests/work-graph/S3-graph-context.test.ts`,
`tests/work-graph/S2C-node-detail-*.test.ts`, `tests/architecture/`, the new tests; then `npm run typecheck`,
`npm run check:architecture`, `npm run build`. No real model calls, no git writes, never ports 3080/3099/44797; probes
under `./.dsh-scratch/`, deleted.

## Reply

Under 500 words: files changed (production net), each item RED → GREEN, the count literals and how each was derived,
checks with numbers, UNSPECIFIED, subagents (most at once).
