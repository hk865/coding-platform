Found **five concrete issues**. No files changed; no tests run.

1. **User-decision replay omits `responseSince` binding.**  
   **Spec:** [line 168](/D:/cxt/w2-spec/docs/refactor/design/orchestration-2026-10/slices/wiring-2-SPEC.md:168), and §6’s file list.  
   **Problem:** The first user answer returns a bound cursor through the mailbox writer, but retrying `answerDecision` takes a separate replay path and returns the event’s `responseSince:null`.  
   **Evidence:** [communication/decision-service.ts:replayMessage](/D:/cxt/w2-spec/src/core/work-graph/communication/decision-service.ts:357) returns `sessionMessageFromEvent(...).value` unchanged; `answerDecision` calls it on receipt lookup at line 726.  
   **Fix:** Include this file and bind the explicit null using the original receipt cursor through the proposed state helper. Extend NR25 to assert identical fields on first answer, retry, and reopen.

2. **NR24 requires an impossible first retirement through `recordRunResult`.**  
   **Spec:** [line 29](/D:/cxt/w2-spec/docs/refactor/design/orchestration-2026-10/slices/wiring-2-SPEC.md:29), lines 166, 329 and W224.  
   **Problem:** NR24 requires this operation to leave `kernel_turn_open` and write a new retirement position. It cannot do so under current code.  
   **Evidence:** [tasks/execution-entry-service.ts:recordRunResult](/D:/cxt/w2-spec/src/core/work-graph/tasks/execution-entry-service.ts:1867) selects only `terminal_observed`, `reconcile_terminal`, or `late_evidence`. Their handlers in `state/run-machine.ts`—`onTerminalObserved` (1539), `onReconcileTerminal` (2131), `onLateEvidence` (2283)—all release with `kernelTurnOpen:false`. [state/session-availability.ts:releaseSessionRecord](/D:/cxt/w2-spec/src/core/work-graph/state/session-availability.ts:378) then preserves health. An unresolved terminal retains occupancy.  
   **Fix:** Test first retirement through health observation, Work reconciliation/attestation, and Query recovery. Test ordinary result recording for preservation of an existing retirement position. Remove the unreachable binding requirement and reconsider W224; update counts accordingly.

3. **A legacy reply in another Goal can block a filtered query.**  
   **Spec:** [line 236](/D:/cxt/w2-spec/docs/refactor/design/orchestration-2026-10/slices/wiring-2-SPEC.md:236), followed by Goal filtering at line 237.  
   **Problem:** The literal sequence rejects missing R/P before filtering by Goal. A valid legacy reply belonging to Goal A therefore breaks a query for Goal B, even when B’s positions are complete.  
   **Evidence:** [communication/mailbox-service.ts:readUndeliveredReplies](/D:/cxt/w2-spec/src/core/work-graph/communication/mailbox-service.ts:3266) enumerates messages by sender Session; [views/decision-read-model.ts:readDecisionQueueWindow](/D:/cxt/w2-spec/src/core/work-graph/views/decision-read-model.ts:496) passes the requested Goal to the provider and immediately propagates its failure.  
   **Fix:** Establish message ownership and Goal first; exclude proven out-of-scope items before requiring positions. Keep explicit failure for the affected Goal and unfiltered Workspace query. Add this distinction to NR28.

4. **Unconditional rejection propagation bypasses the promised window retry.** *Retained from the previous draft.*  
   **Spec:** [line 240](/D:/cxt/w2-spec/docs/refactor/design/orchestration-2026-10/slices/wiring-2-SPEC.md:240): propagate `rejected` unchanged, but retry unstable windows four times.  
   **Problem:** A commit between directory pages produces an immediate rejection, so the implementation never reaches its final watermark comparison or retry.  
   **Evidence:** [sessions/session-directory.ts:findSessions](/D:/cxt/w2-spec/src/core/work-graph/sessions/session-directory.ts:1652) returns `source_stale` when the continuation cursor’s watermark changes. The queue also immediately returns provider failures.  
   **Fix:** Explicitly classify directory `source_stale` as a whole-window retry: discard accumulated rows and cursors, then restart within the four-attempt bound. Add this actual failure shape to NR14.

5. **The source can ignore `atLeastCursor` when there are no retired Sessions.** *Retained from the previous draft.*  
   **Spec:** [lines 235–236](/D:/cxt/w2-spec/docs/refactor/design/orchestration-2026-10/slices/wiring-2-SPEC.md:235).  
   **Problem:** Only mailbox calls receive the requested minimum cursor. An empty/all-active directory makes no mailbox call and can return `available/[]` below that minimum.  
   **Evidence:** [sessions/session-directory.ts:findSessions](/D:/cxt/w2-spec/src/core/work-graph/sessions/session-directory.ts:1655) already supports this check. The outer [decision-read-model.ts:readDecisionQueueWindow](/D:/cxt/w2-spec/src/core/work-graph/views/decision-read-model.ts:562) catches it for production queue requests, so the defect is confined to the source contract.  
   **Fix:** Forward `page.atLeastCursor` to `findSessions`; add an empty/all-active NR13 branch.

The permanence change at spec line 165 fixes a **pre-existing Session defect** under decision 38 and slice 1’s retirement rules. It can remain an explicitly scoped prerequisite in this package: first-retirement-only `retiredSince` depends on retirement being permanent. It changes behavior currently asserted by:

- [tests/state/session-availability.test.ts](/D:/cxt/w2-spec/tests/state/session-availability.test.ts:831): “a closed head clears it”; “SES-13 clears it” (840); “clears the conclusion with available” (1114), plus the exhaustive transition matrix.
- [tests/scenarios/A8-host-restart-entry.test.ts](/D:/cxt/w2-spec/tests/scenarios/A8-host-restart-entry.test.ts:181): **A8-2b, L-2, L-1**, and **A8-2b, SES-07, SES-19, H-01** (272).
- [tests/scenarios/A8-host-restart.test.ts](/D:/cxt/w2-spec/tests/scenarios/A8-host-restart.test.ts:666): **W-14 then W-07, W-15 and RUN-22 on a readable Kernel**.

The **five highest-risk test areas** are:

1. Every real retirement writer: atomic health/R binding, rollback, archive preservation, and permanent retirement.
2. Work, Query Answer and user-decision replies: atomic P binding and identical first/replayed/reopened results.
3. Both U1 orderings, especially an old reply retiring after another notice was marked seen; equal/backward clocks must not matter.
4. Multiple replies sharing R: full-key pagination, display-token advancement, acceptance removal, and `source_stale` retries.
5. Legacy compatibility: ordinary reads and unrelated Goals remain usable; affected notice reads fail explicitly; empty sources honor minimum watermarks.

**Verdict: freeze after listed fixes.**