import type { HumanCollaboration } from '../../src/contracts/modules.js';
import type { ControlEngine } from '../../src/contracts/modules.js';
import type { PlanCompilerPort, PlanningContextPort } from '../../src/contracts/planning.js';

/**
 * Shared P1-11 contract-suite harness: goal/plan-change scenario over a real
 * ledger + engine (FROZEN surface; lanes fill the control/compiler/projection
 * implementations behind the same scenario).
 */
import { expect } from "vitest";
import type { P1_08HarnessLike, P1_08TestHarness } from "./p1-08-harness.js";
import type { GoalSnapshot, StateLedger } from "../../src/contracts/ledger.js";
import type { PlanRevisionSnapshot } from "../../src/contracts/plan.js";
import type { AmendGoalRequestV1, ApplyPlanChangeCommand, ApplyPlanChangeReceipt, PlanChangeViewQuery, PlanChangeViewResult, PlanProposalV1, RecordPlanChangeProposalReceipt, RecordUserDecisionReceipt, TaskDispositionRow, UserDecisionV1 } from "../../src/contracts/goal-change.js";
import {
  P111_GOAL,
  P111_NEW_PLAN,
  P111_PROJECT,
  P111_PROJECT_B,
  P111_SCHEMA,
  P111_SOURCE_PLAN,
  P111_WORKSPACE,
  buildAmendGoalRequestV1,
  buildApplyPlanChangeCommand,
  buildP111NewPlanDraft,
  buildPlanProposalV1,
  buildRecordPlanChangeProposalCommand,
  buildRecordUserDecisionCommand,
  buildUserDecisionV1,
  p111GoalRef,
  p111PlanRef,
  p111ProposalRef,
} from "../contract-support/fixtures/goal-change-fixtures.js";
import { buildBootstrapCommand } from "../../src/contracts/bootstrap.js";
import {
  WORKSPACE_BOOTSTRAP_FIXTURE_V1,
  buildBootstrapLedgerCommit,
} from "../contract-support/fixtures/bootstrap-fixture-v1.js";
import {
  MULTI_SCOPE_CREATE_GOAL_FIXTURE_V1,
  buildCreateGoalCommand,
  buildGoalCreateLedgerCommit,
} from "../contract-support/fixtures/goal-fixtures.js";
import { ARCHITECTURE_BASELINE_FIXTURE_V1, COMPLETION_POLICY_FIXTURE_V1, buildActivateCommand, buildActivateLedgerCommit, buildInstallCommand, buildInstallLedgerCommit } from "../../src/fixtures/governance-fixtures.js";
import { architectureBaselinePinFor, completionPolicyPinFor } from "../../src/contracts/governance.js";
import { HAND_AUTHORED_PLAN_REVISION_FIXTURE_V1, buildApplyPlanCommand } from "../../src/fixtures/plan-fixtures.js";
import type { InstallArchitectureBaselineRevisionCommand, InstallCompletionPolicyRevisionCommand } from "../../src/contracts/governance.js";
import { FIXED_ISO_2026_09_05 } from "../../src/testing/sequences.js";

const FIXED = FIXED_ISO_2026_09_05;

export interface P1_11TestHarness extends P1_08TestHarness {
  planChangeView(query: PlanChangeViewQuery): Promise<PlanChangeViewResult>;
  planProposal: Pick<PlanCompilerPort, 'request'>;
  planningContext: PlanningContextPort;
  collaboration: Pick<HumanCollaboration, 'amend'>;
}

export type P1_11HarnessLike = P1_08HarnessLike & {
  control: Pick<ControlEngine, 'submit' | 'recordPlanChangeProposal' | 'recordUserDecision' | 'applyPlanChange'>;
  planChangeView: (query: PlanChangeViewQuery) => Promise<PlanChangeViewResult>;
  planProposal: Pick<PlanCompilerPort, 'request'>;
  planningContext: PlanningContextPort;
  collaboration: Pick<HumanCollaboration, 'amend'>;
};

export function toP1_11Harness(h: P1_11HarnessLike): P1_11TestHarness {
  return h as unknown as P1_11TestHarness;
}

// ------------------------------------------------------------------------ //
// Scenario setup (real ledger commits; deterministic fixture commits)        //
// ------------------------------------------------------------------------ //

export async function p111BootstrapGoalGovernance(ledger: StateLedger, projectId: string): Promise<void> {
  const bootCmd = buildBootstrapCommand(WORKSPACE_BOOTSTRAP_FIXTURE_V1, {
    commandId: "cmd-bootstrap",
    correlationId: "corr-bootstrap",
    submittedAt: FIXED,
  });
  const bootReceipt = await ledger.commit(
    buildBootstrapLedgerCommit(bootCmd, {
      eventIds: ["evt-bootstrap-1", "evt-bootstrap-2", "evt-bootstrap-3", "evt-bootstrap-4"],
      occurredAt: FIXED,
    }),
  );
  expect(bootReceipt.status).toBe("committed");
  const scope = MULTI_SCOPE_CREATE_GOAL_FIXTURE_V1.scopes.find((s) => s.projectId === projectId);
  if (!scope) throw new Error("unknown project " + projectId);
  const goalReceipt = await ledger.commit(
    buildGoalCreateLedgerCommit(
      buildCreateGoalCommand(scope, { commandId: "cmd-goal-" + projectId, correlationId: "corr-goal-" + projectId, submittedAt: FIXED }),
      { eventId: "evt-goal-" + projectId, occurredAt: FIXED, projectRevision: 1, workspaceRevision: 1 },
    ),
  );
  expect(goalReceipt.status).toBe("committed");
  const cp = buildInstallCommand(COMPLETION_POLICY_FIXTURE_V1, {
    commandId: "cmd-install-cp-" + projectId, correlationId: "corr-install-cp-" + projectId, submittedAt: FIXED, projectId, idempotencyKey: "inst-cp-" + projectId,
  }) as InstallCompletionPolicyRevisionCommand;
  const cpReceipt = await ledger.commit(buildInstallLedgerCommit(cp, { eventId: "evt-install-cp-" + projectId, occurredAt: FIXED }));
  expect(cpReceipt.status).toBe("committed");
  const ab = buildInstallCommand(ARCHITECTURE_BASELINE_FIXTURE_V1, {
    commandId: "cmd-install-ab-" + projectId, correlationId: "corr-install-ab-" + projectId, submittedAt: FIXED, projectId, idempotencyKey: "inst-ab-" + projectId,
  }) as InstallArchitectureBaselineRevisionCommand;
  const abReceipt = await ledger.commit(buildInstallLedgerCommit(ab, { eventId: "evt-install-ab-" + projectId, occurredAt: FIXED }));
  expect(abReceipt.status).toBe("committed");
  const actCp = buildActivateCommand(completionPolicyPinFor(cp), {
    commandId: "cmd-act-cp-" + projectId, correlationId: "corr-act-cp-" + projectId, submittedAt: FIXED, projectId, idempotencyKey: "act-cp-" + projectId, expectedRevision: 1,
  });
  const actCpReceipt = await ledger.commit(buildActivateLedgerCommit(actCp, { eventId: "evt-act-cp-" + projectId, occurredAt: FIXED, activeAggregateRevision: 1, projectRevision: 1 }));
  expect(actCpReceipt.status).toBe("committed");
  const actAb = buildActivateCommand(architectureBaselinePinFor(ab), {
    commandId: "cmd-act-ab-" + projectId, correlationId: "corr-act-ab-" + projectId, submittedAt: FIXED, projectId, idempotencyKey: "act-ab-" + projectId, expectedRevision: 1,
  });
  const actAbReceipt = await ledger.commit(buildActivateLedgerCommit(actAb, { eventId: "evt-act-ab-" + projectId, occurredAt: FIXED, activeAggregateRevision: 1, projectRevision: 1 }));
  expect(actAbReceipt.status).toBe("committed");
}

export type P111ChangeScenarioResult = {
  goalRef: { aggregateType: "Goal"; projectId: string; goalId: string };
  sourcePlan: PlanRevisionSnapshot;
  sourceGoal: GoalSnapshot;
  intent: AmendGoalRequestV1;
  proposal: PlanProposalV1;
  proposalReceipt: RecordPlanChangeProposalReceipt;
  decision: UserDecisionV1;
  decisionReceipt: RecordUserDecisionReceipt;
  applyCommand: ApplyPlanChangeCommand;
  applyReceipt: ApplyPlanChangeReceipt;
  view: PlanChangeViewResult;
  dispositions: TaskDispositionRow[];
};

export async function runP111ChangeScenario(h: P1_11HarnessLike, projectId: string = P111_PROJECT): Promise<P111ChangeScenarioResult> {
  await p111BootstrapGoalGovernance(h.ledger, projectId);
  const planCommand = buildApplyPlanCommand(HAND_AUTHORED_PLAN_REVISION_FIXTURE_V1, {
    commandId: "p111-cmd-accept-plan",
    correlationId: "p111-corr-accept-plan",
    submittedAt: FIXED,
    projectId,
    expectedRevision: 1,
    idempotencyKey: "p111-accept-plan",
  });
  const planReceipt = await h.applyPlan(planCommand);
  expect(planReceipt.status).toBe("committed");

  const goalRef = p111GoalRef(projectId);
  const sourcePlanRef = p111PlanRef(HAND_AUTHORED_PLAN_REVISION_FIXTURE_V1.planId, projectId);
  const sourceLoad = await h.ledger.load(sourcePlanRef);
  expect(sourceLoad.status).toBe("found");
  if (sourceLoad.status !== "found") throw new Error("source plan not found");
  const sourcePlan = sourceLoad.snapshot as PlanRevisionSnapshot;
  const sourceGoalLoad = await h.ledger.load(goalRef);
  expect(sourceGoalLoad.status).toBe("found");
  if (sourceGoalLoad.status !== "found") throw new Error("source goal not found");
  const sourceGoal = sourceGoalLoad.snapshot as GoalSnapshot;

  const intent = buildAmendGoalRequestV1({ projectId, workspaceId: P111_WORKSPACE, goalRef: p111GoalRef(projectId), planRef: p111PlanRef(P111_SOURCE_PLAN, projectId) });
  const proposal = buildPlanProposalV1({ projectId, workspaceId: P111_WORKSPACE, sourceGoalRef: p111GoalRef(projectId), sourcePlanRef: p111PlanRef(P111_SOURCE_PLAN, projectId) });
  const proposalReceipt = await h.control.recordPlanChangeProposal(buildRecordPlanChangeProposalCommand(proposal, { commandId: "p111-cmd-proposal" }));
  expect(proposalReceipt.status).toBe("committed");

  const decision = buildUserDecisionV1({ proposal, outcome: "accept" });
  const decisionReceipt = await h.control.recordUserDecision(buildRecordUserDecisionCommand(decision, { commandId: "p111-cmd-decision" }));
  expect(decisionReceipt.status).toBe("committed");

  const deltas = proposal.patch.patchDraft.obligationDeltas;
  const newPlanDraft = buildP111NewPlanDraft(sourcePlan, deltas, proposal.patch.patchDraft.objective);
  const applyCommand = buildApplyPlanChangeCommand(proposal, decision, newPlanDraft, {
    commandId: "p111-cmd-apply",
    expectedRevision: sourceGoal.revision,
  });
  const applyReceipt = await h.control.applyPlanChange(applyCommand);
  expect(applyReceipt.status).toBe("committed");

  await h.advanceProjection();
  const view = await h.planChangeView({ projectId, workspaceId: P111_WORKSPACE, goalId: P111_GOAL });
  const dispositions = view.status === "ready" ? view.dispositions : [];
  return { goalRef, sourcePlan, sourceGoal, intent, proposal, proposalReceipt, decision, decisionReceipt, applyCommand, applyReceipt, view, dispositions };
}

export function planChangeViewQueryFor(projectId: string = P111_PROJECT): PlanChangeViewQuery {
  return { projectId, workspaceId: P111_WORKSPACE, goalId: P111_GOAL };
}

export { P111_GOAL, P111_NEW_PLAN, P111_PROJECT, P111_PROJECT_B, P111_SCHEMA, P111_SOURCE_PLAN, P111_WORKSPACE, p111GoalRef, p111PlanRef, p111ProposalRef };
