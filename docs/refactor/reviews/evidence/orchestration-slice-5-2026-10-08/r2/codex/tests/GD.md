# Group D: Agent adoption attribution and application recording (runtime); the ordering safe point (driver)

Read RULES.md first. Rows: table §2.4, R2D01–R2D13. You may create ONLY
`tests/runtime/S5R2-agent-application.test.ts` (R2D01–R2D06, ×2), `tests/app/S5R2-driver-safe-point.test.ts`
(R2D07–R2D13, memory) and at most one helper `tests/helpers/S5R2-d-support.ts`.

Runtime file:
- The Agent is Session S's claimed, entered, running Run RA of the S5 fixture (`f.runRA`, `f.claimRA`), with trusted
  duties and W2 delegated plan writes. Call the REAL tools: `createWhiteboardTools`
  (`src/core/agent-runtime/whiteboard-tools.ts`: `propose_future_plan`, `apply_future_plan`) and
  `createSessionMailboxTools` with `decisionMessages` (`src/core/agent-runtime/communication-tools.ts`:
  `read_user_decision`, `record_decision_application`). See `tests/runtime/W2-whiteboard-tools.test.ts` and
  `tests/composition/W2-future-intent-platform.test.ts` for how an Agent proposes and adopts its own candidate, and the
  frozen `tests/runtime/S5-user-message-tools.test.ts` (TU rows) + `tests/helpers/S5-user-message-support.ts` for the
  user decision tools. Call each tool through its own execute path (strict schema validation included).
- R2D01 is RED because the strict schema has no `acknowledgementRef` (`whiteboard-tools.ts:211–218`). Assert in the
  setup that the candidate and the answer exist (answer committed, card `answered_pending_application`); the decisive
  step is the apply call with `acknowledgementRef`, then the stored `PlanRevisionAccepted` event (read it from the store
  at the result cursor) and the tool result's `applicationReceipt` (table §1 T-R2-1).
- R2D02: `record_decision_application` with `{messageRef, receipt: <applicationReceipt of the apply tool result>}`;
  build R2D02's given by repeating R2D01's steps (each `it` has its own fixture; a shared helper function is fine).
- R2D03: the retry is the same tool call with the same callId (so the same requestId; read how the tool derives the
  requestId). Inject the read failure into the record store (or the decision-message owner's read port) used by the
  tool's pre-read of the answer message, only on the retry; assert it was reached.
- R2D04/R2D05: Host `applyPlanChange` as operator with `acknowledgementRef` (see the frozen AP rows of
  `tests/work-graph/S5-decision-application.test.ts` for the attributed Host adoption).

Driver file:
- Real `createCollaborationDriver` (`src/app/collaboration-driver.ts`) with the dependency doubles of
  `tests/app/change-emitters.test.ts` (copy its `driverWith`-style setup into your helper). `workflow.orderGoalAdvances`
  = the REAL Workflow's ordering (`createWorkflow(...).orderGoalAdvances` with the real Goal-settings owner on the S5
  memory fixture, after a real `reorderGoals` to B=0, A=1, C=2 — see WF02 in
  `tests/business/S5-decision-workflow.test.ts`); `workflow.advanceWork` = a recorder you script per row (record each
  advance's goalRef/kind/taskId and the signal it got; return scripted `WorkflowAdvanceResult`s; use deferred promises
  for "never returns"). For R2D09/R2D10 wrap the real ordering to return the rejection / to throw.
- Do not use fixed sleeps as the ordering proof: await the recorder's calls (deferred promises, or polling the recorder
  with a deadline as change-emitters does).
- R2D11: read `runHandle` (`collaboration-driver.ts` ~780–905) for the exact `complete_task` receipt / `next` shapes the
  driver recognises as the pinned observation step.
