All 14 numbered findings are **FIXED**. One additional must-fix remains in SC01. Read-only review; no files changed and no Node/npm/npx/tests ran.

| rv3 # | Status | Evidence |
|---|---|---|
| 1 | FIXED | Self-pins removed: [shared fixture:840](D:/cxt/impl-s5-rv4/tests/helpers/S5-decision-fixture.ts:840), [settings support:582](D:/cxt/impl-s5-rv4/tests/helpers/S5-goal-settings-support.ts:582). |
| 2 | FIXED | Ordinary answers use `SessionMessageResponded`: [fixture:891](D:/cxt/impl-s5-rv4/tests/helpers/S5-decision-fixture.ts:891), [support:634](D:/cxt/impl-s5-rv4/tests/helpers/S5-goal-settings-support.ts:634). D9’s earlier codec blocker is corrected. |
| 3 | FIXED | Real PB2 adoption creates unclaimed tasks and preserves RA/RB: [settings:166](D:/cxt/impl-s5-rv4/tests/work-graph/S5-goal-settings.test.ts:166). |
| 4 | FIXED | Planning Query uses newly created, planless Goal D: [queue support:168](D:/cxt/impl-s5-rv4/tests/helpers/S5-queue-support.ts:168). |
| 5 | FIXED | DQ01/DQ07 retain only `change_pending`: [queue:94](D:/cxt/impl-s5-rv4/tests/work-graph/S5-decision-queue.test.ts:94), [queue:225](D:/cxt/impl-s5-rv4/tests/work-graph/S5-decision-queue.test.ts:225). |
| 6 | FIXED | DQ06 rereads canonical source and verifies captured B@8: [queue:213](D:/cxt/impl-s5-rv4/tests/work-graph/S5-decision-queue.test.ts:213). |
| 7 | FIXED | Operator-bound synthetic body and required `intent:'notify'`: [message state:438](D:/cxt/impl-s5-rv4/tests/state/S5-message-decision.test.ts:438). |
| 8 | FIXED | UM03 requires absent false flags: [user messages:127](D:/cxt/impl-s5-rv4/tests/work-graph/S5-user-messages.test.ts:127). |
| 9 | FIXED | New-identity no-op separated from original-identity replay: [application:297](D:/cxt/impl-s5-rv4/tests/work-graph/S5-decision-application.test.ts:297), [application:408](D:/cxt/impl-s5-rv4/tests/work-graph/S5-decision-application.test.ts:408). |
| 10 | FIXED | NR04 uses real user notification and production projection, following the lead’s acknowledgement decision: [notices:159](D:/cxt/impl-s5-rv4/tests/work-graph/S5-notices.test.ts:159). |
| 11 | FIXED | NR06 compares the displayed notifications’ saved records through marking/reopen: [notices:208](D:/cxt/impl-s5-rv4/tests/work-graph/S5-notices.test.ts:208). |
| 12 | FIXED | UM08 checks the winning request’s exact response text: [user messages:218](D:/cxt/impl-s5-rv4/tests/work-graph/S5-user-messages.test.ts:218). |
| 13 | FIXED | Persisted snapshots surround both Workflow calls: [workflow:205](D:/cxt/impl-s5-rv4/tests/business/S5-decision-workflow.test.ts:205), [workflow:257](D:/cxt/impl-s5-rv4/tests/business/S5-decision-workflow.test.ts:257). |
| 14 | FIXED | AP12 requires interception without prescribing read count: [application:378](D:/cxt/impl-s5-rv4/tests/work-graph/S5-decision-application.test.ts:378). |

**Additional defect**

- **Must-fix — SC01 — [S5-two-request-decisions.test.ts:135](D:/cxt/impl-s5-rv4/tests/scenarios/S5-two-request-decisions.test.ts:135).**  
  **Spec:** lines 15, 224, 402; row 1165; D8.  
  **Evidence:** The answer captures the original candidate source. Replacement at lines 120–127 changes U2 from candidate@1 to not_adopted@2; line 135 then supplies the old captured source and requires successful application. D8 explicitly requires non-Goal captured pins to equal current versions ([plan-contracts.ts:235](D:/cxt/impl-s5-rv4/src/core/work-graph/model/plan-contracts.ts:235)). Goal control rebasing cannot repair the changed candidate pin. A correct implementation rejects this request; ignoring that pin would incorrectly satisfy the test.  
  **Direction:** Regenerate before capturing/answering the canonical source, then exercise pause/resume with unchanged non-Goal pins. Retain historical proof assertions. **Size: small**, scenario reordering.

No other concrete defects found within the requested scope.