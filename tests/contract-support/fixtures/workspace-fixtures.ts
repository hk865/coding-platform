import { buildAcquireReadLeaseCommand as formalbuildP107AcquireReadLeaseCommand, buildAcquireWriteLeaseCommand as formalbuildP107AcquireWriteLeaseCommand, buildReleaseLeaseCommand as formalbuildP107ReleaseLeaseCommand, buildRecordPatchCommand as formalbuildP107RecordPatchCommand } from "../../../src/contracts/commands/workspace.js";


/**
 * P1-07 shared fixtures: the two-independent-reader-tasks plan slice for the
 * parallel-readers + single-writer ticket + command/commit builders (fold
 * targets for the Control lanes; fold-equality is a frozen guarantee).
 *
 * Plan shape (frozen by the ticket's two-independent-reader-tasks artifact):
 *   - two work reader tasks with NO depends_on (independent reader lanes);
 *   - one work integration task with EXPLICIT depends_on on BOTH readers;
 *   - one work writer task depending on the integration task;
 *   - one gate task (goal gate) depending on the writer.
 * Obligations: one shared reader obligation carrying the common VR both
 * readers report against (the evidence-conflict surface), plus join / patch /
 * gate obligations.
 */
import type { PlanRevisionDraft } from "../../../src/contracts/plan.js";
import type { PlanRevisionRef } from "../../../src/contracts/plan.js";
import type { RoleBindingRefV1, RunRef, TaskAttemptRef, TaskBudgetV1 } from "../../../src/contracts/dispatch.js";
import { runRefFor, taskAttemptRefFor } from "../../../src/contracts/dispatch.js";
import type { ArtifactRef } from "../../../src/contracts/artifact.js";
import { sha256Hex } from "../../../src/contracts/fingerprint.js";
import type { EvidenceRef } from "../../../src/contracts/evidence.js";
import type { CommandIdentity } from "../../../src/contracts/command-event.js";
import type { AcquireWorkspaceReadLeaseCommand, AcquireWorkspaceWriteLeaseCommand, ConflictScopeV1, ReleaseWorkspaceLeaseCommand } from "../../../src/contracts/workspace-lease.js";

import type { IntegrationTaskResultV1, RecordIntegrationResultCommand } from "../../../src/contracts/integration.js";

import type { PatchArtifactV1, RecordPatchCommand } from "../../../src/contracts/patch.js";

import type { FakeRuntimeScriptV1 } from "../../../src/fixtures/dispatch-fixtures.js";
import type { TaskEnvelopeV1 } from "../../../src/contracts/task-envelope.js";

// ------------------------------------------------------------------------ //
// Constants                                                                 //
// ------------------------------------------------------------------------ //

/** Uses the bootstrap fixture's existing project/workspace (proj-alpha/ws-shared
 * — the P1-06 precedent); P107 local ids (goal/plan/tasks/obligations) stay
 * P107-specific. */
export const P107_PROJECT = "proj-alpha";
export const P107_WORKSPACE = "ws-shared";
export const P107_GOAL = "goal-p107-1";
export const P107_PLAN_ID = "plan-p107-parallel";
export const P107_TASK_READER_A = "task-p107-read-a";
export const P107_TASK_READER_B = "task-p107-read-b";
export const P107_TASK_INTEGRATION = "task-p107-integrate";
export const P107_TASK_WRITER = "task-p107-writer";
/** Second (independent, optional) writer used ONLY by the competing-writer-lease-test. */
export const P107_TASK_WRITER_B = "task-p107-writer-b";
export const P107_TASK_GATE = "gate-p107-goal";
export const P107_OBL_READERS = "obl-p107-readers";
export const P107_VR_READERS = "vr-p107-readers-common";
export const P107_OBL_JOIN = "obl-p107-join";
export const P107_VR_JOIN = "vr-p107-join";
export const P107_OBL_PATCH = "obl-p107-patch";
export const P107_VR_PATCH = "vr-p107-patch";
export const P107_OBL_GATE = "obl-p107-gate";
export const P107_VR_GATE = "vr-p107-gate";
export const P107_SCHEMA = "2026-09-06T12:00:00.000Z";
export const P107_WRITE_SCOPE = "src/p107";

export const P107_ROLE_BINDING_READER_V1: RoleBindingRefV1 = {
  schemaVersion: 1,
  bindingId: "binding-p107-reader-v1",
  templateId: "template-short-lived-reader",
  templateRevision: "2026-09-06",
  bindingVersion: 1,
  policyRevision: "auth-policy-runtime-v1",
};

export const P107_ROLE_BINDING_WRITER_V1: RoleBindingRefV1 = {
  schemaVersion: 1,
  bindingId: "binding-p107-writer-v1",
  templateId: "template-short-lived-writer",
  templateRevision: "2026-09-06",
  bindingVersion: 1,
  policyRevision: "auth-policy-runtime-v1",
};

export const P107_ROLE_BINDING_COORDINATOR_V1: RoleBindingRefV1 = {
  schemaVersion: 1,
  bindingId: "binding-p107-coordinator-v1",
  templateId: "template-short-lived-coordinator",
  templateRevision: "2026-09-06",
  bindingVersion: 1,
  policyRevision: "auth-policy-runtime-v1",
};

export const P107_BUDGET_READER_V1: TaskBudgetV1 = { tokenBudget: 50_000, deadline: "2026-09-07T00:00:00.000Z" };
export const P107_BUDGET_WRITER_V1: TaskBudgetV1 = { tokenBudget: 80_000, deadline: "2026-09-07T00:00:00.000Z" };

export const P107_DECLARED_READ_PERMISSIONS_V1 = { tools: ["read"], writeScope: [] as string[] };
export const P107_DECLARED_WRITE_PERMISSIONS_V1 = { tools: ["read", "write"], writeScope: [P107_WRITE_SCOPE] };

/** Reader scope A: module "mod/module-a" (path-like). Reader B: module "mod/module-b". Writer: workspace. */
export const P107_SCOPE_READER_A: ConflictScopeV1 = {
  schemaVersion: 1,
  projectId: P107_PROJECT,
  workspaceId: P107_WORKSPACE,
  kind: "module",
  id: "mod/module-a",
  revision: null,
};

export const P107_SCOPE_READER_B: ConflictScopeV1 = {
  schemaVersion: 1,
  projectId: P107_PROJECT,
  workspaceId: P107_WORKSPACE,
  kind: "module",
  id: "mod/module-b",
  revision: null,
};

export const P107_SCOPE_WRITER: ConflictScopeV1 = {
  schemaVersion: 1,
  projectId: P107_PROJECT,
  workspaceId: P107_WORKSPACE,
  kind: "path",
  id: P107_WRITE_SCOPE,
  revision: null,
};

export const P107_SCOPE_WRITER_B: ConflictScopeV1 = {
  schemaVersion: 1,
  projectId: P107_PROJECT,
  workspaceId: P107_WORKSPACE,
  kind: "path",
  id: "src/p107-alt",
  revision: null,
};

// ------------------------------------------------------------------------ //
// Plan fixture                                                              //
// ------------------------------------------------------------------------ //

export const P107_PLAN_REVISION_FIXTURE_V1: PlanRevisionDraft = {
  schemaVersion: 1,
  planId: P107_PLAN_ID,
  planRevision: 1,
  goalId: P107_GOAL,
  stages: [{ stageId: "stage-p107-parallel", title: "双 Reader 并行 + 唯一 Writer" }],
  tasks: [
    {
      taskId: P107_TASK_READER_A,
      stageId: "stage-p107-parallel",
      title: "Reader A：只读调查方向 A",
      requirementLevel: "required",
      taskKind: "work",
      disposition: "active",
      phase: "pending",
      scope: { kind: "module", stageId: "stage-p107-parallel", moduleRef: P107_SCOPE_READER_A.id },
    },
    {
      taskId: P107_TASK_READER_B,
      stageId: "stage-p107-parallel",
      title: "Reader B：只读调查方向 B",
      requirementLevel: "required",
      taskKind: "work",
      disposition: "active",
      phase: "pending",
      scope: { kind: "module", stageId: "stage-p107-parallel", moduleRef: P107_SCOPE_READER_B.id },
    },
    {
      taskId: P107_TASK_INTEGRATION,
      stageId: "stage-p107-parallel",
      title: "Integration：join 双 Reader 输出并保留冲突",
      requirementLevel: "required",
      taskKind: "work",
      disposition: "active",
      phase: "pending",
      scope: { kind: "stage", stageId: "stage-p107-parallel" },
    },
    {
      taskId: P107_TASK_WRITER,
      stageId: "stage-p107-parallel",
      title: "Writer：唯一写入 + patch 登记",
      requirementLevel: "required",
      taskKind: "work",
      disposition: "active",
      phase: "pending",
      scope: { kind: "module", stageId: "stage-p107-parallel", moduleRef: P107_WRITE_SCOPE },
    },
    {
      taskId: P107_TASK_WRITER_B,
      stageId: "stage-p107-parallel",
      title: "Writer B（可选）：竞争写入用独立工作包",
      requirementLevel: "optional",
      taskKind: "work",
      disposition: "active",
      phase: "pending",
      scope: { kind: "module", stageId: "stage-p107-parallel", moduleRef: "src/p107-alt" },
    },
    {
      taskId: P107_TASK_GATE,
      title: "GoalGate：全量 Evidence 检查通过后 Goal 才可完成",
      requirementLevel: "required",
      taskKind: "gate",
      disposition: "active",
      phase: "pending",
      scope: { kind: "goal" },
    },
  ],
  obligations: [
    {
      obligationId: P107_OBL_READERS,
      title: "两个 Reader 对共同 VR 各自提交可比对证据",
      requirementLevel: "required",
      taskIds: [P107_TASK_READER_A, P107_TASK_READER_B],
      verificationRequirements: [
        { requirementId: P107_VR_READERS, requirementLevel: "required", kind: "dynamic", description: "双 Reader 证据在同一 revision 下可比对（冲突可判定、可保留）" },
      ],
    },
    {
      obligationId: P107_OBL_JOIN,
      title: "IntegrationTask join 双 Reader 输出（来源保留、冲突保留）",
      requirementLevel: "required",
      taskIds: [P107_TASK_INTEGRATION],
      verificationRequirements: [
        { requirementId: P107_VR_JOIN, requirementLevel: "required", kind: "dynamic", description: "join 事实与冲突面（不解归约语义）" },
      ],
    },
    {
      obligationId: P107_OBL_PATCH,
      title: "Writer 使用已接受 Reader 输出并登记 patch（workspace revision 推进）",
      requirementLevel: "required",
      taskIds: [P107_TASK_WRITER],
      verificationRequirements: [
        { requirementId: P107_VR_PATCH, requirementLevel: "required", kind: "dynamic", description: "patch/commit + changed paths + check results + workspace revision" },
        { requirementId: "vr-p107-writer-accepts", requirementLevel: "required", kind: "dynamic", description: "Writer 不得使用未接受的 Reader 输出" },
      ],
    },
    {
      obligationId: P107_OBL_GATE,
      title: "GoalGate 全量检查后 Goal 才可完成",
      requirementLevel: "required",
      taskIds: [P107_TASK_GATE],
      verificationRequirements: [
        { requirementId: P107_VR_GATE, requirementLevel: "required", kind: "reviewer", description: "Gate Evidence 路径可用；失败事实可追溯" },
      ],
    },
  ],
  taskHierarchy: {
    parentOf: [
      { parentTaskId: P107_TASK_GATE, childTaskId: P107_TASK_WRITER },
      { parentTaskId: P107_TASK_WRITER, childTaskId: P107_TASK_INTEGRATION },
      { parentTaskId: P107_TASK_INTEGRATION, childTaskId: P107_TASK_READER_A },
      { parentTaskId: P107_TASK_INTEGRATION, childTaskId: P107_TASK_READER_B },
    ],
  },
  executionDag: {
    dependsOn: [
      { taskId: P107_TASK_INTEGRATION, dependsOnId: P107_TASK_READER_A, requires: { kind: "artifact", label: "Reader A 的调查结果" } },
      { taskId: P107_TASK_INTEGRATION, dependsOnId: P107_TASK_READER_B, requires: { kind: "artifact", label: "Reader B 的调查结果" } },
      { taskId: P107_TASK_WRITER, dependsOnId: P107_TASK_INTEGRATION, requires: { kind: "artifact", label: "join 确认（无未解释冲突）" } },
      { taskId: P107_TASK_GATE, dependsOnId: P107_TASK_WRITER, requires: { kind: "gate-result", label: "Writer patch 已登记且 workspace revision 推进" } },
    ],
  },
};

/**
 * CONFLICT-TEST plan variant: same slice, but the Integration task's DAG edge
 * onto reader B is dropped — a reader whose task FAILS (the disagreeing
 * evidence) must not block the integration run that joins it. The Conflict is
 * preserved by the join (acceptance 4) while the DAG stays explicit
 * (acceptance 2: only the declared depends_on edges gate).
 */
export const P107_PLAN_REVISION_CONFLICT_FIXTURE_V1: PlanRevisionDraft = {
  ...P107_PLAN_REVISION_FIXTURE_V1,
  planId: P107_PLAN_ID,
  executionDag: {
    dependsOn: [
      { taskId: P107_TASK_INTEGRATION, dependsOnId: P107_TASK_READER_A, requires: { kind: "artifact", label: "Reader A 的调查结果" } },
      { taskId: P107_TASK_WRITER, dependsOnId: P107_TASK_INTEGRATION, requires: { kind: "artifact", label: "join 确认（无未解释冲突）" } },
      { taskId: P107_TASK_GATE, dependsOnId: P107_TASK_WRITER, requires: { kind: "gate-result", label: "Writer patch 已登记且 workspace revision 推进" } },
    ],
  },
};

// ------------------------------------------------------------------------ //
// Scope helpers                                                             //
// ------------------------------------------------------------------------ //

export function p107ScopeForTask(taskId: string): ConflictScopeV1 {
  if (taskId === P107_TASK_READER_A) return P107_SCOPE_READER_A;
  if (taskId === P107_TASK_READER_B) return P107_SCOPE_READER_B;
  if (taskId === P107_TASK_WRITER) return P107_SCOPE_WRITER;
  return { ...P107_SCOPE_WRITER, kind: "workspace", id: P107_WORKSPACE };
}

export function buildP107RunRef(projectId: string, runId: string): RunRef {
  return runRefFor(projectId, P107_GOAL, runId);
}

export function buildP107AttemptRef(projectId: string, taskId: string, attemptId: string): TaskAttemptRef {
  return taskAttemptRefFor(projectId, P107_GOAL, taskId, attemptId);
}

export function p107PlanRef(projectId: string): PlanRevisionRef {
  return { aggregateType: "PlanRevision", projectId, planId: P107_PLAN_ID };
}

// ------------------------------------------------------------------------ //
// Command builders (Control entries receive exactly these shapes)           //
// ------------------------------------------------------------------------ //

export type P107Actor = CommandIdentity["actor"];

export type BuildP107AcquireReadDeps = {
  commandId: string;
  projectId: string;
  workspaceId?: string;
  leaseId: string;
  scope?: ConflictScopeV1;
  holder: { runRef: RunRef; attemptRef: TaskAttemptRef; roleBinding: RoleBindingRefV1 };
  expiresAt?: string | null;
  actor?: P107Actor;
  idempotencyKey?: string;
  correlationId?: string;
  submittedAt?: string;
};

export function buildP107AcquireReadLeaseCommand(deps: BuildP107AcquireReadDeps): AcquireWorkspaceReadLeaseCommand {
  return formalbuildP107AcquireReadLeaseCommand({ ...deps, actor: deps.actor ?? { kind: "system", id: "integrator" }, idempotencyKey: deps.idempotencyKey ?? "p107-acquire-read-" + deps.leaseId, correlationId: deps.correlationId ?? deps.commandId, submittedAt: deps.submittedAt ?? P107_SCHEMA, workspaceId: deps.workspaceId ?? P107_WORKSPACE, scope: deps.scope ?? P107_SCOPE_READER_A, expiresAt: deps.expiresAt ?? null });
}

export type BuildP107AcquireWriteDeps = {
  commandId: string;
  projectId: string;
  workspaceId?: string;
  leaseId: string;
  scope?: ConflictScopeV1;
  declaredWriteScope?: string[];
  holder: { runRef: RunRef; attemptRef: TaskAttemptRef; roleBinding: RoleBindingRefV1 };
  expiresAt?: string | null;
  actor?: P107Actor;
  idempotencyKey?: string;
  correlationId?: string;
  submittedAt?: string;
};

export function buildP107AcquireWriteLeaseCommand(deps: BuildP107AcquireWriteDeps): AcquireWorkspaceWriteLeaseCommand {
  return formalbuildP107AcquireWriteLeaseCommand({ ...deps, actor: deps.actor ?? { kind: "system", id: "integrator" }, idempotencyKey: deps.idempotencyKey ?? "p107-acquire-write-" + deps.leaseId, correlationId: deps.correlationId ?? deps.commandId, submittedAt: deps.submittedAt ?? P107_SCHEMA, workspaceId: deps.workspaceId ?? P107_WORKSPACE, scope: deps.scope ?? P107_SCOPE_WRITER, expiresAt: deps.expiresAt ?? null, declaredWriteScope: deps.declaredWriteScope ?? P107_DECLARED_WRITE_PERMISSIONS_V1.writeScope });
}

export type BuildP107ReleaseDeps = {
  commandId: string;
  projectId: string;
  workspaceId?: string;
  leaseId: string;
  kind: "read" | "write";
  holderRunRef: RunRef;
  actor?: P107Actor;
  idempotencyKey?: string;
  correlationId?: string;
  submittedAt?: string;
};

export function buildP107ReleaseLeaseCommand(deps: BuildP107ReleaseDeps): ReleaseWorkspaceLeaseCommand {
  return formalbuildP107ReleaseLeaseCommand({ ...deps, actor: deps.actor ?? { kind: "system", id: "integrator" }, idempotencyKey: deps.idempotencyKey ?? "p107-release-" + deps.leaseId, correlationId: deps.correlationId ?? deps.commandId, submittedAt: deps.submittedAt ?? P107_SCHEMA, workspaceId: deps.workspaceId ?? P107_WORKSPACE });
}

export type BuildP107RecordIntegrationDeps = {
  commandId: string;
  projectId: string;
  workspaceId?: string;
  expectedRevision: number;
  result: IntegrationTaskResultV1;
  actor?: P107Actor;
  idempotencyKey?: string;
  correlationId?: string;
  submittedAt?: string;
};

export function buildP107RecordIntegrationCommand(deps: BuildP107RecordIntegrationDeps): RecordIntegrationResultCommand {
  return {
    commandId: deps.commandId,
    commandType: "RecordIntegrationResult",
    schemaVersion: 1,
    identity: {
      projectId: deps.projectId,
      actor: deps.actor ?? { kind: "system", id: "integrator" },
      idempotencyKey: deps.idempotencyKey ?? "p107-integration-" + deps.result.resultId,
    },
    aggregateId: deps.result.taskId,
    expectedRevision: deps.expectedRevision,
    correlationId: deps.correlationId ?? deps.commandId,
    submittedAt: deps.submittedAt ?? P107_SCHEMA,
    payload: { result: deps.result },
  };
}

export type BuildP107RecordPatchDeps = {
  commandId: string;
  projectId: string;
  patch: PatchArtifactV1;
  actor?: P107Actor;
  idempotencyKey?: string;
  correlationId?: string;
  submittedAt?: string;
};

export function buildP107RecordPatchCommand(deps: BuildP107RecordPatchDeps): RecordPatchCommand {
  return formalbuildP107RecordPatchCommand({ ...deps, actor: deps.actor ?? { kind: "system", id: "integrator" }, idempotencyKey: deps.idempotencyKey ?? "p107-patch-" + deps.patch.patchId, correlationId: deps.correlationId ?? deps.commandId, submittedAt: deps.submittedAt ?? P107_SCHEMA });
}

// ------------------------------------------------------------------------ //
// Runtime script factories (per-role deterministic scripts)                 //
// ------------------------------------------------------------------------ //

export function p107ReaderScript(reader: "a" | "b", startedAt: string, endedAt: string): FakeRuntimeScriptV1 {
  return {
    schemaVersion: 1,
    items: [
      { sequence: 1, eventType: "run_started", payload: { kind: "started", startedAt }, occurredAt: startedAt },
      { sequence: 2, eventType: "run_completed", payload: { kind: "completed", exitCode: 0 }, occurredAt: endedAt },
    ],
  };
}

export function p107WriterScript(startedAt: string, endedAt: string): FakeRuntimeScriptV1 {
  return {
    schemaVersion: 1,
    items: [
      { sequence: 1, eventType: "run_started", payload: { kind: "started", startedAt }, occurredAt: startedAt },
      { sequence: 2, eventType: "run_completed", payload: { kind: "completed", exitCode: 0 }, occurredAt: endedAt },
    ],
  };
}

/** Per-envelope selector factory: taskId -> deterministic script (reader/writer roles). */
export function p107ScriptSelector(
  scripts: Partial<Record<string, FakeRuntimeScriptV1>>,
): (envelope: TaskEnvelopeV1) => FakeRuntimeScriptV1 {
  return (envelope) => {
    const script = scripts[envelope.taskId];
    if (script === undefined) throw new Error("P1-07 selector: no script for task " + envelope.taskId);
    return script;
  };
}

/** Deterministic patch body artifact ref (body-first; digest = sha256 hex). */
export function buildP107ArtifactRef(label: string): ArtifactRef {
  const digest = sha256Hex("p107-body:" + label);
  return {
    kind: "artifact",
    contentType: "application/json",
    digest,
    sizeBytes: 96,
    source: { kind: "artifact", refId: "body-p107-" + label, revision: "1", digest },
  };
}

export type { EvidenceRef };
