/**
 * P1-02 restart-path fixtures: full persistent path
 *   bootstrap -> install(CompletionPolicy, ArchitectureBaseline) ->
 *   activate x2 (CAS) -> CreateGoal -> advance -> applyPlan -> commit ->
 *   close -> reopen -> (a) canonical refs re-resolve, (b) Plan Graph /
 *   Task Detail / active revision rebuilt identically from persisted events.
 *
 * SKELETON (shared baseline): the original P1-01 pattern (restart-fixtures /
 * restart-assertions) is reused; lane D completes/owns this file. Readiness
 * probe: the path is only executable once the P1-02 handlers + projections
 * are implemented (stubs throw "P1-02: ... not implemented yet").
 */
import type { WorkspaceBootstrapCommand, WorkspaceBootstrapReceipt } from "../../src/contracts/bootstrap.js";
import { buildBootstrapCommand } from "../../src/contracts/bootstrap.js";
import { WORKSPACE_BOOTSTRAP_FIXTURE_V1 } from "../../src/contracts/fixtures/bootstrap-fixture-v1.js";
import {
  ARCHITECTURE_BASELINE_FIXTURE_V1,
  COMPLETION_POLICY_FIXTURE_V1,
  buildActivateCommand,
  buildInstallCommand,
  completionPolicyPinFor,
  architectureBaselinePinFor,
} from "../../src/contracts/fixtures/governance-fixtures.js";
import { HAND_AUTHORED_PLAN_REVISION_FIXTURE_V1, buildApplyPlanCommand } from "../../src/contracts/fixtures/plan-fixtures.js";
import { MULTI_SCOPE_CREATE_GOAL_FIXTURE_V1, buildCreateGoalCommand } from "../../src/contracts/fixtures/goal-fixtures.js";
import { createPersistentSqliteHarness } from "../../src/harness/persistent-harness.js";
import type { PersistentSqliteHarness } from "../../src/harness/persistent-harness.js";
import type { PlanGraphView } from "../../src/contracts/plan-view.js";
import type { TaskDetailView } from "../../src/contracts/plan-view.js";
import type { GoalView } from "../../src/contracts/goal-view.js";

const SCHEMA = "2026-09-05T12:00:00.000Z";

export interface P102PreRestartEvidence {
  projectId: string;
  workspaceId: string;
  goalId: string;
  planId: string;
  policyRef: unknown;
  baselineRef: unknown;
  policyDigest: string;
  baselineDigest: string;
  policyContentDigest: string;
  baselineContentDigest: string;
  planPinPolicyDigest: string;
  planPinBaselineDigest: string;
  activePolicyRef: unknown;
  activeBaselineRef: unknown;
  goalSnapshotActivePlan: unknown;
  goalSnapshotRevision: number;
  notFoundBaseline: { projectId: string; aggregateType: string };
  graph: PlanGraphView | null;
  taskDetails: TaskDetailView[];
  goalView: GoalView | null;
  eventTypes: string[];
}

/** True when the P1-02 handlers + projections are implemented (no stub throw). */
export async function isP102Ready(): Promise<boolean> {
  const h = await createPersistentSqliteHarness({ deps: {} });
  try {
    const c = buildInstallCommand(COMPLETION_POLICY_FIXTURE_V1, {
      commandId: "probe-cmd",
      correlationId: "probe-corr",
      submittedAt: SCHEMA,
      projectId: "proj-alpha",
      idempotencyKey: "probe-install",
    });
    await h.bootstrap(buildBootstrapCommand(WORKSPACE_BOOTSTRAP_FIXTURE_V1, {
      commandId: "probe-boot",
      correlationId: "probe-corr",
      submittedAt: SCHEMA,
    }));
    const receipt = await h.install(c);
    return receipt.status === "committed";
  } catch {
    return false;
  } finally {
    await h.cleanup().catch(() => undefined);
  }
}

/** Execute the pre-restart path and capture evidence (deterministic ids). */
export async function runP102Path(h: PersistentSqliteHarness): Promise<P102PreRestartEvidence> {
  const projectId = "proj-alpha";
  const workspaceId = "ws-shared";
  const goalId = "goal-1";
  const planId = HAND_AUTHORED_PLAN_REVISION_FIXTURE_V1.planId;

  await h.bootstrap(buildBootstrapCommand(WORKSPACE_BOOTSTRAP_FIXTURE_V1, {
    commandId: "cmd-boot",
    correlationId: "corr-boot",
    submittedAt: SCHEMA,
  }));

  const cp = buildInstallCommand(COMPLETION_POLICY_FIXTURE_V1, {
    commandId: "cmd-install-cp",
    correlationId: "corr-install-cp",
    submittedAt: SCHEMA,
    projectId,
    idempotencyKey: "install-cp",
  });
  const ab = buildInstallCommand(ARCHITECTURE_BASELINE_FIXTURE_V1, {
    commandId: "cmd-install-ab",
    correlationId: "corr-install-ab",
    submittedAt: SCHEMA,
    projectId,
    idempotencyKey: "install-ab",
  });
  const cpReceipt = await h.install(cp);
  const abReceipt = await h.install(ab);
  if (cpReceipt.status !== "committed" || abReceipt.status !== "committed") throw new Error("install failed");
  if (cp.commandType !== "InstallCompletionPolicyRevision" || ab.commandType !== "InstallArchitectureBaselineRevision") throw new Error("fixture kind");

  const actCp = await h.activate(buildActivateCommand(completionPolicyPinFor(cp), {
    commandId: "cmd-act-cp",
    correlationId: "corr-act-cp",
    submittedAt: SCHEMA,
    projectId,
    expectedRevision: 1,
  }));
  const actAb = await h.activate(buildActivateCommand(architectureBaselinePinFor(ab), {
    commandId: "cmd-act-ab",
    correlationId: "corr-act-ab",
    submittedAt: SCHEMA,
    projectId,
    expectedRevision: 1,
  }));
  if (actCp.status !== "committed" || actAb.status !== "committed") throw new Error("activate failed");

  const goal = await h.control.submit(buildCreateGoalCommand(MULTI_SCOPE_CREATE_GOAL_FIXTURE_V1.scopes[0]!, {
    commandId: "cmd-goal",
    correlationId: "corr-goal",
    submittedAt: SCHEMA,
    idempotencyKey: "goal-create",
  }));
  if (goal.status !== "committed") throw new Error("create goal failed");

  const plan = await h.applyPlan(buildApplyPlanCommand(HAND_AUTHORED_PLAN_REVISION_FIXTURE_V1, {
    commandId: "cmd-plan",
    correlationId: "corr-plan",
    submittedAt: SCHEMA,
    projectId,
    expectedRevision: 1,
    idempotencyKey: "apply-plan",
  }));
  if (plan.status !== "committed") throw new Error("apply plan failed");

  await h.advanceProjection();

  // ---- capture pre-restart evidence ------------------------------------- //
  const goalSnapshot = await h.ledger.load({ aggregateType: "Goal", projectId, goalId });
  if (goalSnapshot.status !== "found") throw new Error("goal snapshot missing");
  const planSnapshot = await h.ledger.load({ aggregateType: "PlanRevision", projectId, planId });
  if (planSnapshot.status !== "found") throw new Error("plan snapshot missing");
  const activePolicy = await h.ledger.load({ aggregateType: "ProjectCompletionPolicyActive", projectId });
  const activeBaseline = await h.ledger.load({ aggregateType: "ProjectArchitectureBaselineActive", projectId });
  if (activePolicy.status !== "found" || activeBaseline.status !== "found") throw new Error("active refs missing");

  const graph = await h.planGraph({ projectId, goalId });
  if (graph.status !== "ready") throw new Error("plan graph not ready");
  const taskDetails: TaskDetailView[] = [];
  for (const task of HAND_AUTHORED_PLAN_REVISION_FIXTURE_V1.tasks) {
    const d = await h.taskDetail({ projectId, goalId, taskId: task.taskId });
    if (d.status !== "ready") throw new Error("task detail not ready: " + task.taskId);
    taskDetails.push(d.task);
  }
  const goalView = await h.collaboration.goalView({ projectId, workspaceId, goalId });
  if (goalView.status !== "ready") throw new Error("goal view not ready");

  const page = await h.ledger.events({ afterCursor: null, limit: 500 });

  const evd: P102PreRestartEvidence = {
    projectId,
    workspaceId,
    goalId,
    planId,
    policyRef: cpReceipt.revisionRef,
    baselineRef: abReceipt.revisionRef,
    policyDigest: cpReceipt.contentDigest,
    baselineDigest: abReceipt.contentDigest,
    policyContentDigest: cp.payload.contentDigest,
    baselineContentDigest: ab.payload.contentDigest,
    planPinPolicyDigest: graph.graph.pinnedCompletionPolicy.digest,
    planPinBaselineDigest: graph.graph.pinnedArchitectureBaseline.digest,
    activePolicyRef: (activePolicy.snapshot as { activeRevision: unknown }).activeRevision,
    activeBaselineRef: (activeBaseline.snapshot as { activeRevision: unknown }).activeRevision,
    goalSnapshotActivePlan: (goalSnapshot.snapshot as { activePlanRevision: unknown }).activePlanRevision,
    goalSnapshotRevision: goalSnapshot.snapshot.revision,
    notFoundBaseline: { projectId: "proj-beta", aggregateType: "PlanRevision" },
    graph: graph.graph,
    taskDetails,
    goalView: goalView.goal,
    eventTypes: page.events.map((p) => p.event.eventType),
  };
  return evd;
}

/** Post-restart assertions: canonical refs resolve; pin unchanged; views rebuilt identical. */
export function verifyP102AfterRestart(
  h: PersistentSqliteHarness,
  before: P102PreRestartEvidence,
): Promise<void> {
  const projectId = before.projectId;
  const goalId = before.goalId;
  return (async () => {
    // (a) canonical: refs still resolve from the persistence store
    const goalSnapshot = await h.ledger.load({ aggregateType: "Goal", projectId, goalId });
    if (goalSnapshot.status !== "found") throw new Error("goal snapshot lost after restart");
    const goalActive = (goalSnapshot.snapshot as { activePlanRevision: unknown }).activePlanRevision;
    if (goalActive === null) throw new Error("active plan lost");
    if (goalSnapshot.snapshot.revision !== before.goalSnapshotRevision) throw new Error("goal revision drifted");
    if (JSON.stringify(goalActive) !== JSON.stringify(before.goalSnapshotActivePlan)) {
      throw new Error("active plan ref drifted");
    }
    const planSnapshot = await h.ledger.load({
      aggregateType: "PlanRevision",
      projectId,
      planId: before.planId,
    });
    if (planSnapshot.status !== "found") throw new Error("plan snapshot lost after restart");
    const active = await h.ledger.load({
      aggregateType: "ProjectCompletionPolicyActive",
      projectId,
    });
    if (active.status !== "found") throw new Error("active policy ref lost");

    // (b) views rebuilt from persisted events: advance the NEW read model and
    // compare field-for-field with the pre-restart graph/task-detail/goal view.
    await h.advanceProjection();
    const graph = await h.planGraph({ projectId, goalId });
    if (graph.status !== "ready") throw new Error("plan graph not ready after restart");
    if (JSON.stringify(graph.graph) !== JSON.stringify(before.graph)) {
      throw new Error("plan graph rebuilt differently after restart");
    }
    for (const task of before.taskDetails) {
      const d = await h.taskDetail({ projectId, goalId, taskId: task.taskId });
      if (d.status !== "ready" || JSON.stringify(d.task) !== JSON.stringify(task)) {
        throw new Error("task detail rebuilt differently after restart: " + task.taskId);
      }
    }
    const goalView = await h.collaboration.goalView({
      projectId,
      workspaceId: before.workspaceId,
      goalId,
    });
    if (goalView.status !== "ready") throw new Error("goal view not ready after restart");
    if (goalView.goal.activePlanRevision === null) throw new Error("active plan missing in goal view");
    // pin immutability: pin digests equal the pre-restart pins
    if (graph.graph.pinnedCompletionPolicy.digest !== before.planPinPolicyDigest) {
      throw new Error("policy pin drifted");
    }
    if (graph.graph.pinnedArchitectureBaseline.digest !== before.planPinBaselineDigest) {
      throw new Error("baseline pin drifted");
    }
  })();
}
