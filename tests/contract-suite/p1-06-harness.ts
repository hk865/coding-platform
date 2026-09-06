/**
 * Shared P1-06 contract-suite harness contract: scenario preparation + helper
 * builders used by BOTH adapter suites (InMemory + SQLite, same fixtures).
 */
import { expect } from "vitest";
import type { P1_04HarnessLike, P1_04TestHarness } from "./p1-04-harness.js";
import type { P1_04HarnessFactory } from "./p1-04-harness.js";
import type { HandoffProvenanceViewQuery, HandoffProvenanceViewResult } from "../../src/contracts/handoff-view.js";
import type { HandoffContextPort, HandoffContextRequestV1, HandoffContextResultV1 } from "../../src/contracts/handoff-context.js";
import type { HandoffControlPort } from "../../src/contracts/handoff-control.js";
import type { HandoffPort } from "../../src/contracts/handoff.js";
import type { RecordHandoffCommand, RecordHandoffReceipt, ClaimReplacementCommand, ClaimReplacementReceipt } from "../../src/contracts/handoff.js";
import type { ArtifactRef } from "../../src/contracts/artifact.js";
import type { RunRef, TaskAttemptRef, RuntimeEventV1 } from "../../src/contracts/dispatch.js";
import { buildBootstrapCommand } from "../../src/contracts/bootstrap.js";
import { WORKSPACE_BOOTSTRAP_FIXTURE_V1 } from "../../src/contracts/fixtures/bootstrap-fixture-v1.js";
import {
  ARCHITECTURE_BASELINE_FIXTURE_V1,
  COMPLETION_POLICY_FIXTURE_V1,
  architectureBaselinePinFor,
  buildActivateCommand,
  buildInstallCommand,
  completionPolicyPinFor,
} from "../../src/contracts/fixtures/governance-fixtures.js";
import { MULTI_SCOPE_CREATE_GOAL_FIXTURE_V1, buildCreateGoalCommand } from "../../src/contracts/fixtures/goal-fixtures.js";
import { buildApplyPlanCommand } from "../../src/contracts/fixtures/plan-fixtures.js";
import {
  P106_BUDGET_V1,
  P106_DECLARED_PERMISSIONS_V1,
  P106_GOAL,
  P106_PLAN_ID,
  P106_PLAN_REVISION_FIXTURE_V1,
  P106_PROJECT,
  P106_ROLE_BINDING_V1,
  P106_SCHEMA,
  P106_TASK_ID,
  P106_WORKSPACE,
  buildHandoffPacketV1,
  buildRecordHandoffCommand,
  freshP106Id,
  p106PlanRef,
  type P106ScenarioPreview,
} from "../../src/contracts/fixtures/handoff-fixtures.js";
import { artifactBodyDigest } from "../../src/contracts/artifact.js";
import { runRefFor, taskAttemptRefFor } from "../../src/contracts/dispatch.js";
import { buildDispatchClaimCommand, buildDispatchStartCommand, buildRunFactCommand, rebaseScriptForRun, FAKE_RUNTIME_SCRIPT_CRASHED_V1, FAKE_RUNTIME_SCRIPT_COMPLETED_V1 } from "../../src/contracts/fixtures/dispatch-fixtures.js";
import type { PlanRevisionRef } from "../../src/contracts/plan.js";

export type { P1_04HarnessFactory };

export interface P1_06TestHarness extends P1_04TestHarness {
  /** P1-03 real vault (body-first packet/bundle puts). */
  vault: import("../../src/contracts/artifact.js").ArtifactPort;
  handoffContext: HandoffContextPort;
  handoffControl: HandoffControlPort;
  handoffDrive: HandoffPort;
  recordHandoff(command: RecordHandoffCommand): Promise<RecordHandoffReceipt>;
  claimReplacement(command: ClaimReplacementCommand): Promise<ClaimReplacementReceipt>;
  handoffProvenance(query: HandoffProvenanceViewQuery): Promise<HandoffProvenanceViewResult>;
  assembleHandoff(request: HandoffContextRequestV1): Promise<HandoffContextResultV1>;
}

export type P1_06HarnessFactory = () => Promise<P1_06TestHarness>;

export type P1_06HarnessLike = P1_04HarnessLike & {
  handoffContext: HandoffContextPort;
  handoffControl: HandoffControlPort;
  handoffDrive: HandoffPort;
  recordHandoff: (command: RecordHandoffCommand) => Promise<RecordHandoffReceipt>;
  claimReplacement: (command: ClaimReplacementCommand) => Promise<ClaimReplacementReceipt>;
  handoffProvenance: (query: HandoffProvenanceViewQuery) => Promise<HandoffProvenanceViewResult>;
  assembleHandoff: (request: HandoffContextRequestV1) => Promise<HandoffContextResultV1>;
};

export function toP1_06Harness(h: P1_06HarnessLike): P1_06TestHarness {
  return h as unknown as P1_06TestHarness;
}

export { P106_GOAL, P106_TASK_ID, P106_PROJECT, P106_WORKSPACE, P106_SCHEMA };

export function p106GoalScope() {
  const scope = MULTI_SCOPE_CREATE_GOAL_FIXTURE_V1.scopes[0]!;
  return {
    ...scope,
    projectId: P106_PROJECT,
    workspaceId: P106_WORKSPACE,
    goalId: P106_GOAL,
    objective: "为 " + P106_PROJECT + " 完成换手接续目标：A 中断后 B 在同一 Task 上继续并留下可追溯结果",
  };
}

/** Shared governance+goal+plan preparation for the P1-06 handoff scenario. */
export async function prepareP106Scenario(
  h: P1_06TestHarness | P1_04HarnessLike,
): Promise<P106ScenarioPreview> {
  const boot = await h.bootstrap(
    buildBootstrapCommand(WORKSPACE_BOOTSTRAP_FIXTURE_V1, {
      commandId: "cmd-p106-boot",
      correlationId: "corr-p106-boot",
      submittedAt: P106_SCHEMA,
    }),
  );
  expect(boot.status).toBe("committed");

  const installPolicy = buildInstallCommand(COMPLETION_POLICY_FIXTURE_V1, {
    commandId: "cmd-p106-install-policy",
    correlationId: "corr-p106-install-policy",
    submittedAt: P106_SCHEMA,
    projectId: P106_PROJECT,
    idempotencyKey: "p106-install-policy",
  });
  const installBaseline = buildInstallCommand(ARCHITECTURE_BASELINE_FIXTURE_V1, {
    commandId: "cmd-p106-install-baseline",
    correlationId: "corr-p106-install-baseline",
    submittedAt: P106_SCHEMA,
    projectId: P106_PROJECT,
    idempotencyKey: "p106-install-baseline",
  });
  expect((await h.install(installPolicy)).status).toBe("committed");
  expect((await h.install(installBaseline)).status).toBe("committed");

  const actPolicy = buildActivateCommand(completionPolicyPinFor(installPolicy as never), {
    commandId: "cmd-p106-activate-policy",
    correlationId: "corr-p106-activate-policy",
    submittedAt: P106_SCHEMA,
    projectId: P106_PROJECT,
    expectedRevision: 1,
    idempotencyKey: "p106-activate-policy",
  });
  const actBaseline = buildActivateCommand(architectureBaselinePinFor(installBaseline as never), {
    commandId: "cmd-p106-activate-baseline",
    correlationId: "corr-p106-activate-baseline",
    submittedAt: P106_SCHEMA,
    projectId: P106_PROJECT,
    expectedRevision: 1,
    idempotencyKey: "p106-activate-baseline",
  });
  expect((await h.activate(actPolicy)).status).toBe("committed");
  expect((await h.activate(actBaseline)).status).toBe("committed");

  const goal = await (("control" in h && h.control !== undefined)
    ? h.control.submit(
        buildCreateGoalCommand(p106GoalScope(), {
          commandId: "cmd-p106-create-goal",
          correlationId: "corr-p106-create-goal",
          submittedAt: P106_SCHEMA,
          idempotencyKey: "p1-06-create-goal",
        }),
      )
    : (h as P1_04HarnessLike).control.submit(
        buildCreateGoalCommand(p106GoalScope(), {
          commandId: "cmd-p106-create-goal",
          correlationId: "corr-p106-create-goal",
          submittedAt: P106_SCHEMA,
          idempotencyKey: "p1-06-create-goal",
        }),
      ));
  expect(goal.status).toBe("committed");

  const plan = await h.applyPlan(
    buildApplyPlanCommand(P106_PLAN_REVISION_FIXTURE_V1, {
      commandId: "cmd-p106-apply-plan",
      correlationId: "corr-p106-apply-plan",
      submittedAt: P106_SCHEMA,
      projectId: P106_PROJECT,
      expectedRevision: 1,
      idempotencyKey: "p1-06-apply-plan",
    }),
  );
  expect(plan.status).toBe("committed");

  const goalLoad = await h.ledger.load({ aggregateType: "Goal" as const, projectId: P106_PROJECT, goalId: P106_GOAL });
  expect(goalLoad.status).toBe("found");
  const planLoad = await h.ledger.load(p106PlanRef(P106_PROJECT));
  expect(planLoad.status).toBe("found");
  const wsLoad = await h.ledger.load({ aggregateType: "Workspace" as const, projectId: P106_PROJECT, workspaceId: P106_WORKSPACE });
  expect(wsLoad.status).toBe("found");
  return {
    projectId: P106_PROJECT,
    goalId: P106_GOAL,
    planRef: p106PlanRef(P106_PROJECT),
    workspaceId: P106_WORKSPACE,
    planSnapshot: planLoad.status === "found" ? (planLoad.snapshot as import("../../src/contracts/plan.js").PlanRevisionSnapshot) : undefined,
    goal: goalLoad.status === "found" ? (goalLoad.snapshot as import("../../src/contracts/ledger.js").GoalSnapshot) : undefined,
    workspace: wsLoad.status === "found" ? (wsLoad.snapshot as import("../../src/contracts/ledger.js").WorkspaceSnapshot) : undefined,
    pinnedCompletionPolicy: completionPolicyPinFor(installPolicy as never),
    pinnedArchitectureBaseline: architectureBaselinePinFor(installBaseline as never),
  };
}

/** A's claimed run (claim + start + optional runtime facts) on the handoff task. */
export async function runP106ClaimedRun(
  h: P1_06TestHarness,
  deps: { projectId: string; taskId: string; runId: string; attemptId: string },
): Promise<void> {
  const projectId = deps.projectId;
  const planRef = p106PlanRefFor(projectId);
  const claim = await h.claimTask(
    buildDispatchClaimCommand({
      commandId: "cmd-p106-claim-" + deps.runId,
      correlationId: "corr-p106-claim-" + deps.runId,
      submittedAt: P106_SCHEMA,
      projectId,
      goalId: P106_GOAL,
      taskId: deps.taskId,
      attemptId: deps.attemptId,
      runId: deps.runId,
      idempotencyKey: "p106-claim-" + deps.runId,
      // MUST match the startRun envelope binding (P1-03 start-run guard 4):
      // a claim with the default P1-03 binding + a P106 envelope is stale_binding.
      roleBinding: P106_ROLE_BINDING_V1,
      declaredPermissions: P106_DECLARED_PERMISSIONS_V1,
      budget: P106_BUDGET_V1,
    }),
  );
  expect(claim.status).toBe("committed");
  if (claim.status !== "committed") throw new Error("p106 claim failed: " + claim.code);
  const bundleRef: ArtifactRef = {
    kind: "artifact",
    contentType: "text/plain",
    digest: artifactBodyDigest("p106-bundle-" + deps.runId),
    sizeBytes: artifactBodyDigest("p106-bundle-" + deps.runId).length,
    source: { kind: "plan-revision", refId: planRef.planId, revision: "1" },
  };
  const envelope = {
    schemaVersion: 1 as const,
    envelopeId: "envelope-p106-" + deps.runId,
    projectId,
    workspaceId: P106_WORKSPACE,
    goalId: P106_GOAL,
    taskId: deps.taskId,
    runRef: runRefFor(projectId, P106_GOAL, deps.runId),
    attemptRef: taskAttemptRefFor(projectId, P106_GOAL, deps.taskId, deps.attemptId),
    planRef,
    roleBinding: P106_ROLE_BINDING_V1,
    workspaceSnapshot: { workspaceId: P106_WORKSPACE, revision: 1 },
    permissions: { policyRevision: P106_ROLE_BINDING_V1.policyRevision, tools: [...P106_DECLARED_PERMISSIONS_V1.tools], writeScope: [...P106_DECLARED_PERMISSIONS_V1.writeScope] },
    budget: P106_BUDGET_V1,
    sourceRefs: [{ kind: "plan-revision" as const, refId: planRef.planId, revision: "1" }],
    bundleRef,
  };
  const start = await h.startRun(
    buildDispatchStartCommand({
      commandId: "cmd-p106-start-" + deps.runId,
      correlationId: "corr-p106-start-" + deps.runId,
      submittedAt: P106_SCHEMA,
      projectId,
      runId: deps.runId,
      expectedRevision: 1,
      envelope,
      manifest: {
        schemaVersion: 1 as const,
        selectedRefs: [{ kind: "plan-revision" as const, refId: planRef.planId, revision: "1" }],
        gaps: [],
        freshness: {
          workspaceSnapshot: { workspaceId: P106_WORKSPACE, revision: 1 },
          planRef,
        },
      },
    }),
  );
  expect(start.status).toBe("committed");
}

/** Terminal A run: claim + start + crash (via run-fact) or completed. */
export async function endP106RunA(
  h: P1_06TestHarness,
  deps: { projectId: string; taskId: string; runId: string; attemptId: string; script?: "crashed" | "completed" },
): Promise<RunRef> {
  const projectId = deps.projectId;
  const planRef = p106PlanRefFor(projectId);
  await runP106ClaimedRun(h, deps);
  const runRef = runRefFor(projectId, P106_GOAL, deps.runId);
  const script = deps.script === "completed" ? rebaseScriptForRun(FAKE_RUNTIME_SCRIPT_COMPLETED_V1, runRef) : rebaseScriptForRun(FAKE_RUNTIME_SCRIPT_CRASHED_V1, runRef);
  let expectedRevision = 2;
  for (const event of script) {
    const receipt = await h.runFact(
      buildRunFactCommand({
        commandId: "cmd-p106-fact-" + deps.runId + "-" + event.sequence,
        correlationId: "corr-p106-fact-" + deps.runId,
        submittedAt: event.occurredAt,
        projectId,
        runId: deps.runId,
        expectedRevision,
        fact: { kind: "runtime_event", event },
      }),
    );
    expect(receipt.status).toBe("committed");
    if (receipt.status === "committed") expectedRevision = receipt.runRevision;
  }
  return runRef;
}

export function p106PlanRefFor(projectId: string): PlanRevisionRef {
  return p106PlanRef(projectId);
}

export function p106RequestB(
  deps: {
    projectId: string;
    runId: string;
    attemptId: string;
    packetRef: import("../../src/contracts/handoff.js").HandoffPacketRef;
    workspaceRevision?: number;
    scope?: { tools: string[]; writeScope: string[] };
    budget?: import("../../src/contracts/dispatch.js").TaskBudgetV1;
  },
): HandoffContextRequestV1 {
  return {
    schemaVersion: 1,
    requestId: "req-handoff-" + deps.runId,
    projectId: deps.projectId,
    workspaceId: P106_WORKSPACE,
    goalId: P106_GOAL,
    taskId: P106_TASK_ID,
    planRef: p106PlanRefFor(deps.projectId),
    runRef: runRefFor(deps.projectId, P106_GOAL, deps.runId),
    attemptRef: taskAttemptRefFor(deps.projectId, P106_GOAL, P106_TASK_ID, deps.attemptId),
    roleBinding: P106_ROLE_BINDING_V1,
    declaredPermissions: { tools: [...P106_DECLARED_PERMISSIONS_V1.tools], writeScope: [...P106_DECLARED_PERMISSIONS_V1.writeScope] },
    scope: deps.scope ?? { tools: [...P106_DECLARED_PERMISSIONS_V1.tools], writeScope: [...P106_DECLARED_PERMISSIONS_V1.writeScope] },
    workspaceSnapshot: { workspaceId: P106_WORKSPACE, revision: deps.workspaceRevision ?? 1 },
    handoffPacketRef: deps.packetRef,
    budget: deps.budget ?? P106_BUDGET_V1,
    submittedAt: P106_SCHEMA,
  };
}
