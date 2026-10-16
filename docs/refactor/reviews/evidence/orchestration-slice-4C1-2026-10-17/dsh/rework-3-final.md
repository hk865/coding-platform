# 4C-1 rework part 3 — complete

**FILES (production net +94: 182 added / 88 deleted).** `notes/scribe-scope.ts` (+14), `notes/note-service.ts` (+29), `notes/note-read-model.ts` (+13), `notes/note-related-scope.ts` (+6), `views/note-views.ts` (+6), `views/graph-context-reader.ts` (+18), `model/note-contracts.ts` (+8). Tests: new `S4C-per-call-cache.test.ts` (191) and `S4C-resolution-order.test.ts` (99); edits to 4 files (+131/−14). No git writes.

**Items (RED → GREEN).**
1. Per-call caches: RED the second disposition reused stale facts/plan stages — `{status:'done'}` vs `forbidden/outside_managed_scope`, and `{status:'done'}` vs `invalid/resolution_not_applicable`; GREEN after `ScribeScopeCall`/`NoteCall` created at each public entry, WeakMaps and `ctx` keys deleted.
2. `resolution_not_applicable` first: RED `{code:'unavailable', reason:'relation read blocked by the test'}`; GREEN `{code:'invalid', reason:'resolution_not_applicable'}` for `review` and `reject` — check moved above `managingScopeOf` and the version check.
3. Trim coverage: RED `expected +0 to be 2` at `coverage.checkedItems`; GREEN `checkedItems 2`, `filesRead 2`, both `observedFiles`, shown `norms 0` / `omitted 2` — the norm-loop coverage filter is gone.
4. Path search module identity: RED (a) one module `['src','src/']` → `expected [] to deeply equal [M1]`; (b) two modules both `src` → two hits; GREEN (a) exactly `[M1]`, (b) neither (tie).
5. **Counts.** lookup literal `9` kept; comment now says 5 anchor set + the 4 existing `overQuota` goal status-bucket scans. Segmented find window read once: `readMany` **7→5** (seg1: ledger 1 + related window 2 + pointer 1 + activity 1) and **10→8** (+3 seg2); `lookup 25/37`, `lookupOrdered 5`, `searchText 0` unchanged. Write relations batched: RW-12a `readMany` **13→12** = runFacts 3 + anchor facts 5 + scope facts once 3 + one batched relation read; `lookup 12`. New RW-12b through the real `record_note` factory: `{searchText 0, lookup 26, lookupOrdered 0, readMany 17}` = write path 12/12 + post-write check `C(1)` base 5/9 + `withSimilar` 5 lookups.
6. Not changed (body/sections presence validation).

**CHECKS.** One `--maxWorkers=2` run of the full list (plus new tests): **74 files, 843 passed / 5 skipped / 0 failed, exit 0**. `typecheck` 0; `check:architecture` 0 (7/8 module edges, 55 submodule edges); `build` 0. No `DSH-BASELINE` failure; no `.dsh-scratch/`.

**UNSPECIFIED.** Item 4: `find_graph` has no tie marker, so a tie shows only as absence of equal-path hits (smallest option; alternative was a marker). Item 5(b): only explicit-task related scope seeds `planWindows`; `caller_task`/`auto` still uses one `readPlan` (smallest option). Item 1: the `countCurrentNotes` sub-assertion's RED was inferred, not observed. Item 2: the check now precedes the version check, so `resolution_not_applicable` outranks `revision_conflict`; no test pinned that.

**Subagents.** 5 total; most at once 3 (implementers A/B/C, disjoint files). Then A's 5(b) follow-up and the close-out ran one at a time. Coordinator wrote no source/test lines.