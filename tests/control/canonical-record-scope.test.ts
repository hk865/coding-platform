import { describe, expect, it } from "vitest";
import { InMemoryLedger } from "../../src/data/state-ledger/in-memory-ledger.js";
import { createControlEngine } from "../../src/control/control-engine/control-engine.js";
import { buildBootstrapCommand } from "../../src/contracts/bootstrap.js";
import { WORKSPACE_BOOTSTRAP_FIXTURE_V1 } from "../contract-support/fixtures/bootstrap-fixture-v1.js";
import { buildCreateGoalCommand } from "../../src/contracts/commands/goal.js";
import { buildP110Intent, buildP110SubmitControlCommand } from "../contract-support/fixtures/control-fixtures.js";
import { controlIntentRefFor } from "../../src/contracts/control-intent.js";
import { buildP115Proposal, buildP115ProposalCommand, buildP115Decision, buildP115DecisionCommand, P115_COORDINATION_POLICY_CONTENT } from "../contract-support/fixtures/human-role-collaboration-fixtures.js";
import { initialDesignProposalRefFor, initialDesignDecisionRefFor, coordinationPolicyContentDigest } from "../../src/contracts/human-role-collaboration.js";
import { buildGoalChangeApplyCommit } from "../../src/control/control-engine/records/goal-change.js";
import { planRevisionSnapshotFor } from "../../src/control/control-engine/records/plan.js";
import { HAND_AUTHORED_PLAN_REVISION_FIXTURE_V1, buildApplyPlanCommand } from "../../src/fixtures/plan-fixtures.js";
import { buildP111NewPlanDraft, buildApplyPlanChangeCommand, buildPlanProposalV1, buildUserDecisionV1 } from "../contract-support/fixtures/goal-change-fixtures.js";
import { architectureBaselinePinFor, completionPolicyPinFor } from "../../src/contracts/governance.js";
import { ARCHITECTURE_BASELINE_FIXTURE_V1, COMPLETION_POLICY_FIXTURE_V1, buildInstallCommand } from "../../src/fixtures/governance-fixtures.js";
import type { InstallArchitectureBaselineRevisionCommand, InstallCompletionPolicyRevisionCommand } from "../../src/contracts/governance.js";

const now = "2026-09-09T08:00:00.000Z";
const actor = { kind: "human" as const, id: "scope-owner" };
const projectId = "proj-beta";
const workspaceId = "ws-shared";

async function world() {
  const ledger = new InMemoryLedger();
  let sequence = 0;
  const control = createControlEngine({ ledger, now: () => now, eventId: () => "scope-event-" + ++sequence });
  expect((await control.bootstrap(buildBootstrapCommand(WORKSPACE_BOOTSTRAP_FIXTURE_V1, { commandId: "bootstrap-scope", correlationId: "scope", submittedAt: now }))).status).toBe("committed");
  return { ledger, control };
}

describe("canonical records use command and canonical scope", () => {
  it("persists a beta ControlIntent without creating an alpha snapshot, and replays the same identity", async () => {
    const { ledger, control } = await world();
    const intent = { ...buildP110Intent({ intentId: "local-intent", kind: "pause" }), projectId, workspaceId,
      scope: { projectId, workspaceId, goalId: null, taskId: null, runRef: null } };
    const command = buildP110SubmitControlCommand(intent, { commandId: "scope-intent", actor });
    const first = await control.submitControl(command);
    expect(first.status).toBe("committed");
    expect(await ledger.load(controlIntentRefFor(projectId, workspaceId, intent.intentId))).toMatchObject({ status: "found", snapshot: { intent } });
    expect(await ledger.load(controlIntentRefFor("proj-alpha", workspaceId, intent.intentId))).toMatchObject({ status: "not_found" });
    expect(await control.submitControl(command)).toMatchObject({ status: "committed", replayed: true });
  });

  it("persists exact design, decision and policy IDs rather than a scenario's fixed IDs", async () => {
    const { ledger, control } = await world();
    const goalRef = { aggregateType: "Goal" as const, projectId, goalId: "goal-local" };
    expect((await control.submit(buildCreateGoalCommand({ projectId, workspaceId, goalId: goalRef.goalId, objective: "scope isolation", actor }, { commandId: "scope-goal", correlationId: "scope", submittedAt: now, idempotencyKey: "scope-goal" }))).status).toBe("committed");
    const proposal = buildP115Proposal({ projectId, workspaceId, goalRef, designId: "design-local", planRef: null });
    expect((await control.recordInitialDesignProposal(buildP115ProposalCommand(proposal, { commandId: "scope-design" }))).status).toBe("committed");
    const proposalRef = initialDesignProposalRefFor(projectId, workspaceId, proposal.designId);
    expect(await ledger.load(proposalRef)).toMatchObject({ status: "found", snapshot: { proposal } });
    expect(await ledger.load(initialDesignProposalRefFor(projectId, workspaceId, "design-p115-1"))).toMatchObject({ status: "not_found" });
    const decision = buildP115Decision(proposal, { decisionId: "decision-local", proposalRef });
    expect((await control.recordInitialDesignDecision(buildP115DecisionCommand(decision, { commandId: "scope-decision" }))).status).toBe("committed");
    expect(await ledger.load(initialDesignDecisionRefFor(projectId, workspaceId, decision.decisionId))).toMatchObject({ status: "found", snapshot: { decision } });
    const policyId = "policy-local";
    expect((await control.installCoordinationPolicy({ commandType: "InstallCoordinationPolicy", schemaVersion: 1, commandId: "scope-policy", correlationId: "scope", submittedAt: now,
      identity: { projectId, actor, idempotencyKey: "scope-policy" }, payload: { policyId, content: P115_COORDINATION_POLICY_CONTENT, contentDigest: coordinationPolicyContentDigest(P115_COORDINATION_POLICY_CONTENT, policyId, 1) } })).status).toBe("committed");
    expect(await ledger.load({ aggregateType: "CoordinationPolicyRevision", projectId, policyId, revision: 1 })).toMatchObject({ status: "found", snapshot: { policyId } });
    expect(await ledger.load({ aggregateType: "CoordinationPolicyRevision", projectId, policyId: "coordination-policy-1", revision: 1 })).toMatchObject({ status: "not_found" });
  });

  it("keeps a changed goal's exact canonical goal and workspace in every new revision fact", () => {
    const goalRef = { aggregateType: "Goal" as const, projectId, goalId: "goal-not-the-sample" };
    const deps = { commandId: "scope-plan", projectId, correlationId: "scope", submittedAt: now, expectedRevision: 1, goalId: goalRef.goalId };
    const cp = buildInstallCommand(COMPLETION_POLICY_FIXTURE_V1, deps) as InstallCompletionPolicyRevisionCommand;
    const ab = buildInstallCommand(ARCHITECTURE_BASELINE_FIXTURE_V1, deps) as InstallArchitectureBaselineRevisionCommand;
    const pins = { completionPolicy: completionPolicyPinFor(cp), architectureBaseline: architectureBaselinePinFor(ab) };
    const sourcePlan = planRevisionSnapshotFor(buildApplyPlanCommand({ ...HAND_AUTHORED_PLAN_REVISION_FIXTURE_V1, goalId: goalRef.goalId, planId: "source-local" }, deps), pins, now);
    const proposal = buildPlanProposalV1({ projectId, workspaceId: "ws-not-the-sample", sourceGoalRef: goalRef, sourcePlanRef: sourcePlan.ref });
    const decision = buildUserDecisionV1({ proposal, outcome: "accept", overrides: { projectId, workspaceId: proposal.workspaceId } });
    const newPlanDraft = buildP111NewPlanDraft(sourcePlan, [], "scope-local objective");
    const command = buildApplyPlanChangeCommand(proposal, decision, newPlanDraft, { commandId: "scope-change", expectedRevision: 2 });
    command.payload.proposalRef = { ...command.payload.proposalRef, workspaceId: proposal.workspaceId };
    command.payload.decisionRef = { ...command.payload.decisionRef, workspaceId: proposal.workspaceId };
    const batch = buildGoalChangeApplyCommit(command, { eventId: "scope-change-event", occurredAt: now, changedAt: now, pins, sourcePlan, newPlanDraft,
      baseGoal: { ref: goalRef, workspaceRef: { aggregateType: "Workspace", projectId, workspaceId: proposal.workspaceId }, revision: 2, objective: "scope-local objective", desiredState: "active", activePlanRevision: sourcePlan.ref } });
    expect(batch.expectedVersions[0]?.ref).toEqual(goalRef);
    expect(batch.snapshots[0]).toMatchObject({ goalRef });
    expect(batch.snapshots[1]).toMatchObject({ ref: { projectId, workspaceId: proposal.workspaceId, goalId: goalRef.goalId, revision: 3 }, change: { goalRef } });
    expect(batch.events.map(event => event.eventId)).toEqual(["scope-change-event", "scope-change-event-supersede", "scope-change-event-revision"]);
    expect(batch.events[0]).toMatchObject({ payload: { goalId: goalRef.goalId } });
    expect(batch.events[2]).toMatchObject({ aggregateId: goalRef.goalId + "@3" });
  });
});
