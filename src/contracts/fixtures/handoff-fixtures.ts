/**
 * P1-06 shared fixtures: handoff scenario plan + packet / command / ledger-fold
 * builders used by BOTH adapter suites (InMemory + SQLite, same fixtures).
 *
 * Structure mirrors P1-03/04 fixtures: deterministic builders whose fold output
 * equals what the Control handlers produce (fold-equality target), plus the
 * P1-06 plan fixture that passes the P1-02 non-empty guards.
 */
import type { CommandIdentity } from "../command-event.js";
import type { PlanRevisionDraft, PlanRevisionSnapshot, PlanRevisionRef } from "../plan.js";
import type {
  ArtifactRef,
} from "../artifact.js";
import type {
  DispatchIntentV1,
  RoleBindingRefV1,
  RunRef,
  TaskAttemptRef,
  TaskBudgetV1,
} from "../dispatch.js";
import {
  dispatchOutboxRefFor,
  runRefFor,
  taskAttemptRefFor,
} from "../dispatch.js";
import type { EvidenceRef } from "../evidence.js";
import type {
  ClaimReplacementCommand,
  HandoffPacketRef,
  HandoffPacketV1,
  HandoffRecordedEvent,
  ReplacementAttemptSnapshot,
  ReplacementClaimedEvent,
  ReplacementReason,
  RecordHandoffCommand,
} from "../handoff.js";
import {
  claimReplacementFingerprint,
  handoffPacketRefFor,
  recordHandoffFingerprint,
  replacementAttemptRefFor,
} from "../handoff.js";
import type { HandoffContextRequestV1 } from "../handoff-context.js";
import type {
  HandoffRecordLedgerCommitV1,
  ReplacementClaimLedgerCommitV1,
} from "../ledger.js";
import type { GoalSnapshot, WorkspaceSnapshot } from "../ledger.js";
import type {
  DispatchOutboxEntrySnapshot,
  RunSnapshot,
  TaskAttemptSnapshot,
  TaskLeaseSnapshot,
} from "../dispatch.js";
import { taskLeaseRefFor } from "../dispatch.js";

export const P106_PROJECT = "proj-alpha";
export const P106_WORKSPACE = "ws-shared";
export const P106_GOAL = "goal-p106-1";
export const P106_PLAN_ID = "plan-handoff-mvp";
export const P106_TASK_ID = "task-handoff-target";
export const P106_GATE_ID = "gate-handoff-goal";
export const P106_OBL_HANDOFF = "obl-handoff";
export const P106_OBL_GATE = "obl-handoff-gate";
export const P106_VR_STATIC = "vr-handoff-static";
export const P106_VR_DYNAMIC = "vr-handoff-dynamic";

export const P106_PLAN_REVISION_FIXTURE_V1: PlanRevisionDraft = {
  schemaVersion: 1,
  planId: P106_PLAN_ID,
  planRevision: 1,
  goalId: P106_GOAL,
  stages: [{ stageId: "stage-handoff", title: "换手接续：A 中断后 B 在同一 Task 上继续" }],
  tasks: [
    {
      taskId: P106_TASK_ID,
      stageId: "stage-handoff",
      title: "同一 Task 接续：A 部分完成后 B 继续并留下可追溯结果",
      requirementLevel: "required",
      taskKind: "work",
      disposition: "active",
      phase: "pending",
      scope: { kind: "stage", stageId: "stage-handoff" },
    },
    {
      taskId: P106_GATE_ID,
      title: "HandoffGate：换手后的 Task 验证路径可追溯且无未对账副作用",
      requirementLevel: "required",
      taskKind: "gate",
      disposition: "active",
      phase: "pending",
      scope: { kind: "goal" },
    },
  ],
  obligations: [
    {
      obligationId: P106_OBL_HANDOFF,
      title: "B 提交的后续结果可追溯到 A/B 两个 Run 与同一 Task revision",
      requirementLevel: "required",
      taskIds: [P106_TASK_ID],
      verificationRequirements: [
        {
          requirementId: P106_VR_STATIC,
          requirementLevel: "required",
          kind: "static",
          description: "A/B 双 Run 证据在同一 Task revision 下可追溯",
        },
        {
          requirementId: P106_VR_DYNAMIC,
          requirementLevel: "required",
          kind: "dynamic",
          description: "换手后验证路径（contract suite + restart）通过",
        },
      ],
    },
    {
      obligationId: P106_OBL_GATE,
      title: "换手语义的 Gate 验收",
      requirementLevel: "required",
      taskIds: [P106_GATE_ID],
      verificationRequirements: [
        {
          requirementId: "vr-handoff-gate",
          requirementLevel: "required",
          kind: "reviewer",
          description: "集成验收逐项对照与独立复核",
        },
      ],
    },
  ],
  taskHierarchy: {
    parentOf: [
      { parentTaskId: P106_GATE_ID, childTaskId: P106_TASK_ID },
    ],
  },
  executionDag: {
    dependsOn: [
      {
        taskId: P106_GATE_ID,
        dependsOnId: P106_TASK_ID,
        requires: { kind: "gate-result", label: "换手 Task 的验证路径可追溯" },
      },
    ],
  },
};

export const P106_ROLE_BINDING_V1: RoleBindingRefV1 = {
  schemaVersion: 1,
  bindingId: "binding-p106-handoff-v1",
  templateId: "template-short-lived-runner",
  templateRevision: "2026-09-05",
  bindingVersion: 1,
  policyRevision: "auth-policy-runtime-v1",
};

export const P106_BUDGET_V1: TaskBudgetV1 = {
  tokenBudget: 100_000,
  deadline: "2026-09-06T00:00:00.000Z",
};

export const P106_DECLARED_PERMISSIONS_V1 = {
  tools: ["read", "write"],
  writeScope: ["src/contracts", "tests/handoff"],
};

export const P106_SCHEMA = "2026-09-05T12:00:00.000Z";

export type P106BuildDeps = {
  projectId?: string;
  goalId?: string;
  planRef?: PlanRevisionRef;
  workspaceId?: string;
  taskId?: string;
  actor?: CommandIdentity["actor"];
  idempotencyKey?: string;
};

export function freshP106Id(prefix: string): string {
  return prefix + "-" + Math.random().toString(36).slice(2, 10);
}

export function p106PlanRef(projectId: string): PlanRevisionRef {
  return {
    aggregateType: "PlanRevision",
    projectId,
    planId: P106_PLAN_ID,
  };
}

export type BuildArtifactRefDeps = {
  digest?: string;
  sizeBytes?: number;
};

export function buildP106ArtifactRef(deps: BuildArtifactRefDeps = {}): ArtifactRef {
  return {
    kind: "artifact",
    contentType: "application/json",
    digest: deps.digest ?? "digest-p106-body",
    sizeBytes: deps.sizeBytes ?? 128,
    source: { kind: "artifact", refId: "body-p106", revision: "1", digest: deps.digest ?? "digest-p106-body" },
  };
}

export type BuildHandoffPacketDeps = {
  packetId: string;
  projectId: string;
  goalId: string;
  taskId: string;
  planRef: PlanRevisionRef;
  taskRevision: number;
  workspaceId?: string;
  workspaceRevision?: number;
  runRef: RunRef;
  attemptRef: TaskAttemptRef;
  objectOf?: string;
  objective?: string;
  constraints?: string[];
  completed?: HandoffPacketV1["completed"];
  unresolved?: HandoffPacketV1["unresolved"];
  evidenceRefs?: EvidenceRef[];
  artifactRefs?: ArtifactRef[];
  contextBundleRef?: ArtifactRef | null;
  contextManifestRef?: ArtifactRef | null;
  lastEventSeq?: number;
  terminalEventId?: string | null;
  terminalOutcome?: HandoffPacketV1["source"]["runtime"]["terminalOutcome"];
  bodyRef?: ArtifactRef;
  predecessorPacketRef?: HandoffPacketRef | null;
  generatedAt?: string;
  roleBinding?: RoleBindingRefV1;
};

export function buildHandoffPacketV1(deps: BuildHandoffPacketDeps): HandoffPacketV1 {
  return {
    schemaVersion: 1,
    packetId: deps.packetId,
    projectId: deps.projectId,
    workspaceId: deps.workspaceId ?? P106_WORKSPACE,
    goalId: deps.goalId,
    taskId: deps.taskId,
    planRef: { ...deps.planRef },
    taskRevision: deps.taskRevision,
    objective: deps.objectOf ?? deps.objective ?? "A 中断后由 B 在同一个 Task 上接续",
    constraints: deps.constraints ?? ["保持同一 Task revision", "不重放完整 transcript"],
    completed: deps.completed ?? [
      {
        summary: "A 已完成的步骤（仅摘要/引用，无 transcript）",
        artifactRef: buildP106ArtifactRef({ digest: "digest-a-artifact" }),
        evidenceRefs: [{ aggregateType: "Evidence", projectId: deps.projectId, evidenceId: "ev-a-1" }],
      },
    ],
    unresolved: deps.unresolved ?? [
      {
        kind: "outcome_unknown",
        summary: "A 的某些副作用未确认（保留；不自动重试不可逆动作）",
        artifactRef: null,
      },
    ],
    evidenceRefs: deps.evidenceRefs ?? [
      { aggregateType: "Evidence", projectId: deps.projectId, evidenceId: "ev-a-1" },
    ],
    artifactRefs: deps.artifactRefs ?? [buildP106ArtifactRef({ digest: "digest-a-artifact" })],
    workspaceSnapshot: { workspaceId: deps.workspaceId ?? P106_WORKSPACE, revision: deps.workspaceRevision ?? 1 },
    source: {
      schemaVersion: 1,
      runRef: { ...deps.runRef },
      attemptRef: { ...deps.attemptRef },
      binding: deps.roleBinding ?? P106_ROLE_BINDING_V1,
      context: {
        contextBundleRef: deps.contextBundleRef ?? buildP106ArtifactRef({ digest: "digest-a-bundle" }),
        contextManifestRef: deps.contextManifestRef ?? buildP106ArtifactRef({ digest: "digest-a-manifest" }),
      },
      runtime: {
        lastEventSeq: deps.lastEventSeq ?? 2,
        terminalEventId: deps.terminalEventId ?? "rt-run-a-0002",
        terminalOutcome: deps.terminalOutcome ?? "crashed",
      },
    },
    bodyRef: deps.bodyRef ?? buildP106ArtifactRef({ digest: "digest-packet-body" }),
    noFullTranscript: true,
    predecessorPacketRef: deps.predecessorPacketRef ?? null,
    generatedAt: deps.generatedAt ?? P106_SCHEMA,
  };
}

export type BuildRecordHandoffDeps = {
  commandId: string;
  correlationId: string;
  submittedAt: string;
  projectId: string;
  packet: HandoffPacketV1;
  actor?: CommandIdentity["actor"];
  idempotencyKey?: string;
};

export function buildRecordHandoffCommand(deps: BuildRecordHandoffDeps): RecordHandoffCommand {
  return {
    commandId: deps.commandId,
    commandType: "RecordHandoff",
    schemaVersion: 1,
    identity: {
      projectId: deps.projectId,
      actor: deps.actor ?? { kind: "system", id: "handoff-generator" },
      idempotencyKey: deps.idempotencyKey ?? "p1-06-record-handoff",
    },
    aggregateId: deps.packet.packetId,
    expectedRevision: 0,
    correlationId: deps.correlationId,
    submittedAt: deps.submittedAt,
    payload: { packet: deps.packet },
  };
}

export function handoffRecordedEventFor(
  command: RecordHandoffCommand,
  deps: { eventId: string; occurredAt: string; workspaceId: string },
): HandoffRecordedEvent {
  return {
    eventId: deps.eventId,
    eventType: "HandoffRecorded",
    schemaVersion: 1,
    projectId: command.identity.projectId,
    workspaceId: deps.workspaceId,
    aggregateType: "HandoffPacket",
    aggregateId: command.aggregateId,
    aggregateRevision: 1,
    causationId: command.commandId,
    correlationId: command.correlationId,
    idempotencyKey: command.identity.idempotencyKey,
    actor: { ...command.identity.actor },
    occurredAt: deps.occurredAt,
    payload: {
      goalId: command.payload.packet.goalId,
      taskId: command.payload.packet.taskId,
      packet: command.payload.packet,
      recordedAt: deps.occurredAt,
    },
  };
}

export function handoffPacketSnapshotFor(command: RecordHandoffCommand, recordedAt: string) {
  const packet = command.payload.packet;
  return {
    ref: handoffPacketRefFor(command.identity.projectId, packet.goalId, packet.taskId, packet.packetId),
    revision: 1 as const,
    schemaVersion: 1 as const,
    packet,
    recordedAt,
  };
}

export function buildHandoffRecordLedgerCommit(
  command: RecordHandoffCommand,
  deps: { eventId: string; occurredAt: string; workspaceId: string },
): HandoffRecordLedgerCommitV1 {
  const snapshot = handoffPacketSnapshotFor(command, deps.occurredAt);
  const event = handoffRecordedEventFor(command, deps);
  return {
    commitKind: "handoff-record",
    schemaVersion: 1,
    identity: { ...command.identity },
    fingerprint: recordHandoffFingerprint(command),
    expectedVersions: [{ ref: snapshot.ref, revision: 0 }],
    events: [event],
    snapshots: [snapshot],
    outboxIntents: [],
  };
}

export type BuildClaimReplacementDeps = {
  commandId: string;
  correlationId: string;
  submittedAt: string;
  projectId: string;
  goalId?: string;
  taskId?: string;
  /** P1-03 first claim left the lease at revision 1; replacement CAS expects it. */
  expectedRevision?: number;
  attemptId?: string;
  runId?: string;
  roleBinding?: RoleBindingRefV1;
  declaredPermissions?: { tools: string[]; writeScope: string[] };
  budget?: TaskBudgetV1;
  handoffPacketRef: HandoffPacketRef;
  reason?: ReplacementReason;
  actor?: CommandIdentity["actor"];
  idempotencyKey?: string;
};

export function buildClaimReplacementCommand(deps: BuildClaimReplacementDeps): ClaimReplacementCommand {
  return {
    commandId: deps.commandId,
    commandType: "ClaimReplacement",
    schemaVersion: 1,
    identity: {
      projectId: deps.projectId,
      actor: deps.actor ?? { kind: "system", id: "handoff-controller" },
      idempotencyKey: deps.idempotencyKey ?? "p1-06-claim-replacement",
    },
    aggregateId: deps.taskId ?? P106_TASK_ID,
    expectedRevision: deps.expectedRevision ?? 1,
    correlationId: deps.correlationId,
    submittedAt: deps.submittedAt,
    payload: {
      goalId: deps.goalId ?? P106_GOAL,
      attemptId: deps.attemptId ?? "att-p106-b-1",
      runId: deps.runId ?? "run-p106-b-1",
      roleBinding: deps.roleBinding ?? P106_ROLE_BINDING_V1,
      declaredPermissions: deps.declaredPermissions ?? P106_DECLARED_PERMISSIONS_V1,
      budget: deps.budget ?? P106_BUDGET_V1,
      handoffPacketRef: { ...deps.handoffPacketRef },
      reason: deps.reason ?? "run_crashed",
    },
  };
}

export function nextTaskLeaseSnapshotForReplacement(
  prior: TaskLeaseSnapshot,
  command: ClaimReplacementCommand,
  occurredAt: string,
): TaskLeaseSnapshot {
  return {
    ref: { ...prior.ref },
    revision: prior.revision + 1,
    schemaVersion: 1,
    holderRunId: command.payload.runId,
    attemptId: command.payload.attemptId,
    grantedAt: occurredAt,
    expiresAt: prior.expiresAt,
  };
}

export function buildReplacementClaimLedgerCommit(
  command: ClaimReplacementCommand,
  deps: {
    eventId: string;
    occurredAt: string;
    workspaceId: string;
    workspaceRevision: number;
    planRef: PlanRevisionRef;
    priorLease: TaskLeaseSnapshot;
    priorRunRef: RunRef;
    priorAttemptRef: TaskAttemptRef;
  },
): ReplacementClaimLedgerCommitV1 {
  const projectId = command.identity.projectId;
  const goalId = command.payload.goalId;
  const taskId = command.aggregateId;
  const attemptId = command.payload.attemptId;
  const runId = command.payload.runId;

  const attemptRef: TaskAttemptRef = taskAttemptRefFor(projectId, goalId, taskId, attemptId);
  const runRef: RunRef = runRefFor(projectId, goalId, runId);
  const outboxRef = dispatchOutboxRefFor(projectId, goalId, taskId, attemptId);
  const replacementRef = replacementAttemptRefFor(projectId, goalId, taskId, attemptId);
  const leaseRef = taskLeaseRefFor(projectId, goalId, taskId);

  const lease: TaskLeaseSnapshot = nextTaskLeaseSnapshotForReplacement(deps.priorLease, command, deps.occurredAt);
  const attempt: TaskAttemptSnapshot = {
    ref: attemptRef,
    revision: 1,
    schemaVersion: 1,
    runId,
    planRef: { ...deps.planRef },
    status: "claimed",
    startedAt: null,
    endedAt: null,
    endOutcome: null,
  };
  const run: RunSnapshot = {
    ref: runRef,
    revision: 1,
    schemaVersion: 1,
    task: { projectId, goalId, taskId },
    attemptId,
    planRef: { ...deps.planRef },
    roleBinding: { ...command.payload.roleBinding },
    budget: { ...command.payload.budget },
    workspaceSnapshot: { workspaceId: deps.workspaceId, revision: deps.workspaceRevision },
    status: "starting",
    outcome: null,
    exitCode: null,
    lastEventSeq: 0,
    lastRuntimeEventId: "",
    lastFactEventId: "",
    envelope: null,
    startedAt: null,
    endedAt: null,
  };
  const intent: DispatchIntentV1 = {
    schemaVersion: 1,
    intentId: attemptId,
    projectId,
    workspaceId: deps.workspaceId,
    goalId,
    taskId,
    planRef: { ...deps.planRef },
    attemptRef: { ...attemptRef },
    runRef: { ...runRef },
    roleBinding: { ...command.payload.roleBinding },
    workspaceSnapshot: { workspaceId: deps.workspaceId, revision: deps.workspaceRevision },
    declaredPermissions: {
      tools: [...command.payload.declaredPermissions.tools],
      writeScope: [...command.payload.declaredPermissions.writeScope],
    },
    budget: { ...command.payload.budget },
    requestedAt: command.submittedAt,
    correlationId: command.correlationId,
  };
  const outbox: DispatchOutboxEntrySnapshot = {
    ref: outboxRef,
    revision: 1,
    schemaVersion: 1,
    status: "pending",
    intent,
    pendingAt: deps.occurredAt,
    startedAt: null,
    doneAt: null,
  };
  const replacement: ReplacementAttemptSnapshot = {
    ref: replacementRef,
    revision: 1,
    schemaVersion: 1,
    packetRef: { ...command.payload.handoffPacketRef },
    priorAttemptRef: { ...deps.priorAttemptRef },
    priorRunRef: { ...deps.priorRunRef },
    attemptRef: { ...attemptRef },
    runRef: { ...runRef },
    outboxRef: { ...outboxRef },
    reason: command.payload.reason,
    workspaceRevision: deps.workspaceRevision,
    claimedAt: deps.occurredAt,
  };

  const event: ReplacementClaimedEvent = {
    eventId: deps.eventId,
    eventType: "ReplacementClaimed",
    schemaVersion: 1,
    projectId,
    workspaceId: deps.workspaceId,
    aggregateType: "ReplacementAttempt",
    aggregateId: replacementRef.attemptId,
    aggregateRevision: 1,
    causationId: command.commandId,
    correlationId: command.correlationId,
    idempotencyKey: command.identity.idempotencyKey,
    actor: { ...command.identity.actor },
    occurredAt: deps.occurredAt,
    payload: {
      goalId,
      taskId,
      packetRef: { ...command.payload.handoffPacketRef },
      replacementRef: { ...replacementRef },
      priorAttemptRef: { ...deps.priorAttemptRef },
      priorRunRef: { ...deps.priorRunRef },
      attemptRef: { ...attemptRef },
      runRef: { ...runRef },
      outboxRef: { ...outboxRef },
      reason: command.payload.reason,
      claimedAt: deps.occurredAt,
    },
  };

  return {
    commitKind: "replacement-claim",
    schemaVersion: 1,
    identity: { ...command.identity },
    fingerprint: claimReplacementFingerprint(command),
    expectedVersions: [
      { ref: leaseRef, revision: command.expectedRevision },
      { ref: attemptRef, revision: 0 },
      { ref: runRef, revision: 0 },
      { ref: outboxRef, revision: 0 },
      { ref: replacementRef, revision: 0 },
    ],
    events: [event],
    snapshots: [lease, attempt, run, outbox, replacement],
    outboxIntents: [intent],
  };
}

export type BuildHandoffContextRequestDeps = {
  requestId: string;
  projectId: string;
  goalId?: string;
  taskId?: string;
  planRef: PlanRevisionRef;
  runRef: RunRef;
  attemptRef: TaskAttemptRef;
  handoffPacketRef: HandoffPacketRef;
  workspaceId?: string;
  workspaceRevision?: number;
  submittedAt?: string;
  roleBinding?: RoleBindingRefV1;
  declaredPermissions?: { tools: string[]; writeScope: string[] };
  scope?: { tools: string[]; writeScope: string[] };
  budget?: TaskBudgetV1;
};

export function buildHandoffContextRequest(deps: BuildHandoffContextRequestDeps): HandoffContextRequestV1 {
  const declared = deps.declaredPermissions ?? P106_DECLARED_PERMISSIONS_V1;
  return {
    schemaVersion: 1,
    requestId: deps.requestId,
    projectId: deps.projectId,
    workspaceId: deps.workspaceId ?? P106_WORKSPACE,
    goalId: deps.goalId ?? P106_GOAL,
    taskId: deps.taskId ?? P106_TASK_ID,
    planRef: { ...deps.planRef },
    runRef: { ...deps.runRef },
    attemptRef: { ...deps.attemptRef },
    roleBinding: deps.roleBinding ?? P106_ROLE_BINDING_V1,
    declaredPermissions: { tools: [...declared.tools], writeScope: [...declared.writeScope] },
    scope: deps.scope ?? { tools: [...declared.tools], writeScope: [...declared.writeScope] },
    workspaceSnapshot: { workspaceId: deps.workspaceId ?? P106_WORKSPACE, revision: deps.workspaceRevision ?? 1 },
    handoffPacketRef: { ...deps.handoffPacketRef },
    budget: deps.budget ?? P106_BUDGET_V1,
    submittedAt: deps.submittedAt ?? P106_SCHEMA,
  };
}

/** Evidence ref builder (project-scoped). */
export function buildEvidenceRef(projectId: string, evidenceId: string): EvidenceRef {
  return { aggregateType: "Evidence", projectId, evidenceId };
}

export type P106ScenarioPreview = {
  projectId: string;
  goalId: string;
  planRef: PlanRevisionRef;
  workspaceId: string;
  planSnapshot: PlanRevisionSnapshot | undefined;
  goal: GoalSnapshot | undefined;
  workspace: WorkspaceSnapshot | undefined;
  pinnedCompletionPolicy: import("../governance.js").CompletionPolicyPin | undefined;
  pinnedArchitectureBaseline: import("../governance.js").ArchitectureBaselinePin | undefined;
};
