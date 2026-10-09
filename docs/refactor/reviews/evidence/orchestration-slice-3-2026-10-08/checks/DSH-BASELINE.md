# DSH-BASELINE.md

Written by the lead on the untouched copy, before part 1. Each command ran in this copy, at its baseline commit, in the same sandbox your commands run in.

- `npm run typecheck`: exit 0.
- `npm run check:architecture`: exit 0 (last line `next source boundaries: OK`).
- The 11 new test files do not exist yet.
- The regression command of the book (`npx vitest run` with the 50 files, in the book's order): exit 1. Run twice; the same numbers and the same failing tests both times.

```
Test Files  19 failed | 31 passed (50)
Tests  63 failed | 1028 passed | 29 skipped (1120)

per file (passed / failed / skipped):
tests/runtime/B1-kernel-assembly.test.ts  6 / 0 / 0
tests/runtime/B2-runtime-execution.test.ts  26 / 0 / 0
tests/runtime/C2-runtime-platform-tools.test.ts  6 / 0 / 0
tests/runtime/W2-role-skills.test.ts  5 / 0 / 0
tests/app/AG6-agent-assembly.test.ts  3 / 0 / 0
tests/kernel/R4a-frozen-public.test.ts  19 / 0 / 0
tests/work-graph/R5b-initial-plan.test.ts  2 / 0 / 0
tests/runtime/R5b-query-session-loop.test.ts  4 / 0 / 0
tests/app/AG2-consultation.test.ts  4 / 0 / 0
tests/app/AG2b-collaboration.test.ts  1 / 2 / 0
tests/app/orchestration-mechanism.test.ts  14 / 1 / 0
tests/runtime/orchestration-boundaries.test.ts  5 / 0 / 0
tests/runtime/R4c-session-continuity.test.ts  4 / 0 / 0
tests/runtime/R4-control-runtime.test.ts  4 / 0 / 0
tests/runtime/R2e-git-source-loop.test.ts  2 / 0 / 0
tests/runtime/source-text-loop-migration.test.ts  2 / 0 / 0
tests/contracts/A2-rework-contract-helpers.test.ts  45 / 0 / 0
tests/runtime/C3-brief-timeline.test.ts  3 / 0 / 0
tests/scenarios/A1-rework-same-session.test.ts  0 / 1 / 0
tests/scenarios/C3-brief-idempotency.test.ts  0 / 4 / 0
tests/scenarios/C3-not-entered-chain.test.ts  0 / 1 / 0
tests/scenarios/C3-workspace-changed.test.ts  0 / 1 / 0
tests/scenarios/C3-paused-continue-brief.test.ts  0 / 1 / 0
tests/scenarios/C3-reply-other-session.test.ts  0 / 3 / 0
tests/scenarios/A7-control.test.ts  10 / 14 / 0
tests/scenarios/A7-control-goal29.test.ts  1 / 1 / 0
tests/scenarios/A4-duplicate-receipts.test.ts  2 / 4 / 0
tests/composition/A2-requeue-platform.test.ts  0 / 5 / 0
tests/scenarios/C5-gate-fix.test.ts  0 / 2 / 0
tests/scenarios/A8-host-restart-entry.test.ts  1 / 7 / 0
tests/scenarios/A8-host-restart-paused.test.ts  1 / 5 / 0
tests/scenarios/A8-host-restart.test.ts  9 / 3 / 0
tests/state/invariants.test.ts  0 / 0 / 29
tests/state/invariants-fuzz.test.ts  12 / 1 / 0
tests/architecture/boundaries.test.ts  29 / 0 / 0
tests/architecture/state-writes.test.ts  19 / 0 / 0
tests/architecture/production-reach.test.ts  4 / 0 / 0
tests/work-graph/R3g-role-spec.test.ts  17 / 0 / 0
tests/work-graph/B2-execution-entry.test.ts  13 / 0 / 0
tests/work-graph/C2-mailbox-admission.test.ts  7 / 0 / 0
tests/work-graph/R5b-query-execution.test.ts  1 / 0 / 0
tests/runtime/R4c-graph-history.test.ts  16 / 0 / 0
tests/runtime/R4c-execution-history.test.ts  8 / 0 / 0
tests/runtime/source-tool-lifecycle.test.ts  16 / 0 / 0
tests/runtime/W2-whiteboard-tools.test.ts  10 / 0 / 0
tests/composition/AG1-session-discovery.test.ts  2 / 0 / 0
tests/state/run-machine.test.ts  279 / 0 / 0
tests/state/query-run-recovery.test.ts  76 / 0 / 0
tests/state/no-progress.test.ts  337 / 0 / 0
tests/scenarios/A11-no-progress.test.ts  3 / 7 / 0

failing tests, by name (file > test):
tests/app/AG2b-collaboration.test.ts > AG2b continuous communication over the real Host HTTP > releases a busy B, runs two wait rounds and completes the real Task/Goal
tests/app/AG2b-collaboration.test.ts > AG2b continuous communication over the real Host HTTP > reopens read-only over the original messages/Query/history and refuses another scope
tests/app/orchestration-mechanism.test.ts > runs two explicitly selected same-Goal Tasks in independent Sessions with overlapping real provider calls
tests/scenarios/A1-rework-same-session.test.ts > A1 (C8, §15.2 5.8, AV-12, W-21, L-3, C3): a FAILed round is requeued automatically, claimed in Run 1's Session with the brief, passes and completes the Goal
tests/scenarios/C3-brief-idempotency.test.ts > C3-R1 (W-24), W-02, W-05 → RUN-16 → RUN-03: one requeue Run passes every crash point before the Kernel and keeps one brief
tests/scenarios/C3-brief-idempotency.test.ts > C3-R1 (W-24) with the source changed before the Workflow prepares again: the second prepare is another manifest whose brief differs only in the workspace facts; the Run was still Claimed, so it is the one authorized
tests/scenarios/C3-brief-idempotency.test.ts > C3-R2 (W-25): after a restart the facts Run's Kernel store is not registered (host_config): prepare answers unavailable, pins no degraded brief and changes nothing; the Workflow waits and retries, and binds the full brief once the store is readable
tests/scenarios/C3-brief-idempotency.test.ts > C3-R2 (W-25) with a transient Kernel read: the Kernel store is held by another process at the restart and at the prepare; the probe proves nothing (H-03), prepare answers unavailable, pins no degraded brief and changes nothing; once the store is free the next advance binds the full brief
tests/scenarios/C3-not-entered-chain.test.ts > C3 (D-7, factsFrom): Run 2 cancelled while Claimed never enters the Kernel; the person's requeue opens Run 3 whose brief says so and lists the failed check and the changed file from the earlier Run 1; only Run 1 and Run 3 call the model
tests/scenarios/C3-workspace-changed.test.ts > C3 (GAP-49): the source is D1 at the requeue and D2 at the prepare; the brief says "重新入队 → 本次执行开始前：有变化（具体文件无法从持久记录确定）" and lists the uncommitted files
tests/scenarios/C3-paused-continue-brief.test.ts > C3/C4: a Run a person paused, with a steer the Kernel never accepted, ends paused-interrupted at the restart; an Agent's 继续 is forbidden and leaves no brief and no Run; the person's 继续 opens Run 2 whose brief says paused by a person and carries the steer text
tests/scenarios/C3-reply-other-session.test.ts > C3 (P17, same Session): Run 2 continues in Run 1's Session; the reply enters once through run.input_accepted and the brief lists only its reference
tests/scenarios/C3-reply-other-session.test.ts > C3 (P17, other Session): with Run 1's Session archived, Run 2 continues in another Session and its brief carries the bounded reply text
tests/scenarios/C3-reply-other-session.test.ts > C3 (P17, another Task's Session): with Run 1's Session archived and another work Task's Session reusable, Run 2 continues there without Run 1's history (other_session) and its brief carries the bounded reply text
tests/scenarios/A7-control.test.ts > A7 entered Run: a pause lands at the next safe point, a steer waits while the Run is paused, the resume re-enters the original Turn where the Kernel accepts the steer; the applied pause is never rewritten and a control on the ended Run is busy
tests/scenarios/A7-control.test.ts > A7 yielded wait: the yielded terminal keeps the queued steer (no terminal_without_cancel); after a real reply the continuation claim consumes the wait, and the yielded Run takes no control (RD-8)
tests/scenarios/A7-control.test.ts > goals/control pause, then resume: the claimed Run is paused and resumed by the fan-out; a paused Goal starts nothing; the Goal completes
tests/scenarios/A7-control.test.ts > VD-9: a paused Goal opens no round and begins no check; after the resume the same chain completes
tests/scenarios/A7-control.test.ts > GOAL-11/14 with a live Kernel Turn: the fan-out pause lands at the next safe point; the resume re-enters the original Turn
tests/scenarios/A7-control.test.ts > GOAL-14 retry: a resume sent while the fan-out pause is still queued follows once the pause lands; the Turn is re-entered and completes
tests/scenarios/A7-control.test.ts > A7-G2 (G-01, G-02, GOAL-16, GOAL-14 at a restart): a Goal pause committed on a Host without the lease reaches no Run; the next start submits the fan-out pause once and the platform pauses the not-entered Run; a further start and a replay of the same request skip it; a Goal resume committed without the lease is submitted once by the next start; the same claim completes
tests/scenarios/A7-control.test.ts > G-04 and GOAL-29: a Run the Goal fan-out paused ends paused-interrupted at the restart; resuming the Goal continues it under the fan-out actor in a new Session
tests/scenarios/A7-control.test.ts > A7-G4b (G-05): a fan-out pause still queued when the Host crashed ends the Run paused-interrupted (RUN-24 kernelPaused:false, CTL-08(f)); the Goal resume continues it under the fan-out actor with a brief
tests/scenarios/A7-control.test.ts > A7-G4b contrast (G-01 at a crash): a fan-out pause never submitted before the crash leaves a plain interruption (RUN-19); the Goal resume continues nothing and the automation requeues it, uncounted
tests/scenarios/A7-control.test.ts > A7-G5 (§12.10 order): a person's own pause stays through the Goal pause and resume; the Host stops while the Goal is paused; the Goal resume after the restart, in process and at the next start, leaves the Task paused-interrupted until the person's 继续
tests/scenarios/A7-control.test.ts > G-04 and G-06 at a restart: a Goal resumed (and paused and resumed again) on a Host without the lease continues its paused-interrupted Task exactly once at the next start
tests/scenarios/A7-control.test.ts > §2.3 step 2 (5.6 FINAL #28): the start-up resume pass skips an entered Run that step 2 left (W-07); the next start classifies it (RUN-24) and GOAL-29 continues it at once (G-04)
tests/scenarios/A7-control.test.ts > GOAL-29 after a person's 继续 (G-04 "存在 → 跳过", the sequential order of `already_continued`): the start-up continuation skips a Run a TaskRequeue covers; exactly one TaskRequeue, the person's
tests/scenarios/A7-control-goal29.test.ts > A7-G4 with history (GOAL-29, LA-1, contract (e)): a Run the Goal fan-out paused after an earlier completed Turn of its Session is continued by the Goal resume in a new Session seeded with that history; the first request carries the earlier Turn, never the interrupted one
tests/scenarios/A4-duplicate-receipts.test.ts > A4 (领取、发信、记录结果): every step of a Run, its rounds and the Goal completion, sent again after its answer is lost — on the same Host or after a crash — returns the original receipt; no Kernel start, model call, check process or write is added
tests/scenarios/A4-duplicate-receipts.test.ts > A4, W-23: a requeue and its committed refusal that fail inside the commit leave nothing; after the restart the same request commits once, and every later copy — same Host, after a crash, from the operator — replays the original receipt
tests/scenarios/A4-duplicate-receipts.test.ts > A4, C-05: an automatic reverify and its committed refusal that fail inside the commit leave nothing; after the restart the same request commits once and every later copy replays the original receipt
tests/scenarios/A4-duplicate-receipts.test.ts > A4 (记录结果): the Runtime's result write that failed (the ledger locked while the Kernel ended the Turn) is retried with the same identity by the re-sent start: the terminal is written once, no Kernel Turn or model call is added, a further copy writes nothing
tests/composition/A2-requeue-platform.test.ts > D-3: FAIL → TaskRequeue (P4) → requeue claim with the continuation brief → no_new_basis refusal → note → PASS completes
tests/composition/A2-requeue-platform.test.ts > §4.3 / §4.4: 0-commit refusals of a requeue — shape, pins, a verifying Task and new inputs (ND-9)
tests/composition/A2-requeue-platform.test.ts > TASK-03 (§4.3): the Workflow claims a requeue with the budget it pins; a claim with another budget is invalid
tests/composition/A2-requeue-platform.test.ts > C3 (§6.1 (e), RUN-02/03, I-19): a requeue Run binds one brief; prepare rehydrates it and the driver refuses another
tests/composition/A2-requeue-platform.test.ts > W-21 / C3: an archived afterRun Session moves the requeue to a new Session; the brief lists the message Run 1 accepted
tests/scenarios/C5-gate-fix.test.ts > C5 gate fix (§15.2 5.9, GV-8/GV-9, P20, TASK-15): a FAILed gate stops as gate_needs_fix, a fix Task repairs it, and the automatic re-verification completes the Goal
tests/scenarios/C5-gate-fix.test.ts > C5 control: a fix that does not repair the failure FAILs its own round, the gate is not re-verified, and the Goal reason comes from the fix Task
tests/scenarios/A8-host-restart-entry.test.ts > A8-2a, A8-1c (W-05, W-03, RUN-16, RUN-03, I-19): an Entering Run with no Kernel Turn is revoked at the restart and the same claim re-authorizes with the bound brief; on, the start-up re-drive does it at once; off, the revoked Run (W-03) waits, and a later start with the re-drive on re-drives it without a workflow/advance
tests/scenarios/A8-host-restart-entry.test.ts > A8-2a with a queued cancel (W-05, RUN-16 + RUN-09, CTL-08(a)): a cancel submitted while the Run is Entering stays queued; the restart revokes the entry and ends the Run cancelled in the same commit, releasing its claim
tests/scenarios/A8-host-restart-entry.test.ts > A8-2b, L-2, L-1 (W-06, W-15, RUN-20(ii), RUN-22, ATT-36, ATT-37, ATT-29): an Entering Run with the Kernel unreadable ends outcome_unknown without a Turn; with the Kernel back it waits for evidence; a Host without the lease cannot attest it, the lease Host settles the pending Outbox
tests/scenarios/A8-host-restart-entry.test.ts > A8-2b, SES-07, SES-19, H-01 (W-06, RUN-22, LA-1): attested while the Kernel is still unreadable, the Session is retired kernel_turn_open in place of missing; a start with the Kernel still missing keeps it; with the Kernel back and its last Turn ended, the probe returns it to available
tests/scenarios/A8-host-restart-entry.test.ts > A8-2c (W-07, H-03, CI-10, then W-05 with RUN-09): under a host_config probe an Entering Run and its queued cancel are left as they are; the next start with the Kernel registered revokes the entry and ends the Run cancelled in the same commit
tests/scenarios/A8-host-restart-entry.test.ts > A8-1b (W-02, I-19, LA-6, §12.1 step 6b (b)): a requeue Run authorized and never begun is re-driven by the start-up re-drive with no workflow/advance; the bound brief is rebuilt (rehydratePreparedExecution): the same digest after the source changed, the same permit
tests/scenarios/A8-host-restart-entry.test.ts > A8-1a requeue variant (W-01, W-24, C3, LA-6): a requeue Run claimed and never prepared is re-prepared by the start-up re-drive; its brief is assembled then, from the workspace as it is at that prepare
tests/scenarios/A8-host-restart-paused.test.ts > A8-3l, A8-3p (W-20, RUN-24, LA-1, C3, C4, §13.4 #23/#24): a Run paused by a person ends paused-interrupted at the crash; only a person continues it, in a new Session seeded with the old completed history; the Kernel refuses the old Session; the next Run in the new Session sees only that Session's own Turns
tests/scenarios/A8-host-restart-paused.test.ts > A8-3n (W-11, RUN-19, LA-7, §13.4 #17, LA-6): the Kernel paused, a resume queued, the crash before the re-entry: an ordinary interruption with the resume superseded; the start-up re-drive requeues it uncounted into a new Session seeded with the old history, and a later check failure counts as usual
tests/scenarios/A8-host-restart-paused.test.ts > A8-3q, A8-3o (W-21, W-20, HL-06, HL-01, LA-1, SES-02): a Run paused by a person ends paused-interrupted after a normal close as after a crash; another Task of the same role is never claimed into its retired Session; it runs in another Session with no Entering→Revoked loop
tests/scenarios/A8-host-restart-paused.test.ts > a Run paused at a safe point when its Host stopped ends paused-interrupted at the restart; a second start keeps its Session retired and writes nothing; 继续 continues the Task in a new Session
tests/scenarios/A8-host-restart-paused.test.ts > LA-1 and contract (e) (A8-3l step 5, A8-3r): the continuation in a new Session is seeded with the original Session's completed history and says so; a later requeue after a never-entered continuation keeps that source
tests/scenarios/A8-host-restart.test.ts > A8-3a (W-09, RUN-18, ATT-08, SES-06): the Kernel wrote the Turn's terminal but its result was never booked; the restart books the Kernel's own terminal, releases the Session at the full boundary, and the Workflow goes on
tests/scenarios/A8-host-restart.test.ts > §12.1 step 6b (LA-6, W-01): a claimed Run left by a stopped Host is re-driven with the same claim at the next start, unless the Host setting turns the re-drive off
tests/scenarios/A8-host-restart.test.ts > §12.1 step 6b (a), W-11, RUN-19, §13.4 #17, LA-1: an interrupted Run is requeued by the start-up re-drive, uncounted, in a new Session; off, only a workflow/advance requeues it, with the same identity from any flow (W-23)
tests/state/invariants-fuzz.test.ts > coverage: every kind of operation the row lists actually ran (counts merged over the seeds)
tests/scenarios/A11-no-progress.test.ts > §13.4 #15/#21, AV-8/AV-9, GOAL-27/30: the cap stops the automation, a raised cap meets a committed refusal, the other Task runs and the stale refusal is retried once
tests/scenarios/A11-no-progress.test.ts > A11 #2, #25, #21 (不改文件), #22, ND-3, #20: the same failure twice stops at refusal @1 with no new Attempt or model call; a platform body is invalid; a stale refusal is retried once and stops at @2; a reason is no new basis, a note or a new Artifact is, the same one again is not
tests/scenarios/A11-no-progress.test.ts > A11 #14 (ND-4), #6 (L-4): a Run that changed an unrelated file lets the second requeue pass; an unrelated adoption changes no key, so the request it made stale is re-made and refused
tests/scenarios/A11-no-progress.test.ts > A11 #15: an automatic requeue past the limit is the committed auto_rework_cap_reached refusal (before any source capture); the operator's requeue then passes and counts 0
tests/scenarios/A11-no-progress.test.ts > A11 #1, #3, #10 (ND-3), #5, #11: the first requeue passes; a Run that changed a file passes; a source back at S1 meets the first key; another reason is no new basis; a manual edit after the failure is
tests/scenarios/A11-no-progress.test.ts > A11 #7, #8: c1 turning PASS while c2 FAILs is another failure, so the requeue passes on the same source; after a Run that ended outcome_unknown every requeue is busy before any policy step
tests/scenarios/A11-no-progress.test.ts > A11 #4: a message its recipient has answered is a new basis, so the requeue passes; the same message before the answer is not admitted
```

## Why these fail here

This sandbox has no `/usr/bin/bwrap`. Every check step is rejected (`ENOENT: no such file or directory, access '/usr/bin/bwrap'`), so the Tasks that need a check stay `waiting` instead of completing (most messages read `expected 'waiting' to be 'completed'` or `... to be 'stopped'`). `tests/state/invariants.test.ts` fails in its shared setup for the same reason (`requeue 1: ... finalize_first: round ... of the selected Run is open`), so its 29 tests are skipped. The two AG2b tests time out (30000 ms) waiting for a completion that needs a check.

At the same commit, where `/usr/bin/bwrap` exists, the same 19 files pass in full: 146 of 146 tests.

These failures are not caused by your change and are not yours to fix. Compare per file and per test name: a regression is any change from these numbers or names.
