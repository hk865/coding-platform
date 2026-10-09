**Do not merge yet.** HEAD is `216e0e2b`. This was a static, read-only review; no files were changed and no tests or package commands were run.

| LEAD fix | Verdict | Current-file evidence |
|---|---|---|
| LA1 | **DEFECT** | [plan-readers.ts:704](D:/cxt/s5areas-final/src/core/work-graph/tasks/plan-readers.ts:704), [decision-read-model.ts:1116](D:/cxt/s5areas-final/src/core/work-graph/views/decision-read-model.ts:1116): an older accepted candidate can override a newer abandoned head. See D1. |
| LA2 | **OK** | [decision-read-model.ts:778](D:/cxt/s5areas-final/src/core/work-graph/views/decision-read-model.ts:778): missing adapter returns named `unavailable`. |
| LA3 | **OK** | [plan-readers.ts:717](D:/cxt/s5areas-final/src/core/work-graph/tasks/plan-readers.ts:717): exhausted consistency retries return `unavailable`. Capacity handling remains separate. |
| LA4 | **OK** | [decision-read-model.ts:875](D:/cxt/s5areas-final/src/core/work-graph/views/decision-read-model.ts:875): terminal candidates have `candidateStatus: null`. |
| LA5 | **OK** | [plan-readers.ts:667](D:/cxt/s5areas-final/src/core/work-graph/tasks/plan-readers.ts:667): independent terminal candidates enter history; [decision-read-model.ts:852](D:/cxt/s5areas-final/src/core/work-graph/views/decision-read-model.ts:852) uses their proposal identity. |
| LB3 | **OK** | [plan-service.ts:415](D:/cxt/s5areas-final/src/core/work-graph/tasks/plan-service.ts:415): absent/null attribution is omitted. Compared with HEAD’s function and caller, the canonical payload—and therefore fingerprint—is byte-identical. |
| LB4 | **OK** | [decision-service.ts:353](D:/cxt/s5areas-final/src/core/work-graph/communication/decision-service.ts:353): foreign Workspace returns `forbidden` before reading. |
| LB5 | **OK** | [decision-service.ts:527](D:/cxt/s5areas-final/src/core/work-graph/communication/decision-service.ts:527): exact positive message pin is checked before the application shortcut. |
| LB6 | **OK** | [decision-service.ts:363](D:/cxt/s5areas-final/src/core/work-graph/communication/decision-service.ts:363), [:385](D:/cxt/s5areas-final/src/core/work-graph/communication/decision-service.ts:385): only explicit `missing` means absence; unexplained omission is `unavailable`. |
| LC1 | **OK** | [collaboration-driver.ts:886](D:/cxt/s5areas-final/src/app/collaboration-driver.ts:886): exemption is limited to pinned `select_work` following successful `complete_task`; Goal-wide reselection remains ordered. |
| LC2 | **OK** | [collaboration-driver.ts:985](D:/cxt/s5areas-final/src/app/collaboration-driver.ts:985), [:558](D:/cxt/s5areas-final/src/app/collaboration-driver.ts:558): stopping releases admission immediately; cleanup removes the entry and releases the pass. |
| LD1 | **DEFECT** | [goal-settings-service.ts:541](D:/cxt/s5areas-final/src/core/work-graph/tasks/goal-settings-service.ts:541), [decision-actions.ts:225](D:/cxt/s5areas-final/src/business/workflow/decision-actions.ts:225): fixes revision-drift replay, but leaves coordinator read-before-replay and malformed-pin replay defects. See D2/D10. |
| LD2 | **OK** | [decision-actions.ts:227](D:/cxt/s5areas-final/src/business/workflow/decision-actions.ts:227), [:238](D:/cxt/s5areas-final/src/business/workflow/decision-actions.ts:238): post-answer read failures appear in `action`, preserving the committed answer. |

For LD1 specifically: **different valid decisions do not collide**—the full source, selection and message reference remain fingerprinted. First-execution supplementary CAS remains exact, including the earlier GoalPhase and uncaptured ordering Goals. The coordinator preserves captured Goal pins. Normal automation keys and the D→C ordering contract also match; the exceptions are below.

1. **D1 — must-fix: closed request history can select the wrong proposal.**  
   [plan-readers.ts:704](D:/cxt/s5areas-final/src/core/work-graph/tasks/plan-readers.ts:704); [decision-read-model.ts:1116](D:/cxt/s5areas-final/src/core/work-graph/views/decision-read-model.ts:1116).  
   **Spec:** §4.2:782; A1’s “request’s last head.”  
   Adoption releases the request slot (`plan-machine.ts:1689`), and request facts do not prohibit reacquisition. Thus **P1 accepted → P2 created for the same request → P2 abandoned** is permitted, but LA1 selects P1. The history card visibly jumps backward to P1’s objects/pins. Multiple abandoned ends also retain the documented lexical-order error.  
   **Direction:** determine the terminal head from formal chronology/head facts, not status precedence or ref-key order.

2. **D2 — must-fix: settings replay still depends on fresh business reads.**  
   [decision-actions.ts:225](D:/cxt/s5areas-final/src/business/workflow/decision-actions.ts:225).  
   **Spec:** §4.5:884; §8.2:1366.  
   After `:settings` commits, retrying `conflict_wait` still reads GoalPhase at line 176; `conflict_order` reads uncaptured Goals at line 155. Failure returns at line 227 before reaching the owner’s receipt lookup. LD1 handles changed revisions, but cannot recover an existing receipt during these read failures.  
   **Direction:** durably recover the settings receipt before deriving supplementary pins; derive them only for first execution.

3. **D3 — must-fix: paused GATE confirmation cards disappear.**  
   [decision-policy.ts:195](D:/cxt/s5areas-final/src/core/work-graph/state/decision-policy.ts:195); [goal-decision-reader.ts:357](D:/cxt/s5areas-final/src/core/work-graph/tasks/goal-decision-reader.ts:357).  
   **Spec:** §8.2:1357; §4.5:888.  
   Pause an `every_step` Goal after its gate emits an automatic-reverification confirmation. The verdict becomes `none`; paused gate derivation returns null. Both queue discovery and canonical answer validation lose the cause, making the previously displayed card unanswerable.  
   **Direction:** supply the missing formal gate facts and preserve the cause through the shared derivation.

4. **D4 — must-fix: Agent adoption attribution is unreachable through the runtime tool.**  
   [whiteboard-tools.ts:211](D:/cxt/s5areas-final/src/core/agent-runtime/whiteboard-tools.ts:211), [:305](D:/cxt/s5areas-final/src/core/agent-runtime/whiteboard-tools.ts:305).  
   **Spec:** §0 L1; §3.3:621.  
   `apply_future_plan` neither accepts nor forwards `acknowledgementRef`/`decisionSource`. An otherwise authorized Agent adoption after a user answer therefore produces no application proof; subsequent recording returns `incomplete`. The owner correction alone does not complete this path.  
   **Direction:** connect attribution through the tool while preserving existing adoption authorization.

5. **D5 — must-fix: runtime application retries cannot reach receipt replay during read failures.**  
   [communication-tools.ts:553](D:/cxt/s5areas-final/src/core/agent-runtime/communication-tools.ts:553).  
   **Spec:** §3.3:627; §8.2:1366.  
   An identical retry after application recording committed first re-reads the message/reader facts. Any failure exits before `recordDecisionApplication`, although its saved receipt could restore success. LB-2 fixes pin drift, not this ordering.  
   **Direction:** allow receipt recovery before the runtime’s current-message read.

6. **D6 — must-fix: resolved initialization cards remain pending forever.**  
   [decision-read-model.ts:895](D:/cxt/s5areas-final/src/core/work-graph/views/decision-read-model.ts:895), [:611](D:/cxt/s5areas-final/src/core/work-graph/views/decision-read-model.ts:611).  
   **Spec:** **§0 L1**, which overrides the general pending-answer rule.  
   Answer a missing-architecture/completion-policy card, then adopt the missing initialization through the existing interface. B’s facts recognize the resolved source, but A reconstructs the saved answer and unconditionally keeps it pending. Application recording for these event kinds is intentionally unsupported, so the card cannot clear.  
   **Direction:** derive the explicit L1 `closed/source_resolved` state in both queue and direct-card reads.

7. **D7 — must-fix: `perform` can emit a confirmation that the source reader rejects.**  
   [workflow.ts:1224](D:/cxt/s5areas-final/src/business/workflow/workflow.ts:1224).  
   **Spec:** §4.5:888; §3.3:627; §8.2:1366.  
   Commit `perform(requeue_task)` under `after_plan_confirmation`, switch to `every_step`, then retry that perform. The gate uses the operation kind without checking the current automation verdict and can emit a new confirmation before owner replay. The reader skips the now-`claim_requeued` row (`goal-decision-reader.ts:339–363`), so canonical validation cannot find that emitted cause.  
   **Direction:** replay committed operations first; derive first-execution confirmations from the same formal actionable facts as the reader.

8. **D8 — must-fix: failed GoalPhase reads become “not completed.”**  
   [decision-source-facts.ts:267](D:/cxt/s5areas-final/src/core/work-graph/communication/decision-source-facts.ts:267).  
   **Spec:** §4.3:829; §8.2:1367.  
   `goalTerminal` converts unavailable/corrupt phase reads to `completed:false`. If a conflict member is actually completed but its phase read fails, successful Goal/Plan reads can still produce an open source and permit a new answer.  
   **Direction:** propagate phase-read failures; only explicit phase absence may mean no recorded completion.

9. **D9 — must-fix: capacity overflow silently makes queue items unreachable.**  
   [decision-read-model.ts:414](D:/cxt/s5areas-final/src/core/work-graph/views/decision-read-model.ts:414); [goal-conflicts.ts:159](D:/cxt/s5areas-final/src/core/work-graph/views/goal-conflicts.ts:159), [:175](D:/cxt/s5areas-final/src/core/work-graph/views/goal-conflicts.ts:175).  
   **Spec:** §4.1:772.  
   Beyond the source window, readers truncate and return `ready`; queue pagination traverses only that truncated collection. For example, later messages beyond a 5,000-record window remain inaccessible even after paging to the end. `countsComplete:false` does not expose a continuation. The 200-Goal ceiling is also unenforced.  
   **Direction:** enforce the specified limits and return `capacity`, rather than a successful truncated queue.

10. **D10 — should-fix: LD1 permits malformed supplementary pins on replay.**  
    [goal-settings-service.ts:543](D:/cxt/s5areas-final/src/core/work-graph/tasks/goal-settings-service.ts:543).  
    **Spec:** §3.3:613, 625.  
    After a successful wait, remove its phase pin, duplicate it, or give it a negative/fractional revision. Filtering removes these differences from the fingerprint, and replay succeeds before `exactPins`. This is an invalid-command collision, not a collision between different valid decisions.  
    **Direction:** validate complete pin shapes/identities before replay, without restoring mutable supplementary revisions to the fingerprint.

11. **D11 — should-fix: A still disagrees with B about unreadable records.**  
    [decision-read-model.ts:1152](D:/cxt/s5areas-final/src/core/work-graph/views/decision-read-model.ts:1152); [goal-conflicts.ts:179](D:/cxt/s5areas-final/src/core/work-graph/views/goal-conflicts.ts:179).  
    **Spec:** §8.2:1367.  
    A’s `readOne` maps an unexplained ready-batch omission to absence, where LB6 now returns `unavailable`. Workspace enumeration also silently skips undecodable Goals. These produce missing cards/Goals instead of an honest read failure.  
    **Direction:** apply explicit-missing and decode-failure handling consistently across both areas.

12. **D12 — should-fix: malformed decision objects fail after body storage.**  
    [mailbox-service.ts:1631](D:/cxt/s5areas-final/src/core/work-graph/communication/mailbox-service.ts:1631), [:1886](D:/cxt/s5areas-final/src/core/work-graph/communication/mailbox-service.ts:1886).  
    **Spec:** §3.3:614.  
    Empty aggregate labels or extra pin keys can reach body storage before codec rejection. No invalid message commits, but “nothing persisted” is inaccurate: an orphan body artifact can remain.  
    **Direction:** validate the complete object shape before storing its body.

13. **D13 — should-fix: `gatePerform` suppresses legitimate read failures.**  
    [workflow.ts:1216](D:/cxt/s5areas-final/src/business/workflow/workflow.ts:1216).  
    **Spec:** §4.5:888; §8.2:1367.  
    A well-formed perform whose Goal/graph read fails proceeds as though no gate applied. Owners independently enforce autonomy, so this does not establish an authorization bypass, but the caller can receive a generic refusal instead of the read failure or decision cause.  
    **Direction:** distinguish malformed requests delegated to the owner from failed reads of valid requests.

The recorded remaining/not-taken items resolve as follows:

| Recorded item | Judgment | Concrete reason |
|---|---|---|
| B: paused GATE cards | **Must fix before merge** | Pausing makes an existing confirmation unanswerable; D3. |
| B: runtime Agent attribution | **Must fix before merge** | Normal authorized adoption cannot be recorded end to end; D4. |
| B: runtime application pre-read | **Must fix before merge** | A committed operation cannot replay during a subsequent read failure; D5. |
| A: several `not_adopted` ends | **Must fix before merge** | Ordinary abandon/reacquire/abandon shows the wrong historical proposal. LA1 additionally mishandles an older accepted end; D1. |
| A: capacity/200-Goal limit | **Must fix before merge** | Accumulated history can become unreachable through pagination; D9. |
| D: Goal read before Workspace ownership check | **Agree for valid bound calls** | GoalRef lacks Workspace, so ownership needs discovery. Separately, `readGoalSettings:309` should reject a missing Workspace context before reading; malformed-context hardening can wait. |
| B: malformed object shapes | **Can wait; should-fix** | Invalid messages do not commit, but body artifacts can remain; D12. |
| Missing frozen coverage for A–D paths | **Coverage gap, not an independent runtime defect** | No contrary test result was inferred. Add targeted regressions for the corrections above; frozen-suite success does not establish these paths. |
| C: `start()` resolves before first advance | **Agree: not a defect** | No identified caller or frozen contract requires the async ordering read to finish before `start()` resolves. |
| C: thrown ordering read falls back to arrival order | **Agree: not a defect** | Matches the advisory ordering fallback; Workflow still performs its own admission. |
| C: no timeout on ordering seam | **Can wait** | A never-settling read blocks live advances, but LC2 releases stopped handles and close drainage. No slice-specific timeout requirement exists. |
| B: actor comparison omits Run identity | **Agree: not a defect** | The admitted actor is kind+id; a later Run of the same Session may record that actor’s earlier application. |
| B: `gatePerform` non-ready → no gate | **Can wait; should-fix** | Owners prevent an autonomy bypass, but failure reporting remains incorrect; D13. |
| B initial notes: caller-supplied perform invisible to reader | **Must fix before merge** | Still present, despite omission from the final remaining list; a valid committed-operation retry demonstrates it, D7. |