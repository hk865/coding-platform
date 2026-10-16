## 4C-1 rework part 4 — done

**Files (production net +35; 64 added/29 deleted).** `notes/note-service.ts` +18 (per-call plan-window memo), `views/graph-context-reader.ts` +15 (normalised/stripped candidates, stripped directory branch, tie carries shared path), `notes/note-path-ownership.ts` +2 (`tie` carries `owners`) — +35. Tests: `S3-graph-context.test.ts` +62 net, `S4C-write-read-bounds.test.ts` +33, `S4C-find-read-bounds.test.ts` comment-only, `S4C-note-path-ownership.test.ts` 1 assertion.

**Item 1 RED→GREEN.** New RW-12c: one scribe disposition, two stage-anchored targets in `s4a-goal`. RED `{0,4,1,13}`; GREEN literal **`{searchText:0, lookup:4, lookupOrdered:1, readMany:11}`** = runFacts 3 + subject head 1 + scope facts once 3 + relationAnchorsOf 1 (2 targets batched) + userReasonTargetsOf 1 (same 2) + plan window once 2 (readGoal+readPlan); RED read the window twice. Continuity unchanged (`{status:'done'}`).

**Item 2.** (a) RED `[]` vs `[M1]` for `Src`/`src/a.ts`; GREEN `[M1]`. (b) applied (stripped `path` in the directory branch); no independent RED because equality precedes that branch. (c) part-3 tie test now expects both M1,M2 (RED `[]`); 3-module case returns the two, not `lib`; `src/sub` under `src` still found. Other `pathOwnershipOf` callers keep "tie owns nothing"; typecheck green.

**Item 3.** `S4C-find-read-bounds` comments now derive 25 = 15 (three related anchor keys × 5 indexes) + 1 Run index + 5 project-header anchors + 4 quota buckets; 37 = 25 + 1 goal index + 6 (2 slots × 3 states) + 5 module anchor; 5/8 readMany named. Codex matched 25/37 (he had not named readMany). RW-12b names matched Codex: head 1 + catalog 2 + author Run 1 + bound plan 1. No literals changed.

**Checks.** One `--maxWorkers=2` run: 75 files, 74 passed/1 failed; 860 tests, 853 passed/2 failed/5 skipped, exit 1. `typecheck` 0; `check:architecture` 0 (7/8 module, 55 submodule edges); `build` 0. No `.dsh-scratch/`.

**UNSPECIFIED / report-not-edit.** Item 2(c) says only the part-3 tie test changes, but the pre-existing `S3-graph-context.test.ts` `RW-13 find under an equal-prefix tie reports no owner, not two module hits` (`sharedModulePaths`, line 925) also relied on the old tie rule: `expect(nodes).not.toContainEqual({kind:'module', ref:moduleM1.ref})` now observes `[M1,M2]` (memory+sqlite). Per the item I did not edit it, so those 2 rows stay red. The direct contract test `S4C-note-path-ownership.test.ts:19` was updated to the binding `{status:'tie', owners}` shape.

**Subagents.** 3 at once (items 1+3-write, 2, 3-find, disjoint files), then 1 close-out. Coordinator edited no source/test lines.