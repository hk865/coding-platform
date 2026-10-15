All section-3 checks are done and the working tree is clean of scratch. Here is the report.

## R1–R13 — per ruling, which session did it

`Int2` = the interrupted round-2 session (its files were already on disk when I started); `This` = this continuation.

- **R1** (Int2 test; fix Int2+This): `S2B-r2-backfill-identity.test.ts`; `activity-backfill.ts:submissionToken` uses the candidate read's commit cursor. This session removed the keyset/counter fallback and now derives a stable token from the selected record revision + a digest of the facts (reviewer-1 finding 1).
- **R2** (Int2): `S2B-r2-run08-current-revision.test.ts`; `execution-observation.ts` re-reads the Run's current revision, keeps the pending event/activity input.
- **R3** (Int2): `S2B-r2-r3-track-pagination.test.ts`; `track-read-model.ts` segment+position cursor, stops when the page is full (limit 2 over later bars under an injected cap 10).
- **R4** (Int2+This): `S2B-r2-r4-bound-workspace.test.ts`, `S2B-r2-workspace-binding.test.ts`; guards in `activity-read-model.ts`, `track-read-model.ts`, `task-state-timeline.ts`, `goal-executed-files-reader.ts`. This session added `activity/runs`, `activity/track`, `tasks/timeline` route cases.
- **R5** (Int2): `S2B-r2-never-entered.test.ts`, `S2B-r2-r5-not-entered.test.ts`; one L7 predicate in `contracts/run-activity.ts`, applied only to ended Runs; active Runs → `possiblyIncomplete:true`.
- **R6** (Int2+This): `S2B-r2-backfill-probe-first.test.ts`; `runtime.ts:countRunActivity` probes before `readTurnBounds`. This session added `S2B-r2-r6-probe-verdicts.test.ts` (`host_config`, `cancelled`, cancellation after bounds).
- **R7** (Int2+This): `S2B-r2-keyed-cap.test.ts`, `S2B-r2-r7-keyed-read-cap.test.ts`; `readOneKeyed` in `activity-read-model.ts` and `track-read-model.ts` charges every requested key incl. misses. This session made the calendar cap boundary explicit.
- **R8** (Int2): `S2B-r2-calendar-boundaries.test.ts`; `activity-read-model.ts` step 2 skips any Run with a record and treats unknown spans as closed.
- **R9** (Int2+This): `S2B-r2-backfill-done-cursor.test.ts`; `activity-backfill.ts` preserves the probe's continuation. This session made a full batch with `next:null` report `done:true`.
- **R10** (Int2+This): `S2B-r2-activity-run-ended-at.test.ts`; `execution-entry-service.ts:1958` and `run-reconcile-service.ts:425` use `nextRun.endedAt`, `recordedAt = now`. This session corrected the non-discriminating reconcile assertion.
- **R11** (This): S `S2B-r2-s-yielded.test.ts`, `S2B-r2-s-preentry-control.test.ts`; V `S2B-r2-v-real-runs.test.ts` (real Runtime/scripted model); B `S2B-r2-backfill-real-kernel.test.ts` (real leased Host + `activity/backfill` route, real Kernel, §7 counting-off double).
- **R12** (This): 2B-24 `S2B-r2-calendar-same-task.test.ts` (public reverify on the same subject Run after FAIL); 2B-27 `S2B-r2-27-moving-window.test.ts` (track+timeline, exactly 4 attempts, settle-once); 2B-34 `S2B-r2-conflict-catalog.test.ts` — **STOPPED**.
- **R13** (Int2): `S2B-r2-backfill-revision-race.test.ts`; `run-activity-service.ts` CAS on `expectedActivityRevision` carried through the write.

## Checks

- `npm run typecheck` — 0; `npm run check:architecture` — 0 (`next source boundaries: OK`); `npm run build` — 0; `node scripts/build-kernel-patch.mjs --check` — 0.
- targeted (`--maxWorkers=4`) — exit 1; `Test Files 2 failed | 57 passed (59)`, `Tests 4 failed | 313 passed (317)`: 3× 2B-09 (sandbox) + SC02 (baseline).
- `npx vitest run --maxWorkers=8` — exit 1; `Test Files 49 failed | 320 passed (369)`, `Tests 153 failed | 6339 passed | 29 skipped (6521)`. Exact-set diff: all 150 `DSH-BASELINE.md` §A entries present, extra = the 3 2B-09 sandbox tests (no `NEW` failure).
- sha256 `198e832f…`, `8e7e159a…` unchanged; `git status --short` only `src/`+`tests/` (27 new round-2 test/helper files); head still `5eca147`; `./.dsh-scratch/` deleted; no commit.

## Not done / limits

- **2B-34 stopped** (independently confirmed by reviewer 2): frozen `goal-settings-machine.ts:276-286` defines `filePaths` as the executed∩executed intersection (B executed nothing → `[]`); `GoalConflictReadV1` exposes no mapped-file list and `goal-conflicts.ts` lists only `moduleRef === null`. Listing F needs a frozen interface change.
- 2B-17 through the Host uses one-Run windows (production `ACTIVITY_BACKFILL_BATCH_RUNS=5` is not injectable through the Host/route); the cursor-per-batch flow stays in round-1 `S2B-backfill-workflow.test.ts`.
- R1/R9/R13's new tests use a scripted `countRunActivity` (Workflow-side defects); real-Kernel coverage lives in `S2B-r2-backfill-real-kernel.test.ts`.
- R10's reconcile-writer `endedAt` invariant is vacuous (fresh ends stamp `endedAt = recordedAt`); the test now says so; only the entry writer discriminates.
- Group-V `in_progress`/open-bar and >3-task cells are unreachable through BE1; they remain in round-1 supplementary files.

## Subagents

This session: D1 (R11 S+V, R12 2B-27), D2 (R11 B, R12 2B-24/34); Reviewer 1 (A/B), Reviewer 2 (C/D); Fixer A (reviewer-2 findings 1/3/4), Fixer B (findings 2/5/6). All collected in-turn; never more than two running.