/**
 * Shared P1-07 contract-suite harness contract: scenario preparation + run /
 * evidence / lease / join / patch helpers used by BOTH adapter suites
 * (InMemory + SQLite, same fixtures) and by the restart path.
 *
 * The helper surface below is FROZEN by the shared baseline: lane A fills the
 * lease engine, lane B fills driveParallel + recordIntegrationResult, lane C
 * fills recordPatch + the three views; the helpers only call the frozen
 * signatures and stay unchanged.
 */
import { expect } from "vitest";
import type { P1_06HarnessLike, P1_06TestHarness, P1_06HarnessFactory } from "./p1-06-harness.js";
import type { WorkspaceCapabilityPort } from "../../src/contracts/workspace-capability.js";
import type {
  AcquireReadLeaseReceipt,
  AcquireWorkspaceReadLeaseCommand,
  AcquireWorkspaceWriteLeaseCommand,
  AcquireWriteLeaseReceipt,
  ReleaseLeaseReceipt,
  ReleaseWorkspaceLeaseCommand,
  WorkspaceLeasePort,
} from "../../src/contracts/workspace-lease.js";
import type { WorkspaceDrivePort } from "../../src/contracts/workspace-drive.js";
import type { WorkspaceLeaseViewQuery, WorkspaceLeaseViewResult, IntegrationConflictViewQuery, IntegrationConflictViewResult, WorkspacePatchViewQuery, WorkspacePatchViewResult } from "../../src/contracts/workspace-views.js";
import type { RecordIntegrationResultCommand, RecordIntegrationResultReceipt, IntegrationInputRefV1, IntegrationTaskResultV1 } from "../../src/contracts/integration.js";
import type { RecordPatchCommand, RecordPatchReceipt, PatchArtifactV1 } from "../../src/contracts/patch.js";
import type { PlanRevisionDraft, PlanRevisionRef, PlanRevisionSnapshot } from "../../src/contracts/plan.js";
import { sha256Hex } from "../../src/contracts/fingerprint.js";
import type { GoalSnapshot, WorkspaceSnapshot } from "../../src/contracts/ledger.js";
import type { RunRef, TaskAttemptRef, TaskBudgetV1, RoleBindingRefV1, RuntimeEventV1 } from "../../src/contracts/dispatch.js";
import type { EvidenceOutcome, EvidenceRef, EffectivityAnchorV1 } from "../../src/contracts/evidence.js";
import { buildSubmitEvidenceCommand, buildEvidenceV1, buildEffectivityAnchorV1, coverage, taskTriple } from "../../src/contracts/fixtures/evidence-fixtures.js";
import { buildDispatchClaimCommand, buildRunFactCommand, rebaseScriptForRun, FAKE_RUNTIME_SCRIPT_COMPLETED_V1, type FakeRuntimeScriptV1 } from "../../src/contracts/fixtures/dispatch-fixtures.js";
import { buildReduceGoalCommand } from "../../src/contracts/fixtures/goal-phase-fixtures.js";
import {
  P107_GOAL,
  P107_PLAN_ID,
  P107_PLAN_REVISION_FIXTURE_V1,
  P107_PLAN_REVISION_CONFLICT_FIXTURE_V1,
  P107_PROJECT,
  P107_SCHEMA,
  P107_TASK_GATE,
  P107_TASK_INTEGRATION,
  P107_TASK_READER_A,
  P107_TASK_READER_B,
  P107_TASK_WRITER,
  P107_TASK_WRITER_B,
  P107_WORKSPACE,
  P107_VR_READERS,
  P107_OBL_READERS,
  P107_VR_JOIN,
  P107_OBL_JOIN,
  P107_VR_PATCH,
  P107_OBL_PATCH,
  P107_VR_GATE,
  P107_OBL_GATE,
  P107_ROLE_BINDING_READER_V1,
  P107_ROLE_BINDING_WRITER_V1,
  P107_BUDGET_READER_V1,
  P107_BUDGET_WRITER_V1,
  P107_DECLARED_READ_PERMISSIONS_V1,
  P107_DECLARED_WRITE_PERMISSIONS_V1,
  P107_SCOPE_READER_A,
  P107_SCOPE_READER_B,
  P107_SCOPE_WRITER,
  P107_WRITE_SCOPE,
  P107_ROLE_BINDING_COORDINATOR_V1,
  p107PlanRef,
  p107ScopeForTask,
  buildP107AcquireReadLeaseCommand,
  buildP107AcquireWriteLeaseCommand,
  buildP107ReleaseLeaseCommand,
  buildP107RecordIntegrationCommand,
  buildP107RecordPatchCommand,
  buildP107ArtifactRef,
  p107ReaderScript,
  p107WriterScript,
} from "../../src/contracts/fixtures/workspace-fixtures.js";
import type { RunPort, RunCapabilities, RunHandle } from "../../src/contracts/ports.js";
import type { TaskEnvelopeV1 } from "../../src/contracts/task-envelope.js";
import { MULTI_SCOPE_CREATE_GOAL_FIXTURE_V1, buildCreateGoalCommand } from "../../src/contracts/fixtures/goal-fixtures.js";
import { buildApplyPlanCommand } from "../../src/contracts/fixtures/plan-fixtures.js";
import {
  ARCHITECTURE_BASELINE_FIXTURE_V1,
  COMPLETION_POLICY_FIXTURE_V1,
  architectureBaselinePinFor,
  buildActivateCommand,
  buildInstallCommand,
  completionPolicyPinFor,
} from "../../src/contracts/fixtures/governance-fixtures.js";
import { buildBootstrapCommand } from "../../src/contracts/bootstrap.js";
import { WORKSPACE_BOOTSTRAP_FIXTURE_V1 } from "../../src/contracts/fixtures/bootstrap-fixture-v1.js";
import { evidenceRefFor, evidenceApplicability } from "../../src/contracts/evidence.js";
import { workspaceReadLeaseRefFor, workspaceWriteLeaseRefFor } from "../../src/contracts/workspace-lease.js";

export type { P1_06HarnessFactory };
import type { ReduceGoalCommand, ReduceGoalReceipt } from "../../src/contracts/goal-phase.js";
import type { GoalStatusQuery, GoalStatusViewResult, GoalTimelineQuery, GoalTimelineViewResult } from "../../src/contracts/goal-phase-view.js";
import type { TaskVerificationViewQuery, TaskVerificationViewResult } from "../../src/contracts/verification-view.js";
import type { ControlEngine } from "../../src/contracts/modules.js";

export interface P1_07TestHarness extends P1_06TestHarness {
  control: ControlEngine;
  reduceGoal(command: ReduceGoalCommand): Promise<ReduceGoalReceipt>;
  goalStatus(query: GoalStatusQuery): Promise<GoalStatusViewResult>;
  goalTimeline(query: GoalTimelineQuery): Promise<GoalTimelineViewResult>;
  taskVerification(query: TaskVerificationViewQuery): Promise<TaskVerificationViewResult>;
  workspaceCapability: WorkspaceCapabilityPort;
  workspaceLease: WorkspaceLeasePort;
  workspaceDrive: WorkspaceDrivePort;
  acquireWorkspaceReadLease(command: AcquireWorkspaceReadLeaseCommand): Promise<AcquireReadLeaseReceipt>;
  acquireWorkspaceWriteLease(command: AcquireWorkspaceWriteLeaseCommand): Promise<AcquireWriteLeaseReceipt>;
  releaseWorkspaceLease(command: ReleaseWorkspaceLeaseCommand): Promise<ReleaseLeaseReceipt>;
  recordIntegrationResult(command: RecordIntegrationResultCommand): Promise<RecordIntegrationResultReceipt>;
  recordPatch(command: RecordPatchCommand): Promise<RecordPatchReceipt>;
  workspaceLeaseView(query: WorkspaceLeaseViewQuery): Promise<WorkspaceLeaseViewResult>;
  integrationConflicts(query: IntegrationConflictViewQuery): Promise<IntegrationConflictViewResult>;
  workspacePatches(query: WorkspacePatchViewQuery): Promise<WorkspacePatchViewResult>;
}

export type P1_07HarnessFactory = () => Promise<P1_07TestHarness>;

export type P1_07HarnessLike = P1_06HarnessLike & {
  reduceGoal(command: ReduceGoalCommand): Promise<ReduceGoalReceipt>;
  goalStatus(query: GoalStatusQuery): Promise<GoalStatusViewResult>;
  goalTimeline(query: GoalTimelineQuery): Promise<GoalTimelineViewResult>;
  taskVerification(query: TaskVerificationViewQuery): Promise<TaskVerificationViewResult>;
  workspaceCapability: WorkspaceCapabilityPort;
  workspaceLease: WorkspaceLeasePort;
  workspaceDrive: WorkspaceDrivePort;
  acquireWorkspaceReadLease: (command: AcquireWorkspaceReadLeaseCommand) => Promise<AcquireReadLeaseReceipt>;
  acquireWorkspaceWriteLease: (command: AcquireWorkspaceWriteLeaseCommand) => Promise<AcquireWriteLeaseReceipt>;
  releaseWorkspaceLease: (command: ReleaseWorkspaceLeaseCommand) => Promise<ReleaseLeaseReceipt>;
  recordIntegrationResult: (command: RecordIntegrationResultCommand) => Promise<RecordIntegrationResultReceipt>;
  recordPatch: (command: RecordPatchCommand) => Promise<RecordPatchReceipt>;
  workspaceLeaseView: (query: WorkspaceLeaseViewQuery) => Promise<WorkspaceLeaseViewResult>;
  integrationConflicts: (query: IntegrationConflictViewQuery) => Promise<IntegrationConflictViewResult>;
  workspacePatches: (query: WorkspacePatchViewQuery) => Promise<WorkspacePatchViewResult>;
};

export function toP1_07Harness(h: P1_07HarnessLike): P1_07TestHarness {
  return h as unknown as P1_07TestHarness;
}

export {
  P107_GOAL,
  P107_PROJECT,
  P107_WORKSPACE,
  P107_SCHEMA,
  P107_TASK_READER_A,
  P107_TASK_READER_B,
  P107_TASK_INTEGRATION,
  P107_TASK_WRITER,
  P107_TASK_WRITER_B,
  P107_TASK_GATE,
  P107_VR_READERS,
  P107_OBL_READERS,
  P107_VR_JOIN,
  P107_OBL_JOIN,
  P107_VR_PATCH,
  P107_OBL_PATCH,
  P107_VR_GATE,
  P107_OBL_GATE,
  P107_ROLE_BINDING_READER_V1,
  P107_ROLE_BINDING_WRITER_V1,
  P107_BUDGET_READER_V1,
  P107_BUDGET_WRITER_V1,
  P107_DECLARED_READ_PERMISSIONS_V1,
  P107_DECLARED_WRITE_PERMISSIONS_V1,
  P107_SCOPE_READER_A,
  P107_SCOPE_READER_B,
  P107_SCOPE_WRITER,
  P107_WRITE_SCOPE,
  P107_ROLE_BINDING_COORDINATOR_V1,
  P107_PLAN_REVISION_CONFLICT_FIXTURE_V1,
  p107PlanRef,
  p107ScopeForTask,
  p107ReaderScript,
  p107WriterScript,
  buildP107ArtifactRef,
};

export function p107GoalScope() {
  const scope = MULTI_SCOPE_CREATE_GOAL_FIXTURE_V1.scopes[0]!;
  return {
    ...scope,
    projectId: P107_PROJECT,
    workspaceId: P107_WORKSPACE,
    goalId: P107_GOAL,
    objective: "为 " + P107_PROJECT + " 完成双 Reader 并行 + 唯一 Writer + Evidence join",
  };
}

export type P107ScenarioPreview = {
  projectId: string;
  goalId: string;
  workspaceId: string;
  planRef: PlanRevisionRef;
  planSnapshot: PlanRevisionSnapshot | undefined;
  goal: GoalSnapshot | undefined;
  workspace: WorkspaceSnapshot | undefined;
  workspaceRevision: number;
  pinnedCompletionPolicy: ReturnType<typeof completionPolicyPinFor>;
  pinnedArchitectureBaseline: ReturnType<typeof architectureBaselinePinFor>;
};

/** Shared governance+goal+plan preparation for the P1-07 scenario
 * (planDraft defaults to the two-independent-reader-tasks slice; the conflict
 * variant is used by the evidence-conflict test). */
export async function prepareP107Scenario(
  h: P1_07HarnessLike,
  planDraft: PlanRevisionDraft = P107_PLAN_REVISION_FIXTURE_V1,
): Promise<P107ScenarioPreview> {
  const boot = await h.bootstrap(
    buildBootstrapCommand(WORKSPACE_BOOTSTRAP_FIXTURE_V1, {
      commandId: "cmd-p107-boot",
      correlationId: "corr-p107-boot",
      submittedAt: P107_SCHEMA,
    }),
  );
  expect(boot.status).toBe("committed");

  const installPolicy = buildInstallCommand(COMPLETION_POLICY_FIXTURE_V1, {
    commandId: "cmd-p107-install-policy",
    correlationId: "corr-p107-install-policy",
    submittedAt: P107_SCHEMA,
    projectId: P107_PROJECT,
    idempotencyKey: "p107-install-policy",
  });
  const installBaseline = buildInstallCommand(ARCHITECTURE_BASELINE_FIXTURE_V1, {
    commandId: "cmd-p107-install-baseline",
    correlationId: "corr-p107-install-baseline",
    submittedAt: P107_SCHEMA,
    projectId: P107_PROJECT,
    idempotencyKey: "p107-install-baseline",
  });
  expect((await h.install(installPolicy)).status).toBe("committed");
  expect((await h.install(installBaseline)).status).toBe("committed");

  const actPolicy = buildActivateCommand(completionPolicyPinFor(installPolicy as never), {
    commandId: "cmd-p107-activate-policy",
    correlationId: "corr-p107-activate-policy",
    submittedAt: P107_SCHEMA,
    projectId: P107_PROJECT,
    expectedRevision: 1,
    idempotencyKey: "p107-activate-policy",
  });
  const actBaseline = buildActivateCommand(architectureBaselinePinFor(installBaseline as never), {
    commandId: "cmd-p107-activate-baseline",
    correlationId: "corr-p107-activate-baseline",
    submittedAt: P107_SCHEMA,
    projectId: P107_PROJECT,
    expectedRevision: 1,
    idempotencyKey: "p107-activate-baseline",
  });
  expect((await h.activate(actPolicy)).status).toBe("committed");
  expect((await h.activate(actBaseline)).status).toBe("committed");

  const goal = await h.control.submit(
    buildCreateGoalCommand(p107GoalScope(), {
      commandId: "cmd-p107-create-goal",
      correlationId: "corr-p107-create-goal",
      submittedAt: P107_SCHEMA,
      idempotencyKey: "p1-07-create-goal",
    }),
  );
  expect(goal.status).toBe("committed");

  const plan = await h.applyPlan(
    buildApplyPlanCommand(planDraft, {
      commandId: "cmd-p107-apply-plan",
      correlationId: "corr-p107-apply-plan",
      submittedAt: P107_SCHEMA,
      projectId: P107_PROJECT,
      expectedRevision: 1,
      idempotencyKey: "p1-07-apply-plan",
    }),
  );
  expect(plan.status).toBe("committed");

  const goalLoad = await h.ledger.load({ aggregateType: "Goal" as const, projectId: P107_PROJECT, goalId: P107_GOAL });
  expect(goalLoad.status).toBe("found");
  const planLoad = await h.ledger.load(p107PlanRef(P107_PROJECT));
  expect(planLoad.status).toBe("found");
  const wsLoad = await h.ledger.load({ aggregateType: "Workspace" as const, projectId: P107_PROJECT, workspaceId: P107_WORKSPACE });
  expect(wsLoad.status).toBe("found");
  return {
    projectId: P107_PROJECT,
    goalId: P107_GOAL,
    workspaceId: P107_WORKSPACE,
    planRef: p107PlanRef(P107_PROJECT),
    planSnapshot: planLoad.status === "found" ? (planLoad.snapshot as PlanRevisionSnapshot) : undefined,
    goal: goalLoad.status === "found" ? (goalLoad.snapshot as GoalSnapshot) : undefined,
    workspace: wsLoad.status === "found" ? (wsLoad.snapshot as WorkspaceSnapshot) : undefined,
    workspaceRevision: wsLoad.status === "found" ? (wsLoad.snapshot as WorkspaceSnapshot).revision : 1,
    pinnedCompletionPolicy: completionPolicyPinFor(installPolicy as never),
    pinnedArchitectureBaseline: architectureBaselinePinFor(installBaseline as never),
  };
}

// ------------------------------------------------------------------------ //
// Claim / run helpers                                                       //
// ------------------------------------------------------------------------ //

export type P107ClaimDeps = {
  taskId: string;
  runId: string;
  attemptId: string;
  roleBinding: RoleBindingRefV1;
  declaredPermissions: { tools: string[]; writeScope: string[] };
  budget: TaskBudgetV1;
};

/** Claim a P107 task (eligible per the plan DAG — claim returns committed). */
export async function claimP107Task(h: P1_07TestHarness, deps: P107ClaimDeps): Promise<RunRef> {
  const claim = await h.claimTask(
    buildDispatchClaimCommand({
      taskId: deps.taskId,
      goalId: P107_GOAL,
      roleBinding: deps.roleBinding,
      projectId: P107_PROJECT,
      commandId: "cmd-p107-claim-" + deps.runId,
      correlationId: "corr-p107-claim-" + deps.runId,
      submittedAt: P107_SCHEMA,
      runId: deps.runId,
      attemptId: deps.attemptId,
      idempotencyKey: "p107-claim-" + deps.runId,
      declaredPermissions: deps.declaredPermissions,
      budget: deps.budget,
    }),
  );
  expect(claim.status).toBe("committed");
  return claim.status === "committed" ? claim.runRef : (null as unknown as RunRef);
}

export type P107RunDeps = P107ClaimDeps & {
  script?: FakeRuntimeScriptV1;
};

/**
 * Full single-task run: claim -> drive (pending intents of the goal).
 * Returns the task's RunRef after the run facts were ingested.
 */
export async function runP107Task(h: P1_07TestHarness, deps: P107RunDeps): Promise<RunRef> {
  const runRef = await claimP107Task(h, deps);
  const drive = await h.drive({ reason: "p1-07 run " + deps.taskId, maxIntents: 8 });
  expect(drive.failures).toHaveLength(0);
  return runRef;
}

/** Reader run: the reader keeps NO writes — read capability only. */
export async function runP107Reader(h: P1_07TestHarness, reader: "a" | "b", startedAt: string, endedAt: string): Promise<RunRef> {
  const taskId = reader === "a" ? P107_TASK_READER_A : P107_TASK_READER_B;
  return runP107Task(h, {
    taskId,
    runId: "run-p107-read-" + reader,
    attemptId: "att-p107-read-" + reader,
    roleBinding: P107_ROLE_BINDING_READER_V1,
    declaredPermissions: P107_DECLARED_READ_PERMISSIONS_V1,
    budget: P107_BUDGET_READER_V1,
    script: p107ReaderScript(reader, startedAt, endedAt),
  });
}

// ------------------------------------------------------------------------ //
// Evidence helpers                                                          //
// ------------------------------------------------------------------------ //

export type P107EvidenceDeps = {
  evidenceId: string;
  taskId: string;
  outcome: EvidenceOutcome;
  runRef: RunRef | null;
  coverage: { obligationId: string; requirementId: string }[];
  anchor: EffectivityAnchorV1;
  actor?: { kind: "human" | "system"; id: string };
};

export async function submitP107Evidence(h: P1_07TestHarness, deps: P107EvidenceDeps): Promise<EvidenceRef> {
  const evidence = buildEvidenceV1({
    evidenceId: deps.evidenceId,
    kind: deps.outcome === "INCONCLUSIVE" ? "claim" : "observation",
    outcome: deps.outcome,
    projectId: P107_PROJECT,
    goalId: P107_GOAL,
    taskId: deps.taskId,
    coverage: deps.coverage.map((c) => coverage(c.obligationId, c.requirementId)),
    anchor: deps.anchor,
    verificationPlanRef: { planId: "vp-p107", planDigest: sha256Hex("vp-p107") },
    runRef: deps.runRef,
    ...(deps.actor === undefined ? {} : { actor: deps.actor }),
  });
  const submitted = await h.submitEvidence(
    buildSubmitEvidenceCommand({
      commandId: "cmd-p107-evidence-" + deps.evidenceId,
      correlationId: "corr-p107-evidence-" + deps.evidenceId,
      submittedAt: P107_SCHEMA,
      evidence,
    }),
  );
  expect(submitted.status).toBe("committed");
  return evidenceRefFor(P107_PROJECT, deps.evidenceId);
}

/** Accepted-evidence check used by the writer guard (APPLICABLE vs current anchor). */
export function isAcceptedEvidence(
  evidence: import("../../src/contracts/evidence.js").EvidenceV1,
  plan: PlanRevisionSnapshot,
  anchor: EffectivityAnchorV1,
): boolean {
  return evidenceApplicability(evidence, plan, anchor) === "APPLICABLE";
}

// ------------------------------------------------------------------------ //
// Integration result helper                                                 //
// ------------------------------------------------------------------------ //

export type P107IntegrationDeps = {
  resultId: string;
  runRef: RunRef;
  attemptRef: TaskAttemptRef;
  inputs: IntegrationInputRefV1[];
  conflicts?: IntegrationTaskResultV1["conflicts"];
  gaps?: IntegrationTaskResultV1["gaps"];
  explanation?: string | null;
  escalate?: boolean;
  workspaceRevision: number;
  planRef: PlanRevisionRef;
};

export async function recordP107Integration(h: P1_07TestHarness, deps: P107IntegrationDeps) {
  const result: IntegrationTaskResultV1 = {
    schemaVersion: 1,
    resultId: deps.resultId,
    projectId: P107_PROJECT,
    workspaceId: P107_WORKSPACE,
    goalId: P107_GOAL,
    taskId: P107_TASK_INTEGRATION,
    planRef: deps.planRef,
    taskRevision: 1,
    runRef: deps.runRef,
    attemptRef: deps.attemptRef,
    workspaceRevision: deps.workspaceRevision,
    inputs: deps.inputs,
    conflicts: deps.conflicts ?? [],
    gaps: deps.gaps ?? [],
    explanation: deps.explanation ?? null,
    escalate: deps.escalate ?? false,
    generatedAt: P107_SCHEMA,
  };
  return h.recordIntegrationResult(
    buildP107RecordIntegrationCommand({
      commandId: "cmd-p107-integration-" + deps.resultId,
      projectId: P107_PROJECT,
      expectedRevision: 0,
      result,
    }),
  );
}

// ------------------------------------------------------------------------ //
// Patch helper                                                              //
// ------------------------------------------------------------------------ //

export type P107PatchDeps = {
  patchId: string;
  runRef: RunRef;
  attemptRef: TaskAttemptRef;
  beforeWorkspaceRevision: number;
  afterWorkspaceRevision: number;
  usedInputEvidenceRefs: EvidenceRef[];
  leaseId: string;
  changedPaths?: string[];
};

export async function recordP107Patch(h: P1_07TestHarness, deps: P107PatchDeps) {
  const patch: PatchArtifactV1 = {
    schemaVersion: 1,
    patchId: deps.patchId,
    projectId: P107_PROJECT,
    workspaceId: P107_WORKSPACE,
    goalId: P107_GOAL,
    taskId: P107_TASK_WRITER,
    planRef: p107PlanRef(P107_PROJECT),
    taskRevision: 1,
    runRef: deps.runRef,
    attemptRef: deps.attemptRef,
    roleBinding: P107_ROLE_BINDING_WRITER_V1,
    kind: "patch",
    title: "P1-07 patch from accepted reader outputs",
    changedPaths: deps.changedPaths ?? ["src/p107/fix-a.ts", "src/p107/fix-b.ts"],
    bodyRef: buildP107ArtifactRef(deps.patchId),
    beforeWorkspaceRevision: deps.beforeWorkspaceRevision,
    afterWorkspaceRevision: deps.afterWorkspaceRevision,
    checkResults: [
      { checkId: "gate-p107", outcome: "PASS", summary: "deterministic checks passed" },
    ],
    usedInputEvidenceRefs: deps.usedInputEvidenceRefs,
    generatedAt: P107_SCHEMA,
  };
  return h.recordPatch(
    buildP107RecordPatchCommand({
      commandId: "cmd-p107-patch-" + deps.patchId,
      projectId: P107_PROJECT,
      patch,
    }),
  );
}

// ------------------------------------------------------------------------ //
// Goal phase helper                                                         //
// ------------------------------------------------------------------------ //

export async function reduceP107Goal(h: P1_07TestHarness, expectedRevision: number) {
  return h.reduceGoal(
    buildReduceGoalCommand({
      commandId: "cmd-p107-reduce-goal-" + expectedRevision,
      correlationId: "corr-p107-reduce-goal-" + expectedRevision,
      submittedAt: P107_SCHEMA,
      expectedRevision,
      projectId: P107_PROJECT,
      goalId: P107_GOAL,
    }),
  );
}

// ------------------------------------------------------------------------ //
// Parallel probe runtime (real-overlap measurement)                         //
// ------------------------------------------------------------------------ //

/**
 * Probe RunPort for the overlap measurement: it wraps a per-task script
 * selector AND records the execution ORDER (all start() calls vs all
 * pollFreshEvents() calls). driveParallel MUST start both readers before
 * consuming any of them — a sequential drive shows start(A), poll(A), ...,
 * start(B) in the log.
 */
export class ParallelProbeRuntime implements RunPort {
  readonly started: string[] = [];
  readonly polled: string[] = [];
  readonly windows: Record<string, { startedAt: string; terminalAt: string }> = {};
  private readonly handles = new Map<string, RunHandle>();

  constructor(
    private readonly scripts: (envelope: TaskEnvelopeV1) => FakeRuntimeScriptV1,
  ) {}

  capabilities(): Promise<RunCapabilities> {
    return Promise.resolve({ replayable: true, supportsSnapshot: false, maxEnvelopeBytes: 64 * 1024 });
  }

  start(envelope: TaskEnvelopeV1): Promise<RunHandle> {
    this.started.push(envelope.taskId);
    const script = this.scripts(envelope);
    const events = rebaseScriptForRun(script, envelope.runRef);
    const runId = envelope.runRef.runId;
    const window: { startedAt: string; terminalAt: string } = { startedAt: "", terminalAt: "" };
    let nextIndex = 0;
    const handle: RunHandle = {
      runRef: envelope.runRef,
      pollFreshEvents: async () => {
        this.polled.push(runId);
        const remaining = events.slice(nextIndex);
        if (remaining.length > 0) {
          nextIndex = events.length;
          const first = remaining[0]!;
          if (window.startedAt === "" && first.payload.kind === "started") window.startedAt = first.occurredAt;
          const terminal = remaining[remaining.length - 1]!;
          window.terminalAt = terminal.occurredAt;
        }
        return remaining;
      },
    };
    this.windows[runId] = window;
    this.handles.set(runId, handle);
    return Promise.resolve(handle);
  }
}

// ------------------------------------------------------------------------ //
// Full scenario / restart path                                              //
// ------------------------------------------------------------------------ //

export type P107FullScenarioResult = {
  workspaceRevisionAfter: number;
  readerARun: RunRef;
  readerBRun: RunRef;
  integrationRun: RunRef;
  writerRun: RunRef;
  evidenceA: EvidenceRef;
  evidenceB: EvidenceRef;
};

/**
 * The full happy-path scenario used by the main contract suite AND by the
 * restart probe (isP107Ready). It exercises:
 *   prepare -> claim A+B -> driveParallel (real overlap) -> reader evidence
 *   -> join (no conflicts) -> writer claim/run -> write lease -> recordPatch
 *   (workspace revision advance + lease release) -> gate run -> gate evidence
 *   -> reduceGoal COMPLETED.
 * Returns the refs the caller asserts on.
 */
export async function runP107FullScenario(h: P1_07TestHarness): Promise<P107FullScenarioResult> {
  const sc = await prepareP107Scenario(h);
  const anchor = buildEffectivityAnchorV1({
    planRef: sc.planRef,
    planRevision: 1,
    workspaceRevision: sc.workspaceRevision,
    pinnedCompletionPolicy: sc.pinnedCompletionPolicy,
    pinnedArchitectureBaseline: sc.pinnedArchitectureBaseline,
  });

  // 1) claim both readers and drive them PARALLEL (real overlap).
  const runA = await claimP107Task(h, {
    taskId: P107_TASK_READER_A, runId: "run-p107-read-a", attemptId: "att-p107-read-a",
    roleBinding: P107_ROLE_BINDING_READER_V1, declaredPermissions: P107_DECLARED_READ_PERMISSIONS_V1, budget: P107_BUDGET_READER_V1,
  });
  const runB = await claimP107Task(h, {
    taskId: P107_TASK_READER_B, runId: "run-p107-read-b", attemptId: "att-p107-read-b",
    roleBinding: P107_ROLE_BINDING_READER_V1, declaredPermissions: P107_DECLARED_READ_PERMISSIONS_V1, budget: P107_BUDGET_READER_V1,
  });
  const parallel = await h.workspaceDrive.driveParallel({
    schemaVersion: 1, reason: "p1-07 parallel readers", projectId: P107_PROJECT, goalId: P107_GOAL, maxIntents: 4,
  });
  expect(parallel.failures).toHaveLength(0);

  // 2) reader evidence (both APPLICABLE, agreeing outcomes) + reductions.
  const evidenceA = await submitP107Evidence(h, {
    evidenceId: "ev-p107-read-a", taskId: P107_TASK_READER_A, outcome: "PASS", runRef: runA,
    coverage: [{ obligationId: P107_OBL_READERS, requirementId: P107_VR_READERS }], anchor,
  });
  const evidenceB = await submitP107Evidence(h, {
    evidenceId: "ev-p107-read-b", taskId: P107_TASK_READER_B, outcome: "PASS", runRef: runB,
    coverage: [{ obligationId: P107_OBL_READERS, requirementId: P107_VR_READERS }], anchor,
  });
  expect((await h.reduceTask(buildP107ReduceTaskCommand(P107_TASK_READER_A))).status).toBe("committed");
  expect((await h.reduceTask(buildP107ReduceTaskCommand(P107_TASK_READER_B))).status).toBe("committed");

  // 3) integration run + join (both inputs accepted; no conflicts).
  const integrationRun = await runP107Task(h, {
    taskId: P107_TASK_INTEGRATION, runId: "run-p107-integration", attemptId: "att-p107-integration",
    roleBinding: P107_ROLE_BINDING_READER_V1, declaredPermissions: P107_DECLARED_READ_PERMISSIONS_V1, budget: P107_BUDGET_READER_V1,
  });
  const join = await recordP107Integration(h, {
    resultId: "result-p107-1", runRef: integrationRun, attemptRef: taskAttemptRefFor(P107_PROJECT, P107_GOAL, P107_TASK_INTEGRATION, "att-p107-integration"),
    inputs: [
      { sourceTaskId: P107_TASK_READER_A, sourceRunRef: runA, kind: "evidence", evidenceRef: evidenceA, artifactRef: null, handoffPacketRef: null },
      { sourceTaskId: P107_TASK_READER_B, sourceRunRef: runB, kind: "evidence", evidenceRef: evidenceB, artifactRef: null, handoffPacketRef: null },
    ],
    workspaceRevision: sc.workspaceRevision, planRef: sc.planRef,
  });
  expect(join.status).toBe("committed");
  const integrationEvidence = await submitP107Evidence(h, {
    evidenceId: "ev-p107-integration", taskId: P107_TASK_INTEGRATION, outcome: "PASS", runRef: integrationRun,
    coverage: [{ obligationId: P107_OBL_JOIN, requirementId: P107_VR_JOIN }],
    anchor: buildEffectivityAnchorV1({
      planRef: sc.planRef, planRevision: 1, workspaceRevision: sc.workspaceRevision,
      pinnedCompletionPolicy: sc.pinnedCompletionPolicy, pinnedArchitectureBaseline: sc.pinnedArchitectureBaseline,
    }),
  });
  expect((await h.reduceTask(buildP107ReduceTaskCommand(P107_TASK_INTEGRATION))).status).toBe("committed");

  // 4) writer run + write lease + patch record (workspace revision advance).
  const writerRun = await runP107Task(h, {
    taskId: P107_TASK_WRITER, runId: "run-p107-writer", attemptId: "att-p107-writer",
    roleBinding: P107_ROLE_BINDING_WRITER_V1, declaredPermissions: P107_DECLARED_WRITE_PERMISSIONS_V1, budget: P107_BUDGET_WRITER_V1,
  });
  const lease = await h.acquireWorkspaceWriteLease(
    buildP107AcquireWriteLeaseCommand({
      commandId: "cmd-p107-lease-write", projectId: P107_PROJECT, leaseId: "lease-p107-writer",
      scope: P107_SCOPE_WRITER,
      declaredWriteScope: P107_DECLARED_WRITE_PERMISSIONS_V1.writeScope,
      holder: { runRef: writerRun, attemptRef: taskAttemptRefFor(P107_PROJECT, P107_GOAL, P107_TASK_WRITER, "att-p107-writer"), roleBinding: P107_ROLE_BINDING_WRITER_V1 },
    }),
  );
  expect(lease.status).toBe("committed");
  const patch = await recordP107Patch(h, {
    patchId: "patch-p107-1", runRef: writerRun,
    attemptRef: taskAttemptRefFor(P107_PROJECT, P107_GOAL, P107_TASK_WRITER, "att-p107-writer"),
    beforeWorkspaceRevision: sc.workspaceRevision, afterWorkspaceRevision: sc.workspaceRevision + 1,
    usedInputEvidenceRefs: [evidenceA, evidenceB], leaseId: "lease-p107-writer",
  });
  expect(patch.status).toBe("committed");
  const workspaceRevisionAfter = patch.status === "committed" ? patch.workspaceRevision : sc.workspaceRevision;
  // Full re-verification at the canonical POST-WRITE revision (GoalGate全量检查):
  // the P1-05 goal reduction evaluates obligations at the CURRENT tuple, so the
  // reader + integration evidence (anchor N) is re-admitted at N+1 and the
  // three downstream tasks re-reduced (TaskReduction k+1 — never rewritten).
  await rerunP107Verification(h, {
    anchor: buildEffectivityAnchorV1({
      planRef: sc.planRef, planRevision: 1, workspaceRevision: workspaceRevisionAfter,
      pinnedCompletionPolicy: sc.pinnedCompletionPolicy, pinnedArchitectureBaseline: sc.pinnedArchitectureBaseline,
    }),
    runA, runB, integrationRun,
  });
  await submitP107Evidence(h, {
    evidenceId: "ev-p107-writer", taskId: P107_TASK_WRITER, outcome: "PASS", runRef: writerRun,
    coverage: [
      { obligationId: P107_OBL_PATCH, requirementId: P107_VR_PATCH },
      { obligationId: P107_OBL_PATCH, requirementId: "vr-p107-writer-accepts" },
    ],
    anchor: buildEffectivityAnchorV1({
      planRef: sc.planRef, planRevision: 1, workspaceRevision: workspaceRevisionAfter,
      pinnedCompletionPolicy: sc.pinnedCompletionPolicy, pinnedArchitectureBaseline: sc.pinnedArchitectureBaseline,
    }),
  });
  expect((await h.reduceTask(buildP107ReduceTaskCommand(P107_TASK_WRITER))).status).toBe("committed");

  // 5) gate evidence (gate tasks are NOT dispatchable — evidence reduction
  //    applies without a run; verdicts are system checks, runRef null) +
  //    reduction + goal phase COMPLETED.
  const gateEvidence = await submitP107Evidence(h, {
    evidenceId: "ev-p107-gate", taskId: P107_TASK_GATE, outcome: "PASS", runRef: null,
    coverage: [{ obligationId: P107_OBL_GATE, requirementId: P107_VR_GATE }],
    anchor: buildEffectivityAnchorV1({
      planRef: sc.planRef, planRevision: 1, workspaceRevision: workspaceRevisionAfter,
      pinnedCompletionPolicy: sc.pinnedCompletionPolicy, pinnedArchitectureBaseline: sc.pinnedArchitectureBaseline,
    }),
  });
  expect((await h.reduceTask(buildP107ReduceTaskCommand(P107_TASK_GATE))).status).toBe("committed");
  const goalReduce = await reduceP107Goal(h, 0);
  expect(goalReduce.status).toBe("committed");
  await h.advanceProjection();

  return {
    workspaceRevisionAfter,
    readerARun: runA,
    readerBRun: runB,
    integrationRun,
    writerRun,
    evidenceA,
    evidenceB,
  };
}

// ------------------------------------------------------------------------ //
// helpers                                                                   //
// ------------------------------------------------------------------------ //

import { taskAttemptRefFor, taskLeaseRefFor } from "../../src/contracts/dispatch.js";
import type { ReduceTaskCommand } from "../../src/contracts/reduction.js";
import { buildReduceTaskCommand } from "../../src/contracts/fixtures/evidence-fixtures.js";

export function buildP107ReduceTaskCommand(taskId: string, expectedRevision = 0): ReduceTaskCommand {
  return buildReduceTaskCommand({
    commandId: "cmd-p107-reduce-" + taskId + "-" + expectedRevision,
    correlationId: "corr-p107-reduce-" + taskId + "-" + expectedRevision,
    submittedAt: P107_SCHEMA,
    projectId: P107_PROJECT,
    goalId: P107_GOAL,
    taskId,
    expectedRevision,
    idempotencyKey: "p1-07-reduce-" + taskId + "-" + expectedRevision,
  }) as ReduceTaskCommand;
}

/**
 * Post-write full re-verification (the GoalGate full check at the canonical
 * revision AFTER the patch): re-admit the reader + integration evidence at the
 * final workspace revision and re-reduce the three downstream tasks so the
 * goal reduction sees ALL required obligations satisfied at the CURRENT
 * anchor (P1-05 reducer is frozen — the full check re-verifies at the new
 * tuple instead of re-writing it).
 */
export async function rerunP107Verification(
  h: P1_07TestHarness,
  deps: {
    anchor: EffectivityAnchorV1;
    runA: RunRef;
    runB: RunRef;
    integrationRun: RunRef;
  },
): Promise<{ evA2: EvidenceRef; evB2: EvidenceRef; evInt2: EvidenceRef }> {
  const evA2 = await submitP107Evidence(h, { evidenceId: "ev-p107-read-a-v2", taskId: P107_TASK_READER_A, outcome: "PASS", runRef: deps.runA, coverage: [{ obligationId: P107_OBL_READERS, requirementId: P107_VR_READERS }], anchor: deps.anchor });
  const evB2 = await submitP107Evidence(h, { evidenceId: "ev-p107-read-b-v2", taskId: P107_TASK_READER_B, outcome: "PASS", runRef: deps.runB, coverage: [{ obligationId: P107_OBL_READERS, requirementId: P107_VR_READERS }], anchor: deps.anchor });
  const evInt2 = await submitP107Evidence(h, { evidenceId: "ev-p107-integration-v2", taskId: P107_TASK_INTEGRATION, outcome: "PASS", runRef: deps.integrationRun, coverage: [{ obligationId: P107_OBL_JOIN, requirementId: P107_VR_JOIN }], anchor: deps.anchor });
  expect((await h.reduceTask(buildP107ReduceTaskCommand(P107_TASK_READER_A, 1))).status).toBe("committed");
  expect((await h.reduceTask(buildP107ReduceTaskCommand(P107_TASK_READER_B, 1))).status).toBe("committed");
  expect((await h.reduceTask(buildP107ReduceTaskCommand(P107_TASK_INTEGRATION, 1))).status).toBe("committed");
  return { evA2, evB2, evInt2 };
}

export { taskAttemptRefFor, taskLeaseRefFor, buildReduceTaskCommand, workspaceReadLeaseRefFor, workspaceWriteLeaseRefFor, buildP107AcquireReadLeaseCommand, buildP107AcquireWriteLeaseCommand, buildP107ReleaseLeaseCommand, buildP107RecordIntegrationCommand, buildP107RecordPatchCommand, runRefFor };
import { runRefFor } from "../../src/contracts/dispatch.js";
