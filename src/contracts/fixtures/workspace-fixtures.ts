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
import type { PlanRevisionDraft } from "../plan.js";
import type { PlanRevisionRef } from "../plan.js";
import type { RoleBindingRefV1, RunRef, TaskAttemptRef, TaskBudgetV1 } from "../dispatch.js";
import { runRefFor, taskAttemptRefFor } from "../dispatch.js";
import type { ArtifactRef } from "../artifact.js";
import { sha256Hex } from "../fingerprint.js";
import type { EvidenceRef } from "../evidence.js";
import type { CommandIdentity } from "../command-event.js";
import type {
  AcquireWorkspaceReadLeaseCommand,
  AcquireWorkspaceWriteLeaseCommand,
  ConflictScopeV1,
  ReleaseWorkspaceLeaseCommand,
  WorkspaceReadLeaseIndexSnapshot,
  WorkspaceReadLeaseSnapshot,
  WorkspaceWriteLeaseIndexSnapshot,
  WorkspaceWriteLeaseSnapshot,
} from "../workspace-lease.js";
import {
  acquireReadLeaseFingerprint,
  acquireWriteLeaseFingerprint,
  releaseLeaseFingerprint,
  workspaceReadLeaseIndexRefFor,
  workspaceReadLeaseRefFor,
  workspaceWriteLeaseIndexRefFor,
  workspaceWriteLeaseRefFor,
} from "../workspace-lease.js";
import type {
  IntegrationResultSnapshot,
  IntegrationTaskResultV1,
  RecordIntegrationResultCommand,
} from "../integration.js";
import { integrationResultRefFor, recordIntegrationFingerprint } from "../integration.js";
import type { PatchArtifactV1, RecordPatchCommand } from "../patch.js";
import { patchRecordRefFor, recordPatchFingerprint } from "../patch.js";
import type { FakeRuntimeScriptV1 } from "./dispatch-fixtures.js";
import type { TaskEnvelopeV1 } from "../task-envelope.js";

// ------------------------------------------------------------------------ //
// Constants                                                                 //
// ------------------------------------------------------------------------ //

export const P107_PROJECT = "proj-p107";
export const P107_WORKSPACE = "ws-p107";
export const P107_GOAL = "goal-p107-1";
export const P107_PLAN_ID = "plan-p107-parallel";
export const P107_TASK_READER_A = "task-p107-read-a";
export const P107_TASK_READER_B = "task-p107-read-b";
export const P107_TASK_INTEGRATION = "task-p107-integrate";
export const P107_TASK_WRITER = "task-p107-writer";
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
  return {
    commandId: deps.commandId,
    commandType: "AcquireWorkspaceReadLease",
    schemaVersion: 1,
    identity: {
      projectId: deps.projectId,
      actor: deps.actor ?? { kind: "system", id: "integrator" },
      idempotencyKey: deps.idempotencyKey ?? "p107-acquire-read-" + deps.leaseId,
    },
    aggregateId: deps.leaseId,
    expectedRevision: 0,
    correlationId: deps.correlationId ?? deps.commandId,
    submittedAt: deps.submittedAt ?? P107_SCHEMA,
    payload: {
      projectId: deps.projectId,
      workspaceId: deps.workspaceId ?? P107_WORKSPACE,
      scope: deps.scope ?? P107_SCOPE_READER_A,
      holder: deps.holder,
      expiresAt: deps.expiresAt ?? null,
    },
  };
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
  return {
    commandId: deps.commandId,
    commandType: "AcquireWorkspaceWriteLease",
    schemaVersion: 1,
    identity: {
      projectId: deps.projectId,
      actor: deps.actor ?? { kind: "system", id: "integrator" },
      idempotencyKey: deps.idempotencyKey ?? "p107-acquire-write-" + deps.leaseId,
    },
    aggregateId: deps.leaseId,
    expectedRevision: 0,
    correlationId: deps.correlationId ?? deps.commandId,
    submittedAt: deps.submittedAt ?? P107_SCHEMA,
    payload: {
      projectId: deps.projectId,
      workspaceId: deps.workspaceId ?? P107_WORKSPACE,
      scope: deps.scope ?? P107_SCOPE_WRITER,
      holder: deps.holder,
      expiresAt: deps.expiresAt ?? null,
      declaredWriteScope: deps.declaredWriteScope ?? P107_DECLARED_WRITE_PERMISSIONS_V1.writeScope,
    },
  };
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
  return {
    commandId: deps.commandId,
    commandType: "ReleaseWorkspaceLease",
    schemaVersion: 1,
    identity: {
      projectId: deps.projectId,
      actor: deps.actor ?? { kind: "system", id: "integrator" },
      idempotencyKey: deps.idempotencyKey ?? "p107-release-" + deps.leaseId,
    },
    aggregateId: deps.leaseId,
    expectedRevision: 1,
    correlationId: deps.correlationId ?? deps.commandId,
    submittedAt: deps.submittedAt ?? P107_SCHEMA,
    payload: {
      projectId: deps.projectId,
      workspaceId: deps.workspaceId ?? P107_WORKSPACE,
      kind: deps.kind,
      leaseId: deps.leaseId,
      holderRunRef: deps.holderRunRef,
    },
  };
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
  return {
    commandId: deps.commandId,
    commandType: "RecordPatch",
    schemaVersion: 1,
    identity: {
      projectId: deps.projectId,
      actor: deps.actor ?? { kind: "system", id: "integrator" },
      idempotencyKey: deps.idempotencyKey ?? "p107-patch-" + deps.patch.patchId,
    },
    aggregateId: deps.patch.patchId,
    expectedRevision: 0,
    correlationId: deps.correlationId ?? deps.commandId,
    submittedAt: deps.submittedAt ?? P107_SCHEMA,
    payload: { patch: deps.patch },
  };
}

// ------------------------------------------------------------------------ //
// Ledger commit builders (fold targets — fold equality is a frozen rule)    //
// ------------------------------------------------------------------------ //

export type BuildP107ReadAcquireCommitDeps = {
  eventId: string;
  occurredAt: string;
  indexSnapshot: WorkspaceReadLeaseIndexSnapshot;
};

export function buildWorkspaceReadLeaseAcquireLedgerCommit(
  command: AcquireWorkspaceReadLeaseCommand,
  deps: BuildP107ReadAcquireCommitDeps,
): import("../ledger.js").WorkspaceReadLeaseAcquireLedgerCommitV1 {
  const leaseId = command.aggregateId;
  const leaseSnapshot: WorkspaceReadLeaseSnapshot = {
    ref: workspaceReadLeaseRefFor(command.identity.projectId, leaseId),
    revision: 1,
    schemaVersion: 1,
    lease: {
      schemaVersion: 1,
      leaseId,
      projectId: command.payload.projectId,
      workspaceId: command.payload.workspaceId,
      scope: command.payload.scope,
      holder: command.payload.holder,
      grantedAt: deps.occurredAt,
      expiresAt: command.payload.expiresAt,
      status: "active",
      releasedAt: null,
      releasedBy: null,
    },
  };
  const index = deps.indexSnapshot;
  const nextIndex: WorkspaceReadLeaseIndexSnapshot = {
    ref: workspaceReadLeaseIndexRefFor(command.identity.projectId, command.payload.workspaceId),
    revision: index.revision + 1,
    schemaVersion: 1,
    activeReadLeases: [
      ...index.activeReadLeases,
      { leaseId, scope: command.payload.scope },
    ],
  };
  return {
    commitKind: "workspace-read-lease-acquire",
    schemaVersion: 1,
    identity: command.identity,
    fingerprint: acquireReadLeaseFingerprint(command),
    expectedVersions: [
      { ref: leaseSnapshot.ref, revision: 0 },
      { ref: index.ref, revision: index.revision },
    ],
    events: [workspaceReadLeaseGrantedEventFor(command, deps.eventId, deps.occurredAt)],
    snapshots: [leaseSnapshot, nextIndex],
    outboxIntents: [],
  };
}

export type BuildP107ReadReleaseCommitDeps = {
  eventId: string;
  occurredAt: string;
  indexSnapshot: WorkspaceReadLeaseIndexSnapshot;
};

export function buildWorkspaceReadLeaseReleaseLedgerCommit(
  command: ReleaseWorkspaceLeaseCommand,
  activeSnapshot: WorkspaceReadLeaseSnapshot,
  deps: BuildP107ReadReleaseCommitDeps,
): import("../ledger.js").WorkspaceReadLeaseReleaseLedgerCommitV1 {
  const leaseSnapshot: WorkspaceReadLeaseSnapshot = {
    ref: activeSnapshot.ref,
    revision: 2,
    schemaVersion: 1,
    lease: { ...activeSnapshot.lease, status: "released", releasedAt: deps.occurredAt, releasedBy: "holder" },
  };
  const index = deps.indexSnapshot;
  const nextIndex: WorkspaceReadLeaseIndexSnapshot = {
    ref: index.ref,
    revision: index.revision + 1,
    schemaVersion: 1,
    activeReadLeases: index.activeReadLeases.filter((e) => e.leaseId !== command.payload.leaseId),
  };
  return {
    commitKind: "workspace-read-lease-release",
    schemaVersion: 1,
    identity: command.identity,
    fingerprint: releaseLeaseFingerprint(command),
    expectedVersions: [
      { ref: activeSnapshot.ref, revision: 1 },
      { ref: index.ref, revision: index.revision },
    ],
    events: [workspaceReadLeaseReleasedEventFor(command, deps.eventId, deps.occurredAt)],
    snapshots: [leaseSnapshot, nextIndex],
    outboxIntents: [],
  };
}

export type BuildP107WriteAcquireCommitDeps = {
  eventId: string;
  occurredAt: string;
  indexSnapshot: WorkspaceWriteLeaseIndexSnapshot;
  /** Expired active lease vacated in the same commit (null otherwise). */
  vacatedSnapshot?: WorkspaceWriteLeaseSnapshot;
};

export function buildWorkspaceWriteLeaseAcquireLedgerCommit(
  command: AcquireWorkspaceWriteLeaseCommand,
  deps: BuildP107WriteAcquireCommitDeps,
): import("../ledger.js").WorkspaceWriteLeaseAcquireLedgerCommitV1 {
  const leaseId = command.aggregateId;
  const leaseSnapshot: WorkspaceWriteLeaseSnapshot = {
    ref: workspaceWriteLeaseRefFor(command.identity.projectId, leaseId),
    revision: 1,
    schemaVersion: 1,
    lease: {
      schemaVersion: 1,
      leaseId,
      projectId: command.payload.projectId,
      workspaceId: command.payload.workspaceId,
      scope: command.payload.scope,
      holder: command.payload.holder,
      grantedAt: deps.occurredAt,
      expiresAt: command.payload.expiresAt,
      status: "active",
      releasedAt: null,
      releasedBy: null,
      patches: [],
      postWriteWorkspaceRevision: null,
    },
  };
  const index = deps.indexSnapshot;
  const nextIndex: WorkspaceWriteLeaseIndexSnapshot = {
    ref: workspaceWriteLeaseIndexRefFor(command.identity.projectId, command.payload.workspaceId),
    revision: index.revision + 1,
    schemaVersion: 1,
    activeLeaseId: leaseId,
    activeScope: command.payload.scope,
    holderRunRef: command.payload.holder.runRef,
  };
  let vacatedSnap: WorkspaceWriteLeaseSnapshot | null = null;
  let vacatedRef: WorkspaceWriteLeaseSnapshot["ref"] | null = null;
  const vacated = deps.vacatedSnapshot;
  if (vacated !== undefined) {
    vacatedRef = vacated.ref;
    vacatedSnap = {
      ref: vacated.ref,
      revision: 2,
      schemaVersion: 1,
      lease: {
        ...vacated.lease,
        status: "released",
        releasedAt: deps.occurredAt,
        releasedBy: null,
      },
    };
  }
  const expectedVersions = [
    { ref: leaseSnapshot.ref, revision: 0 },
    { ref: index.ref, revision: index.revision },
  ];
  if (vacatedSnap !== null && vacatedRef !== null) {
    expectedVersions.push({ ref: vacatedRef, revision: 1 });
  }
  return {
    commitKind: "workspace-write-lease-acquire",
    schemaVersion: 1,
    identity: command.identity,
    fingerprint: acquireWriteLeaseFingerprint(command),
    expectedVersions,
    events: [workspaceWriteLeaseGrantedEventFor(command, deps.eventId, deps.occurredAt)],
    snapshots: vacatedSnap === null ? [leaseSnapshot, nextIndex] : [leaseSnapshot, nextIndex, vacatedSnap],
    vacatedLeaseRef: vacatedSnap === null ? null : vacatedRef,
    outboxIntents: [],
  };
}

export type BuildP107WriteReleaseCommitDeps = {
  eventId: string;
  occurredAt: string;
  indexSnapshot: WorkspaceWriteLeaseIndexSnapshot;
};

export function buildWorkspaceWriteLeaseReleaseLedgerCommit(
  command: ReleaseWorkspaceLeaseCommand,
  activeSnapshot: WorkspaceWriteLeaseSnapshot,
  deps: BuildP107WriteReleaseCommitDeps,
): import("../ledger.js").WorkspaceWriteLeaseReleaseLedgerCommitV1 {
  const leaseSnapshot: WorkspaceWriteLeaseSnapshot = {
    ref: activeSnapshot.ref,
    revision: 2,
    schemaVersion: 1,
    lease: { ...activeSnapshot.lease, status: "released", releasedAt: deps.occurredAt, releasedBy: "holder" },
  };
  const index = deps.indexSnapshot;
  const nextIndex: WorkspaceWriteLeaseIndexSnapshot = {
    ref: index.ref,
    revision: index.revision + 1,
    schemaVersion: 1,
    activeLeaseId: null,
    activeScope: null,
    holderRunRef: null,
  };
  return {
    commitKind: "workspace-write-lease-release",
    schemaVersion: 1,
    identity: command.identity,
    fingerprint: releaseLeaseFingerprint(command),
    expectedVersions: [
      { ref: activeSnapshot.ref, revision: 1 },
      { ref: index.ref, revision: index.revision },
    ],
    events: [workspaceWriteLeaseReleasedEventFor(command, deps.eventId, deps.occurredAt)],
    snapshots: [leaseSnapshot, nextIndex],
    outboxIntents: [],
  };
}

export type BuildP107IntegrationCommitDeps = {
  eventId: string;
  occurredAt: string;
  priorRecords: IntegrationTaskResultV1[];
};

export function buildIntegrationRecordLedgerCommit(
  command: RecordIntegrationResultCommand,
  deps: BuildP107IntegrationCommitDeps,
): import("../ledger.js").IntegrationRecordLedgerCommitV1 {
  const result = command.payload.result;
  const snapshot: IntegrationResultSnapshot = {
    ref: integrationResultRefFor(command.identity.projectId, result.goalId, result.taskId),
    revision: deps.priorRecords.length + 1,
    schemaVersion: 1,
    records: [...deps.priorRecords, result],
  };
  return {
    commitKind: "integration-record",
    schemaVersion: 1,
    identity: command.identity,
    fingerprint: recordIntegrationFingerprint(command),
    expectedVersions: [{ ref: snapshot.ref, revision: deps.priorRecords.length }],
    events: [
      { ...integrationJoinedEventFor(command, deps.eventId, deps.occurredAt), aggregateRevision: snapshot.revision },
    ],
    snapshots: [snapshot],
    outboxIntents: [],
  };
}

export type BuildP107PatchCommitDeps = {
  eventId: string;
  occurredAt: string;
  workspaceRevisionBefore: number;
  activeLeaseSnapshot: WorkspaceWriteLeaseSnapshot;
  writeIndexSnapshot: WorkspaceWriteLeaseIndexSnapshot;
};

export function buildPatchRecordLedgerCommit(
  command: RecordPatchCommand,
  deps: BuildP107PatchCommitDeps,
): import("../ledger.js").PatchRecordLedgerCommitV1 {
  const patch = command.payload.patch;
  const patchSnapshot: import("../patch.js").PatchRecordSnapshot = {
    ref: patchRecordRefFor(command.identity.projectId, patch.patchId),
    revision: 1,
    schemaVersion: 1,
    patch,
    recordedAt: deps.occurredAt,
  };
  const workspaceSnapshot = {
    ref: { aggregateType: "Workspace" as const, projectId: command.identity.projectId, workspaceId: patch.workspaceId },
    revision: patch.afterWorkspaceRevision,
  };
  const lease = deps.activeLeaseSnapshot;
  const leaseSnapshot: WorkspaceWriteLeaseSnapshot = {
    ref: lease.ref,
    revision: 2,
    schemaVersion: 1,
    lease: {
      ...lease.lease,
      status: "released",
      releasedAt: deps.occurredAt,
      releasedBy: "holder",
      patches: [...lease.lease.patches, patchSnapshot.ref],
      postWriteWorkspaceRevision: patch.afterWorkspaceRevision,
    },
  };
  const index = deps.writeIndexSnapshot;
  const nextIndex: WorkspaceWriteLeaseIndexSnapshot = {
    ref: index.ref,
    revision: index.revision + 1,
    schemaVersion: 1,
    activeLeaseId: null,
    activeScope: null,
    holderRunRef: null,
  };
  return {
    commitKind: "patch-record",
    schemaVersion: 1,
    identity: command.identity,
    fingerprint: recordPatchFingerprint(command),
    expectedVersions: [
      { ref: patchSnapshot.ref, revision: 0 },
      { ref: workspaceSnapshot.ref, revision: deps.workspaceRevisionBefore },
      { ref: lease.ref, revision: 1 },
      { ref: index.ref, revision: index.revision },
    ],
    events: [patchRecordedEventFor(command, deps.eventId, deps.occurredAt), workspaceWriteLeaseReleasedViaPatchEventFor(command, deps.eventId, deps.occurredAt, patch.afterWorkspaceRevision, lease.ref.leaseId)],
    snapshots: [patchSnapshot, workspaceSnapshot, leaseSnapshot, nextIndex],
    outboxIntents: [],
  };
}

// ------------------------------------------------------------------------ //
// Event folds (used by the commit builders above)                           //
// ------------------------------------------------------------------------ //

function workspaceReadLeaseGrantedEventFor(command: AcquireWorkspaceReadLeaseCommand, eventId: string, occurredAt: string) : import("../workspace-lease.js").WorkspaceReadLeaseGrantedEvent {
  return {
    eventId,
    eventType: "WorkspaceReadLeaseGranted" as const,
    schemaVersion: 1 as const,
    projectId: command.identity.projectId,
    workspaceId: command.payload.workspaceId,
    aggregateType: "WorkspaceReadLease" as const,
    aggregateId: command.aggregateId,
    aggregateRevision: 1,
    causationId: command.commandId,
    correlationId: command.correlationId,
    idempotencyKey: command.identity.idempotencyKey,
    actor: command.identity.actor,
    occurredAt,
    payload: {
      leaseId: command.aggregateId,
      scope: command.payload.scope,
      holder: { runRef: command.payload.holder.runRef, attemptRef: command.payload.holder.attemptRef },
      expiresAt: command.payload.expiresAt,
    },
  };
}

function workspaceReadLeaseReleasedEventFor(command: ReleaseWorkspaceLeaseCommand, eventId: string, occurredAt: string) : import("../workspace-lease.js").WorkspaceReadLeaseReleasedEvent {
  return {
    eventId,
    eventType: "WorkspaceReadLeaseReleased" as const,
    schemaVersion: 1 as const,
    projectId: command.identity.projectId,
    workspaceId: command.payload.workspaceId,
    aggregateType: "WorkspaceReadLease" as const,
    aggregateId: command.payload.leaseId,
    aggregateRevision: 2,
    causationId: command.commandId,
    correlationId: command.correlationId,
    idempotencyKey: command.identity.idempotencyKey,
    actor: command.identity.actor,
    occurredAt,
    payload: { leaseId: command.payload.leaseId, releasedAt: occurredAt, releasedBy: "holder" },
  };
}

function workspaceWriteLeaseGrantedEventFor(command: AcquireWorkspaceWriteLeaseCommand, eventId: string, occurredAt: string) : import("../workspace-lease.js").WorkspaceWriteLeaseGrantedEvent {
  return {
    eventId,
    eventType: "WorkspaceWriteLeaseGranted" as const,
    schemaVersion: 1 as const,
    projectId: command.identity.projectId,
    workspaceId: command.payload.workspaceId,
    aggregateType: "WorkspaceWriteLease" as const,
    aggregateId: command.aggregateId,
    aggregateRevision: 1,
    causationId: command.commandId,
    correlationId: command.correlationId,
    idempotencyKey: command.identity.idempotencyKey,
    actor: command.identity.actor,
    occurredAt,
    payload: {
      leaseId: command.aggregateId,
      scope: command.payload.scope,
      holder: { runRef: command.payload.holder.runRef, attemptRef: command.payload.holder.attemptRef },
      expiresAt: command.payload.expiresAt,
    },
  };
}

function workspaceWriteLeaseReleasedEventFor(command: ReleaseWorkspaceLeaseCommand, eventId: string, occurredAt: string) : import("../workspace-lease.js").WorkspaceWriteLeaseReleasedEvent {
  return {
    eventId,
    eventType: "WorkspaceWriteLeaseReleased" as const,
    schemaVersion: 1,
    projectId: command.identity.projectId,
    workspaceId: command.payload.workspaceId,
    aggregateType: "WorkspaceWriteLease" as const,
    aggregateId: command.payload.leaseId,
    aggregateRevision: 2,
    causationId: command.commandId,
    correlationId: command.correlationId,
    idempotencyKey: command.identity.idempotencyKey,
    actor: command.identity.actor,
    occurredAt,
    payload: { leaseId: command.payload.leaseId, releasedAt: occurredAt, releasedBy: "holder", releasedVia: "explicit", postWriteWorkspaceRevision: null },
  };
}

function workspaceWriteLeaseReleasedViaPatchEventFor(command: RecordPatchCommand, eventId: string, occurredAt: string, postWriteWorkspaceRevision: number, leaseId: string) : import("../workspace-lease.js").WorkspaceWriteLeaseReleasedEvent {
  const patch = command.payload.patch;
  return {
    eventId,
    eventType: "WorkspaceWriteLeaseReleased" as const,
    schemaVersion: 1,
    projectId: command.identity.projectId,
    workspaceId: patch.workspaceId,
    aggregateType: "WorkspaceWriteLease" as const,
    aggregateId: leaseId,
    aggregateRevision: 2,
    causationId: command.commandId,
    correlationId: command.correlationId,
    idempotencyKey: command.identity.idempotencyKey,
    actor: command.identity.actor,
    occurredAt,
    payload: { leaseId, releasedAt: occurredAt, releasedBy: "holder", releasedVia: "patch-record", postWriteWorkspaceRevision },
  };
}

function integrationJoinedEventFor(command: RecordIntegrationResultCommand, eventId: string, occurredAt: string) : import("../integration.js").IntegrationJoinedEvent {
  const result = command.payload.result;
  return {
    eventId,
    eventType: "IntegrationJoined" as const,
    schemaVersion: 1,
    projectId: command.identity.projectId,
    workspaceId: result.workspaceId,
    aggregateType: "IntegrationResult" as const,
    aggregateId: result.taskId,
    aggregateRevision: 0, // patched below by the caller (see buildIntegrationRecordLedgerCommit)
    causationId: command.commandId,
    correlationId: command.correlationId,
    idempotencyKey: command.identity.idempotencyKey,
    actor: command.identity.actor,
    occurredAt,
    payload: {
      resultId: result.resultId,
      goalId: result.goalId,
      taskId: result.taskId,
      runRef: result.runRef,
      attemptRef: result.attemptRef,
      workspaceRevision: result.workspaceRevision,
      planRef: result.planRef,
      inputs: result.inputs,
      conflicts: result.conflicts,
      gaps: result.gaps,
      explanation: result.explanation,
      escalate: result.escalate,
      generatedAt: result.generatedAt,
    },
  };
}

function patchRecordedEventFor(command: RecordPatchCommand, eventId: string, occurredAt: string) : import("../patch.js").PatchRecordedEvent {
  const patch = command.payload.patch;
  return {
    eventId,
    eventType: "PatchRecorded" as const,
    schemaVersion: 1,
    projectId: command.identity.projectId,
    workspaceId: patch.workspaceId,
    aggregateType: "PatchRecord" as const,
    aggregateId: patch.patchId,
    aggregateRevision: 1,
    causationId: command.commandId,
    correlationId: command.correlationId,
    idempotencyKey: command.identity.idempotencyKey,
    actor: command.identity.actor,
    occurredAt,
    payload: {
      patchId: patch.patchId,
      goalId: patch.goalId,
      taskId: patch.taskId,
      runRef: patch.runRef,
      attemptRef: patch.attemptRef,
      kind: patch.kind,
      title: patch.title,
      changedPaths: patch.changedPaths,
      beforeWorkspaceRevision: patch.beforeWorkspaceRevision,
      afterWorkspaceRevision: patch.afterWorkspaceRevision,
      checkResults: patch.checkResults,
      usedInputEvidenceRefs: patch.usedInputEvidenceRefs,
      generatedAt: patch.generatedAt,
    },
  };
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
