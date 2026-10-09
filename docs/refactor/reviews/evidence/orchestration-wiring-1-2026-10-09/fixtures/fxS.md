# Group S — two scenarios on the production composition (SC01, SC02)

Checkout: `D:/cxt/impl-w1-fxS`. Read `D:/cxt/impl-w1-fx-msg/RULES.md` first.

## Your files (only these two)

- `tests/helpers/WP1-scenario-fixture.ts` (new)
- `tests/wp1-smoke/scenario.smoke.test.ts` (new, temporary)

## Rows (spec §5.2, file `tests/scenarios/WP1-wiring.test.ts`, SQLite, production composition)

SC01, SC02. Read the spec: §0 L7–L9, L10–L15, §1.1, §4.2, §4.4, §5.1 (scenarios: fixed SQLite, `tests/scenarios/harness.ts`,
`tests/scenarios/support/restart.ts`, `assertInvariants` from `tests/state/invariants.ts` after every step), rows SC01,
SC02, §7. Code: the production composition `src/composition/create-platform.ts`, `src/business/workflow/workflow.ts`
(`claimRequeued`, `continuationProvenanceFor`), `session-maintenance.ts` retired branch, `session-archive.ts`. Existing
scenarios to follow: `tests/scenarios/A8-host-restart-paused.test.ts` (the exact SC01 path), `tests/scenarios/harness.ts`,
`tests/scenarios/support/restart.ts`, `tests/scenarios/S1-archive-restart.test.ts` and `tests/app/S1-session-routes.test.ts`
(operator archive of a line through `sessions/archive-line`, choosing "drop"), `tests/scenarios/S3-context-and-inputs.test.ts`
(reading a prepared manifest's binding and input; `readContextFacts`).

## What the helper must provide

1. **SC01 `openPausedInterruptedScenario()`**: following A8-host-restart-paused: Task T's Run in progress in Session P,
   a person clicks pause, the Host restarts before the pause took effect, T stays paused-interrupted and P is left
   `kernel_turn_open` (maintenance does not auto-archive P because of the pause fence). Stop there. Return the harness /
   platform handles, P, T, the Goal, and two functions: `clickContinue()` (the person's "继续", exactly as A8 does it) and
   `advanceToEnd()` that drives the Workflow advance loop to the end (scripted model replies, scripted checks as the
   existing scenarios do), collecting EVERY step kind performed in order and every receipt (so the test can check the
   order `create_session`, `transfer_responsibility`, `claim_task` and the transfer receipt's cursor), calling
   `assertInvariants` after each step. Also read helpers: P's Session card (lifecycle, links with `until`), P's
   `SessionArchiveRequested` events (mode), all `SessionAnomalyAnchor` records, T's task row (`satisfied`), and the
   `tasks/archive-state` route read for T (`label`).
   Today the loop will stop at the first new behaviour (no `transfer_responsibility` step exists) — `advanceToEnd` must
   not throw on an unknown step: it stops and returns what it collected when the Workflow returns `waiting`/`completed`
   or after a bounded number of steps (say 60).
2. **SC02 `openArchivedLineScenario()`**: a Goal with NO anomaly anchor yet; T's Run in progress in Session P; the
   operator archives P's line through the `sessions/archive-line` route choosing "drop" for T → the anchor A is written
   (real owner). Stop there. Return handles, A (ref, task, runRef), T, and functions: `advanceUntilPrepared()` (advance
   until another Session has claimed T and the `prepare` step returned a prepared manifest; return that manifest: its
   binding — `extensions`, `sections` — and its input text), `enterAndComplete()` (continue: start the Run with a
   scripted reply, checks pass, T completes), and `readGoalContextFacts()` (a Host `readContextFacts` for the Goal through
   the production graph reader, returning the result so the test can check `extensions.anomalies.rows`).

## Lead notes for this group

- Scenarios do not call a real model; every model reply is scripted (as the existing scenarios do).
- Do not modify `tests/scenarios/harness.ts` or `tests/scenarios/support/*`; copy what you need into your helper.
- If checks in these scenarios need the bubblewrap check sandbox, say so under RISKS (the lead runs them in an
  environment with and without `/usr/bin/bwrap`).
