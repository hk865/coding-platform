FILES CHANGED:
`src/business/workflow/workflow.ts`
`src/core/work-graph/communication/decision-service.ts`
`src/core/work-graph/communication/decision-source-facts.ts`
`src/core/work-graph/communication/mailbox-service.ts`
`src/core/work-graph/state/decision-policy.ts`
`src/core/work-graph/tasks/goal-decision-reader.ts`
`src/core/work-graph/tasks/plan-service.ts`

CHECKS:

`npm run typecheck` → exit 0.
`npm run check:architecture` → exit 0 (`next source boundaries: OK`).
`npm run build` → exit 0 (`workbench build: published …`).

Area run (`npx vitest run` the 17 section-8 files) → `Test Files 2 failed | 15 passed (17)`, `Tests 8 failed | 237 passed (245)`. Two failing files, all bwrap-kind:
- `tests/scenarios/A11-no-progress.test.ts` (7):
  - `§13.4 #15/#21, AV-8/AV-9, GOAL-27/30: the cap stops the automation…` :: `AssertionError: expected { state: 'waiting', …(3) } to match object { state: 'waiting', next: null, …(1) }`
  - `A11 #2, #25, #21 (不改文件), #22, ND-3, #20: the same failure twice stops at refusal @1…` :: `AssertionError: expected [] to deeply equal [ 'FAIL', 'FAIL' ]`
  - `A11 #14 (ND-4), #6 (L-4): a Run that changed an unrelated file…` :: `AssertionError: expected 'waiting' to be 'stopped' // Object.is equality`
  - `A11 #15: an automatic requeue past the limit…` :: `AssertionError: expected [] to deeply equal [ 'FAIL', 'FAIL' ]`
  - `A11 #1, #3, #10 (ND-3), #5, #11: the first requeue passes…` :: `AssertionError: expected 'waiting' to be 'stopped' // Object.is equality`
  - `A11 #7, #8: c1 turning PASS while c2 FAILs…` :: `AssertionError: expected [] to deeply equal [ 'FAIL' ]`
  - `A11 #4: a message its recipient has answered…` :: `AssertionError: expected [] to deeply equal [ 'FAIL', 'FAIL' ]`
- `tests/scenarios/C8-auto-rework-cap.test.ts` (1): `C8 (§13.4 #15, AV-8, GOAL-30): three automatic requeues…` :: `AssertionError: expected 'waiting' to be 'stopped' // Object.is equality`

Named run (`npx vitest run` the 131 section-8 files) → `Test Files 24 failed | 107 passed (131)`, `Tests 69 failed | 3721 passed | 29 skipped (3819)`; `NAMED_EXIT=1`. Every failing file and its tests (all bwrap/process-sandbox-kind; no other message class):
- `tests/app/AG2b-collaboration.test.ts` (2): `releases a busy B, runs two wait rounds…` :: `Error: Test timed out in 30000ms.`; `reopens read-only over the original messages/Query/history…` :: `Error: Test timed out in 30000ms.`
- `tests/app/change-emitters.test.ts` (1): `announces settled, and stopping once before settled for a stopped command` :: `Error: echo did not start: {… "the Kernel ProcessSandbox profile is not available; no host shell fallback"}`
- `tests/app/orchestration-mechanism.test.ts` (1): `runs two explicitly selected same-Goal Tasks…` :: `Error: Task parallel-left stopped: {… "reason":"ENOENT: no such file or directory, access '/usr/bin/bwrap'"}`
- `tests/composition/A2-requeue-platform.test.ts` (5): `D-3: FAIL → TaskRequeue (P4)…` :: `AssertionError: expected { ref: … } to match object { effectivePhase: 'failed', … }`; `§4.3 / §4.4: 0-commit refusals of a requeue…` :: same class; `TASK-03 (§4.3)…` :: `Error: requeue: {… "finalize_first: round … of the selected Run is open"}`; `C3 (§6.1 (e), RUN-02/03, I-19)…` :: same `finalize_first … is open`; `W-21 / C3…` :: `AssertionError: expected { ref: … } to match object { effectivePhase: 'failed', … }`
- `tests/scenarios/A1-rework-same-session.test.ts` (1): `A1 (C8, §15.2 5.8, AV-12…)…` :: `AssertionError: expected 'waiting' to be 'stopped' // Object.is equality`
- `tests/scenarios/A11-no-progress.test.ts` (7): same 7 ids/lines as the area run above.
- `tests/scenarios/A4-duplicate-receipts.test.ts` (4): `A4 (领取、发信、记录结果)…` :: `expected 'waiting' to be 'completed'`; `A4, W-23…` :: `expected 'waiting' to be 'stopped'`; `A4, C-05…` :: `expected 'waiting' to be 'stopped'`; `A4 (记录结果)…` :: `expected 'waiting' to be 'completed'`
- `tests/scenarios/A7-control-goal29.test.ts` (1): `A7-G4 with history (GOAL-29, LA-1…)…` :: `AssertionError: expected 'waiting' to be 'completed'`
- `tests/scenarios/A7-control.test.ts` (14): `A7 entered Run…`, `A7 yielded wait…`, `GOAL-11/14 with a live Kernel Turn…`, `GOAL-14 retry…`, `A7-G2 (G-01, G-02…)…`, `A7-G4b (G-05)…`, `A7-G4b contrast (G-01 at a crash)…`, `A7-G5 (§12.10 order)…`, `G-04 and G-06 at a restart…`, `§2.3 step 2 (5.6 FINAL #28)…`, `GOAL-29 after a person's 继续…` :: `AssertionError: expected 'waiting' to be 'completed'`; `goals/control pause, then resume…`, `GOAL-11/14…`(dup class) :: `expected { state: 'waiting', … } to match object { state: 'completed' }`; `VD-9: a paused Goal opens no round…` :: `AssertionError: expected 'ENOENT: … /usr/bin/bwrap' to contain 'the Goal is paused; no new check proc…'`; `G-04 and GOAL-29…` and `G-04 and G-06 at a restart…` :: `[["advance",…,["waiting","ENOENT: … '/usr/bin/bwrap'","run_check"]]: expected { state: 'waiting', … } to match object { state: 'completed' }`
- `tests/scenarios/A8-host-restart-entry.test.ts` (7): `A8-2a, A8-1c…`, `A8-2a with a queued cancel…`, `A8-2b, L-2, L-1…`, `A8-2b, SES-07, SES-19, H-01…`, `A8-2c (W-07, H-03, CI-10…)…`, `A8-1b (W-02, I-19, LA-6…)…`, `A8-1a requeue variant…` :: all `AssertionError: expected 'waiting' to be 'stopped' // Object.is equality`
- `tests/scenarios/A8-host-restart-paused.test.ts` (5): `A8-3l, A8-3p…` and `A8-3q, A8-3o…` :: `AssertionError: expected { ref: … } to match object { effectivePhase: 'satisfied' }`; `A8-3n…` :: `Error: timed out waiting for the start-up re-drive to complete the Goal: {… "failureClass":"interrupted"}…`; `a Run paused at a safe point…` :: `[… "waiting","ENOENT: … '/usr/bin/bwrap'","run_check"]]: expected { state: 'waiting', … } to match object { state: 'completed' }`; `LA-1 and contract (e)…` :: `Error: the continuation r2 must be claimed`
- `tests/scenarios/A8-host-restart.test.ts` (3): `A8-3a (W-09, RUN-18…)…` :: `expected 'waiting' to be 'completed'`; `§12.1 step 6b (LA-6, W-01)…` :: `Error: the start-up re-drive completed the Task without a workflow/advance…`; `§12.1 step 6b (a), W-11, RUN-19…` :: `Error: … completed the Goal without a workflow/advance: expected { phase: 'RUNNING', … } to match object { phase: 'COMPLETED' }`
- `tests/scenarios/C3-brief-idempotency.test.ts` (4): `C3-R1 (W-24)…`, `C3-R1 (W-24) with the source changed…`, `C3-R2 (W-25)…`, `C3-R2 (W-25) with a transient Kernel read…` :: all `AssertionError: expected 'waiting' to be 'stopped'`
- `tests/scenarios/C3-not-entered-chain.test.ts` (1): `C3 (D-7, factsFrom)…` :: `AssertionError: expected 'waiting' to be 'stopped'`
- `tests/scenarios/C3-paused-continue-brief.test.ts` (1): `C3/C4: a Run a person paused…` :: `AssertionError: expected 'waiting' to be 'completed'`
- `tests/scenarios/C3-reply-other-session.test.ts` (3): `C3 (P17, same Session)…`, `C3 (P17, other Session)…` :: `expected 'waiting' to be 'completed'`; `C3 (P17, another Task's Session)…` :: `AssertionError: expected [ 'claim_task', 'prepare', … ] to deeply equal ArrayContaining{…}`
- `tests/scenarios/C3-workspace-changed.test.ts` (1): `C3 (GAP-49)…` :: `AssertionError: expected 'waiting' to be 'stopped'`
- `tests/scenarios/C5-gate-fix.test.ts` (2): `C5 gate fix (§15.2 5.9…)`, `C5 control…` :: both `Error: the Workflow must reach the gate open`
- `tests/scenarios/C8-auto-rework-cap.test.ts` (1): `C8 (§13.4 #15, AV-8, GOAL-30)…` :: `AssertionError: expected 'waiting' to be 'stopped'`
- `tests/scenarios/C8-human-stop-respected.test.ts` (2): `AV-4 (STEP5-FLIPS §14)…` :: `AssertionError: expected [ 'open_checks', 'run_check' ] to deeply equal [ 'open_checks', 'run_check', … ]`; `VR-14 step 5 (hard limit 3, I-17)…` :: `Error: the round must finalize`
- `tests/scenarios/S1-archive-restart.test.ts` (1): `IT19 (request committed)…` :: `AssertionError: expected 'waiting' to be 'completed'`
- `tests/scenarios/S5-goal-conflict-rework.test.ts` (1): `SC02 two Goals conflicting on module M…` :: `AssertionError: expected 'waiting' to be 'stopped'`
- `tests/state/invariants-fuzz.test.ts` (1): `coverage: every kind of operation the row lists actually ran…` :: `AssertionError: kinds that never ran: expected [ '起检 begin check', … ] to deeply equal []`
- `tests/state/invariants.test.ts` (0 test failures; collection error, 29 skipped): `FAIL  tests/state/invariants.test.ts [ tests/state/invariants.test.ts ]` :: `Error: requeue 1: {… "finalize_first: round … of the selected Run is open"}`

`sha256sum` of the 25 section-3 files → `sha256sum -c` reports 25/25 `OK`, 0 mismatches (all values exactly as section 3).
`git status --short | wc -l` → `93` (same list as today; `.dsh-scratch/` deleted; `git log` still 1 commit; no commit, no push).

UNSPECIFIED:
- F1 → done. F1a paused-Goal re-derivation `src/core/work-graph/state/decision-policy.ts:159-197` (`pausedAutomationAction`) wired at `src/core/work-graph/tasks/goal-decision-reader.ts:356-360`; F1b LB-1 reader branch `goal-decision-reader.ts:350-355`. Not covered by the direction: `TaskRow.failure` carries no GV-5 `fixInProgress`, so the helper returns `null` for `subjectKind:'gate'` instead of inventing a gate card. The paused work reconstruction is a second derivation of chain facts (`round.autoCount`/`ordinal`/`failingChecks`/`gapCodes`) that could drift from `chain`/`roundOrdinalOf`. Per LB-1's "reader always", the reader derives a card for any `stopped/budget_exhausted` + class + Run pin even when the Host binding budget would not lift it (no Workflow card). Only paused (not cancelled) Goals are re-derived (cancelled cards are read-only history).
- F2 → done. `src/core/work-graph/tasks/plan-service.ts:1514-1523` forwards `acknowledgementRef`/`decisionSource`; `:3267-3270` input; `:3291-3298` conditional fingerprint spread (byte-identical when absent); `:3332-3345` `decisionProof` built exactly as the Host branch. Not determined by the spec/message: the only production Agent caller, `src/core/agent-runtime/whiteboard-tools.ts:303-307` (`apply_future_plan`), still sends neither field and is outside this area's write scope, so the new proof path is not yet reachable end-to-end from production. The proof may now refuse an attributed apply with `revision_conflict` on a stale captured pin, identical to the Host branch.
- F3 → done. `src/core/work-graph/communication/decision-service.ts:965-974`: fingerprint = operation+scope+sender+payload `{ messageRef, receipt }`; the expected message pin remains the first-execution CAS (`:988`, `:1038`) and `lookupCommit` replay precedes all business reads. No frozen test asserts `idempotency_conflict` for this operation, so LB-2 applied cleanly; `communication-tools.ts` was correctly left unchanged.
- F4 → done. `decision-service.ts:996-1021` (report cites `:1003-1013`): the already-recorded shortcut and the different-application refusal now run only after modifier/operator admission; a non-admitted caller falls through to the message state machine and gets `forbidden`. Not pinned by the spec: the "different application already recorded" refusal is also gated behind admission; actor comparison stays `kind`+`id`.
- F5 → done. `src/core/work-graph/communication/decision-source-facts.ts:681-690` (`readerReadRecord`), and also `:182-190` (`readEncoded`) beyond the cited line, now return `not_found` only when the ready batch reports the key in `missing`, else `unavailable`. Residual same-class site not fixed because it is outside the decided changed lines: `decision-service.ts:363-364` (`loadMessage`) / `:382` (`readOne`) still map a ready-batch omission to absence.
- F6 → done. `goal-decision-reader.ts:201-234`: absent `plans.queryTaskGraph` → `unavailable`; `not_found` → empty rows only when `goal.activePlanRevision === null`, else `unavailable`. Not exercised by any frozen test: the frozen `createDecisionSourceFacts({ records })` path builds no reader; a partial `plans` without `queryTaskGraph` now makes every `goal_cause` read `unavailable`.
- F7 → done. `src/core/work-graph/communication/mailbox-service.ts:1463-1472` (`verifyDecisionObjectWorkspaces`) refuses an `aggregate` object whose `pin` is absent/not an object/no ref/no positive-int revision as `invalid` before pin extraction or body effects; `:1442-1450` no longer silently skips it. The direction named `aggregateObjectPins`/`verifyDecisionObjectPins`; the refusal is placed at the earliest object-shape seam (`verifyDecisionObjectWorkspaces`, the cited "second skip"), with both named helpers also adjusted.
- F8 → done. `src/business/workflow/workflow.ts:1146-1155`: the pure policy probe runs before `deps.sourceAuthority.load`; under default `after_plan_confirmation` it returns `null` and no Run revision read occurs; `every_step` still reads.
- Pre-existing/out-of-scope defects observed by the reviewers, NOT changed (outside the decided items/regions): Host PlanApply identity drift — `plan-service.ts:407-414` + call `:1531-1532` always serialize null `acknowledgementRef`/`decisionSource`, so a Host apply without attribution is not byte-identical to pre-slice; `goalBases` non-array can throw in `planAcceptanceProof` via the parsed source (mirrored from Host); `workflow.ts:1216-1219` (`gatePerform`) turns a non-ready read into "no gate"; `workflow.ts:1194-1200` Workflow `decisionCause.source` omits `goalBases` (low confidence).
- Frozen-test contradiction: none found for any item; no test was edited, and all 25 frozen hashes match.

NOTES:
- Subagents: 3 group fixers (G1 F1/F6/F8, G2 F3/F4/F5, G3 F2/F7, parallel) + 3 read-only reviewers (one per group); all 6 finished and reported. No follow-up fix subagent was needed: every review verdict was "done" for F1–F8.
- Writes this round were exactly the 7 in-scope files (verified by mtime); `communication-tools.ts` was legitimately not needed. No file under `tests/` was touched.
- All four section-8 commands were run (typecheck/architecture/build before and unaffected by the read-only reviews; area + named runs after). Results match the expected numbers exactly.
- `/usr/bin/bwrap` is absent in this sandbox; all failures are the expected bwrap/process-sandbox kind (`waiting`, `ENOENT … /usr/bin/bwrap`, `Kernel ProcessSandbox profile is not available`, `finalize_first … is open`, waits timing out). No harness was instrumented.
- `.dsh-scratch/` was created only for the brief and logs and is deleted; final `git status --short` is 93 paths, no commit added, no other work undone.