# Group C: structured conflict answers — retries, read failures, lead fixes LZ1–LZ3

Read RULES.md first. Rows: table §2.3, R2C01–R2C08. You may create ONLY
`tests/business/S5R2-settings-replay.test.ts` and at most one helper `tests/helpers/S5R2-c-support.ts`. ×2.

- Assembly: the real owners on the S5 fixture of each kind (`tests/helpers/S5-goal-settings-support.ts`
  `openS5GoalSettingsFixture`, `tests/helpers/S5-application-support.ts` `owners(f)`), the real decision source facts
  WITH the plan service injected (as `src/composition/create-platform.ts` ~628), and `createWorkflow`
  (`src/business/workflow/workflow.ts`) wired like create-platform: `goalSettings`, `decisionMessages`,
  `decisionSources`, `decisionDuties`, `goalExecutedFiles`, and `applicationReceipt` = a copy of create-platform.ts
  lines 633–643 (it reads the identityKey/fingerprint saved in the event at the commit cursor) in your helper, with a
  comment naming that source. `goalPhasePin` is the Workflow's own (it reads `plans.queryTaskGraph` of the earlier Goal).
- The A/B conflict: both active Plans change module M (`src/m/`). Read how the frozen
  `tests/work-graph/S5-goal-settings.test.ts` (SS rows) and `tests/scenarios/S5-goal-conflict-rework.test.ts` build a
  real conflict card; take the card from `queryGoalConflicts` (the read model / conflict assembler).
- Pins: `resolveDecision` meta.expected = the card's source pins (§3.3 line 625 for a non-message card); the settings
  command pins are built by the coordinator, not by the test.
- Fault injection (R2C02, R2C04): wrap the port the coordinator reads on the retry — R2C02: the plan port's
  `queryTaskGraph` for Goal A (what `goalPhasePin` uses); R2C04: the Goal-settings owner's `readGoalSettings` for Goal C
  (or the record-store read of Goal C underneath it). Fault only during the retry; assert the fault was reached. Build
  the Workflow so the wrapped port is the one it uses (the wrapper passes everything through during the first
  execution).
- R2C05: pause A before answering (real control), answer → `awaiting_resume`, resume A, repeat the same request.
- R2C06/R2C07: take a real answer message ref of this Workspace and replace only `workspaceId` with `'W2'`.
- R2C08: Goal A's Plan PA1 must be formally COMPLETED (GoalPhase COMPLETED with planRef PA1) and A must then adopt PA2.
  Look for an existing path that completes a Goal (spec §5.1 mentions GPC = COMPLETED with planRef = the active pointer;
  search the S5 fixtures, `tests/work-graph/A2-goal-control.test.ts` and the `R3c-*` tests for `completeGoal`). If a
  completed Goal cannot adopt a new plan through production entries, report R2C08 under UNDETERMINED (do not forge the
  GoalPhase).
