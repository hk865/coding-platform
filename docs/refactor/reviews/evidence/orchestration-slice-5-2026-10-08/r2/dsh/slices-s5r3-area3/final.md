All checks and cleanup are done. Here is the final report.

## FILES CHANGED
- `src/business/workflow/decision-actions.ts`
- `src/core/work-graph/tasks/goal-settings-service.ts`

## CHECKS

1. `npm run typecheck` → exit 0.
2. `npm run check:architecture` → exit 0 (observed module edges 7/8 allowed; `next source boundaries: OK`).
3. `npm run build` → exit 0 (`workbench build: published …/dist/app/public/workbench`).
4. `npx vitest run tests/business/S5R2-settings-replay.test.ts tests/work-graph/S5-goal-settings.test.ts tests/state/S5-goal-settings.test.ts tests/business/S5-decision-workflow.test.ts tests/app/S5-decision-routes.test.ts tests/work-graph/S5-decision-application.test.ts tests/scenarios/S5-goal-conflict-rework.test.ts` → exit 1.
   - `Test Files  1 failed | 6 passed (7)`
   - `Tests  1 failed | 101 passed (102)`
   - `tests/scenarios/S5-goal-conflict-rework.test.ts (1 test | 1 failed)` — `SC02 …` first line: `AssertionError: expected 'waiting' to be 'stopped'` (missing `/usr/bin/bwrap`; expected in this sandbox). All other 6 files pass; R2C02 and R2C04 pass.
5. `npx vitest run <the 149 named files>` → exit 1.
   - `Test Files  31 failed | 118 passed (149)`
   - `Tests  97 failed | 3832 passed | 29 skipped (3958)`
   - `tests/app/AG2b-collaboration.test.ts (3 tests | 2 failed)`: "releases a busy B…" :: `Error: Test timed out in 30000ms.`; "reopens read-only…" :: `Error: Test timed out in 30000ms.`
   - `tests/app/change-emitters.test.ts (7 | 1)`: "announces settled, and stopping once before settled…" :: `Error: echo did not start: {"status":"rejected","code":"unsupported","reason":"the Kernel ProcessSandbox profile is not available; no host shell fallback"}`
   - `tests/app/orchestration-mechanism.test.ts (15 | 1)`: "runs two explicitly selected same-Goal Tasks…" :: `Error: Task parallel-left stopped: {"state":"waiting",…,"reason":"ENOENT … /usr/bin/bwrap"}`
   - `tests/business/S5R2-automation-cards.test.ts (5 | 3)`: R2B01 :: `AssertionError: expected { …(16) } to deeply equal { …(16) }`; R2B03 :: `expected [] to have a length of 1 but got +0`; R2B04 :: `expected { status: 'rejected', …(2) } to match object { status: 'ready', … }`
   - `tests/composition/A2-requeue-platform.test.ts (5 | 5)`: "C3 (§6.1 (e)…)" :: `Error: requeue: … "finalize_first: round … is open"`; "D-3: FAIL → TaskRequeue…" :: `AssertionError: expected { ref: …, …(13) } to match object { effectivePhase: 'failed', …(2) }`; "TASK-03 (§4.3)…" :: `finalize_first … is open`; "W-21 / C3…" :: `effectivePhase: 'failed'`; "§4.3 / §4.4…" :: `effectivePhase: 'failed'`
   - `tests/composition/A2-verification-chain-platform.test.ts (6 | 6)`: VR-01..VR-07 :: `expected 'waiting' to be 'stopped'`; VD-7 future :: `Error: work-1 must reach its completion`; VD-7 adoption :: `expected { stopped: null, …(3) } to match object { state: 'completed' }`; VR-05 (VD-6) :: `expected { status: 'ready', … } to match object { status: 'ready', … }`; VD-15 :: `Error: the Workflow must reach the gate check`; VD-8 :: `expected { status: 'ready', … } to match object { status: 'ready', … }`
   - `tests/composition/R5c-workflow-platform.test.ts (4 | 3)`: "advances two works and 'the Goal gate'…" :: `AssertionError: the adopted Plan must reach a formal Goal completion (settled: ENOENT … '/usr/bin/bwrap')`; "advances two works and 'a stage gate then the Goal gate'…" :: same `ENOENT … bwrap`; "resumes the original verification round…" :: `AssertionError: the original check runs to a persisted finished window: expected …`
   - `tests/runtime/S5R2-agent-application.test.ts (12 | 6)`: R2D01 (memory), R2D02 (memory), R2D03 (memory), R2D01 (sqlite), R2D02 (sqlite), R2D03 (sqlite) :: `AssertionError: {"schemaVersion":1,"callId":"apply","status":"error","error":{"code":"invalid_arguments","message":"the tool arguments do not match the strict schema",…}}: expected 'error' to be 'success'`
   - `tests/scenarios/A1-rework-same-session.test.ts (1 | 1)`: "A1 (C8, §15.2 5.8…)" :: `expected 'waiting' to be 'stopped'`
   - `tests/scenarios/A11-no-progress.test.ts (10 | 7)`: "#1, #3, #10…" :: `expected 'waiting' to be 'stopped'`; "#14 (ND-4), #6…" :: `expected 'waiting' to be 'stopped'`; "#15…" :: `expected [] to deeply equal [ 'FAIL', 'FAIL' ]`; "#2, #25, #21…" :: `expected [] to deeply equal [ 'FAIL', 'FAIL' ]`; "#4…" :: `expected [] to deeply equal [ 'FAIL', 'FAIL' ]`; "#7, #8…" :: `expected [] to deeply equal [ 'FAIL' ]`; "§13.4 #15/#21…" :: `expected { state: 'waiting', …(3) } to match object { state: 'waiting', next: null, …(1) }`
   - `tests/scenarios/A4-duplicate-receipts.test.ts (6 | 4)`: "(记录结果)…" :: `expected 'waiting' to be 'completed'`; "W-23…" :: `expected 'waiting' to be 'stopped'`; "C-05…" :: `expected 'waiting' to be 'stopped'`; "(领取、发信、记录结果)…" :: `expected 'waiting' to be 'completed'`
   - `tests/scenarios/A7-control-goal29.test.ts (2 | 1)`: "A7-G4 with history…" :: `expected 'waiting' to be 'completed'`
   - `tests/scenarios/A7-control.test.ts (24 | 14)`: "A7 entered Run…" :: `expected 'waiting' to be 'completed'`; "A7 yielded wait…" :: `expected 'waiting' to be 'completed'`; "goals/control pause, then resume…" :: `expected { state: 'waiting', …(3) } to match object { state: 'completed' }`; "VD-9…" :: `expected 'ENOENT … /usr/bin/bwrap' to contain 'the Goal is paused; no new check proc…'`; "GOAL-11/14…" :: `expected { state: 'waiting', …(3) } to match object { state: 'completed' }`; "GOAL-14 retry…" :: same; "A7-G2…" :: `expected 'waiting' to be 'completed'`; "G-04 and GOAL-29…" :: `AssertionError: [["advance",null,null],…]`; "A7-G4b (G-05)…" :: `expected 'waiting' to be 'completed'`; "A7-G4b contrast…" :: `expected 'waiting' to be 'completed'`; "A7-G5…" :: `expected 'waiting' to be 'completed'`; "G-04 and G-06…" :: `AssertionError: [["advance",null,null],…]`; "§2.3 step 2…" :: `expected 'waiting' to be 'completed'`; "GOAL-29 after a person's 继续…" :: `expected 'waiting' to be 'completed'`
   - `tests/scenarios/A8-host-restart-entry.test.ts (8 | 7)`: A8-2a/A8-1c, A8-2a queued cancel, A8-2b L-2/L-1, A8-2b SES-07, A8-2c, A8-1b, A8-1a :: each first line `AssertionError: expected 'waiting' to be 'stopped'`
   - `tests/scenarios/A8-host-restart-paused.test.ts (6 | 5)`: "A8-3l, A8-3p…" :: `expected { ref: …, …(13) } to match object { effectivePhase: 'satisfied' }`; "A8-3n…" :: `Error: timed out waiting for the start-up re-drive to complete the Goal: {…"auto_rework_pending"…}`; "A8-3q, A8-3o…" :: `effectivePhase: 'satisfied'`; "a Run paused at a safe point…" :: `AssertionError: [["advance",null,null],…]`; "LA-1 and contract (e)…" :: `Error: the continuation r2 must be claimed`
   - `tests/scenarios/A8-host-restart.test.ts (12 | 3)`: "A8-3a…" :: `expected 'waiting' to be 'completed'`; "§12.1 step 6b (LA-6, W-01)…" :: `AssertionError: the start-up re-drive completed the Task without a workflow/advance: … 'satisfied'`; "§12.1 step 6b (a)…" :: `AssertionError: the start-up re-drive completed the Goal without a workflow/advance: … 'COMPLETED'`
   - `tests/scenarios/C3-brief-idempotency.test.ts (4 | 4)`: C3-R1 (W-24), C3-R1 source changed, C3-R2 (W-25) host_config, C3-R2 (W-25) transient read :: each `AssertionError: expected 'waiting' to be 'stopped'`
   - `tests/scenarios/C3-not-entered-chain.test.ts (1 | 1)`: "C3 (D-7, factsFrom)…" :: `expected 'waiting' to be 'stopped'`
   - `tests/scenarios/C3-paused-continue-brief.test.ts (1 | 1)`: "C3/C4…" :: `expected 'waiting' to be 'completed'`
   - `tests/scenarios/C3-reply-other-session.test.ts (3 | 3)`: P17 same Session :: `expected 'waiting' to be 'completed'`; P17 other Session :: `expected 'waiting' to be 'completed'`; P17 another Task's Session :: `expected [ 'claim_task', 'prepare', …(3) ] to deeply equal ArrayContaining{…}`
   - `tests/scenarios/C3-workspace-changed.test.ts (1 | 1)`: "C3 (GAP-49)…" :: `expected 'waiting' to be 'stopped'`
   - `tests/scenarios/C5-gate-fix-open.test.ts (1 | 1)`: "C5 gate fix while the gate round is open…" :: `Error: the Workflow must reach the gate open`
   - `tests/scenarios/C5-gate-fix.test.ts (2 | 2)`: "C5 gate fix (§15.2 5.9…)…" :: `Error: the Workflow must reach the gate open`; "C5 control…" :: `Error: the Workflow must reach the gate open`
   - `tests/scenarios/C8-auto-rework-cap.test.ts (1 | 1)`: "C8 (§13.4 #15…)…" :: `expected 'waiting' to be 'stopped'`
   - `tests/scenarios/C8-human-stop-respected.test.ts (7 | 2)`: "AV-4 (STEP5-FLIPS §14)…" :: `AssertionError: expected [ 'open_checks', 'run_check' ] to deeply equal [ 'open_checks', 'run_check', …(3) ]`; "VR-14 step 5…" :: `Error: the round must finalize`
   - `tests/scenarios/S1-archive-restart.test.ts (6 | 1)`: "IT19 (request committed)…" :: `expected 'waiting' to be 'completed'`
   - `tests/scenarios/S5-goal-conflict-rework.test.ts (1 | 1)`: SC02 :: `expected 'waiting' to be 'stopped'`
   - `tests/scenarios/WP1-wiring.test.ts (2 | 2)`: SC01 :: `expected 'waiting' to be 'completed'`; SC02 :: `expected 'waiting' to be 'completed'`
   - `tests/state/invariants-fuzz.test.ts (13 | 1)`: "coverage: every kind of operation the row lists actually ran…" :: `AssertionError: kinds that never ran: expected [ '起检 begin check', …(10) ] to deeply equal []`
   - `tests/state/invariants.test.ts`: collection error (29 tests skipped), first line `Error: requeue 1: {"status":"rejected","code":"busy","reason":"finalize_first: round … is open"}`
   - `tests/work-graph/S5R2-queue-history.test.ts (21 | 7)`: R2A01 (memory) :: `expected [ { ref: …, revision: 2 } ] to deeply equal …`; R2A01 (sqlite) :: same; R2A02 (memory) :: same; R2A02 (sqlite) :: same; R2A07 (memory) :: `expected { status: 'ready', value: { …(11) } } to match object { Object (status, code) }`; R2A07 (sqlite) :: same; R2A09 (memory only) :: same
6. `sha256sum <34 frozen files>` → all 34 match section 3 exactly (`diff` empty).
7. `git status --short | wc -l` → `103`.

## UNSPECIFIED
- **G1 — done.** `resolveDecision` now calls the settings owner's new read-only `readGoalConflictReplay` before any current-fact read (`src/business/workflow/decision-actions.ts:266-288`), which looks up the exact `${requestId}:settings` receipt with the same identity/fingerprint as `resolveGoalConflict` (`src/core/work-graph/tasks/goal-settings-service.ts:533-541`, `:552-579`, exposed at `:914`); `relevant pins`/`replayExpectedPins` (`decision-actions.ts:159-179`); only `absent` falls through to the existing supplementary reads + `resolveGoalConflict`; a rejection returns `ready` with the failure in `action` (not absence). R2C01–R2C08 all pass.
- Not added: the optional `readGoalConflictReplay` method on the shared `GoalSettingsPort` interface (`src/core/work-graph/model/decision-contracts.ts`), because that file is outside this area's write scope; the concrete service exposes it and `decision-actions.ts` reaches it through a local structural type. A future wrapper that rebuilds a `GoalSettingsPort` literal would silently drop it (today `create-platform.ts` passes the raw service object, so production reach is real and `production-reach.test.ts` passes).
- Retained pre-G1 path: the `captured === null` compatibility branch (`decision-actions.ts:289-314`) still reads the source/pins before any receipt lookup; it is unreachable for slice-5 answers (they always carry the captured source), so no frozen test covers it.
- The named run's `tests/app/AG2b-collaboration.test.ts` failures are `Error: Test timed out in 30000ms.` rather than the message the brief lists (`STACK_TRACE_ERROR`); same file, same count (2), same missing-`/usr/bin/bwrap` root cause (the Kernel ProcessSandbox profile is unavailable, so the run never settles).
- No frozen test contradicts a correction; no new tests or test edits.

## NOTES
- Subagents: 1 implementation (G-1) + 1 read-only review (G-1) = 2; review verdict DONE, no new defects, no contradictions.
- The review could not run `git diff slice-base -- <files>` because both files are untracked in `slice-base`; it reviewed current content instead.
- All `Tests` totals, per-file failure counts, and the 103-path `git status` match the brief's expected sandbox state exactly; every area file (7) passes except the one expected bwrap scenario.
- `.dsh-scratch/` deleted; no commit (`git log` still one commit); no test file touched (34 hashes verified).