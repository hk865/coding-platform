/**
 * Shared P1-04 contract-suite harness contract: scenario preparation + helper
 * builders used by BOTH adapter suites (InMemory + SQLite, same fixtures).
 */
import { expect } from "vitest";
import type { P1_03TestHarness } from "./p1-03-harness.js";
import type { TaskVerificationViewQuery, TaskVerificationViewResult } from "../../src/contracts/verification-view.js";
import type { VerificationPort } from "../../src/contracts/verification.js";
import type { ReviewContextPort, ReviewContextRequestV1, ReviewContextResultV1 } from "../../src/contracts/review-context.js";
import type { SubmitEvidenceCommand, SubmitEvidenceReceipt, EvidenceV1, EffectivityAnchorV1, EvidenceKind, EvidenceOutcome, EvidenceCoverageV1 } from "../../src/contracts/evidence.js";
import type { ReduceTaskCommand, ReduceTaskReceipt, TaskReductionSnapshot } from "../../src/contracts/reduction.js";
import type { ArtifactRef } from "../../src/contracts/artifact.js";
import type { RunRef } from "../../src/contracts/dispatch.js";
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
  COMPLETION_POLICY_FASTPATH_FIXTURE_V1,
  P104_GOAL,
  P104_PLAN_ID,
  P104_PLAN_REVISION_FIXTURE_V1,
  P104_TASK_GATE,
  P104_TASK_IMPLEMENT,
  P104_TASK_REVIEW,
  buildEffectivityAnchorV1,
  buildEvidenceV1,
  buildSubmitEvidenceCommand,
} from "../../src/contracts/fixtures/evidence-fixtures.js";
import { MULTI_SCOPE_CREATE_GOAL_FIXTURE_V1, buildCreateGoalCommand } from "../../src/contracts/fixtures/goal-fixtures.js";
import { buildApplyPlanCommand } from "../../src/contracts/fixtures/plan-fixtures.js";
import {
  FAKE_RUNTIME_SCRIPT_COMPLETED_V1,
  buildDispatchClaimCommand,
  buildDispatchStartCommand,
  buildManifestFixture,
  buildRunFactCommand,
  rebaseScriptForRun,
} from "../../src/contracts/fixtures/dispatch-fixtures.js";
import { artifactBodyDigest } from "../../src/contracts/artifact.js";
import { runRefFor, taskAttemptRefFor } from "../../src/contracts/dispatch.js";
import type {
  ArchitectureBaselinePin,
  CompletionPolicyPin,
} from "../../src/contracts/governance.js";
import type { PlanRevisionRef } from "../../src/contracts/plan.js";

export interface P1_04TestHarness extends P1_03TestHarness {
  verification: VerificationPort;
  reviewContext: ReviewContextPort;
  submitEvidence(command: SubmitEvidenceCommand): Promise<SubmitEvidenceReceipt>;
  reduceTask(command: ReduceTaskCommand): Promise<ReduceTaskReceipt>;
  taskVerification(query: TaskVerificationViewQuery): Promise<TaskVerificationViewResult>;
  assembleReview(request: ReviewContextRequestV1): Promise<ReviewContextResultV1>;
}

export type P1_04HarnessFactory = () => Promise<P1_04TestHarness>;

export type P1_04HarnessLike = {
  control: { submit: (c: import("../../src/contracts/command-event.js").CreateGoalCommand) => Promise<import("../../src/contracts/command-event.js").CommandReceipt> };
  ledger: import("../../src/contracts/ledger.js").StateLedger;
  runtime: import("../../src/contracts/ports.js").RunPort;
  bootstrap: (c: import("../../src/contracts/bootstrap.js").WorkspaceBootstrapCommand) => Promise<import("../../src/contracts/bootstrap.js").WorkspaceBootstrapReceipt>;
  install: (c: import("../../src/contracts/governance.js").GovernanceInstallCommand) => Promise<import("../../src/contracts/governance.js").GovernanceInstallReceipt>;
  activate: (c: import("../../src/contracts/governance.js").GovernanceActivateCommand) => Promise<import("../../src/contracts/governance.js").GovernanceActivateReceipt>;
  applyPlan: (c: import("../../src/contracts/plan.js").ApplyPlanRevisionCommand) => Promise<import("../../src/contracts/plan.js").PlanRevisionReceipt>;
  planGraph: (q: import("../../src/contracts/plan-view.js").PlanGraphViewQuery) => Promise<import("../../src/contracts/plan-view.js").PlanGraphViewResult>;
  taskDetail: (q: import("../../src/contracts/plan-view.js").TaskDetailViewQuery) => Promise<import("../../src/contracts/plan-view.js").TaskDetailViewResult>;
  dispatchReadiness: (q: import("../../src/contracts/dispatch.js").DispatchReadinessQuery) => Promise<import("../../src/contracts/dispatch.js").DispatchReadinessResult>;
  claimTask: (c: import("../../src/contracts/dispatch.js").DispatchClaimCommand) => Promise<import("../../src/contracts/dispatch.js").DispatchClaimReceipt>;
  startRun: (c: import("../../src/contracts/dispatch.js").DispatchStartCommand) => Promise<import("../../src/contracts/dispatch.js").DispatchStartReceipt>;
  runFact: (c: import("../../src/contracts/dispatch.js").RunFactCommand) => Promise<import("../../src/contracts/dispatch.js").RunFactReceipt>;
  drive: (t: import("../../src/contracts/ports.js").DispatchDriveTrigger) => Promise<import("../../src/contracts/ports.js").DispatchDriveResult>;
  advanceProjection: () => Promise<import("../../src/contracts/goal-view.js").ProjectionReceipt>;
  observedCursor: () => import("../../src/contracts/command-event.js").CommitCursor | null;
  verification: VerificationPort;
  reviewContext: ReviewContextPort;
  submitEvidence: (command: SubmitEvidenceCommand) => Promise<SubmitEvidenceReceipt>;
  reduceTask: (command: ReduceTaskCommand) => Promise<ReduceTaskReceipt>;
  taskVerification: (query: TaskVerificationViewQuery) => Promise<TaskVerificationViewResult>;
  assembleReview: (request: ReviewContextRequestV1) => Promise<ReviewContextResultV1>;
};

export function toP1_04Harness(h: P1_04HarnessLike): P1_04TestHarness {
  return { ...h, submit: (c: import("../../src/contracts/command-event.js").CreateGoalCommand) => h.control.submit(c) } as unknown as P1_04TestHarness;
}

export { P104_GOAL };
export const SCHEMA = "2026-09-05T12:00:00.000Z";
export const P104_PROJECT = "proj-alpha";
export const P104_BETA_PROJECT = "proj-beta";
export const P104_PLAN_REF: PlanRevisionRef = {
  aggregateType: "PlanRevision",
  projectId: P104_PROJECT,
  planId: P104_PLAN_ID,
};

export type P104Preview = {
  projectId: string;
  goalId: string;
  planRef: PlanRevisionRef;
  completionPolicyPin: CompletionPolicyPin;
  architectureBaselinePin: ArchitectureBaselinePin;
  fastPath: boolean;
};

export function freshP104Id(prefix: string): string {
  return prefix + "-" + Math.random().toString(36).slice(2, 10);
}

/** Shared governance+goal+plan preparation (alpha + optional beta w/ fastpath policy). */
export async function prepareP104Scenario(
  h: P1_04TestHarness,
  opts: { withFastPathBeta?: boolean } = {},
): Promise<{ alpha: P104Preview; beta: P104Preview | null }> {
  const boot = await h.bootstrap(
    buildBootstrapCommand(WORKSPACE_BOOTSTRAP_FIXTURE_V1, {
      commandId: "cmd-p104-boot",
      correlationId: "corr-p104-boot",
      submittedAt: SCHEMA,
    }),
  );
  expect(boot.status).toBe("committed");
  const alpha = await prepareP104Project(h, P104_PROJECT, "a", COMPLETION_POLICY_FIXTURE_V1);
  let beta: P104Preview | null = null;
  if (opts.withFastPathBeta) {
    beta = await prepareP104Project(h, P104_BETA_PROJECT, "b", COMPLETION_POLICY_FASTPATH_FIXTURE_V1);
  }
  return { alpha, beta };
}

async function prepareP104Project(
  h: P1_04TestHarness,
  projectId: string,
  suffix: string,
  policyFixture: typeof COMPLETION_POLICY_FIXTURE_V1,
): Promise<P104Preview> {
  const cpCmd = buildInstallCommand(policyFixture, {
    commandId: "cmd-p104-install-cp-" + suffix,
    correlationId: "corr-p104-install-cp-" + suffix,
    submittedAt: SCHEMA,
    projectId,
    idempotencyKey: "p104-install-cp-" + suffix,
  });
  expect(cpCmd.commandType).toBe("InstallCompletionPolicyRevision");
  const installedCp = await h.install(cpCmd);
  expect(installedCp.status).toBe("committed");
  const abCmd = buildInstallCommand(ARCHITECTURE_BASELINE_FIXTURE_V1, {
    commandId: "cmd-p104-install-ab-" + suffix,
    correlationId: "corr-p104-install-ab-" + suffix,
    submittedAt: SCHEMA,
    projectId,
    idempotencyKey: "p104-install-ab-" + suffix,
  });
  const installedAb = await h.install(abCmd);
  expect(installedAb.status).toBe("committed");
  await h.activate(
    buildActivateCommand(completionPolicyPinFor(cpCmd as never), {
      commandId: "cmd-p104-activate-cp-" + suffix,
      correlationId: "corr-p104-activate-cp-" + suffix,
      submittedAt: SCHEMA,
      projectId,
      expectedRevision: 1,
      idempotencyKey: "p104-activate-cp-" + suffix,
    }),
  );
  await h.activate(
    buildActivateCommand(architectureBaselinePinFor(abCmd as never), {
      commandId: "cmd-p104-activate-ab-" + suffix,
      correlationId: "corr-p104-activate-ab-" + suffix,
      submittedAt: SCHEMA,
      projectId,
      expectedRevision: 1,
      idempotencyKey: "p104-activate-ab-" + suffix,
    }),
  );
  const scope = MULTI_SCOPE_CREATE_GOAL_FIXTURE_V1.scopes.find((s) => s.projectId === projectId)!;
  const goal = await h.submit(
    buildCreateGoalCommand(scope, {
      commandId: "cmd-p104-goal-" + suffix,
      correlationId: "corr-p104-goal-" + suffix,
      submittedAt: SCHEMA,
    }),
  );
  expect(goal.status).toBe("committed");
  const plan = await h.applyPlan(
    buildApplyPlanCommand(P104_PLAN_REVISION_FIXTURE_V1, {
      commandId: "cmd-p104-plan-" + suffix,
      correlationId: "corr-p104-plan-" + suffix,
      submittedAt: SCHEMA,
      projectId,
      expectedRevision: 1,
    }),
  );
  expect(plan.status).toBe("committed");
  // Resolve the accepted pins from the plan view.
  const cursor = h.observedCursor();
  const graph = await h.planGraph(cursor === null ? { projectId, goalId: P104_GOAL } : { projectId, goalId: P104_GOAL, atLeastCursor: cursor });
  expect(graph.status).toBe("ready");
  if (graph.status !== "ready") throw new Error("plan graph not ready");
  return {
    projectId,
    goalId: P104_GOAL,
    planRef: { aggregateType: "PlanRevision", projectId, planId: P104_PLAN_ID },
    completionPolicyPin: graph.graph.pinnedCompletionPolicy,
    architectureBaselinePin: graph.graph.pinnedArchitectureBaseline,
    fastPath: policyFixture.identity.policyId === COMPLETION_POLICY_FASTPATH_FIXTURE_V1.identity.policyId,
  };
}

export function p104PlanRefFor(projectId: string): PlanRevisionRef {
  return { aggregateType: "PlanRevision", projectId, planId: P104_PLAN_ID };
}

export function anchorFor(sc: P104Preview, workspaceRevision: number = 1): EffectivityAnchorV1 {
  return buildEffectivityAnchorV1({
    planRef: p104PlanRefFor(sc.projectId),
    planRevision: 1,
    workspaceRevision,
    pinnedCompletionPolicy: sc.completionPolicyPin,
    pinnedArchitectureBaseline: sc.architectureBaselinePin,
  });
}

export const P104_VPLAN = { planId: "vp-evidence-mvp-1", planDigest: "e".repeat(64) };

export function evidenceBuildDeps(sc: P104Preview, deps: {
  evidenceId: string;
  kind: EvidenceKind;
  outcome: EvidenceOutcome;
  taskId: string;
  coverage: EvidenceCoverageV1[];
  runRef?: RunRef | null;
  checkId?: string | null;
  actor?: { kind: "human" | "system"; id: string };
  workspaceRevision?: number;
}) {
  return {
    evidenceId: deps.evidenceId,
    kind: deps.kind,
    outcome: deps.outcome,
    projectId: sc.projectId,
    goalId: sc.goalId,
    taskId: deps.taskId,
    coverage: deps.coverage,
    anchor: anchorFor(sc, deps.workspaceRevision ?? 1),
    verificationPlanRef: { ...P104_VPLAN },
    ...(deps.runRef !== undefined ? { runRef: deps.runRef } : {}),
    ...(deps.checkId !== undefined ? { checkId: deps.checkId } : {}),
    ...(deps.actor !== undefined ? { actor: deps.actor } : {}),
  };
}

export function evidenceFor(sc: P104Preview, deps: Parameters<typeof evidenceBuildDeps>[1]): EvidenceV1 {
  return buildEvidenceV1(evidenceBuildDeps(sc, deps));
}

export function evidenceCommandFor(sc: P104Preview, deps: {
  commandId: string;
  evidence: EvidenceV1;
  idempotencyKey?: string;
  correlationId?: string;
}) {
  return buildSubmitEvidenceCommand({
    commandId: deps.commandId,
    correlationId: deps.correlationId ?? "corr-p104-evidence",
    submittedAt: SCHEMA,
    evidence: deps.evidence,
    ...(deps.idempotencyKey !== undefined ? { idempotencyKey: deps.idempotencyKey } : {}),
  });
}

/** Claim -> start -> FakeRuntime(completed, exit=0) — the standard run path. */
export async function runP104ClaimedRun(
  h: P1_04TestHarness,
  deps: { projectId: string; taskId: string; runId: string; attemptId: string },
): Promise<{ runRef: RunRef; claim: { outboxRef: import("../../src/contracts/dispatch.js").DispatchOutboxRef } }> {
  const projectId = deps.projectId;
  const planRef = p104PlanRefFor(projectId);
  const claim = await h.claimTask(
    buildDispatchClaimCommand({
      commandId: "cmd-p104-claim-" + deps.runId,
      correlationId: "corr-p104-claim-" + deps.runId,
      submittedAt: SCHEMA,
      projectId,
      goalId: P104_GOAL,
      taskId: deps.taskId,
      attemptId: deps.attemptId,
      runId: deps.runId,
      idempotencyKey: "p104-claim-" + deps.runId,
    }),
  );
  expect(claim.status).toBe("committed");
  if (claim.status !== "committed") throw new Error("p104 claim failed");
  const bundleRef: ArtifactRef = {
    kind: "artifact",
    contentType: "text/plain",
    digest: artifactBodyDigest("p104-bundle-" + deps.runId),
    sizeBytes: artifactBodyDigest("p104-bundle-" + deps.runId).length,
    source: { kind: "plan-revision", refId: planRef.planId, revision: "1" },
  };
  const envelope = {
    schemaVersion: 1 as const,
    envelopeId: "envelope-" + deps.runId,
    projectId,
    workspaceId: "ws-shared",
    goalId: P104_GOAL,
    taskId: deps.taskId,
    runRef: runRefFor(projectId, P104_GOAL, deps.runId),
    attemptRef: taskAttemptRefFor(projectId, P104_GOAL, deps.taskId, deps.attemptId),
    planRef,
    roleBinding: {
      schemaVersion: 1 as const,
      bindingId: "binding-run-short-lived-v1",
      templateId: "template-short-lived-runner",
      templateRevision: "2026-09-05",
      bindingVersion: 1,
      policyRevision: "auth-policy-runtime-v1",
    },
    workspaceSnapshot: { workspaceId: "ws-shared", revision: 1 },
    permissions: { policyRevision: "auth-policy-runtime-v1", tools: ["read", "write"], writeScope: ["src/contracts"] },
    budget: { tokenBudget: 100_000, deadline: "2026-09-06T00:00:00.000Z" },
    sourceRefs: [{ kind: "plan-revision" as const, refId: planRef.planId, revision: "1" }],
    bundleRef,
  };
  const start = await h.startRun(
    buildDispatchStartCommand({
      commandId: "cmd-p104-start-" + deps.runId,
      correlationId: "corr-p104-start-" + deps.runId,
      submittedAt: SCHEMA,
      projectId,
      runId: deps.runId,
      expectedRevision: 1,
      envelope,
      manifest: buildManifestFixture({ workspaceId: "ws-shared", workspaceRevision: 1, planRef }),
    }),
  );
  expect(start.status).toBe("committed");
  if (start.status !== "committed") throw new Error("p104 start failed");
  const events = rebaseScriptForRun(FAKE_RUNTIME_SCRIPT_COMPLETED_V1, runRefFor(projectId, P104_GOAL, deps.runId));
  for (const [i, event] of events.entries()) {
    const fact = await h.runFact(
      buildRunFactCommand({
        commandId: "cmd-p104-fact-" + deps.runId + "-" + i,
        correlationId: "corr-p104-fact-" + deps.runId + "-" + i,
        submittedAt: SCHEMA,
        projectId,
        runId: deps.runId,
        expectedRevision: 2 + i,
        fact: { kind: "runtime_event", event },
      }),
    );
    expect(fact.status).toBe("committed");
  }
  return { runRef: runRefFor(projectId, P104_GOAL, deps.runId), claim: claim as never };
}

export const P104_TASKS = {
  implement: P104_TASK_IMPLEMENT,
  review: P104_TASK_REVIEW,
  gate: P104_TASK_GATE,
};

export function reduceCommand(sc: P104Preview, deps: {
  commandId: string;
  taskId: string;
  expectedRevision: number;
  idempotencyKey?: string;
}) {
  return {
    commandId: deps.commandId,
    commandType: "ReduceTask" as const,
    schemaVersion: 1 as const,
    identity: {
      projectId: sc.projectId,
      actor: { kind: "system" as const, id: "control-engine" },
      idempotencyKey: deps.idempotencyKey ?? "p104-reduce-" + deps.taskId,
    },
    aggregateId: deps.taskId,
    expectedRevision: deps.expectedRevision,
    correlationId: "corr-p104-reduce-" + deps.taskId,
    submittedAt: SCHEMA,
    payload: { goalId: sc.goalId },
  };
}

export function requireReduction(snapshot: { phase: string }): TaskReductionSnapshot {
  return snapshot as TaskReductionSnapshot;
}
