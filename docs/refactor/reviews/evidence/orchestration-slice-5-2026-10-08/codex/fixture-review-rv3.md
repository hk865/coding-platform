**Do not freeze yet.** I reviewed all 16 test files and six support files at `48c8d473` plus the working changes. No files changed; no Node, npm, npx, or tests ran.

All spec references below refer to `slice-5-SPEC.md`. Fixed earlier findings are omitted.

1. **Must-fix — shared message sources still contain their own message pin.**  
   **Locations:** [S5-decision-fixture.ts:840](D:/cxt/impl-s5-rv3/tests/helpers/S5-decision-fixture.ts:840), [S5-goal-settings-support.ts:580](D:/cxt/impl-s5-rv3/tests/helpers/S5-goal-settings-support.ts:580).  
   **Cases:** shared AP/DQ/SS preconditions, especially AP02–AP07 and DQ04/06/08. **Spec:** lines 224, 625.  
   Both constructors insert message@1 into `source.pins`. Line 224 explicitly excludes it; the current message pin belongs separately in `meta.expected`. Deduplicating request pins or filtering them at individual call sites does not repair the stored source.  
   **Direction:** remove self-pins from both stored question and answer sources; retain exactly one current message pin in answer requests. **Estimate: small.**

2. **Must-fix — ordinary responses use the synthetic-answer event.**  
   **Locations:** [S5-decision-fixture.ts:890](D:/cxt/impl-s5-rv3/tests/helpers/S5-decision-fixture.ts:890), [S5-goal-settings-support.ts:630](D:/cxt/impl-s5-rv3/tests/helpers/S5-goal-settings-support.ts:630).  
   **Cases:** consumers of the shared answered-message precondition. **Spec:** lines 228–230; S5-MSG-02/03.  
   These are ordinary work-run questions answered pending@1→responded@2, but their second event is `SessionMessageDecisionAnswered`. The spec reserves that event for synthetic answers and retains `SessionMessageResponded` for ordinary responses.  
   **Direction:** seed the ordinary response through its proper event codec. `fxA.md` requested the conflicting shape; this needs correction against the frozen spec. **Estimate: small.**

3. **Must-fix — the “free task” is already claimed.**  
   **Locations:** [S5-goal-settings.test.ts:165](D:/cxt/impl-s5-rv3/tests/work-graph/S5-goal-settings.test.ts:165), [S5-goal-settings-support.ts:492](D:/cxt/impl-s5-rv3/tests/helpers/S5-goal-settings-support.ts:492).  
   **Cases:** SS08, SS09, SS13. **Spec:** lines 1035–1036, 1040.  
   `freeClaim()` targets `b-work-2`, which the bootstrap already claimed for RB. SS08 nevertheless requires its execution to be null before reaching the barrier; SS09 expects a new first claim to succeed; SS13 again expects no execution. A correct implementation cannot satisfy these givens.  
   **Direction:** provide a genuinely unclaimed task while preserving RB for the preservation/authorization cases. **Estimate: small.**

4. **Must-fix — the planning Query is submitted after initial coordination is no longer admissible.**  
   **Location:** [S5-queue-support.ts:176](D:/cxt/impl-s5-rv3/tests/helpers/S5-queue-support.ts:176).  
   **Cases:** DQ01, DQ07. **Spec:** source 5, lines 784/788; rows 1083/1089.  
   The helper submits `initial_coordination` for B after PB1 is active. Existing `query-job-service.ts:704–705` rejects this. Simply switching to `semantic_query` also fails the formal planning-answer reader’s requirement at `plan-service.ts:967–968`.  
   **Direction:** establish the answered initial-coordination Query before Plan adoption, retaining its coherent Job/Run/manifest/body history. **Estimate: larger.**

5. **Must-fix — DQ01/DQ07 create two causes but expect one.**  
   **Locations:** [S5-decision-queue.test.ts:124](D:/cxt/impl-s5-rv3/tests/work-graph/S5-decision-queue.test.ts:124), [S5-decision-queue.test.ts:214](D:/cxt/impl-s5-rv3/tests/work-graph/S5-decision-queue.test.ts:214).  
   **Cases:** DQ01, DQ07; contradictory requirement in AP01. **Spec:** lines 781, 1083, 1089.  
   U1/U2 remain pending against PB1, producing `change_pending`; the tests additionally create `budget_exhausted`. AP01 explicitly requires the shared cause reader to expose `change_pending`, while DQ01 requires only the budget cause and six total cards. No specified deduplication rule reconciles these expectations.  
   **Direction:** use the existing `change_pending` as the single cause in DQ01/DQ07. Keep DQ02’s budget cause—it abandons both candidates. **Estimate: small per case.**

6. **Must-fix — DQ06 answers with the pre-pause source.**  
   **Location:** [S5-decision-queue.test.ts:206](D:/cxt/impl-s5-rv3/tests/work-graph/S5-decision-queue.test.ts:206).  
   **Case:** DQ06. **Spec:** lines 224, 615, 625, 1088.  
   Pausing advances B@7→B@8, but the answer uses the fixture’s original source containing B@7. Allowing answers while paused does not waive answer-time source validation or CAS.  
   **Direction:** reread the canonical card after pausing, answer its current source, and verify the captured B@8 pin. **Estimate: small.**

7. **Must-fix — MD11 rejects the required synthetic shape and supplies the wrong message body.**  
   **Location:** [S5-message-decision.test.ts:438](D:/cxt/impl-s5-rv3/tests/state/S5-message-decision.test.ts:438).  
   **Case:** MD11. **Spec:** lines 228, 245, 989; D7.  
   The exact expected record omits required `intent:'notify'`. Its `BODY` was also constructed for the work-run sender’s question, whereas the synthetic message must carry an operator-bound envelope containing the answer payload.  
   **Direction:** include the required intent and construct the matching synthetic message body. **Estimate: small.**

8. **Must-fix — UM03 requires optional false flags to be materialized.**  
   **Location:** [S5-user-messages.test.ts:127](D:/cxt/impl-s5-rv3/tests/work-graph/S5-user-messages.test.ts:127).  
   **Case:** UM03. **Spec:** line 1051; compatibility rules in §2.3.  
   The assertion demands `needsReply:false` and `waitAfterSend:false`. The existing constructor deliberately omits false flags, and existing `message-machine.test.ts:925–927` freezes that behavior. UM03’s spec row does not require explicit false fields.  
   **Direction:** assert the established absent-field shape or effective false values without requiring materialization. **Estimate: small.**

9. **Must-fix — new-request no-ops are mistaken for original-request replays.**  
   **Locations:** [S5-decision-application.test.ts:297](D:/cxt/impl-s5-rv3/tests/work-graph/S5-decision-application.test.ts:297), [S5-decision-application.test.ts:408](D:/cxt/impl-s5-rv3/tests/work-graph/S5-decision-application.test.ts:408).  
   **Cases:** AP07, AP15. **Spec:** lines 509, 1103, 1110.  
   The helper generates a new request ID for every call, and the second calls change message pin 2→3. Nevertheless, both require the complete original result, original cursor, and `replayed:true`. The spec distinguishes same-identity replay from new-identity same-application no-op.  
   **Direction:** assert AP15’s specified unchanged application/message revision without inventing receipt semantics. Actual replay coverage must resend the original identity and original pins. **Estimate: small per case/helper.**

10. **Must-fix — NR04 implements the projection under test inside its fixture.**  
    **Location:** [S5-notices.test.ts:95](D:/cxt/impl-s5-rv3/tests/work-graph/S5-notices.test.ts:95).  
    **Case:** NR04. **Spec:** lines 289–295, 841, 1120; RULES §6.  
    `inboxNotice()` itself sets `position.cursor = origin.since`, is injected into the reader, and is called again for verification. The case can pass with a broken production member-notice projector. It also substitutes a Session-addressed message for the specified user-notice source.  
    **Direction:** exercise the production projection. Preserve the real acknowledgement/origin checks, but resolve the user-notice acknowledgement seam explicitly rather than supplying its behavior in the test. **Estimate: larger.**

11. **Must-fix — NR06 checks preservation of unrelated messages.**  
    **Location:** [S5-notices.test.ts:203](D:/cxt/impl-s5-rv3/tests/work-graph/S5-notices.test.ts:203).  
    **Case:** NR06. **Spec:** line 1122.  
    Displayed items are artificial `m10/m11/r12`; none identifies a saved message. The final preservation assertion rereads unrelated decision-request messages. An implementation that acknowledges displayed member notifications during `markNoticesSeen` can therefore pass.  
    **Direction:** back the displayed member notices with real saved user-notify messages and compare those records across marking and reopening. **Estimate: larger; coordinate with NR04.**

12. **Should-fix — the answer race never verifies the winning body.**  
    **Location:** [S5-user-messages.test.ts:215](D:/cxt/impl-s5-rv3/tests/work-graph/S5-user-messages.test.ts:215).  
    **Case:** UM08. **Spec:** line 1056.  
    Stored output is compared with returned output, but neither is checked against the winning request’s text. Persisting and returning the losing request’s body would satisfy these assertions.  
    **Direction:** identify the committed request and read back exactly its `'first'` or `'second'` response text. **Estimate: small.**

13. **Should-fix — Workflow zero-write checks remain call counters.**  
    **Locations:** [S5-decision-workflow.test.ts:223](D:/cxt/impl-s5-rv3/tests/business/S5-decision-workflow.test.ts:223), [S5-decision-workflow.test.ts:265](D:/cxt/impl-s5-rv3/tests/business/S5-decision-workflow.test.ts:265).  
    **Cases:** WF01, WF02. **Spec:** lines 930, 1132–1133.  
    These assert commit-call counts instead of the prescribed persisted records/events/claims observations.  
    **Direction:** compare `fixture.storeSnapshot()` immediately around each Workflow call; retain WF01’s explicit requeue-owner-call assertion. **Estimate: small.**

14. **Should-fix — AP12 freezes an unspecified read count.**  
    **Location:** [S5-decision-application.test.ts:369](D:/cxt/impl-s5-rv3/tests/work-graph/S5-decision-application.test.ts:369).  
    **Case:** AP12. **Spec:** line 1107.  
    Exactly one intercepted `eventAt` read is required, although the contract specifies encountering corruption, returning `unavailable`, and preserving state—not the number of reads.  
    **Direction:** require the corruption hook to be reached, retaining the durable-state assertions. **Estimate: small, one line.**

The writers’ open points resolve as follows:

- **fxA/fx7 shared-source and event risks:** real problems, findings 1–2. The snapshot helper’s memory claim probes do inspect actual owners; I found no additional observation defect there.
- **fx4 bootstrap/claim risks:** the claimed “free task” is a real blocker, finding 3. Preserving settings through Goal control remains required part-2 behavior, not a reason to weaken these tests.
- **fx5 projection/adoption risks:** message/candidate projection belongs in part 2; missing implementation is not itself a test defect. No additional inadmissible U1 adoption was found. AP09’s missing catalog was not sufficient evidence of a guaranteed failure: its planned-module overlap remains explicit.
- **fx6 risks:** the Query setup and NR04 adapter limitations are real. The unspecified full affected-pin/action lists are legitimate specification limits. The delegated controller, repaired verification chains, and legacy serialization showed no additional concrete blocker.
- **fxS constructor concerns:** D7 resolves the missing-entry concerns; MD11 still needs finding 7. MD04 legitimately tests the stipulated pure-state `read@2` precondition.
- **fxR/SC01:** the proof-delivery concern remains real and unresolved. [S5-two-request-decisions.test.ts:135](D:/cxt/impl-s5-rv3/tests/scenarios/S5-two-request-decisions.test.ts:135) passes only acknowledgement/current pins but requires original captured pins and rebase basis in the Plan event. Spec lines 607–621 also forbid tasks reading communication records. The lead needs to settle that permitted data path before calling the case executable. This is not evidence that its historical-proof assertion should be weakened.
- **Timing/environment:** no concrete ordering or shared-state flake was established. The Linux sandbox requirement is a real execution prerequisite. Direct Session wall-clock timestamps remain nondeterministic, but I found no reviewed assertion whose outcome depends on them.

Checked and found right, apart from the issues above:

- **State:** GS01–15, PO01–16, NS01–08, PC01–10; MD01 now uses the D7 constructor.
- **Settings/candidates/application:** SS04/06/07/11/12/14/15, RC01–11, and AP03/06/09’s substantive proof/state assertions.
- **Messages/runtime:** UM07/12/13 and TU01–07, including legacy absence, status-index movement, strict tool input, and input acceptance.
- **Queue/notices:** DQ02/03/04/08/09 and NR03/05/07/08’s repaired mechanisms.
- **Routes/scenarios:** RT01–08 and SC02’s delegated admission, changed source basis, preserved tasks, and exact rework counts.