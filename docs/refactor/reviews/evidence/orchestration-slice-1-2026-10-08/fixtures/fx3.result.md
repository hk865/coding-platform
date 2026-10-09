**FILES**

- [S1-session-maintenance.test.ts](/D:/cxt/impl-s1-fx3/tests/business/S1-session-maintenance.test.ts)
- [S1-archive-flow.test.ts](/D:/cxt/impl-s1-fx3/tests/business/S1-archive-flow.test.ts)
- [S1-session-routes.test.ts](/D:/cxt/impl-s1-fx3/tests/app/S1-session-routes.test.ts)
- Created [S1-workflow-archive-fixture.ts](/D:/cxt/impl-s1-fx3/tests/helpers/S1-workflow-archive-fixture.ts)

Only these four files were edited. No Node, npm, npx, tests or typecheck ran.

**PER CASE**

Expected first failures below are from static inspection:

- IT06 — REWRITTEN: real Work completion, plan cancellation, terminal close → `SessionResponsibilityPort.closeTerminalResponsibility`.
- IT07 — REWRITTEN: same idle history, full-day boundary → `SessionResponsibilityPort.closeTerminalResponsibility`.
- IT08 — REWRITTEN: completed initial Work, new task assignment/completion, renewed deadline → `SessionResponsibilityPort.closeTerminalResponsibility`.
- IT09 — REWRITTEN: five Sessions with formally closed responsibilities → `SessionResponsibilityPort.closeTerminalResponsibility`.
- IT10 — REWRITTEN: entered Work, reconciliation releases occupancy and retires Session → `WorkflowPort.maintainSessions`.
- IT11 — REWRITTEN: real consultation copy, Query entry and saved answer → `WorkflowPort.maintainSessions`.
- IT12 — REWRITTEN: entered Work, archive cancel and delivery, still pending → `WorkflowPort.archiveLine`.
- IT13 — REWRITTEN: cancel delivery, terminal reconciliation, continuation with final-commit fault → `WorkflowPort.archiveLine`.
- IT14 — REWRITTEN: real Query claim/entry, pending archive, saved answer, continuation → `WorkflowPort.archiveLine`.
- IT15 — REWRITTEN: reconciliation produces consistent unknown execution → `WorkflowPort.archiveLine`.
- IT16 — REWRITTEN: real D Query history, stopped archive, ordinary dispatch and preparation → `WorkflowPort.archiveLine`.
- IT17 — REWRITTEN: all eleven real route bindings and invalid-envelope checks; expected to pass in part 1.
- IT18 — REWRITTEN: real HTTP Work, fault armed before restart, partial receipts checked → `WorkflowPort.archiveLine`, surfaced as HTTP 500.
- IT26 — REWRITTEN: unknown reconciliation followed by real `resolveUnknownRun` attestation → `WorkflowPort.archiveLine`.
- IT27 — REWRITTEN: D archived, S stopped and archived, ordinary dispatch creates one Session → `WorkflowPort.archiveLine`.
- IT31 — REWRITTEN: terminal closes at t0; later redefinition uses an execution-free cancelled task → `SessionResponsibilityPort.closeTerminalResponsibility`.
- IT33 — REWRITTEN: initial creation link to execution-free task, retirement through health owner → `WorkflowPort.maintainSessions`.
- IT34 — REWRITTEN: paired unknown execution, health retirement, exact refusal and zero-write observations → `WorkflowPort.maintainSessions`.

**FINDINGS**

1. DONE — IT18 fault armed before restart.
2. DONE — due-archive histories release occupancy and formally close terminal responsibilities.
3. DONE — IT10 uses reconciliation for stopping and retirement.
4. DONE — IT33 uses an execution-free task and compares its phase.
5. DONE — IT34 uses real unknown reconciliation and record/event/receipt totals.
6. DONE — IT11 checks copy archival, source preservation and no Query/model rerun.
7. DONE — IT13/16/27 record stop completion before continuation.
8. DONE — IT14 uses real Query execution and answer persistence.
9. DONE — IT15/26 produce matching Run/Attempt/Outbox histories.
10. DONE — exact D history, brief continuity and new-Session provenance assertions added.
11. DONE — both backends check invariants after commits with previous worlds.
12. DONE — IT12 asserts pending wording, retained request and no disposition/requeue.

**UNDETERMINED**

None identified from the spec.

**RISKS**

Execution remains unverified. Lead checks should focus on:

- [Bootstrap schemas and invariant observer](/D:/cxt/impl-s1-fx3/tests/helpers/S1-workflow-archive-fixture.ts:281).
- [Query manifest and answer setup](/D:/cxt/impl-s1-fx3/tests/helpers/S1-workflow-archive-fixture.ts:955).
- [Cancel-to-terminal reconciliation](/D:/cxt/impl-s1-fx3/tests/business/S1-archive-flow.test.ts:357).
- [Route factory clock injection](/D:/cxt/impl-s1-fx3/tests/app/S1-session-routes.test.ts:49).

Assertions beyond the expected part-1 stubs remain unexecuted.