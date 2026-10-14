# DSH baseline for the K slice, part A (measured by the lead in the DSH sandbox, 2026-10-14)

- Copy: `slice-setup` = commit 834e5897 of the branch; `slice-base` adds the spec with §9 (M1–M9), the 14 frozen old-test files and this file.
- `npm run typecheck`: exit 2. Exactly 10 errors, all in frozen test files and all about the new Workflow step kind `close_open_turn` (TS2367 "no overlap" and TS2339 on the narrowed `never`): A7-control-goal29 (2), A7-control (1), A8-host-restart-paused (5), WP1-wiring (2). They go away when `WorkflowCalls` gets `close_open_turn` (spec §2). Any other typecheck error is yours.
- Full suite (`npx vitest run`) here: 279 files; **50 files failed; 145 tests failed**, 5,804 passed, 29 skipped; plus 1 failed suite (`tests/state/invariants.test.ts`, sandbox kind: a registered check cannot finalize).
- With bubblewrap (the lead environment) the same code without the flips passes the whole suite (281 files, 6,000 tests in the part B copy).

## A. Sandbox kind, not in frozen files (88): fail here before and after part A; the lead runs them with bubblewrap

- `tests/app/A2-automation-verdict.test.ts` > C8 (§15.2 5.8): the verdict follows the failure facts and the live policy: FAIL → requeue, cap 0 → stopped, requeue → claim_requeued, no new basis → stopped
- `tests/app/A2-automation-verdict.test.ts` > §15.2 5.9 (AV-7d, C5): check_incomplete reads reverify; the Workflow opens the successor round as the automation and the Goal completes
- `tests/app/A2-requeue-route.test.ts` > tasks/requeue and executions/brief: a failed Task is requeued over HTTP, continues with its brief and completes
- `tests/app/A2-reverify-route.test.ts` > verification/reverify: a FAIL head is refused source_unchanged, then after the fix its successor completes the Goal
- `tests/app/AG2b-collaboration.test.ts` > AG2b continuous communication over the real Host HTTP > releases a busy B, runs two wait rounds and completes the real Task/Goal
- `tests/app/AG2b-collaboration.test.ts` > AG2b continuous communication over the real Host HTTP > reopens read-only over the original messages/Query/history and refuses another scope
- `tests/app/MVP-workbench-tools.test.ts` > MVP workbench-tools real command handle (expected red until stage two) > retains real output, replays one command handle and cancels a running command
- `tests/app/R6-host.test.ts` > R6 execution entry (expected red at the first stage-one unsupported) > loads a real startup JSON and consumes the trusted runtime through the public Query/Workf
- `tests/app/change-emitters.test.ts` > command handle change notices > announces settled, and stopping once before settled for a stopped command
- `tests/app/orchestration-mechanism.test.ts` > runs two explicitly selected same-Goal Tasks in independent Sessions with overlapping real provider calls
- `tests/business/R5b-initial-planning-workflow.test.ts` > consumes the answer, adopts the candidate, then advances to a formal Goal completion
- `tests/composition/A2-requeue-platform.test.ts` > C3 (§6.1 (e), RUN-02/03, I-19): a requeue Run binds one brief; prepare rehydrates it and the driver refuses another
- `tests/composition/A2-requeue-platform.test.ts` > D-3: FAIL → TaskRequeue (P4) → requeue claim with the continuation brief → no_new_basis refusal → note → PASS completes
- `tests/composition/A2-requeue-platform.test.ts` > TASK-03 (§4.3): the Workflow claims a requeue with the budget it pins; a claim with another budget is invalid
- `tests/composition/A2-requeue-platform.test.ts` > W-21 / C3: an archived afterRun Session moves the requeue to a new Session; the brief lists the message Run 1 accepted
- `tests/composition/A2-requeue-platform.test.ts` > §4.3 / §4.4: 0-commit refusals of a requeue — shape, pins, a verifying Task and new inputs (ND-9)
- `tests/composition/A2-reverify-platform.test.ts` > C5 (§15.2 5.9, VR-14/15, TASK-29): an operator reverifies an INCONCLUSIVE head; the Workflow runs the successor and completes the Goal
- `tests/composition/A2-verification-chain-platform.test.ts` > VD-15: a gate has one chain anchored on its first producer, and the Workflow follows its head
- `tests/composition/A2-verification-chain-platform.test.ts` > VD-7: an adoption while the Run is in the Kernel, and one before the finalize: the start and finalize paths use the current Plan
- `tests/composition/A2-verification-chain-platform.test.ts` > VD-7: future adoptions before the open and before the completion never strand the Task
- `tests/composition/A2-verification-chain-platform.test.ts` > VD-8: a source changed after the open ends the check attempts and the round finalizes INCONCLUSIVE
- `tests/composition/A2-verification-chain-platform.test.ts` > VR-01..VR-07: one chain per subject Run, the projection follows its head, and an applicable FAIL fails the Task
- `tests/composition/A2-verification-chain-platform.test.ts` > VR-05 (VD-6): a root moved after begin returns the check to pending; the next begin ends the attempts (frozen_root_changed)
- `tests/composition/R3e-command-check-platform.test.ts` > collapses a concurrent fresh run into one real process and never re-runs an unknown executing window across restart
- `tests/composition/R3e-command-check-platform.test.ts` > executes the fixed commands through the real sandbox and admits mechanical Evidence without completing the Task
- `tests/composition/R3e-completion-platform.test.ts` > runs the real registered checks, completes work and goal, and replays the original receipt after reopen
- `tests/composition/R5c-workflow-platform.test.ts` > advances two works and 'a stage gate then the Goal gate' through public ports, reusing the Session and completing the Goal
- `tests/composition/R5c-workflow-platform.test.ts` > advances two works and 'the Goal gate' through public ports, reusing the Session and completing the Goal
- `tests/composition/R5c-workflow-platform.test.ts` > resumes the original verification round for a completed Work Run across a different flow
- `tests/scenarios/A1-rework-same-session.test.ts` > A1 (C8, §15.2 5.8, AV-12, W-21, L-3, C3): a FAILed round is requeued automatically, claimed in Run 1's Session with the brief, passes and completes the Goal
- `tests/scenarios/A10-check-recovery.test.ts` > A10-R1: two checks PASS and one has no result (it timed out): the round is INCONCLUSIVE and the Task is not completed
- `tests/scenarios/A10-check-recovery.test.ts` > A10-R2 (C-02 under GAP-24, VD-10): a check whose process ended with its report stored but whose result was never booked stays executing until the restart, which
- `tests/scenarios/A10-check-recovery.test.ts` > A10-R5, A10-R4 (C-01, C-04, VR-07, VR-14, §13.7, LA-6): a work check interrupted by a crash is finalized INCONCLUSIVE after the restart and re-verified automati
- `tests/scenarios/A10-check-recovery.test.ts` > A10-R5, C-06, A10-R4: the successor round's check is interrupted by a second crash; the projections follow C-04, and one more exempt round PASSes
- `tests/scenarios/A10-check-recovery.test.ts` > A10-R6 (C-01, GV-3, GV-10, P20, TASK-15, TASK-30): the gate's check interrupted by a crash is re-verified on the anchored producer Run after the restart; PASS c
- `tests/scenarios/A10-check-recovery.test.ts` > VR-04 (C-01): a check left executing by a crashed Host is interrupted at the restart (host_restart), and no check runs again
- `tests/scenarios/A11-no-progress.test.ts` > A11 #1, #3, #10 (ND-3), #5, #11: the first requeue passes; a Run that changed a file passes; a source back at S1 meets the first key; another reason is no new b
- `tests/scenarios/A11-no-progress.test.ts` > A11 #14 (ND-4), #6 (L-4): a Run that changed an unrelated file lets the second requeue pass; an unrelated adoption changes no key, so the request it made stale 
- `tests/scenarios/A11-no-progress.test.ts` > A11 #15: an automatic requeue past the limit is the committed auto_rework_cap_reached refusal (before any source capture); the operator's requeue then passes an
- `tests/scenarios/A11-no-progress.test.ts` > A11 #2, #25, #21 (不改文件), #22, ND-3, #20: the same failure twice stops at refusal @1 with no new Attempt or model call; a platform body is invalid; a stale refus
- `tests/scenarios/A11-no-progress.test.ts` > A11 #4: a message its recipient has answered is a new basis, so the requeue passes; the same message before the answer is not admitted
- `tests/scenarios/A11-no-progress.test.ts` > A11 #7, #8: c1 turning PASS while c2 FAILs is another failure, so the requeue passes on the same source; after a Run that ended outcome_unknown every requeue is
- `tests/scenarios/A11-no-progress.test.ts` > §13.4 #15/#21, AV-8/AV-9, GOAL-27/30: the cap stops the automation, a raised cap meets a committed refusal, the other Task runs and the stale refusal is retried
- `tests/scenarios/A8-host-restart-rework.test.ts` > A8-R1 (W-21, C8, LA-6): a crash between the automatic requeue and its claim; the start-up re-drive claims with the requeueRef (exactly one new Run), off waits f
- `tests/scenarios/A8-host-restart-rework.test.ts` > A8-R2 (W-22, C8, ND-8): a committed no_new_basis refusal survives the restart: the verdict stays stopped, the start-up re-drive does not select the Goal, and a 
- `tests/scenarios/C3-brief-idempotency.test.ts` > C3-R1 (W-24) with the source changed before the Workflow prepares again: the second prepare is another manifest whose brief differs only in the workspace facts;
- `tests/scenarios/C3-brief-idempotency.test.ts` > C3-R1 (W-24), W-02, W-05 → RUN-16 → RUN-03: one requeue Run passes every crash point before the Kernel and keeps one brief
- `tests/scenarios/C3-brief-idempotency.test.ts` > C3-R2 (W-25) with a transient Kernel read: the Kernel store is held by another process at the restart and at the prepare; the probe proves nothing (H-03), prepa
- `tests/scenarios/C3-brief-idempotency.test.ts` > C3-R2 (W-25): after a restart the facts Run's Kernel store is not registered (host_config): prepare answers unavailable, pins no degraded brief and changes noth
- `tests/scenarios/C3-not-entered-chain.test.ts` > C3 (D-7, factsFrom): Run 2 cancelled while Claimed never enters the Kernel; the person's requeue opens Run 3 whose brief says so and lists the failed check and 
- `tests/scenarios/C3-reply-other-session.test.ts` > C3 (P17, another Task's Session): with Run 1's Session archived and another work Task's Session reusable, Run 2 continues there without Run 1's history (other_s
- `tests/scenarios/C3-reply-other-session.test.ts` > C3 (P17, other Session): with Run 1's Session archived, Run 2 continues in another Session and its brief carries the bounded reply text
- `tests/scenarios/C3-reply-other-session.test.ts` > C3 (P17, same Session): Run 2 continues in Run 1's Session; the reply enters once through run.input_accepted and the brief lists only its reference
- `tests/scenarios/C3-workspace-changed.test.ts` > C3 (GAP-49): the source is D1 at the requeue and D2 at the prepare; the brief says "重新入队 → 本次执行开始前：有变化（具体文件无法从持久记录确定）" and lists the uncommitted files
- `tests/scenarios/C5-gate-fix-open.test.ts` > C5 gate fix while the gate round is open: the fix runs first, the pending gate check ends frozen_source_changed, the round finalizes INCONCLUSIVE, the gate is r
- `tests/scenarios/C5-gate-fix.test.ts` > C5 control: a fix that does not repair the failure FAILs its own round, the gate is not re-verified, and the Goal reason comes from the fix Task
- `tests/scenarios/C5-gate-fix.test.ts` > C5 gate fix (§15.2 5.9, GV-8/GV-9, P20, TASK-15): a FAILed gate stops as gate_needs_fix, a fix Task repairs it, and the automatic re-verification completes the 
- `tests/scenarios/C5-reverify-guards.test.ts` > (a) verification_uncovered: the automatic re-verification is refused and committed, no round opens and no check starts, the Goal needs a decision; a covering ch
- `tests/scenarios/C5-reverify-guards.test.ts` > (a)/(b) §13.7 / LA-4: the cap and verification_uncovered are committed refusals on TaskRow.failure; a covering configuration makes them stale
- `tests/scenarios/C5-reverify-guards.test.ts` > (b) a timed-out check with the workspace changed between every round: three automatic re-verifications, then stopped/auto_rework_cap_reached{reverify}; the oper
- `tests/scenarios/C5-reverify-guards.test.ts` > (c) not_started: the sandbox cannot launch the check; the exemption skips the key (the same key admitted three times) but counts, so the cap stops it
- `tests/scenarios/C5-reverify-guards.test.ts` > (d) VR-03: a timed-out check records its INCONCLUSIVE cause and blocks the Task as round_inconclusive
- `tests/scenarios/C6-unrelated-adoption.test.ts` > C6 (W-01 note): an adoption before the prepare and a fresh selection continue the same claim
- `tests/scenarios/C6-unrelated-adoption.test.ts` > C6 main path: another Task's running Run adopts P2 after the Workflow claimed T1; T1 keeps its Session and Lease, runs under P2 and is satisfied; no FAILED, no 
- `tests/scenarios/C6-unrelated-adoption.test.ts` > C6 variant RUN-03 (W-05 → W-03, §12.10 A8-1c supplement): an Entering Run revoked at a restart is re-authorized after an unrelated adoption; the relaxed guard p
- `tests/scenarios/C6-unrelated-adoption.test.ts` > C6 variant W-01: the Host restarts between the claim and the authorization, after an unrelated adoption; the reconcile leaves the claim, and 推进 continues it und
- `tests/scenarios/C6-unrelated-adoption.test.ts` > C6: an unrelated adoption after the claim does not stop the claimed Run; it completes under the new Plan
- `tests/scenarios/C7-defer-reactivate.test.ts` > C7 defer and reactivate (TASK-19 from P4, L-15, GOAL-30, #26): a deferred requeued Task waits, is claimed with its requeueRef once active, and the same failure 
- `tests/scenarios/C7-defer-reactivate.test.ts` > C7 interleavings in both orders (sequential): TASK-19 first → requeue invalid; requeue first → TASK-19 commits; S15 claim while deferred invalid, then claimed; 
- `tests/scenarios/C7-defer-reactivate.test.ts` > C7 races with a commit barrier (§3.6 PLAN-05): a control in TASK-19's window is refused and TASK-19 commits; TASK-19 vs a requeue and vs a requeue claim, each i
- `tests/scenarios/C7-supersede-failed-task.test.ts` > C7 main path (adopter: agent): T fails to the cap, a coordinator's Run proposes T superseded by T2, the Workflow runs T2 and the Goal completes; T keeps its his
- `tests/scenarios/C7-supersede-failed-task.test.ts` > C7 main path (adopter: operator): T fails to the cap, a coordinator's Run proposes T superseded by T2, the Workflow runs T2 and the Goal completes; T keeps its 
- `tests/scenarios/C7-supersede-failed-task.test.ts` > C7 supersede (TASK-19, guards 6, 7, 9): only the operator supersedes a human-stopped Task; the Workflow skips it and completes the Goal with its replacement
- `tests/scenarios/C8-auto-rework-cap.test.ts` > C8 (§13.4 #15, AV-8, GOAL-30): three automatic requeues, then stopped/auto_rework_cap_reached with no refusal; a raised cap continues without a person; an opera
- `tests/scenarios/C8-budget.test.ts` > AV-11, §13.4 #19: an exhausted Run waits until the binding budget is larger, then the Workflow requeues with it and the claim carries it
- `tests/scenarios/C8-human-stop-respected.test.ts` > AV-4 (STEP5-FLIPS §14): a pause superseded by the natural completion fences rework only; the round opens, passes and completes the Task
- `tests/scenarios/C8-human-stop-respected.test.ts` > VR-14 step 5 (hard limit 3, I-17): an operator pause superseded by the natural completion fences the automation, not the operator
- `tests/scenarios/S1-archive-restart.test.ts` > IT19 (request committed): the Host crashes right after the archive request commits; the next Host resumes the original request, archives the line, runs nothing 
- `tests/scenarios/S5-goal-conflict-rework.test.ts` > SC02 two Goals conflicting on module M: no labels before the accepted risk, one system and one agent requeue, one automatic reverify and three notices, restart,
- `tests/state/invariants-fuzz.test.ts` > coverage: every kind of operation the row lists actually ran (counts merged over the seeds)
- `tests/work-graph/A2-verification-chain.test.ts` > memory: VD-10: a result record that failed or lost its response is retried with the same request id
- `tests/work-graph/A2-verification-chain.test.ts` > memory: VR-05 (VD-6): a root change after begin and a caller cancel return the check to pending; the next run begins anew
- `tests/work-graph/A2-verification-chain.test.ts` > memory: VR-13: an incomplete ticket interrupts the check (ticket_invalid), and the round finalizes it as a gap
- `tests/work-graph/A2-verification-chain.test.ts` > memory: §9.3 Workflow order: an interrupted check does not hold the pending one, and the round then finalizes
- `tests/work-graph/A2-verification-chain.test.ts` > sqlite: VD-10: a result record that failed or lost its response is retried with the same request id
- `tests/work-graph/A2-verification-chain.test.ts` > sqlite: VR-05 (VD-6): a root change after begin and a caller cancel return the check to pending; the next run begins anew
- `tests/work-graph/A2-verification-chain.test.ts` > sqlite: VR-13: an incomplete ticket interrupts the check (ticket_invalid), and the round finalizes it as a gap
- `tests/work-graph/A2-verification-chain.test.ts` > sqlite: §9.3 Workflow order: an interrupted check does not hold the pending one, and the round then finalizes

## B. Sandbox kind, in frozen files (35): failed here already before the flips (same test name); they still fail here after part A

- `tests/scenarios/A4-duplicate-receipts.test.ts` > A4 (记录结果): the Runtime's result write that failed (the ledger locked while the Kernel ended the Turn) is retried with the same identity by the re-sent start: th
- `tests/scenarios/A4-duplicate-receipts.test.ts` > A4 (领取、发信、记录结果): every step of a Run, its rounds and the Goal completion, sent again after its answer is lost — on the same Host or after a crash — returns the 
- `tests/scenarios/A4-duplicate-receipts.test.ts` > A4, C-05: an automatic reverify and its committed refusal that fail inside the commit leave nothing; after the restart the same request commits once and every l
- `tests/scenarios/A4-duplicate-receipts.test.ts` > A4, W-23: a requeue and its committed refusal that fail inside the commit leave nothing; after the restart the same request commits once, and every later copy —
- `tests/scenarios/A7-control.test.ts` > A7 entered Run: a pause lands at the next safe point, a steer waits while the Run is paused, the resume re-enters the original Turn where the Kernel accepts the
- `tests/scenarios/A7-control.test.ts` > A7 yielded wait: the yielded terminal keeps the queued steer (no terminal_without_cancel); after a real reply the continuation claim consumes the wait, and the 
- `tests/scenarios/A7-control.test.ts` > A7-G2 (G-01, G-02, GOAL-16, GOAL-14 at a restart): a Goal pause committed on a Host without the lease reaches no Run; the next start submits the fan-out pause o
- `tests/scenarios/A7-control.test.ts` > A7-G4b (G-05): a fan-out pause still queued when the Host crashed ends the Run paused-interrupted (RUN-24 kernelPaused:false, CTL-08(f)); the Goal resume contin
- `tests/scenarios/A7-control.test.ts` > A7-G4b contrast (G-01 at a crash): a fan-out pause never submitted before the crash leaves a plain interruption (RUN-19); the Goal resume continues nothing and 
- `tests/scenarios/A7-control.test.ts` > A7-G5 (§12.10 order): a person's own pause stays through the Goal pause and resume; the Host stops while the Goal is paused; the Goal resume after the restart, 
- `tests/scenarios/A7-control.test.ts` > G-04 and G-06 at a restart: a Goal resumed (and paused and resumed again) on a Host without the lease continues its paused-interrupted Task exactly once at the 
- `tests/scenarios/A7-control.test.ts` > GOAL-11/14 with a live Kernel Turn: the fan-out pause lands at the next safe point; the resume re-enters the original Turn
- `tests/scenarios/A7-control.test.ts` > GOAL-14 retry: a resume sent while the fan-out pause is still queued follows once the pause lands; the Turn is re-entered and completes
- `tests/scenarios/A7-control.test.ts` > GOAL-29 after a person's 继续 (G-04 "存在 → 跳过", the sequential order of `already_continued`): the start-up continuation skips a Run a TaskRequeue covers; exactly o
- `tests/scenarios/A7-control.test.ts` > VD-9: a paused Goal opens no round and begins no check; after the resume the same chain completes
- `tests/scenarios/A7-control.test.ts` > goals/control pause, then resume: the claimed Run is paused and resumed by the fan-out; a paused Goal starts nothing; the Goal completes
- `tests/scenarios/A7-control.test.ts` > §2.3 step 2 (5.6 FINAL #28): the start-up resume pass skips an entered Run that step 2 left (W-07); the next start classifies it (RUN-24) and GOAL-29 continues 
- `tests/scenarios/A8-host-restart-entry.test.ts` > A8-1a requeue variant (W-01, W-24, C3, LA-6): a requeue Run claimed and never prepared is re-prepared by the start-up re-drive; its brief is assembled then, fro
- `tests/scenarios/A8-host-restart-entry.test.ts` > A8-1b (W-02, I-19, LA-6, §12.1 step 6b (b)): a requeue Run authorized and never begun is re-driven by the start-up re-drive with no workflow/advance; the bound 
- `tests/scenarios/A8-host-restart-entry.test.ts` > A8-2a with a queued cancel (W-05, RUN-16 + RUN-09, CTL-08(a)): a cancel submitted while the Run is Entering stays queued; the restart revokes the entry and ends
- `tests/scenarios/A8-host-restart-entry.test.ts` > A8-2a, A8-1c (W-05, W-03, RUN-16, RUN-03, I-19): an Entering Run with no Kernel Turn is revoked at the restart and the same claim re-authorizes with the bound b
- `tests/scenarios/A8-host-restart-entry.test.ts` > A8-2b, L-2, L-1 (W-06, W-15, RUN-20(ii), RUN-22, ATT-36, ATT-37, ATT-29): an Entering Run with the Kernel unreadable ends outcome_unknown without a Turn; with t
- `tests/scenarios/A8-host-restart-entry.test.ts` > A8-2b, SES-07, SES-19, H-01 (W-06, RUN-22, LA-1): attested while the Kernel is still unreadable, the Session is retired kernel_turn_open in place of missing; a 
- `tests/scenarios/A8-host-restart-entry.test.ts` > A8-2c (W-07, H-03, CI-10, then W-05 with RUN-09): under a host_config probe an Entering Run and its queued cancel are left as they are; the next start with the 
- `tests/scenarios/A8-host-restart-lease.test.ts` > A8-H4 (H-04, S8): an idle, available Session is never probed: with the Kernel store gone at the restart a probe would answer `missing` and write it unavailable 
- `tests/scenarios/A8-host-restart-lease.test.ts` > A8-Q2 (Q-02, QRR-02, SES-09): a QueryRun whose begin committed and whose Kernel Turn never started is closed at the restart and never entered again (its entry s
- `tests/scenarios/A8-host-restart-paused.test.ts` > A8-3q, A8-3o (W-21, W-20, HL-06, HL-01, LA-1, SES-02): a Run paused by a person ends paused-interrupted after a normal close as after a crash; another Task of t
- `tests/scenarios/A8-host-restart.test.ts` > A8-3a (W-09, RUN-18, ATT-08, SES-06): the Kernel wrote the Turn's terminal but its result was never booked; the restart books the Kernel's own terminal, release
- `tests/scenarios/A8-host-restart.test.ts` > §12.1 step 6b (LA-6, W-01): a claimed Run left by a stopped Host is re-driven with the same claim at the next start, unless the Host setting turns the re-drive 
- `tests/scenarios/C3-paused-continue-brief.test.ts` > C3/C4: a Run a person paused, with a steer the Kernel never accepted, ends paused-interrupted at the restart; an Agent's 继续 is forbidden and leaves no brief and
- `tests/scenarios/WP1-wiring.test.ts` > SC02 operator archive-line(drop) -> anchor A: the prepared binding exposes the anomaly row and the brief lists A; after pickup the Goal read has no rows
- `tests/scenarios/harness.test.ts` > host mode crash: a Host abandoned mid-Turn is taken over (HL-03); the Run ends interrupted (W-11) with no model call during the reconcile; the next Host's call 
- `tests/scenarios/harness.test.ts` > host mode: claim → Run → PASS → satisfied; a clean restart and a peer Host write nothing; the next Host continues the script and the counters add up
- `tests/scenarios/harness.test.ts` > platform mode seams: a registered check is a new configuration revision; cap 0 stops the automatic rework
- `tests/scenarios/harness.test.ts` > platform mode: claim → Run → PASS → satisfied in process; a reopen keeps the records and the counters, and the script continues

## C. Flips you can verify here (10): fail now only because part A is not built; **must pass at the end**

- `tests/app/A2-runtime-capabilities.test.ts` > reports continuation, safe-point pause, cancel and start-up reconciliation as supported with their boundaries over the Host route  
  now: AssertionError: expected 2 to be 3 // Object.is equality
- `tests/app/A2-runtime-capabilities.test.ts` > says in the recoverRun reason that this Host has the setting automation.resumeOnStartup off, with or without the instance lease (LA-6, L-10)  
  now: AssertionError: new Run with a continuation brief: for a Work line, after the platform closes its dangling Kernel Turn as interrupted, in the same Session: expe
- `tests/composition/R3c-R4b-platform.test.ts` > wires one durable Goal/Plan/Session graph and reopens the same Kernel Session  
  now: AssertionError: expected { status: 'ready', value: { …(10) } } to match object { status: 'ready', value: { …(7) } }
- `tests/kernel/R4a-frozen-public.test.ts` > frozen public: version and completed history > kernel session public extension (R4a) > 默认 current_turn：不写 contextBasis，请求只含当前 Turn  
  now: AssertionError: expected 2 to be 3 // Object.is equality
- `tests/scenarios/A4-duplicate-receipts.test.ts` > A4 (控制、发信、核对): a steer and an operator message re-sent before and after the Run entered reach the Turn once; a reconcile that fails inside its commit is complet  
  now: AssertionError: expected { modelCalls: 2, …(6) } to match object { modelCalls: 2, …(3) }
- `tests/scenarios/A8-host-restart-entry.test.ts` > A8-2d (W-08, W-11, RUN-19, ATT-31..34, LA-1): the begin committed and the Kernel Turn started, the entered fact was never booked; the restart classifies the Tur  
  now: AssertionError: no model request, Kernel Turn or check process during the reconcile: expected { modelCalls: +0, …(6) } to match object { modelCalls: +0, …(3) }
- `tests/scenarios/A8-host-restart.test.ts` > A8-3d (W-12, RUN-23, CI-04, CTL-10, LA-1): a cancel queued on a Run paused at a safe point (submitted on a Host without the lease) stops the Run at the restart;  
  now: AssertionError: no model request, Kernel Turn or check process during the reconcile: expected { modelCalls: 1, …(6) } to match object { modelCalls: 1, …(3) }
- `tests/scenarios/A8-host-restart.test.ts` > W-11 and CTL-08(b), K KA1: a Run interrupted mid-Turn ends crashed at the restart; the steer the Kernel accepted is applied; the Session is retired and the star  
  now: AssertionError: expected { ref: { …(3) }, revision: 6, …(13) } to match object { lifecycle: 'active', …(3) }
- `tests/scenarios/A8-host-restart.test.ts` > W-12 (LA-7): a cancel queued while the Turn runs stops the Run at the restart without a Kernel pause; the cancel is applied by the paused stop  
  now: AssertionError: expected { ref: { …(3) }, revision: 6, …(13) } to match object { lifecycle: 'active', …(3) }
- `tests/scenarios/A8-host-restart.test.ts` > W-14 then W-07, W-15 and RUN-22 on a readable Kernel: a probe that proves nothing refuses the attestation without a write; the attestation of the open Turn reti  
  now: AssertionError: expected { ref: { …(3) }, revision: 5, …(13) } to match object { lifecycle: 'active', …(4) }

## D. Flips that also need the sandbox (12): their pre-flip originals already failed here with the sandbox kind; after part A they still fail here, possibly later in the test. The lead runs them with bubblewrap. Do not try to make them pass here; do check that their failure, if any, is the sandbox kind (a registered check that cannot run, "sandbox unavailable", or a Workflow waiting for such a check), never a K assertion

- `tests/scenarios/A7-control-goal29.test.ts` > A7-G4 with history (closing supported; KA-07, GOAL-29, LA-1, contract (e)): a Run the Goal fan-out paused after an earlier completed Turn of its Session is cont  
  now: AssertionError: expected 'waiting' to be 'completed' // Object.is equality
- `tests/scenarios/A7-control-goal29.test.ts` > A7-G4 with history (closing unsupported; GOAL-29, LA-1, contract (e)): a Run the Goal fan-out paused after an earlier completed Turn of its Session is continued  
  now: AssertionError: expected 'waiting' to be 'completed' // Object.is equality
- `tests/scenarios/A7-control.test.ts` > G-04 and GOAL-29: a Run the Goal fan-out paused ends paused-interrupted at the restart; resuming the Goal continues it under the fan-out actor in the same Sessi  
  now: AssertionError: [["advance",null,null],["advance",null,"create_session"],["advance",null,"transfer_responsibility"],["advance",null,"claim_task"],["advance",nul
- `tests/scenarios/A8-host-restart-paused.test.ts` > A8-3l, A8-3p (W-20, RUN-24, LA-1, C3, C4, §13.4 #23/#24; K KA-07, KA-04): a Run paused by a person ends paused-interrupted at the crash; the Kernel refuses the   
  now: AssertionError: expected { ref: { …(3) }, …(13) } to match object { effectivePhase: 'satisfied' }
- `tests/scenarios/A8-host-restart-paused.test.ts` > A8-3n (closing supported; KA-10, W-11, RUN-19, LA-7, §13.4 #17, LA-6): the Kernel paused, a resume queued, the crash before the re-entry: an ordinary interrupti  
  now: AssertionError: expected { ref: { …(3) }, revision: 8, …(13) } to match object { lifecycle: 'active', …(3) }
- `tests/scenarios/A8-host-restart-paused.test.ts` > A8-3n (closing unsupported; W-11, RUN-19, LA-7, §13.4 #17, LA-6, K L8): the Kernel paused, a resume queued, the crash before the re-entry: an ordinary interrupt  
  now: Error: timed out waiting for the start-up re-drive to complete the Goal: {"phase":"RUNNING","row":"GOAL-27","cause":null,"causes":[{"code":"auto_rework_pending"
- `tests/scenarios/A8-host-restart-paused.test.ts` > LA-1 and contract (e) (closing supported; KA-07, KA-09, A8-3l step 5, A8-3r): a person's 继续 closes the dangling Kernel Turn and the continuation runs in the ori  
  now: Error: the continuation r2 must be claimed
- `tests/scenarios/A8-host-restart-paused.test.ts` > LA-1 and contract (e) (closing unsupported; A8-3l step 5, A8-3r, K L8): the continuation in a new Session is seeded with the original Session's completed histor  
  now: Error: the continuation r2 must be claimed
- `tests/scenarios/A8-host-restart-paused.test.ts` > a Run paused at a safe point when its Host stopped ends paused-interrupted at the restart; a second start keeps its Session retired and writes nothing; 继续 close  
  now: AssertionError: [["advance",null,null],["advance",null,"create_session"],["advance",null,"transfer_responsibility"],["advance",null,"claim_task"],["advance",nul
- `tests/scenarios/A8-host-restart.test.ts` > §12.1 step 6b (a), W-11, RUN-19, §13.4 #17, LA-1, K KA1: an interrupted Run is requeued by the start-up re-drive, uncounted, in the same Session once the start-  
  now: AssertionError: the start-up re-drive completed the Goal without a workflow/advance: expected { phase: 'RUNNING', …(4) } to match object { phase: 'COMPLETED' }
- `tests/scenarios/WP1-wiring.test.ts` > SC01 (closing supported; KA-07) human pause + Host restart, continue: the Workflow closes P's dangling Kernel Turn and T continues in P in a new Run with no new  
  now: AssertionError: expected [ 'create_session', …(2) ] to deeply equal [ 'close_open_turn', 'claim_task' ]
- `tests/scenarios/WP1-wiring.test.ts` > SC01 (closing unsupported) human pause + Host restart, continue: the continuation handover creates, transfers and then archives P, T completes satisfied, no anc  
  now: AssertionError: expected [ 'create_session', …(2) ] to deeply equal [ 'close_open_turn', …(3) ]

## Frozen (sha256 at slice-base)

```
b030a7f8b03f15e2edd83cf4dfd8e9a458157ddc11c7db3063e3dcc73ad72a6c  docs/refactor/design/orchestration-2026-10/slices/slice-K-SPEC.md
de40e52b63f8d99cc71910cf65fa7f41f71808f4d4acf8090a93dd0efb51bb71  tests/app/A2-runtime-capabilities.test.ts
34be632df85079c041834625118f022974cf1fd51f4701e5eeb7129211b9ec2c  tests/composition/R3c-R4b-platform.test.ts
32c200054419723c7d23a88852cc8c5a01e6c2669b086a2d605cc1ad26f710c5  tests/kernel/B2-history-public-export.test.ts
abf05018d9ccaa55a3a0b8aeb77f3134407fd9600f519e523ba82a7affca70d9  tests/kernel/R4a-frozen-public.test.ts
4922fae29950456fc3221723cc50af7fadbd633a836ff155b4bc3d0c167c6a41  tests/scenarios/A4-duplicate-receipts.test.ts
4b129fb935a9981c47e8df9bf90bd1246a66279d774b4bf3a78327684baea4dd  tests/scenarios/A7-control-goal29.test.ts
2495612afb682301c2e420f87be36269ec4b9e77ce45487b06c6680fb0390834  tests/scenarios/A7-control.test.ts
fd34cdcfb52018e96e6e82b6cfa498ae0916f7da975bd97fcec8c5ac0dc93230  tests/scenarios/A8-host-restart-entry.test.ts
931be9412d453bced0e3c6dffeee65a675537029cc44b4e2e5190f55f80174bc  tests/scenarios/A8-host-restart-lease.test.ts
ace88ddae5e53fc6989a66642f14d72b29822a824d228cddfeb671e830a99958  tests/scenarios/A8-host-restart-paused.test.ts
54e7aec707b54a7d6e4b43c051258151fbb20832c00d87824a2b480a28f303be  tests/scenarios/A8-host-restart.test.ts
2e3d3183ff0eedf35593c7086902161d24f73b62712b383212ae032ac731af52  tests/scenarios/C3-paused-continue-brief.test.ts
2ee0965354c862328e0af29c83cd5fda9ebd770cf66dfc52ed9f468a62101be0  tests/scenarios/WP1-wiring.test.ts
75794e0e527cd4ebdb04b5da2417fc18088c12f1ad3fd4e7e914c67781c135d6  tests/scenarios/harness.test.ts
```
