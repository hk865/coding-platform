**Production** — 9 files, +137/−118 (net +19): `note-scribe-todos` +50/−75, `note-update-due` +7/−2, `note-service` +6/−2, `note-anchor-facts` +33/−12, `note-anchors` +10/−1, `note-read-model` +29/−10, `create-platform` +2/−1, `note-contracts` −8, `note-views` −7.

**Tests** — 6 files: modified `S4C2-read-counts` +104/−5, `S4C-write-read-bounds` +38, `S4C-find-read-bounds` +6/−6; new 813 lines (`S4C2-scribe-user-reason` 144, `S4C2-task-window` 394, `S4C2-project-set-shared` 275).

**Item 1.** T1 RED `expected [P@1] to deeply equal []` (memory+sqlite) → GREEN pending `[]`, scribe accept `forbidden`. T2 guard pending `[P'@1]`. T3 RED `expected 20 to be +0` (5 anchor-set lookups × 4 target keys) → GREEN: target anchor-set 0, review-status G+1=2, pointer 1, pointed-head 1, target 1, plan 1, catalog 1, trigger 1, pending `[]`; other heartbeat G=2: 3/1/1/1/2/0/2. `targetAnchorKeys` and `understandingTriggers` deleted (grep clean); `readThrough` carried; targets read only for counting buckets (code-reviewed).

**Item 2.** T1 RED `{goal 6, plan 3}` → GREEN `{goal 2, plan 1}`. Book says Goal 1: the queue's collection wrapper also performs the pre-existing `readGoalForBasis` (`decision-read-model.ts:361`); the target term removed is exactly 4 Goal + 2 PlanRevision. RW-12c RED readMany 17 → GREEN 11 = 3+1+3+1+1+2, lookup 4, lookupOrdered 1; RW-12a/b unchanged. Ruling-B T4b RED `'rejected' ≠ 'ready'` → GREEN: W2 queue ready/card waiting and to-dos `[]` while W1 t1 active; after public W1 cancellation to-dos `[w2-note@1]`, queue empty, card `closed/source_resolved`. T3/T4a behaviour guards.

**Item 3.** RED `expected 10 to be 5` on Goal-card work/query, unsegmented find, segmented page 1; RW-12(i)/(ii) 25→20, 37→32. GREEN project-key lookups 5 = ceil(2/200)+4; page 2 = 5 with `project` undefined; literal header unchanged.

**Checks** (`--maxWorkers=2`): S4*/S5* 83 files, 936 pass/4 skip; scenarios S4C2 + app S4C* 4 files, 44 pass; business + WP2 + architecture 20 files, 219 pass + the known DSH-BASELINE §A R5b sandbox failure; the six changed files rerun independently 46/46. `typecheck`, `check:architecture`, `build`, `git diff --check` all exit 0. No scratch, no git writes.

**UNSPECIFIED**
1. Queue T1 keeps Goal 2, not the book's 1, because of the separate decision-view basis read; plan 1 and the removed delta (4 Goal + 2 PlanRevision) match.
2. Ruling B's "another-project goal stays forbidden" is not publicly assertable: a goal anchor carries only `goalId` and resolves under the call project (missing → `not_found`); the project check remains in place.
3. Dangling-plan fallback deliberately untested (tampering-only, §13.4).
4. Spec post-notes (§13 item 2, §11.7 line 912 wording) remain the lead's; no docs edited.