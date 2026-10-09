**FILES**

- Changed only [S5-decision-application.test.ts](D:/cxt/impl-s5-fx5b/tests/work-graph/S5-decision-application.test.ts).
- Reviewed and kept the RC file and application helper. Preserved 14 AP cases, 11 RC cases, and both backends.
- No Node, npm, npx, typecheck, or tests ran.

**PER CASE**

“First” identifies the expected part-1 stub or missing behavior, from static inspection.

- AP01 — KEPT: persisted `change_pending` cause, concurrent answers and source claim; first: `readGoalDecisionCauses`.
- AP02 — REWRITTEN: stored source preserved; separate message pin; answer then reorder; first: `answerDecision`.
- AP03 — KEPT: real reorder receipt, exact changes and pending-count decrement; first: `reorderGoals`.
- AP04 — KEPT: receipt lacking a formal application event; first: `recordDecisionApplication`.
- AP05 — KEPT: settings change followed by mismatched acknowledged receipt; first: `setGoalSettings`.
- AP06 — KEPT: real reorder, failed application commit, reopen and recovery; first: `reorderGoals`.
- AP07 — REWRITTEN: U1 adoption with D8 source, application, later settings change, same-receipt no-op; first: `recordDecisionApplication`.
- AP08 — REWRITTEN: automation answer uses unchanged stored source and separate message pin; first: `answerDecision`.
- AP09 — KEPT: pause → conflict answer → resume → resolution and exact rebase proof; first: `queryGoalConflicts`.
- AP12 — REWRITTEN: real receipt with corrupted event; requires interception without fixing read count; first: `reorderGoals`.
- AP13 — KEPT: real receipt paired with another real cursor; first: `reorderGoals`.
- AP14 — KEPT: operator modification followed by unauthorized work-run application; first: `reorderGoals`.
- AP15 — REWRITTEN: new-identity no-op plus true replay using original identity and pins; first: `reorderGoals`.
- AP16 — KEPT: second real modification receipt rejected while preserving application; first: `reorderGoals`.
- RC01 — KEPT: saved Q1/Q2 heads and production queue; first: `readRequestCandidate`.
- RC02 — KEPT: owner releases Q1, then commit-barrier race; first: `abandonPlanProposal`.
- RC03 — KEPT: replacement fault intercepts actual slot commit; first failure: missing replacement/slot behavior.
- RC04 — KEPT: replacement receipt proves both revisions and slot transfer; first failure: missing replacement behavior.
- RC05 — KEPT: real U1 adoption followed by Q2 stale-card checks; first: `readRequestCandidate`.
- RC06 — KEPT: abandon, exact replay, then new ownership proving release; first: `abandonPlanProposal`.
- RC07 — KEPT: real same-Workspace request submitted against another Goal; first failure: missing request-Goal validation.
- RC08 — KEPT: abandon, independent proposal/adoption, reopen and reread; first: `abandonPlanProposal`.
- RC09 — KEPT: legacy v2 seed, unchanged wire shape and claims; first: `candidateRequestRef`.
- RC10 — KEPT: foreign-Workspace request with read interception; first: `readRequestCandidate`.
- RC11 — KEPT: legacy v1 wire seed and read-only preservation; first: `candidateRequestRef`.

**FINDINGS**

- fx5b #1 — DONE: AP07/AP15 distinguish new-request no-ops from true replay.
- fx5b #2 — DONE: AP12 requires the corruption hook to be reached.
- fx5b #3 — DONE in owned files: removed source-pin filtering; answer requests carry the message pin separately.
- fx5b #4 — DONE: AP07 passes `response.decision.source` through D8.

**UNDETERMINED**

- AP07/AP15: new-identity cursor, replay flag, receipt-count and allocation semantics are unspecified by §3.1 line 509 and rows 1103/1110; these are not asserted. Records/events/claims and application preservation remain checked.

**RISKS**

- The parallel shared-fixture repair still needs integration: [line 840](D:/cxt/impl-s5-fx5b/tests/helpers/S5-decision-fixture.ts:840) includes the self pin; [line 890](D:/cxt/impl-s5-fx5b/tests/helpers/S5-decision-fixture.ts:890) uses the synthetic event for an ordinary response. Left untouched as required.
- Runtime and TypeScript validation remain for the lead; no additional existing-entry setup blocker was found statically.