**R3** — test `2B-r3 R3 limit 2 over many later readonly copies stays within the injected cap` (`tests/work-graph/S2B-r3-consultation-cap.test.ts`); fix `track-read-model.ts:copiesPageOf` (paged provenance, `COPY_PROVENANCE_PAGE_LIMIT`, cursor `ca`).

**R4** — tests `2B-r3 R4 a track run bar whose Session is in another workspace is forbidden` and `…a calendar cell Session…` (`tests/work-graph/S2B-r4-session-workspace.test.ts`); fix `track-read-model.ts:sessionProblemOf` and `activity-read-model.ts:readCalendarWindow` (final Session pass), cached and charged.

**R5** — test `2B-r2 R5 a V2 authorization carrying a Kernel identity does not prove non-entry` (`tests/work-graph/S2B-r2-r5-not-entered.test.ts`); fix `contracts/run-activity.ts:provenNotEnteredKernel`, used at `runtime.ts:countRunActivity` and `run-activity-service.ts:isBackfillCandidate`.

**R6** — test `R6 a bounds read that answers unreadable because of cancellation is retry_later` (`tests/app/S2B-r2-r6-probe-verdicts.test.ts`); fix `runtime.ts:countRunActivity` (abort checked immediately after the bounds await).

**R8** — test `R8 an unknown span ending exactly on \`from\` marks that first cell` (`tests/work-graph/S2B-r2-calendar-boundaries.test.ts`); fix `activity-read-model.ts:markRun`.

**Checks:** typecheck 0; check:architecture 0; targeted run `Test Files 1 failed | 59 passed (60)`, `Tests 3 failed | 324 passed (327)` — only the three 2B-09 shell sandbox tests. Both sha256 unchanged; `git status` is L-scope only.

**Not done / flags:**
- I edited existing `tests/work-graph/S2B-r2-r7-keyed-read-cap.test.ts` (exact cap 8→9, short 7→8) because R4 adds one cached Session keyed read; this is outside §5.3.
- R5 vs 2B-13: RUN-09(R) is a `revoked` V2 authorization that keeps its Kernel identity but is proven non-entered by a `not_entered` reconciliation. `kernel === null` alone flipped it to `not_recorded`, so the predicate also accepts the platform's `not_entered` reconcile proof; the `kernel === null` condition stays on the authorization branch.
- `./.dsh-scratch/` emptied.