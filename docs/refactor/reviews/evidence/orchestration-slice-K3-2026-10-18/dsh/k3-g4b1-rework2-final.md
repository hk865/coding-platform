All work is complete; subagents reported and the final checks are verified.

**Files changed**

Production (net): `src/business/workflow/workflow.ts` +84/−18 (items 1, 2); `src/contracts/continuation-brief.ts` +18/−17 (item 3); `src/contracts/unknown-call-review.ts` +9 (T02 reason constant); `src/core/work-graph/tasks/unknown-call-review-service.ts` +2/−1 (uses it). No other `src/` change.

Tests: new `tests/business/K3-46-review-advance-failures.test.ts` (406 lines, 4 tests); `tests/business/K3-review-workflow-rows.test.ts` +71/−14; `tests/helpers/K3-review-card-fixture.ts` +10/−7 (additive fault reason); `tests/scenarios/K3-29-disposition-recovery.test.ts` +60/−6; `tests/scenarios/K3-44-recovery-answers.test.ts` +61/−8; `tests/work-graph/K3-15-disposition-effects.test.ts` +3/−3.

**RED → GREEN**

1. RED: ordinary refused ② returned `waiting`. GREEN: the same advance keeps the apply receipt, reason `unavailable: injected ② commit failure`, excludes that card and selects task `k3-20-b` (one apply); designating task 1 still answers `waiting`. UR7b's ② replay follows the same rule.
2. RED: the concurrent-Goal-pause race returned 「目标的内容变了，这个答复不能落实」. GREEN: it returns the real `revision_conflict: <store reason>`; a real PB3 Plan adoption after the answer still returns the exact T02 sentence.
3. RED: both no-targets and settled-by-itself missed `- 作用对象：无。` (2 failed/9). GREEN: 11/11, line always present, `无` for empty/self-settled; platform line unchanged.
4. RED: task stayed `verifying`/`running`, never `satisfied`. Cause: the test's sandbox stand-in refused non-read-only probes, so `run_check` was `unsupported`. GREEN: the check genuinely runs (real command/exit code; no ledger facts), K3-44 stops before `complete_task`, performs it, asserts `effectivePhase: 'satisfied'`; K3-29 asserts `completed` + satisfied; quiet restarts `redriveGoals: []`; all other assertions kept.
5. RED: real ③ text was the fixture default, not the distinct first text. GREEN: two real cards answered through the public card answer, real ② receipts, ③ fails for both with distinct texts; `reason` holds `unavailable: injected ③ failure one`, not `… two`; both records resolved; hand-made path removed (31/31).

**Checks** (`--maxWorkers=2`) — 216 files / 4,969 tests: 4,872 passed, 68 failed, 29 skipped. All 68 failures are DSH-BASELINE §A (no bwrap); A8-3n failed as its listed baseline entry, not investigated. Changed-file rerun: 6 files / 53 tests pass. `npm run typecheck`, `npm run check:architecture`, `npm run build`: pass. No git writes.

**UNSPECIFIED** (smallest options): (i) UR7b answers with no ② run (unreadable/invalid) keep today's `waiting`; (ii) when the continued selection finds no other work its state governs but `reason` is the first ② failure text; (iii) K3-29: once the check passes, the start-up re-drive itself reaches `complete_task`, so the further advance confirms `completed` rather than stopping before it — terminal state still asserted, no fact injection; (iv) fixture gained optional `failNextApplicationCommit(reason?)`, default text unchanged; (v) item-1 test adopts a real reordered Plan revision so `k3-20-a` is reached in an ordinary selection.