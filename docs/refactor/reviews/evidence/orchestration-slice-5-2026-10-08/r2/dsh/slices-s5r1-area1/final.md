All four subagents are inactive with no background jobs. Final state verified. Here is the required report.

## FILES CHANGED
- `src/business/workflow/workflow.ts`
- `src/core/work-graph/state/decision-policy.ts`
- `src/core/work-graph/tasks/goal-decision-reader.ts`
- `src/core/work-graph/tasks/plan-service.ts` (gate regions only: `gateFailureInput`, `gateCoverage`)

(`src/core/work-graph/state/task-failure.ts` was edited in an intermediate E-1 attempt and then restored byte-identical to HEAD; `git diff` for it is empty. No file under `tests/` was touched; no new files.)

## CHECKS
1. `npm run typecheck` → exit 0.
2. `npm run check:architecture` → exit 0; `next source boundaries: OK`, `pure submodules: WorkGraph/state`, 49 submodule edges all allowed.
3. `npm run build` → exit 0; `workbench build: published …/dist/app/public/workbench`.
4. Area run (the 12 named files):
   `Test Files 5 failed | 7 passed (12)`
   `Tests 12 failed | 218 passed (230)`
   Failures (all `/usr/bin/bwrap`-missing kind):
   - `tests/scenarios/A11-no-progress.test.ts` — 7 failed (3 passed); first line `AssertionError: expected { state: 'waiting', …(3) } to match object { state: 'waiting', next: null, …(1) }` (reason `ENOENT: no such file or directory, access '/usr/bin/bwrap'`); also `expected [] to deeply equal [ 'FAIL', 'FAIL' ]`, `expected 'waiting' to be 'stopped'`.
   - `tests/scenarios/C5-gate-fix.test.ts` — 2 failed; both `Error: the Workflow must reach the gate open`.
   - `tests/scenarios/C5-gate-fix-open.test.ts` — 1 failed; `Error: the Workflow must reach the gate open`.
   - `tests/scenarios/C8-auto-rework-cap.test.ts` — 1 failed; `AssertionError: expected 'waiting' to be 'stopped' // Object.is equality`.
   - `tests/scenarios/S5-goal-conflict-rework.test.ts` — 1 failed; `AssertionError: expected 'waiting' to be 'stopped' // Object.is equality`.
5. Named run (all 149 files):
   `Test Files 31 failed | 118 passed (149)`
   `Tests 98 failed | 3831 passed | 29 skipped (3958)`
   Failing files, counts and first failure line:
   - bwrap/process-sandbox kind:
     - `tests/app/AG2b-collaboration.test.ts` — 2; `Error: Test timed out in 30000ms.` (both)
     - `tests/app/change-emitters.test.ts` — 1; `Error: echo did not start: {"status":"rejected","code":"unsupported","reason":"the Kernel ProcessSandbox profile is not available; no host shell fallback"}`
     - `tests/app/orchestration-mechanism.test.ts` — 1; `Error: Task parallel-left stopped: {"state":"waiting",…"reason":"ENOENT: no such file or directory, access '/usr/bin/bwrap'"}`
     - `tests/composition/A2-requeue-platform.test.ts` — 5; `AssertionError: expected { ref: { …(3) }, …(13) } to match object { effectivePhase: 'failed', …(2) }` and `Error: requeue: {"status":"rejected","code":"busy","reason":"finalize_first: round … is open"}`
     - `tests/composition/A2-verification-chain-platform.test.ts` — 6; `AssertionError: expected 'waiting' to be 'stopped'`, `Error: work-1 must reach its completion`, `Error: the Workflow must reach the gate check`
     - `tests/composition/R5c-workflow-platform.test.ts` — 3; `AssertionError: the adopted Plan must reach a formal Goal completion (settled: ENOENT: no such file or directory, access '/usr/bin/bwrap'): expected 'waiting' …`
     - `tests/scenarios/A1-rework-same-session.test.ts` — 1; `AssertionError: expected 'waiting' to be 'stopped'`
     - `tests/scenarios/A11-no-progress.test.ts` — 7; as above
     - `tests/scenarios/A4-duplicate-receipts.test.ts` — 4; `AssertionError: expected 'waiting' to be 'completed'/'stopped'`
     - `tests/scenarios/A7-control-goal29.test.ts` — 1; `AssertionError: expected 'waiting' to be 'completed'`
     - `tests/scenarios/A7-control.test.ts` — 14; `AssertionError: expected 'waiting' to be 'completed'`, `expected { state: 'waiting', … } to match object { state: 'completed' }`, one `ENOENT … '/usr/bin/bwrap'`
     - `tests/scenarios/A8-host-restart-entry.test.ts` — 7; `AssertionError: expected 'waiting' to be 'stopped'`
     - `tests/scenarios/A8-host-restart-paused.test.ts` — 5; `expected { ref: { …(3) }, …(13) } to match object { effectivePhase: 'satisfied' }`, `Error: timed out waiting for the start-up re-drive…`, `Error: the continuation r2 must be claimed`
     - `tests/scenarios/A8-host-restart.test.ts` — 3; `expected 'waiting' to be 'completed'`, `the start-up re-drive completed the Task/Goal without a workflow/advance`
     - `tests/scenarios/C3-brief-idempotency.test.ts` — 4; `AssertionError: expected 'waiting' to be 'stopped'`
     - `tests/scenarios/C3-not-entered-chain.test.ts` — 1; `AssertionError: expected 'waiting' to be 'stopped'`
     - `tests/scenarios/C3-paused-continue-brief.test.ts` — 1; `AssertionError: expected 'waiting' to be 'completed'`
     - `tests/scenarios/C3-reply-other-session.test.ts` — 3; `expected 'waiting' to be 'completed'`, `expected [ 'claim_task', 'prepare', … ] to deeply equal ArrayContaining{…}`
     - `tests/scenarios/C3-workspace-changed.test.ts` — 1; `AssertionError: expected 'waiting' to be 'stopped'`
     - `tests/scenarios/C5-gate-fix-open.test.ts` — 1; `Error: the Workflow must reach the gate open`
     - `tests/scenarios/C5-gate-fix.test.ts` — 2; `Error: the Workflow must reach the gate open`
     - `tests/scenarios/C8-auto-rework-cap.test.ts` — 1; `expected 'waiting' to be 'stopped'`
     - `tests/scenarios/C8-human-stop-respected.test.ts` — 2; `expected [ 'open_checks', 'run_check' ] to deeply equal [ … ]`, `Error: the round must finalize`
     - `tests/scenarios/S1-archive-restart.test.ts` — 1; `expected 'waiting' to be 'completed'`
     - `tests/scenarios/S5-goal-conflict-rework.test.ts` — 1; `expected 'waiting' to be 'stopped'`
     - `tests/scenarios/WP1-wiring.test.ts` — 2; `expected 'waiting' to be 'completed'`
     - `tests/state/invariants-fuzz.test.ts` — 1; `AssertionError: kinds that never ran: expected [ '起检 begin check', … ] to deeply equal []`
     - `tests/state/invariants.test.ts` — collection error, 29 tests skipped; `Error: requeue 1: {"status":"rejected","code":"busy","reason":"finalize_first: round … of the selected Run is open"}`
   - round-2 RED rows of OTHER areas (expected RED here):
     - `tests/business/S5R2-settings-replay.test.ts` — 4; R2C02 (memory), R2C04 (memory), R2C02 (sqlite), R2C04 (sqlite); `AssertionError: expected { status: 'rejected', …(2) } to deeply equal { status: 'committed', …(3) }`
     - `tests/runtime/S5R2-agent-application.test.ts` — 6; R2D01/R2D02/R2D03 × (memory, sqlite); `AssertionError: {"schemaVersion":1,"callId":"apply","status":"error","error":{"code":"invalid_arguments",…` (`Expected: "success"`, `Received: "error"`)
     - `tests/work-graph/S5R2-queue-history.test.ts` — 7; R2A01 (memory), R2A02 (memory), R2A07 (memory), R2A09 (memory), R2A01 (sqlite), R2A02 (sqlite), R2A07 (sqlite); `AssertionError: expected [ { ref: { …(4) }, revision: 2 } ] to deeply equal …` and `AssertionError: expected { status: 'ready', value: { …(11) } } to match object { Object (status, code) }`
6. `sha256sum <34 files>` → all 34 lines match section 3 byte-for-byte (`diff` between actual and expected is empty; `ALL 34 HASHES MATCH`).
7. `git status --short | wc -l` → `103` (54 `??` + 49 ` M`, same split as baseline); `git diff --stat -- src/core/work-graph/state/task-failure.ts` empty; `git log --oneline` → one commit `375dcdb`; `./.dsh-scratch/` deleted.

## UNSPECIFIED
- **E1 — done.** `state/decision-policy.ts:145` `gateCoveredTaskIds`, `:166` `gateFixInProgress`, `:238–255` `pausedAutomationAction` gate branch (GV-1…GV-10 minus GV-0, with cap/chain/fresh-refusal/human-stop/covering-action stops); `tasks/goal-decision-reader.ts:361,365`; `tasks/plan-service.ts:884` (`gateFailureInput`) and `:2416–2418` (`gateCoverage` delegates).
- **E2 — done.** `src/business/workflow/workflow.ts:1206–1212` builds the canonical `goalBasis` (goalRef, workspaceRef, objective, activePlanRef, settings normalized with `DEFAULT_GOAL_SETTINGS_V1`), `:1222` emits `goalBases: [goalBasis]`; `key` and `pins` unchanged.
- **Message self-contradiction:** §6 names tracked-and-clean `WG/state/task-failure.ts` as an E-1 write location, but editing it makes `git status --short` 104, against the twice-stated expected 103. Resolved by putting the shared pure helpers in the already-untracked `state/decision-policy.ts` and reverting `task-failure.ts` to HEAD byte-identical. This is the one thing the correction block and §8 did not jointly determine.
- `TaskFailureFactsV1`/`GateFailureInputV1` live in `src/contracts/task-failure.ts`, outside E-1's four-file scope; therefore GV-5 is passed to `pausedAutomationAction` as a new optional function input `gateFixInProgress?: boolean`, not as a new contract field. No existing field changed.
- GV-8 `source_unchanged` + FAIL and the cap/chain/refusal ordering are re-derived inline in `decision-policy.ts`, mirroring `reverifyHeadStop`; the paused branch is a parallel condition set rather than a parameterization of `gateVerdict` (only GV-5/coverage is genuinely shared). Future GV-table edits must touch both places.
- Host-interruption cap edge: E-1 mirrored the existing work-branch cap formula (`autoCount+1 > cap && exemption !== 'host_interruption'`), while the Workflow additionally fences `countedNext > cap`. No frozen test covers the difference; left unchanged.
- N-R2-1 part (b) (read model resolving the bound Workspace instead of `goalBases[0]`) is another area's; `views/decision-read-model.ts:1209` still uses `goalBases?.[0]`. R2B01 is green because part (a) now supplies the basis. Out of this area's scope.
- No frozen test contradicts any correction.

## NOTES
- Subagents: 2 implementation groups (E-1, E-2) launched together; E-1's owner made one coordinator-ordered follow-up (move helpers, restore `task-failure.ts`); 2 fresh-context read-only reviewers (one per group). 4 distinct agents.
- Both reviewers returned **done, no defects**; E-1 review confirmed the one shared GV-5/coverage helper is used by both `plan-service.ts` and `goal-decision-reader.ts`.
- First E-1 attempt pushed `git status` to 104 by editing tracked `task-failure.ts`; the follow-up restored 103 without touching any E-2/other-area file or any test.
- Every section 8 count reproduced the lead's expected numbers exactly; all non-bwrap failures are the other-area RED rows R2A01/02/07/09, R2C02/04, R2D01/02/03.
- Nothing blocked; nothing undone. No commit made.