# Task: slice 2B, round 2 — fix what the implementation review found; test-driven

You are working in the slice-2B copy (the current directory). Round 1 built slice 2B; its work is **uncommitted in the
working tree — keep it**. This is a NEW session. No git write commands, no network, no real model calls. Throw-away files
go under `./.dsh-scratch/` and are deleted at the end; never use `/tmp`. Finish within 150 minutes.

**This run is headless. When your turn ends, the whole run ends, and every subagent still running is killed.** After
starting subagents, stay in your turn until every one has reported (wait with `sleep 540`, then `list_agents`; repeat).

Read first: `./.dsh-ref/s2b-impl.md` (round 1's book: sections 1–5 still apply, including L-scope, L-tdd, L-fixtures and
the lead answers P1–P12), the frozen spec `docs/refactor/design/orchestration-2026-10/slices/slice-2B-SPEC.md` (§0.3
L1–L17 and §10 are binding), the review `./.dsh-ref/s2bimplrev.out.md` and round 1's report `./.dsh-ref/final-1.md`.

## 1. Lead rulings on the review (binding)

Fix every must-fix item 1–12 and should-fix 13 as the review says, test-first (a failing test that shows the defect,
then the fix). Specifics:

- **R1 (item 1).** Backfill request ids: `s2b-backfill:<runKey>:<commit cursor of the candidate read>` (unique across Host
  lifetimes, stable for retries of the same submission). Test unknown → Host restart → recovered facts → counted.
- **R2 (item 2).** RUN-08 retries re-read the Run and use its current revision; keep the pending event/activity input.
  Test a control write that advances the Run revision between the failure and the retry.
- **R3 (item 3).** Track pagination: the cursor is segment + index position (spec L12); stop reading when the page is
  full; page metadata from that scan only. Tests: bounded reading (a `limit: 2` page with thousands of later bars stays
  within the cap) and a change before the cursor between pages.
- **R4 (item 4).** Every read checks the caller's bound workspace for the Goal, Run and Session it returns; another
  workspace in the same project → `forbidden` (or omitted where the spec says a list filters). Cross-workspace route tests.
- **R5 (item 5).** One predicate for "never entered" exactly as L7 (no position record, no Kernel identity, authorization
  states as L7 lists — no V1 shortcut), applied only to ended Runs; `starting`/`running` Runs make the executed-files
  result `possiblyIncomplete: true`.
- **R6 (item 6).** Backfill probes first; transient, host-config and cancelled outcomes stop without writing
  (`retry_later`); cancellation is honoured around the bounds read.
- **R7 (item 7).** Every keyed read charges each requested key, including misses, in the calendar and track readers;
  exact-boundary tests for both.
- **R8 (item 8).** Calendar step 2 skips every Run that has an activity record (spec L9); unknown spans use closed
  intervals at both ends. Tests at the window start and at an hour boundary.
- **R9 (item 9).** Backfill reports `done` only when there are no candidates and no continuation. Test a missing Run after
  a long stretch of counted Runs.
- **R10 (item 10).** The activity snapshot keeps the Run's original `endedAt`; `recordedAt` is the replacement time — in
  the RUN-21 writer and the reconcile writer.
- **R11 (item 11).** Keep the round-1 tests as supplementary, and add the required flows:
  - Group S: the yielded Run and its successor, and the pre-entry pause/resume, through public services (Workflow,
    controls, claims) — no storage-boundary commits beyond spec §7's legacy round shapes.
  - Group V: rows 2B-21, 2B-26, 2B-29 and 2B-30 also through real Runtime runs with the scripted model (the BE1 platform
    fixture), so the read sees records written by run end.
  - Group B: 2B-16 and 2B-17 also through the Host with real Kernel history and the test-only "counting off" module double
    (spec §7), not a scripted `countRunActivity`.
- **R12 (item 12).**
  - 2B-24: the same task rechecked — use the public reverify on the same task's subject Run after a FAIL.
  - 2B-34: adopt an architecture catalog through the public adoption so module M maps a path prefix; goal B plans a task
    in M; goal A's run executed file F under M; assert through `decisions.queryGoalConflicts` (BE5) that the conflict
    lists F. If the frozen algorithm still cannot produce it, stop that row and report exactly why.
  - 2B-27: add the moving-window cases for track and timeline, and assert exactly four attempts.
- **R13 (should-fix 13).** Carry the selected record revision through the backfill write; a record changed after
  selection → `skipped`, `record_changed`; an ordinary unchanged retry stays `unchanged`.

## 2. Work with subagents (the lead's recommendation; you may regroup with a reason)

- Wave 1, in parallel (disjoint files): **A** backfill (R1, R6, R9, R13; `activity-backfill.ts`, `runtime.ts`,
  `run-activity-service.ts`); **B** observer and writers (R2, R10; `execution-observation.ts`, `execution-entry-service.ts`,
  `run-reconcile-service.ts`/`run-reconcile.ts`); **C** reads (R3, R4, R5, R7, R8; `activity-read-model.ts`,
  `track-read-model.ts`, `task-state-timeline.ts`, `goal-executed-files-reader.ts`, routes only if R4 needs it).
- Wave 2, after wave 1: **D** the real-flow tests of R11 and R12 (new test files and helpers; production fixes go to the
  owning wave-1 file through you).
- Then one read-only reviewer per group with a fresh context; fixes; then section 3.

## 3. Checks (run exactly these)

```
npm run typecheck
npm run check:architecture
npm run build
node scripts/build-kernel-patch.mjs --check
npx vitest run tests/runtime/S2B- tests/work-graph/S2B- tests/composition/S2B- tests/scenarios/S2B- tests/app/S2B- tests/scenarios/S5-goal-conflict-rework.test.ts tests/architecture/
npx vitest run
sha256sum DSH-BASELINE.md docs/refactor/design/orchestration-2026-10/slices/slice-2B-SPEC.md
git status --short
```

Expected: as round 1 (only baseline failures and the three 2B-09 shell tests in this sandbox); the two sha256 values
unchanged (`198e832f…`, `8e7e159a…`).

## 4. Reply

Under 600 words: per ruling R1–R13 the test name(s) and file:symbol of the fix; the checks with exit codes and the
`Test Files`/`Tests` lines; anything not done and why; the subagents you ran.
