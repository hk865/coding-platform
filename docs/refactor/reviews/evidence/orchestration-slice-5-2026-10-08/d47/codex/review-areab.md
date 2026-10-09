| Item | Verdict | Current-file evidence and spec |
|---|---|---|
| **B1** | **PARTLY** | Shared derivation now exists in [decision-policy.ts:114](/D:/cxt/s5area-b1/src/core/work-graph/state/decision-policy.ts:114), called by [workflow.ts:1174](/D:/cxt/s5area-b1/src/business/workflow/workflow.ts:1174) and [goal-decision-reader.ts:345](/D:/cxt/s5area-b1/src/core/work-graph/tasks/goal-decision-reader.ts:345). The known-code check is fixed. Budget-lift, some perform, and paused cases remain inconsistent. Violates **SPEC §4.5:888**. |
| **B2** | **FIXED** | [goal-decision-reader.ts:228](/D:/cxt/s5area-b1/src/core/work-graph/tasks/goal-decision-reader.ts:228) resolves the failure Run’s formal revision; `:292–297` adds it alongside Task@0. A new failure Run therefore produces a new key, satisfying **§3.3:629/D1**. The optional-reader caveat appears below. |
| **B3** | **FIXED** | [decision-service.ts:890](/D:/cxt/s5area-b1/src/core/work-graph/communication/decision-service.ts:890) authorizes saved answers from their captured source; [decision-source-facts.ts:731](/D:/cxt/s5area-b1/src/core/work-graph/communication/decision-source-facts.ts:731) reads the stored proposer without requiring a live candidate. Satisfies **§4.6:915**. An unrelated Session fails the exact membership check at `decision-service.ts:904–906`. |
| **B4** | **PARTLY** | [decision-service.ts:258](/D:/cxt/s5area-b1/src/core/work-graph/communication/decision-service.ts:258) now derives Agent attribution; [communication-tools.ts:553](/D:/cxt/s5area-b1/src/core/agent-runtime/communication-tools.ts:553) uses the decision-authorized reader. Missing adoption proof, incomplete modifier checks, and tool replay remain defective under **S5-MSG-04:509; §4.6:907–911**. |
| **B5** | **FIXED** | [decision-source-facts.ts:214](/D:/cxt/s5area-b1/src/core/work-graph/communication/decision-source-facts.ts:214) preserves non-Goal captured pins; `:265–275` rejects moved objects. Satisfies **§2.8:402; §3.3:625**. |
| **B6** | **PARTLY** | [mailbox-service.ts:1536](/D:/cxt/s5area-b1/src/core/work-graph/communication/mailbox-service.ts:1536) establishes ownership for extracted pins and refuses unknown ownership. Malformed aggregate objects still bypass that extraction. **§3.3:614; §8.2:1354** require earlier validation. |
| **B7** | **FIXED** | [mailbox-service.ts:995](/D:/cxt/s5area-b1/src/core/work-graph/communication/mailbox-service.ts:995) provides one body-storage implementation. The original request identity at `:1788` matches **HEAD:1328** and the pre-round implementation. Original receipt construction, canonical body bytes, and Query-answer provenance are preserved, satisfying **§3.3:684**. |

“SPEC” below means [slice-5-SPEC.md](/D:/cxt/s5area-b1/docs/refactor/design/orchestration-2026-10/slices/slice-5-SPEC.md). Findings distinguish remaining defects from regressions introduced by this round.

1. **Must-fix — B1 still derives answerability from execution eligibility. Estimated repair: larger than 30 lines.**

   **Evidence:** [workflow.ts:1088](/D:/cxt/s5area-b1/src/business/workflow/workflow.ts:1088) promotes `stopped/budget_exhausted` when the binding supplies a larger budget. The resulting operation reaches the confirmation gate, but [goal-decision-reader.ts:322](/D:/cxt/s5area-b1/src/core/work-graph/tasks/goal-decision-reader.ts:322) accepts only `requeue`/`reverify` verdicts. Production `verifyRealCause` consequently returns `not_found`.

   Pausing exposes the same underlying problem: [task-failure.ts:766](/D:/cxt/s5area-b1/src/core/work-graph/state/task-failure.ts:766) and `:859` produce `none` for non-active Goals, so the new reader drops an existing automation card.

   **Spec:** §4.5:888 requires formally derived causes shared by selection and perform; §8.2:1357 requires paused cards to remain answerable.

   **Claim (a):** The budget-lift failure is real and user-visible. The blanket explanation about caller-supplied perform actions is too broad: [goal-decisions.ts:184](/D:/cxt/s5area-b1/src/contracts/goal-decisions.ts:184) does **not** include action in the key, so differing actions do not necessarily cause a mismatch. The demonstrated mismatch is the reader’s exclusion of `stopped`/`none` facts.

   **Direction:** Derive the confirmation basis from formal failure/round/autonomy facts independently of immediate execution eligibility. Share that derivation across both Workflow entrances and source 2. The exact current Host budget comparison is absent from this reader; reconcile that selection input explicitly rather than treating an emitted card’s answerability as unspecified.

2. **Must-fix — B4 Agent adoption still cannot supply application proof. Estimated repair: larger than 30 lines end-to-end.**

   **Evidence:** [plan-service.ts:1517](/D:/cxt/s5area-b1/src/core/work-graph/tasks/plan-service.ts:1517) drops the parsed `acknowledgementRef` and `decisionSource` when entering the Agent branch. [plan-service.ts:3319](/D:/cxt/s5area-b1/src/core/work-graph/tasks/plan-service.ts:3319) calls the compiler without `decisionProof`; [decision-application.ts:117](/D:/cxt/s5area-b1/src/core/work-graph/communication/decision-application.ts:117) therefore returns `incomplete`.

   **Spec:** §0.2/L1:24 and §3.3:621 explicitly include `PlanRevisionAccepted` proof in slice 5. §4.5:886 defers **decision-based authorization**, not recording an already-authorized Plan adoption.

   **Claim (b):** True: an actual Agent adoption cannot complete this recording path. This is a remaining slice-5 defect, although outside Area B’s permitted write scope.

   **Direction:** Carry optional attribution through the Agent command/fingerprint and existing proof compiler while retaining original Agent admission. Preserve old identities when attribution is absent; do not grant new authority from the answer.

3. **Must-fix — B4 admission does not consistently require the actual modifier. Estimated repair: small local edit, under 30 lines.**

   **Evidence:** [decision-service.ts:1001](/D:/cxt/s5area-b1/src/core/work-graph/communication/decision-service.ts:1001) uses `sameActor`, whose implementation at `:69–70` compares only `kind` and `id`. Successive Runs in one Session share the Session-hash ID. Thus R2 can pass for a receipt attributed to R1 despite their different `runRef`s.

   Separately, the same-application shortcut at [decision-service.ts:990](/D:/cxt/s5area-b1/src/core/work-graph/communication/decision-service.ts:990) returns before modifier admission. A caller possessing the receipt can obtain this success through the owner without being its modifier or operator.

   **Spec:** S5-MSG-04:509; §4.6:911.

   **Claim (f):** The new Run/outbox/Role checks improve identification, but the final check is insufficient. A different Session normally fails; a different Run of the same Session does not.

   **Direction:** Compare complete Agent attribution, including the formal Run, and enforce modifier/operator admission before the new-identity no-op shortcut. Keep exact receipt replay first.

4. **Must-fix — B4 runtime retries replace the original application pin. Estimated repair: larger than 30 lines.**

   **Evidence:** [communication-tools.ts:553](/D:/cxt/s5area-b1/src/core/agent-runtime/communication-tools.ts:553) reads current business state before invoking the recording owner, then supplies `saved.revision` at `:565`. The owner fingerprints that pin at [decision-service.ts:965](/D:/cxt/s5area-b1/src/core/work-graph/communication/decision-service.ts:965).

   After the first application increments the message revision, repeating the same tool call produces the same request identity but a different fingerprint: `idempotency_conflict`, rather than the original receipt. Historical-reader failure can also prevent reaching receipt lookup.

   **Spec:** §3.3:617,627; §8.2:1366; brief §5.

   **Direction:** Make tool-level replay recover the original accepted command/pin before fresh message authorization or pin reads. Preserve the original owner fingerprint contract. This is a retained replay defect, not something the new pin-only reader solves.

5. **Must-fix — the new saved-answer helper turns incomplete reads into absence. Estimated repair: small local edit, under 30 lines.**

   **Evidence:** [decision-source-facts.ts:675](/D:/cxt/s5area-b1/src/core/work-graph/communication/decision-source-facts.ts:675) returns `not_found` whenever the requested record is omitted, without checking `read.value.missing`. A ready but incomplete batch therefore makes a saved answer’s supporting facts appear absent.

   **Spec:** Brief §5’s read-failure rule; SPEC §4.2:821 and §8.2:1367.

   **Direction:** Distinguish explicitly reported missing keys from unaccounted omissions. Return `unavailable` for the latter, as the corrected [mailbox-service.ts:1517](/D:/cxt/s5area-b1/src/core/work-graph/communication/mailbox-service.ts:1517) already does. This regression is in the newly added helper.

6. **Should-fix — optional Task-graph access silently weakens B1 and B2.**

   **Evidence:** [goal-decision-reader.ts:200](/D:/cxt/s5area-b1/src/core/work-graph/tasks/goal-decision-reader.ts:200) treats an absent `queryTaskGraph` as successfully empty rows. Automation causes disappear; recurring display causes fall back to Task-only keys at `:294–297`.

   **Spec:** §4.2:821 explicitly forbids representing an unavailable source as available-empty.

   **Claim (e):** True, but latent in current composition: [create-platform.ts:644](/D:/cxt/s5area-b1/src/composition/create-platform.ts:644) and `:684` supply the full Plan service.

   **Direction:** Return `unavailable` when that dependency is missing. Also restrict `:207`’s `not_found → empty` conversion to a Goal actually observed without an adopted Plan: `queryTaskGraph` can return `not_found` for missing supporting records too. Both are small edits.

7. **Should-fix — B6 malformed aggregate pins are rejected too late.**

   **Evidence:** [mailbox-service.ts:1440](/D:/cxt/s5area-b1/src/core/work-graph/communication/mailbox-service.ts:1440) drops absent/non-object pins; `:1458` skips aggregate validation in the other validator. Processing can consequently reach state construction and body storage without verifying that object.

   **Spec:** §3.3:614 requires source-object validation before state/body effects.

   **Claim (c):** Correct about the owner bypass, **incorrect about successful persistence on the real backend**. [message-record-codecs.ts:469](/D:/cxt/s5area-b1/src/core/work-graph/sessions/message-record-codecs.ts:469) rejects malformed pins through the registered Store validator at `:1093`; the strict runtime schema also rejects them. The remaining impact is late failure and unnecessary body effects.

   **Direction:** Reject malformed aggregate objects before extracting their pins. Under 30 lines.

8. **Should-fix — B1 adds unnecessary reads to paths requiring no confirmation.**

   **Evidence:** [workflow.ts:1157](/D:/cxt/s5area-b1/src/business/workflow/workflow.ts:1157) resolves a missing Run revision before evaluating the policy at `:1174`. Under `after_plan_confirmation`, that read can now reject before the existing owner is reached, whereas the previous policy returned no gate.

   **Spec:** Brief §5 preserves existing paths; §8.2:1363 preserves existing automation fences.

   **Direction:** Establish that confirmation is required before performing pin-only I/O. Under 30 lines. This changes the failure surface; I did not establish loss of an otherwise-successful ordinary production execution.

The frozen tests do not establish these missing paths: [WF01:205](/D:/cxt/s5area-b1/tests/business/S5-decision-workflow.test.ts:205) checks gating without answering the emitted card; [queue fixtures:59](/D:/cxt/s5area-b1/tests/work-graph/S5-decision-queue.test.ts:59) deliberately use the lead-approved `{ records }` construction; [AP14:395](/D:/cxt/s5area-b1/tests/work-graph/S5-decision-application.test.ts:395) checks only a non-modifier rejection. [AP15:426](/D:/cxt/s5area-b1/tests/work-graph/S5-decision-application.test.ts:426) preserves the original pin explicitly, unlike the runtime tool. These are coverage limits, not reasons to alter the frozen tests.

No new protected-field write or prohibited module edge was found. The additive `readDecisionMessagePin` reaches the production runtime through the raw service; it is not dead code. No files were changed and no tests, Node, npm, or package scripts were run.