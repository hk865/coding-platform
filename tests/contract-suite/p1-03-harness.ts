/**
 * Shared P1-03 contract-suite harness contract: the suites drive the FULL real
 * path (ControlEngine + StateLedger + ReadModelIndex + dispatch/run modules)
 * so they pass against the InMemory implementation AND the SQLite
 * implementation with the SAME fixtures/assertions (no per-adapter tuning).
 */
import type { WorkspaceBootstrapCommand, WorkspaceBootstrapReceipt } from "../../src/contracts/bootstrap.js";
import type { CommitCursor } from "../../src/contracts/command-event.js";
import type { ProjectionReceipt, ReadModelIndex } from "../../src/contracts/goal-view.js";
import type { StateLedger } from "../../src/contracts/ledger.js";
import type {
  GovernanceActivateCommand,
  GovernanceActivateReceipt,
  GovernanceInstallCommand,
  GovernanceInstallReceipt,
} from "../../src/contracts/governance.js";
import type { ApplyPlanRevisionCommand, PlanRevisionReceipt } from "../../src/contracts/plan.js";
import type {
  PlanGraphViewQuery,
  PlanGraphViewResult,
  TaskDetailViewQuery,
  TaskDetailViewResult,
} from "../../src/contracts/plan-view.js";
import type { CreateGoalCommand, CommandReceipt } from "../../src/contracts/command-event.js";
import type {
  DispatchClaimCommand,
  DispatchClaimReceipt,
  DispatchReadinessQuery,
  DispatchReadinessResult,
  DispatchStartCommand,
  DispatchStartReceipt,
  RunFactCommand,
  RunFactReceipt,
} from "../../src/contracts/dispatch.js";
import type { ActiveAgentQuery, ActiveAgentViewResult } from "../../src/contracts/active-agent.js";
import type { DispatchDriveResult, DispatchDriveTrigger, RunPort } from "../../src/contracts/ports.js";
import { expect } from "vitest";
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
import {
  MULTI_SCOPE_CREATE_GOAL_FIXTURE_V1,
  buildCreateGoalCommand,
} from "../../src/contracts/fixtures/goal-fixtures.js";
import { buildApplyPlanCommand } from "../../src/contracts/fixtures/plan-fixtures.js";
import {
  DISPATCH_ELIGIBLE_TASK_ID,
  DISPATCH_PLAN_REVISION_FIXTURE_V1,
  buildDispatchClaimCommand,
  buildEnvelopeFixture,
} from "../../src/contracts/fixtures/dispatch-fixtures.js";
import type { ArtifactRef } from "../../src/contracts/artifact.js";
import type { TaskEnvelopeV1 } from "../../src/contracts/task-envelope.js";


export interface P1_03TestHarness {
  readonly ledger: StateLedger;
  readonly readModel: ReadModelIndex;
  readonly runtime: RunPort;
  bootstrap(command: WorkspaceBootstrapCommand): Promise<WorkspaceBootstrapReceipt>;
  submit(command: CreateGoalCommand): Promise<CommandReceipt>;
  install(command: GovernanceInstallCommand): Promise<GovernanceInstallReceipt>;
  activate(command: GovernanceActivateCommand): Promise<GovernanceActivateReceipt>;
  applyPlan(command: ApplyPlanRevisionCommand): Promise<PlanRevisionReceipt>;
  dispatchReadiness(query: DispatchReadinessQuery): Promise<DispatchReadinessResult>;
  claimTask(command: DispatchClaimCommand): Promise<DispatchClaimReceipt>;
  startRun(command: DispatchStartCommand): Promise<DispatchStartReceipt>;
  runFact(command: RunFactCommand): Promise<RunFactReceipt>;
  drive(trigger: DispatchDriveTrigger): Promise<DispatchDriveResult>;
  advanceProjection(): Promise<ProjectionReceipt>;
  observedCursor(): CommitCursor | null;
  planGraph(query: PlanGraphViewQuery): Promise<PlanGraphViewResult>;
  taskDetail(query: TaskDetailViewQuery): Promise<TaskDetailViewResult>;
  activeAgent(query: ActiveAgentQuery): Promise<ActiveAgentViewResult>;
  close?(): Promise<void>;
}

export type P1_03HarnessFactory = () => Promise<P1_03TestHarness>;

export function freshCommandId(prefix: string): string {
  return prefix + "-" + Math.random().toString(36).slice(2, 10);
}

export function freshCorrelationId(): string {
  return "corr-" + Math.random().toString(36).slice(2, 10);
}

// ------------------------------------------------------------------------ //
// P1-03 shared scenario setup + envelope helpers                            //
// ------------------------------------------------------------------------ //

const SCHEMA = "2026-09-05T12:00:00.000Z";

/**
 * Deterministic pre-scenario: bootstrap(alpha+beta) -> install+activate
 * CompletionPolicy & ArchitectureBaseline -> CreateGoal(alpha) ->
 * applyPlan(DISPATCH_PLAN_REVISION_FIXTURE_V1) — the same governance shape as
 * P1-02's runP102Path so the dispatch fixtures reuse the accepted chain.
 */
export async function prepareDispatchScenario(h: P1_03TestHarness): Promise<void> {
  const boot = await h.bootstrap(
    buildBootstrapCommand(WORKSPACE_BOOTSTRAP_FIXTURE_V1, {
      commandId: "cmd-p103-boot",
      correlationId: "corr-p103-boot",
      submittedAt: SCHEMA,
    }),
  );
  expect(boot.status).toBe("committed");
  for (const kind of ["cp", "ab"] as const) {
    const fixture = kind === "cp" ? COMPLETION_POLICY_FIXTURE_V1 : ARCHITECTURE_BASELINE_FIXTURE_V1;
    const installCmd = buildInstallCommand(fixture, {
      commandId: "cmd-p103-install-" + kind,
      correlationId: "corr-p103-install-" + kind,
      submittedAt: SCHEMA,
      projectId: "proj-alpha",
      idempotencyKey: "p103-install-" + kind,
    });
    const installed = await h.install(installCmd);
    expect(installed.status).toBe("committed");
    if (kind === "cp") {
      const activated = await h.activate(
        buildActivateCommand(completionPolicyPinFor(installCmd as never), {
          commandId: "cmd-p103-activate-" + kind,
          correlationId: "corr-p103-activate-" + kind,
          submittedAt: SCHEMA,
          projectId: "proj-alpha",
          expectedRevision: 1,
        }),
      );
      expect(activated.status).toBe("committed");
    } else {
      const activated = await h.activate(
        buildActivateCommand(architectureBaselinePinFor(installCmd as never), {
          commandId: "cmd-p103-activate-" + kind,
          correlationId: "corr-p103-activate-" + kind,
          submittedAt: SCHEMA,
          projectId: "proj-alpha",
          expectedRevision: 1,
        }),
      );
      expect(activated.status).toBe("committed");
    }
  }
  const goal = await h.submit(
    buildCreateGoalCommand(MULTI_SCOPE_CREATE_GOAL_FIXTURE_V1.scopes[0]!, {
      commandId: "cmd-p103-goal",
      correlationId: "corr-p103-goal",
      submittedAt: SCHEMA,
    }),
  );
  expect(goal.status).toBe("committed");
  if (goal.status !== "committed") return;
  const plan = await h.applyPlan(
    buildApplyPlanCommand(DISPATCH_PLAN_REVISION_FIXTURE_V1, {
      commandId: "cmd-p103-plan",
      correlationId: "corr-p103-plan",
      submittedAt: SCHEMA,
      projectId: "proj-alpha",
      expectedRevision: 1,
    }),
  );
  expect(plan.status).toBe("committed");
}

/** Standard claim command against the prepared scenario. */
export function buildPreparedClaim(deps: {
  commandId: string;
  correlationId?: string;
  taskId?: string;
  attemptId?: string;
  runId?: string;
  idempotencyKey?: string;
  goalId?: string;
}): import("../../src/contracts/dispatch.js").DispatchClaimCommand {
  return buildDispatchClaimCommand({
    commandId: deps.commandId,
    correlationId: deps.correlationId ?? freshCorrelationId(),
    submittedAt: SCHEMA,
    projectId: "proj-alpha",
    ...(deps.goalId !== undefined ? { goalId: deps.goalId } : {}),
    ...(deps.taskId !== undefined ? { taskId: deps.taskId } : {}),
    ...(deps.attemptId !== undefined ? { attemptId: deps.attemptId } : {}),
    ...(deps.runId !== undefined ? { runId: deps.runId } : {}),
    idempotencyKey: deps.idempotencyKey ?? freshCommandId("claim"),
  });
}

/** Standard envelope fixture for a prepared claim (plan ref = Dispatch plan). */
export function buildPreparedEnvelope(deps: {
  runId: string;
  attemptId: string;
  bundleRef: import("../../src/contracts/artifact.js").ArtifactRef;
  envelopeId?: string;
}): import("../../src/contracts/task-envelope.js").TaskEnvelopeV1 {
  return buildEnvelopeFixture({
    envelopeId: deps.envelopeId ?? "envelope-" + deps.runId,
    projectId: "proj-alpha",
    workspaceId: "ws-shared",
    goalId: "goal-1",
    taskId: DISPATCH_ELIGIBLE_TASK_ID,
    runId: deps.runId,
    attemptId: deps.attemptId,
    planRef: { aggregateType: "PlanRevision", projectId: "proj-alpha", planId: "plan-dispatch-mvp" },
    workspaceRevision: 1,
    bundleRef: deps.bundleRef,
  });
}

export { SCHEMA };
