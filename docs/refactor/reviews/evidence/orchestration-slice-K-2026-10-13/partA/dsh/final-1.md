**FILES CHANGED:**
- src/business/workflow/contracts.ts
- src/business/workflow/session-maintenance.ts
- src/business/workflow/workflow.ts
- src/composition/create-platform.ts
- src/contracts/continuation-brief.ts
- src/core/agent-runtime/context-assembler.ts
- src/core/agent-runtime/continuation-brief-assembly.ts
- src/core/agent-runtime/contracts.ts
- src/core/agent-runtime/execution-contracts.ts
- src/core/agent-runtime/execution-observation.ts
- src/core/agent-runtime/ports.ts
- src/core/agent-runtime/query-observation.ts
- src/core/agent-runtime/run-reconcile.ts
- src/core/agent-runtime/runtime.ts
- src/core/agent-runtime/session-operations.ts
- vendor/coding-agent/dist/app/composition/composition-contracts.d.ts
- vendor/coding-agent/dist/app/composition/composition-contracts.d.ts.map
- vendor/coding-agent/dist/app/composition/composition-contracts.js
- vendor/coding-agent/dist/app/composition/composition-contracts.js.map
- vendor/coding-agent/dist/core/ports/session_store/session-history.d.ts.map
- vendor/coding-agent/dist/core/ports/session_store/session-history.js
- vendor/coding-agent/dist/core/ports/session_store/session-history.js.map
- vendor/coding-agent/dist/core/ports/session_store/session-store-port.d.ts
- vendor/coding-agent/dist/core/ports/session_store/session-store-port.d.ts.map
- vendor/coding-agent/dist/core/runtime/events/agent-events.d.ts
- vendor/coding-agent/dist/core/runtime/events/agent-events.d.ts.map
- vendor/coding-agent/dist/core/runtime/events/agent-events.js
- vendor/coding-agent/dist/core/runtime/events/agent-events.js.map
- vendor/coding-agent/dist/core/runtime/reducer/run-state-reducer.d.ts.map
- vendor/coding-agent/dist/core/runtime/reducer/run-state-reducer.js
- vendor/coding-agent/dist/core/runtime/reducer/run-state-reducer.js.map
- vendor/coding-agent/dist/core/runtime/state/run-state.d.ts
- vendor/coding-agent/dist/core/runtime/state/run-state.d.ts.map
- vendor/coding-agent/dist/core/runtime/state/run-state.js
- vendor/coding-agent/dist/core/runtime/state/run-state.js.map
- vendor/coding-agent/dist/public-api.d.ts
- vendor/coding-agent/dist/public-api.d.ts.map
- vendor/coding-agent/dist/public-api.js
- vendor/coding-agent/dist/public-api.js.map
- vendor/coding-agent/dist/storage/adapters/sqlite/sqlite-stores.d.ts
- vendor/coding-agent/dist/storage/adapters/sqlite/sqlite-stores.d.ts.map
- vendor/coding-agent/dist/storage/adapters/sqlite/sqlite-stores.js
- vendor/coding-agent/dist/storage/adapters/sqlite/sqlite-stores.js.map
- vendor/coding-agent/patches/app/composition/composition-contracts.ts
- vendor/coding-agent/patches/core/ports/session_store/session-history.ts
- vendor/coding-agent/patches/core/runtime/events/agent-events.ts
- vendor/coding-agent/patches/core/runtime/reducer/run-state-reducer.ts
- vendor/coding-agent/patches/core/runtime/state/run-state.ts
- vendor/coding-agent/patches/public-api.ts
- vendor/coding-agent/patches/storage/adapters/sqlite/sqlite-stores.ts
- tests/app/K-R-runtime-capabilities.test.ts (new)
- tests/composition/K-R-close-open-turn.test.ts (new)
- tests/helpers/K-session-support.ts (new)
- tests/kernel/K-close-open-turn.test.ts (new)
- tests/kernel/K-interrupted-history.test.ts (new)
- tests/scenarios/K-R-interrupted-brief.test.ts (new)
- tests/scenarios/K-W-fallback.test.ts (new)
- tests/scenarios/K-W-maintenance.test.ts (new)
- tests/scenarios/K-W-workflow-close.test.ts (new)

**ROWS:**
- KA-01 | tests/kernel/K-close-open-turn.test.ts "KA-01 closes an open Turn by appending run.interrupted…" | RED `TypeError: closeOpenTurn is not a function` | vendor/…/sqlite-stores.ts:closeOpenTurn + run-state.ts/agent-events.ts/run-state-reducer.ts `run.interrupted` + public-api.ts
- KA-02 | "KA-02 returns the table's row 1-4 and 6 results…", "KA-02 cuts a non-last Turn's bounds at the next turn.started…" | RED `Error: KA-02: terminal close results not implemented` (seam stub); fix RED `expected endPosition 6 / "completed", received null/null` | sqlite-stores.ts:readTurnBounds/closeOpenTurn
- KA-03 | "KA-03 closes created, running … and paused Turns…" | RED `AssertionError: expected { status: 'unreadable', …(1) } to match object { status: 'closed' }` | vendor/…/run-state-reducer.ts:terminalState
- KA-04 | "KA-04 refuses a new Turn while the Kernel Turn is open…" | RED `AssertionError: expected [ 'question-A', 'question-B', …(2) ] to deeply equal [ 'question-A', 'question-C', …(1) ]` | vendor/…/session-history.ts:TERMINAL_EVENT_TYPES + skip interrupted content
- KA-05 | "KA-05 keeps the boundaries right…", "KA-05 drops the interrupted Turn's assistant message and tool process…" | RED `StoreError: throughPosition 5 之前没有已完成轮次`; fix RED leaked `process-B`/`call-B`/`tool-output-B` | vendor/…/session-history.ts:341-353
- KA-06 | "KA-06 replays an interrupted identity straight to its terminal…" | RED `ReducerError: status_disallows_event: 当前 State 不能终止` | vendor/…/run-state.ts:293 (`interrupted` terminal)
- KA-07 | tests/scenarios/K-W-workflow-close.test.ts "KA-07 (KE3, L4/L7)…" | RED `AssertionError: expected [ 'create_session', 'transfer_responsibility', 'claim_task' ] to include 'close_open_turn'` | src/business/workflow/workflow.ts:1070/1734
- KA-08 | "KA-08 (KE3, L9)…", "KA-08 (KE3, L9 second clause)…" | RED same missing-close (message text not delivered) | workflow.ts:1734
- KA-09 | tests/scenarios/K-R-interrupted-brief.test.ts (8 tests) + tests/scenarios/K-W-workflow-close.test.ts "KA-09 flow half…" | RED `expected 'running' to be 'interrupted'` (R); flow-half RED `expected [ 'prepare' ] to include 'claim_task'` | src/core/agent-runtime/continuation-brief-assembly.ts:readPreviousTurn/stoppedAtOf; src/contracts/continuation-brief.ts:TURN_STATUSES; workflow.ts:1750
- KA-10 | tests/scenarios/K-W-maintenance.test.ts "KA-10 (KE3, L7/KA1)…", "KA-10 (KE3, L7): a human-paused RUN-24 line…" | RED missing-close before R landed; RUN-19/RUN-24 GREEN after | src/business/workflow/session-maintenance.ts:414/436/605
- KA-11 | "KA-11 (a)…", "KA-11 (b)…", "KA-11 (c)…" | RED `expected undefined to match object { result: { status: 'closed' } }` (c, pre-R); (a)/(b) first-run GREEN | workflow.ts:1734 + select reuse
- KA-12 | tests/composition/K-R-close-open-turn.test.ts (10) + tests/scenarios/K-W-workflow-close.test.ts "KA-12 (KE4, L8, M2)…" | RED `createAgentRuntime(...).port.closeOpenTurn` undefined (missing member) | src/core/agent-runtime/runtime.ts:createCloseOpenTurn
- KA-13 | tests/scenarios/K-W-fallback.test.ts "KA-13 (KE4, L6/L8)…" | RED `expected [ 'prepare' ] to include 'transfer_responsibility'` (setup) | workflow.ts:751 hasContinuationForTask + fallback branch
- KA-14 | "KA-14 … decision 45/51", "KA-14 … second phase" | RED `health 'available'` vs `'unavailable'` (fixture); 2nd phase RED `Error: the continuation Run must be selected` | session-maintenance.ts:436
- KA-15 | "KA-15 (KE3, L7): a concurrent Kernel revision change…" | first run GREEN (was a missing pin) | workflow.ts:1749 conflict→waiting + :1734
- KA-16 | tests/scenarios/K-W-fallback.test.ts "KA-16 (KE3, L10)…" | GREEN first run (condition 2: no Work Run) | session-maintenance.ts:436
- KA-17 | tests/app/K-R-runtime-capabilities.test.ts "KA-17 reports that a Work line continues in the same Session…" | RED `expected 'a continuation is a new Run, never a …' to contain 'For a Work line the platform closes i…'` | src/composition/create-platform.ts:workspaceRuntimeCapabilities (M6)

**CHECKS:**
1. `npm run typecheck` — exit 0.
2. `npm run check:architecture` — exit 0.
3. `npm run build` — exit 0.
4. `node scripts/build-kernel-patch.mjs --check` — exit 0 (56/56 artifacts match).
5. `npx vitest run tests/kernel` — exit 0; `Test Files 6 passed (6)`; `Tests 49 passed (49)`.
6. `npx vitest run <14 frozen + tests/{kernel,scenarios,composition,app}/K->` — exit 1; `Test Files 10 failed | 12 passed (22)`; `Tests 47 failed | 106 passed (153)`. Section C: 10/10 flips pass. All 47 failures = baseline §B(35)+§D(12); NEW = 0.
   - tests/scenarios/A4-duplicate-receipts.test.ts [baseline §B] ×4: `A4 (领取、发信、记录结果)…` → `AssertionError: expected 'waiting' to be 'completed'`; `A4, W-23…` → `expected 'waiting' to be 'stopped'`; `A4, C-05…` → `expected 'waiting' to be 'stopped'`; `A4 (记录结果)…` → `expected 'waiting' to be 'completed'`.
   - tests/scenarios/A7-control-goal29.test.ts [baseline §D] ×2: `A7-G4 with history (closing supported…)` and `(closing unsupported…)` → `AssertionError: expected 'waiting' to be 'completed'`.
   - tests/scenarios/A7-control.test.ts [baseline §B]×13: `A7 entered Run…`, `A7 yielded wait…`, `goals/control pause, then resume…`, `GOAL-11/14 with a live Kernel Turn…`, `GOAL-14 retry…`, `A7-G2…`, `A7-G4b (G-05)…`, `A7-G4b contrast…`, `A7-G5 (§12.10 order)…`, `§2.3 step 2…`, `GOAL-29 after a person's 继续…`, `G-04 and G-06 at a restart…` → `expected 'waiting' to be 'completed'`; `VD-9…` → `expected 'ENOENT…access /usr/bin/bwrap' to contain 'the Goal is paused…'`. [baseline §D]×1: `G-04 and GOAL-29…` → trace includes `close_open_turn` then `["waiting","ENOENT…'/usr/bin/bwrap'","run_check"]` vs `completed`.
   - tests/scenarios/A8-host-restart-entry.test.ts [baseline §B]×7: `A8-2a, A8-1c…`, `A8-2a with a queued cancel…`, `A8-2b, L-2, L-1…`, `A8-2b, SES-07, SES-19, H-01…`, `A8-2c…`, `A8-1b…`, `A8-1a requeue variant…` → `AssertionError: expected 'waiting' to be 'stopped'`.
   - tests/scenarios/A8-host-restart-lease.test.ts [baseline §B]×2: `A8-Q2…` → `expected { ref… } to match object { effectivePhase: 'satisfied' }`; `A8-H4…` → `expected 'waiting' to be 'completed'`.
   - tests/scenarios/A8-host-restart-paused.test.ts [baseline §D]×6: `A8-3l, A8-3p…` → `{ref…} vs {effectivePhase:'satisfied'}`; `A8-3n (closing supported)…` and `(closing unsupported)…` → `Error: timed out waiting for the start-up re-drive to complete the Goal: {…"auto_rework_pending","operation":"requeue","failureClass":"interrupted"…}`; `a Run paused at a safe point…` → `close_open_turn` then `["waiting","ENOENT…'/usr/bin/bwrap'","run_check"]` vs `completed`; `LA-1 and contract (e) (closing supported)…` and `(unsupported)…` → `Error: the continuation r2 must be claimed`. [baseline §B]×1: `A8-3q, A8-3o…` → `{ref…} vs {effectivePhase:'satisfied'}`.
   - tests/scenarios/A8-host-restart.test.ts [baseline §B]×2: `A8-3a…` → `expected 'waiting' to be 'completed'`; `§12.1 step 6b (LA-6, W-01)…` → `completed the Task without a workflow/advance: {ref…} vs {effectivePhase:'satisfied'}`. [baseline §D]×1: `§12.1 step 6b (a), W-11…` → `completed the Goal without a workflow/advance: {phase:'RUNNING'} vs {phase:'COMPLETED'}`.
   - tests/scenarios/C3-paused-continue-brief.test.ts [baseline §B]: `C3/C4…` → `expected 'waiting' to be 'completed'`.
   - tests/scenarios/WP1-wiring.test.ts [baseline §D]×2: `SC01 (closing supported; KA-07)…`, `SC01 (closing unsupported)…` → `expected 'waiting' to be 'completed'`. [baseline §B]×1: `SC02 operator archive-line(drop)…` → `expected 'waiting' to be 'completed'`.
   - tests/scenarios/harness.test.ts [baseline §B]×4: `host mode…` → `expected [Array(6)] to deeply equal ArrayContaining{…}`; `host mode crash…` → `expected ['requeue_task','claim_task',…(4)] to deeply equal ArrayContaining{…}`; `platform mode…` → `expected [] to deeply equal ['PASS']`; `platform mode seams…` → `expected 'waiting' to be 'stopped'`.
   - All 8 new K- files pass (42 tests); no K- test fails with the sandbox kind.
7. `npx vitest run` — exit 1; `Test Files 47 failed | 240 passed (287)`; `Tests 135 failed | 5856 passed | 29 skipped (6020)`; plus the known baseline failed suite `tests/state/invariants.test.ts` (`Error: requeue 1: {"status":"rejected","code":"busy","reason":"finalize_first: round ea9d99a3-… is open"}`). Counts: §A=88, §B=35, §D=12, NEW=0; every one of the 135 prefix-matches a baseline bullet 1:1. The §B/§D set is identical to command 6. §A failures (all sandbox kind; file [count] → first line):
   - tests/app/A2-automation-verdict.test.ts [2]: `C8 (§15.2 5.8)…` → `Error: the Workflow stopped before finalize_checks: {…ENOENT…'/usr/bin/bwrap'…}`; `§15.2 5.9 (AV-7d, C5)…` → `expected {state:'waiting'} to match {state:'advance'}`.
   - tests/app/A2-requeue-route.test.ts [1]: `tasks/requeue and executions/brief…` → `{ref…} vs {effectivePhase:'failed'}`.
   - tests/app/A2-reverify-route.test.ts [1]: `verification/reverify…` → `expected 'waiting' to be 'stopped'`.
   - tests/app/AG2b-collaboration.test.ts [2]: `releases a busy B…` and `reopens read-only…` → `Error: Test timed out in 30000ms`.
   - tests/app/MVP-workbench-tools.test.ts [1]: `retains real output…` → `expected {status:'rejected'} to match {status:'ready'}`.
   - tests/app/R6-host.test.ts [1]: `loads a real startup JSON…` → `expected 'waiting' to be 'completed'`.
   - tests/app/change-emitters.test.ts [1]: `announces settled…` → `Error: echo did not start: {"status":"rejected","code":"unsupported","reason":"…ProcessSandbox profile is not available…"}`.
   - tests/app/orchestration-mechanism.test.ts [1]: `runs two explicitly selected same-Goal Tasks…` → `Error: Task parallel-left stopped: {…ENOENT…'/usr/bin/bwrap'…}`.
   - tests/business/R5b-initial-planning-workflow.test.ts [1]: `consumes the answer…` → `the adopted Plan must reach a formal Goal completion: expected 'waiting' to be 'completed'`.
   - tests/composition/A2-requeue-platform.test.ts [5]: `D-3…`, `§4.3 / §4.4…`, `W-21 / C3…` → `{ref…} vs {effectivePhase:'failed'}`; `TASK-03 (§4.3)…`, `C3 (§6.1 (e)…)…` → `Error: requeue: {"status":"rejected","code":"busy","reason":"finalize_first: round … is open"}`.
   - tests/composition/A2-reverify-platform.test.ts [1]: `C5 (§15.2 5.9, VR-14/15, TASK-29)…` → `Error: the round must finalize`.
   - tests/composition/A2-verification-chain-platform.test.ts [6]: `VR-01..VR-07…`, `VD-7…` (adoption while Run in Kernel) → `expected 'waiting' to be 'stopped'` / `{stopped:null,…} vs {state:'completed'}`; `VD-7: future adoptions…` → `Error: work-1 must reach its completion`; `VR-05 (VD-6)…`, `VD-8…` → `{status:'ready',…} mismatch`; `VD-15…` → `Error: the Workflow must reach the gate check`.
   - tests/composition/R3e-command-check-platform.test.ts [2]: `executes the fixed commands…` → `registered check r3e-pass must return the persisted view: {status:'rejected'} vs {status:'ready'}`; `collapses a concurrent fresh run…` → `at least one request observes the run: expected false to be true`.
   - tests/composition/R3e-completion-platform.test.ts [1]: `runs the real registered checks…` → `registered check r3e-pass must reach the persisted round view: {status:'rejected'} vs {status:'ready'}`.
   - tests/composition/R5c-workflow-platform.test.ts [3]: `advances two works and 'the Goal gate'…`, `…'a stage gate then the Goal gate'…` → `the adopted Plan must reach a formal Goal completion (settled: ENOENT…bwrap): expected 'waiting' to be 'completed'`; `resumes the original verification round…` → `the original check runs to a persisted finished window: {status:'ready',…} mismatch`.
   - tests/scenarios/A1-rework-same-session.test.ts [1]: `A1 (C8, §15.2 5.8, AV-12, W-21, L-3, C3)…` → `expected 'waiting' to be 'stopped'`.
   - tests/scenarios/A10-check-recovery.test.ts [6]: `A10-R1…` → `{ref…} vs {status:'finalized'}`; `VR-04 (C-01)…`, `A10-R5, A10-R4…`, `A10-R5, C-06, A10-R4…`, `A10-R2…` → `Error: timed out waiting for the check to begin: 0`; `A10-R6…` → `expected 'waiting' to be 'completed'`.
   - tests/scenarios/A11-no-progress.test.ts [7]: `§13.4 #15/#21…` → `{state:'waiting',…} vs {state:'waiting',next:null,…}`; `A11 #2, #25…`, `A11 #15…`, `A11 #7, #8…`, `A11 #4…` → `expected [] to deeply equal ['FAIL',…]`; `A11 #14 (ND-4), #6 (L-4)…`, `A11 #1, #3, #10 (ND-3), #5, #11…` → `expected 'waiting' to be 'stopped'`.
   - tests/scenarios/A8-host-restart-rework.test.ts [2]: `A8-R1…` → `expected 'waiting' to be 'stopped'`; `A8-R2…` → `expected [] to have a length of 1 but got +0`.
   - tests/scenarios/C3-brief-idempotency.test.ts [4]: `C3-R1 (W-24)…`, `C3-R1 (W-24) with the source changed…`, `C3-R2 (W-25)…`, `C3-R2 (W-25) with a transient Kernel read…` → `expected 'waiting' to be 'stopped'`.
   - tests/scenarios/C3-not-entered-chain.test.ts [1]: `C3 (D-7, factsFrom)…` → `expected 'waiting' to be 'stopped'`.
   - tests/scenarios/C3-reply-other-session.test.ts [3]: `C3 (P17, same Session)…`, `C3 (P17, other Session)…` → `expected 'waiting' to be 'completed'`; `C3 (P17, another Task's Session)…` → `expected ['claim_task','prepare',…] to deeply equal ArrayContaining{…}`.
   - tests/scenarios/C3-workspace-changed.test.ts [1]: `C3 (GAP-49)…` → `expected 'waiting' to be 'stopped'`.
   - tests/scenarios/C5-gate-fix-open.test.ts [1]: `C5 gate fix while the gate round is open…` → `Error: the Workflow must reach the gate open`.
   - tests/scenarios/C5-gate-fix.test.ts [2]: `C5 gate fix…`, `C5 control…` → `Error: the Workflow must reach the gate open`.
   - tests/scenarios/C5-reverify-guards.test.ts [5]: `(a) verification_uncovered…` → `expected 'waiting' to be 'stopped'`; `(a)/(b) §13.7 / LA-4…` → `Error: the round must finalize`; `(b) a timed-out check…` → `Error: the Workflow must request re-verification 1`; `(c) not_started…` → `expected [] to deeply equal [Array(4)]`; `(d) VR-03…` → `expected undefined to match object {result:{…}}`.
   - tests/scenarios/C6-unrelated-adoption.test.ts [5]: `C6 main path…`, `C6 variant W-01…`, `C6 variant RUN-03…` → `expected 'waiting' to be 'completed'`; `C6: an unrelated adoption after the claim…`, `C6 (W-01 note)…` → `{stopped:null,…} vs {state:'completed'}`.
   - tests/scenarios/C7-defer-reactivate.test.ts [3]: `C7 defer and reactivate…`, `C7 interleavings…`, `C7 races with a commit barrier…` → `expected false to be true`.
   - tests/scenarios/C7-supersede-failed-task.test.ts [3]: `C7 main path (adopter: agent)…`, `(adopter: operator)…` → `{receipts:[…],…} vs {state:'waiting',…}`; `C7 supersede…` → `expected 'waiting' to be 'completed'`.
   - tests/scenarios/C8-auto-rework-cap.test.ts [1]: `C8 (§13.4 #15, AV-8, GOAL-30)…` → `expected 'waiting' to be 'stopped'`.
   - tests/scenarios/C8-budget.test.ts [1]: `AV-11, §13.4 #19…` → trace ends `["waiting","ENOENT…'/usr/bin/bwrap'","run_check"]` vs `completed`.
   - tests/scenarios/C8-human-stop-respected.test.ts [2]: `AV-4 (STEP5-FLIPS §14)…` → `expected ['open_checks','run_check'] to deeply equal ['open_checks','run_check',…]`; `VR-14 step 5…` → `Error: the round must finalize`.
   - tests/scenarios/S1-archive-restart.test.ts [1]: `IT19 (request committed)…` → `expected 'waiting' to be 'completed'`.
   - tests/scenarios/S5-goal-conflict-rework.test.ts [1]: `SC02 two Goals conflicting on module M…` → `expected 'waiting' to be 'stopped'`.
   - tests/state/invariants-fuzz.test.ts [1]: `coverage: every kind of operation…` → `kinds that never ran: expected ['起检 begin check',…] to deeply equal []`.
   - tests/work-graph/A2-verification-chain.test.ts [8]: memory/sqlite `VR-05 (VD-6)…`, `VR-13…`, `VD-10…` → `{status:'rejected',…} vs {status:'rejected'/'ready',…}`; memory/sqlite `§9.3 Workflow order…` → `{state:'waiting',…} vs {state:'waiting',next:null,…}`.
8. `sha256sum DSH-BASELINE.md <spec> <14 tests>` — exit 0; all 16 exact (DSH-BASELINE.md `94a495a7…`; spec `b030a7f8…`; the 14 test files as in section 3).
9. `git diff --stat slice-base -- tests` — exit 0; output empty.
10. `git status --short` — exit 0; exactly the 59 L-scope paths above (15 src, 7 patch sources, 35 generated dist, 9 untracked K test/helper); HEAD still `97a0c00`; no staged files; no commit; `.dsh-scratch/` absent.

**UNSPECIFIED:**
- L1 done (vendor/…/events/agent-events.ts:220, union :249; run-state.ts:28/99/293; run-state-reducer.ts:83-114). L2 done (sqlite-stores.ts:771/797; `closeOpenTurn` now calls `readTurnBounds` internally, so the export is reached from production). L3 done (session-history.ts:29/341-353/383-399). L4 done (src/core/agent-runtime/runtime.ts:183-283, plus fail-closed :130/156). L5 done (runtime.ts:167-181; create-platform.ts:853). L6 done (workflow.ts:1742-1764; session-maintenance.ts:451-466). L7 done (session-maintenance.ts:604-605; workflow.ts:1082/1734). L8 done (runtime.ts:269-276; workflow.ts:1753-1758). L9 done differently (continuation-brief-assembly.ts:154-235 uses the owner's `readPositionWindow` + reducer, not Kernel `readTurnBounds`; behaviour matches; M2's call-time `readTurnBounds` is not exercised by the Runtime op — reach is transitive through `closeOpenTurn`). L10 done (workflow.ts:1072-1084; session-maintenance.ts:442). L11 done (create-platform.ts:273-326). M1–M6 done (see L4/L5/L9/L11; M4 at src/core/agent-runtime/contracts.ts:5; M5 at src/contracts/continuation-brief.ts:114/622; M6 verbatim at create-platform.ts:273-293). M7 done for row assertions (no DB/record-store read to verify; harness use below). M8 done (existing revision conflict; no new test).
- KA-05's third refusal ("current Turn identity overlaps a skipped Turn") is **not realizable through the public KE2 entry**: same runId+turnId past the closure is also rejected by `assertSameExecutionContent`, a new runId+same turnId collides on `turn:<turnId>` (`idempotency_conflict`), and only an inconsistent `turn.started` whose `contextBasis.throughPosition` points past its own closure could isolate the guard. Guard retained (session-history.ts:389-399); no public seam exists to pin it.
- `readTurnBounds` on a Session that does not exist returns `unreadable` (the store read fails); the spec does not say whether a missing Session should instead be `not_found`.
- KA-12's literal L2 row-5 "another Run at the head" is unreachable through legal Kernel appends (spec calls it defensive and not required to test); KA-12 covers the reachable `mismatch` causes and maps Kernel `not_found` to `mismatch`.
- L4 does not name the "successor enumeration unusable" case; the Runtime maps it to retryable `transient` (no close, no duplicate-creating fallback) rather than `unreadable`.
- For an interrupted Turn the brief drops `stoppedAt.lastAssistant` (transcript text) but keeps `stoppedAt.lastToolGroup` (a tool-fact pointer) and `toolCalls`; if rule 3 is read as also forbidding `lastToolGroup`, that is a one-line follow-up.
- M7 harness interpretation: the K-W maintenance tests call the shared scenario harness (`driveChecked`→`assertInvariantsAt`→`readInvariantWorld`), which is the standard §11 machinery for KE3/KE4; the new test bodies add no direct `readSqlite`/`kernelSnapshot`/`kernelTurnOf`/`readInvariantWorld` call (verification via `executions/read`, `executions/brief`, `tasks/query`).
- KA-10's RUN-23 clean close is cited from the frozen `tests/scenarios/A8-host-restart.test.ts` W-12; KA-10's other cases (handoff_complete, handover-incomplete zero-write, archive-request, legacy-unresolved) are exercised by the frozen S1/WP1 business tests. KA-14's unknown-outcome bucket is pinned at KE1 (K-R-interrupted-brief KA-09) because a started-but-unfinished tool call is not producible at KE3.
- No existing or frozen test was found to contradict the spec.

**NOTES:**
- Subagents (11): Group K implementer; Group R; Group W; Group I integration; 3 read-only reviewers (K/R/W); Group K fixer; Group R fixer; Group W fixer; final Group I verifier. All reported; no subagent left running.
- Serializable waves were used (K → R → W → final I) to avoid cross-group test flakes from concurrent dist/src edits.
- Group K's first pass had touched src/core/agent-runtime/contracts.ts (M4 one-liner) across the group boundary; Group R validated and now owns it.
- `.dsh-scratch/` deleted; no git write commands, no commit; HEAD = `97a0c00` (slice-base).
- No NEW failures: 47 count-6 failures = §B 35 + §D 12; full suite 135 = §A 88 + §B 35 + §D 12; the 10 section-C flips all pass; 42 new K tests all pass.
- No K- test needs a registered check or a real sandboxed command; all pass without bubblewrap.
- Every section-D stop is downstream of the missing `/usr/bin/bwrap` run_check or the un-runnable registered check, never on a K assertion; four of them now advance past the baseline stop through `close_open_turn`.
- typecheck baseline 10 errors (WorkflowCalls.close_open_turn) resolved; build/kernel-patch/architecture all exit 0.
- 16/16 frozen sha256 exact; `git diff slice-base -- tests` empty; status only L-scope.
- Blockers: none.