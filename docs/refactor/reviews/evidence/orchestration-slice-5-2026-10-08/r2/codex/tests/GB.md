# Group B: automation confirmation cards — answering, pausing, the requeue retry

Read RULES.md first. Rows: table §2.2, R2B01–R2B05. You may create ONLY
`tests/business/S5R2-automation-cards.test.ts` and at most one helper `tests/helpers/S5R2-b-support.ts`. Memory only.

- Assembly: the approach of the frozen `tests/business/S5-decision-workflow.test.ts` (WF01): the real WorkGraph memory
  fixture (`openS5DecisionFixture('memory')`), the real Goal-settings owner, plan service, claims/requeue owners, the
  real decision owners and readers (decision-message service; decision source facts WITH the plan service injected as
  production does in `src/composition/create-platform.ts` ~625–660; the goal decision cause reader; the decision read
  model), and `createWorkflow` (`src/business/workflow/workflow.ts`) with those deps; only the execution and check
  owners are controlled doubles. You cannot import WF01's private helpers: copy what you need into your helper file.
  No model runs.
- `resolveDecision` is the Workflow's decision surface (`workflow.ts` ~1995; `src/business/workflow/decision-actions.ts`).
  For R2B01/R2B02/R2B04 the selection is `{kind:'other'}` with non-empty text and `annotations: []`; meta.expected = the
  card's source pins exactly as §3.3 line 625 says for a non-message card.
- Pause / resume: the real Goal control owner as operator (see `tests/helpers/S5-application-support.ts` `control`).
- R2B03/R2B04 need a GATE Task of Goal B whose round chain head is a finalized non-PASS round eligible for an automatic
  reverify (GV-9/GV-10 in `src/core/work-graph/state/task-failure.ts` ~857–883; no fix in progress). Build it through
  the real plan (a gate task in an adopted plan), claim/enter, and the evidence/verification owners (round open →
  checks → finalize non-PASS). Look at how `tests/scenarios/support/gate.ts`, `tests/scenarios/C5-gate-fix.test.ts`,
  `tests/composition/A2-verification-chain-platform.test.ts` and `tests/business/A2-workflow-auto-rework.test.ts`
  produce such a head. Before the pause assert that the Workflow returned `decisionCause.action === 'auto_reverify'` for
  the gate and that the queue has the card; the decisive assertions are the queue AFTER the pause (R2B03) and the answer
  result (R2B04). If such a gate head cannot be produced through production entries on this fixture, report it under
  UNDETERMINED instead of forging it.
- R2B05: under the default autonomy (after_plan_confirmation) the Workflow performs the automatic `requeue_task`;
  capture the exact advance/step input and its receipt; then `setGoalSettings` B → every_step; then repeat the same
  step input. Read `workflow.ts` (`automaticRequeue`, `automationConfirmation` ~1123–1190, the perform path) to see which
  input repeats the committed requeue with the same requestId.
