**FILES**

- [S5-decision-routes.test.ts](/D:/cxt/impl-s5-fxR/tests/app/S5-decision-routes.test.ts)
- [S5-two-request-decisions.test.ts](/D:/cxt/impl-s5-fxR/tests/scenarios/S5-two-request-decisions.test.ts)
- [S5-goal-conflict-rework.test.ts](/D:/cxt/impl-s5-fxR/tests/scenarios/S5-goal-conflict-rework.test.ts)
- [S5-decisions.ts](/D:/cxt/impl-s5-fxR/tests/scenarios/support/S5-decisions.ts)

Only these four files edited; case counts remain 8/1/1.

**PER CASE**

Expected part-1 outcomes below are static predictions, not measured results.

- RT01 — KEPT: queue forwarding recorder; expected passes in part 1.
- RT02 — REWRITTEN: canonical message identity, exact pins, trusted-context recorder; expected passes in part 1.
- RT03 — KEPT: full proposal request forwarding; expected passes in part 1.
- RT04 — KEPT: recorder rejection translation, no subsequent apply; expected passes in part 1.
- RT05 — KEPT: workspace rejection before owner invocation; expected passes in part 1.
- RT06 — REWRITTEN: real terminal→requeue→notice page/token→mismatched mark; first stub `DecisionReadPort.queryDecisionQueue`.
- RT07 — KEPT: legacy message forwarding; expected passes in part 1.
- RT08 — REWRITTEN: composed queue, persisted-store comparison, actual model counter; first stub `DecisionReadPort.queryDecisionQueue`.
- SC01 — REWRITTEN: real root queries, proposals/adoption, canonical queue source, replacement and receipt observations; first stub `RequestCandidatePort.readRequestCandidate`. Proof issue remains below.
- SC02 — REWRITTEN: real conflict history, auxiliary Agent admission/requeue/settlement, new source basis, system requeue/reverify, notice marking/restart; first stub `DecisionReadPort.queryGoalConflicts`.

**FINDINGS**

- RT06 — DONE: real shared token/settings services; persisted Workspace@3 and complete ledger unchanged assertions.
- RT08 — DONE: explicit actual-provider counter equals zero.
- Forwarding rows — DONE: recorders retained exclusively for forwarding/rejection cases.
- SC01 — NOT DONE fully: canonical source, stored candidate@1 and exactly-one attributed formal change repaired; valid proof across replacement remains unspecified.
- SC02 — DONE: delegated admission, settlement before restart, actual source edit, preserved A2, exact requeue/reverify/notice counts.
- Source helpers — DONE: natural identities passed through `decisionSourceKey`.

**UNDETERMINED**

- SC01: `applyPlanChange` receives only `acknowledgementRef`, while tasks cannot read communication records. The spec does not define how it obtains the original captured pins/basis for pause/resume proof, or handles changed-object correspondence after U2→U3 replacement. See SPEC §0.2 T02, §2.8, §3.3 lines 607–623 and SC01 line 1165. No fabricated proof added.

**RISKS**

- Lead should execute RT06’s terminal/requeue setup at `tests/app/S5-decision-routes.test.ts:190` after shared-fixture integration.
- Lead should verify auxiliary admission and settlement at `tests/scenarios/support/S5-decisions.ts:524`.
- No Node, npm, npx, tests or typecheck run. Validation was static only.