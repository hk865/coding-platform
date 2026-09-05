/**
 * P1-03 shared fixtures: eligible-plan, role binding ref, dispatch claim/start/
 * run-fact command builders + deterministic fold targets (contract shape the
 * Control handlers must reproduce EXACTLY, given the same ids — same pattern
 * as P1-00/02 fixture builders).
 *
 * Frozen identity choices:
 *   - intentId === attemptId (one intent per attempt);
 *   - claimedAt === requestedAt === occurredAt of the claim event;
 *   - P1-03 at most ONE claim per task (TaskLease CAS @0; expectedRevision 0);
 *   - eligibility fixture: the plan satisfies every P1-02 applyPlan guard.
 */
import type { CommandIdentity } from "../command-event.js";
import { commandIdentityKey } from "../command-event.js";
import type { PlanRevisionDraft, PlanRevisionRef } from "../plan.js";
import type {
  DispatchClaimCommand,
  DispatchIntentV1,
  DispatchOutboxEntrySnapshot,
  DispatchOutboxRef,
  DispatchStartCommand,
  RoleBindingRefV1,
  RunEventRecordedEvent,
  RunFactCommand,
  RunOutcomeUnknownEvent,
  RunRef,
  RunSnapshot,
  TaskAttemptRef,
  TaskAttemptSnapshot,
  TaskBudgetV1,
  TaskClaimedEvent,
  TaskLeaseRef,
  TaskLeaseSnapshot,
  RunStartedEvent,
  RuntimeEventV1,
  RunOutcome,
} from "../dispatch.js";
import {
  dispatchClaimFingerprint,
  dispatchOutboxRefFor,
  dispatchStartFingerprint,
  isTerminalRuntimeEvent,
  runFactFingerprint,
  runRefFor,
  runtimeEventTerminalOutcome,
  taskAttemptRefFor,
  taskLeaseRefFor,
} from "../dispatch.js";
import type { TaskEnvelopeV1, ContextManifestV1 } from "../task-envelope.js";
import type { ArtifactRef } from "../artifact.js";
import type {
  DispatchClaimLedgerCommitV1,
  DispatchStartLedgerCommitV1,
  ExpectedVersion,
  RunFactLedgerCommitV1,
} from "../ledger.js";

// ------------------------------------------------------------------------ //
// Eligible-plan fixture (satisfies P1-02 applyPlan guards)                   //
// ------------------------------------------------------------------------ //

export const DISPATCH_ELIGIBLE_TASK_ID = "task-run-adaptor";
export const DISPATCH_DEPENDENT_TASK_ID = "task-verify-view";
export const DISPATCH_BLOCKED_TASK_ID = "task-blocked";
export const DISPATCH_DEFERRED_TASK_ID = "task-deferred";
export const DISPATCH_GATE_TASK_ID = "gate-dispatch";

export const DISPATCH_PLAN_REVISION_FIXTURE_V1: PlanRevisionDraft = {
  schemaVersion: 1,
  planId: "plan-dispatch-mvp",
  planRevision: 1,
  goalId: "goal-1",
  stages: [{ stageId: "stage-run", title: "运行 Fake Run 并登记事实" }],
  tasks: [
    {
      taskId: DISPATCH_ELIGIBLE_TASK_ID,
      stageId: "stage-run",
      title: "经 DispatchEngine 唯一领取并运行 FakeRuntime",
      requirementLevel: "required",
      taskKind: "work",
      disposition: "active",
      phase: "pending",
      scope: { kind: "stage", stageId: "stage-run" },
    },
    {
      taskId: DISPATCH_DEPENDENT_TASK_ID,
      stageId: "stage-run",
      title: "依赖领取任务，验证视图重建",
      requirementLevel: "required",
      taskKind: "work",
      disposition: "active",
      phase: "pending",
      scope: { kind: "stage", stageId: "stage-run" },
    },
    {
      taskId: DISPATCH_BLOCKED_TASK_ID,
      stageId: "stage-run",
      title: "被 Blocker 阻塞的任务（不可领取）",
      requirementLevel: "required",
      taskKind: "work",
      disposition: "active",
      phase: "blocked",
      scope: { kind: "stage", stageId: "stage-run" },
    },
    {
      taskId: DISPATCH_DEFERRED_TASK_ID,
      stageId: "stage-run",
      title: "deferred（非 desired active）任务（不可领取）",
      requirementLevel: "required",
      taskKind: "work",
      disposition: "deferred",
      phase: "pending",
      scope: { kind: "stage", stageId: "stage-run" },
    },
    {
      taskId: DISPATCH_GATE_TASK_ID,
      title: "DispatchGate：P1-03 验收路径全部通过",
      requirementLevel: "required",
      taskKind: "gate",
      disposition: "active",
      phase: "pending",
      scope: { kind: "goal" },
    },
  ],
  obligations: [
    {
      obligationId: "obl-run",
      title: "eligible Task 被唯一领取并产生可重放 Run facts",
      requirementLevel: "required",
      taskIds: [DISPATCH_ELIGIBLE_TASK_ID],
      verificationRequirements: [
        {
          requirementId: "vr-run",
          requirementLevel: "required",
          kind: "dynamic",
          description: "契约套件与重启证据",
        },
      ],
    },
    {
      obligationId: "obl-view",
      title: "ActiveAgents 与 TaskDetail 可从 Run events 重建",
      requirementLevel: "required",
      taskIds: [DISPATCH_DEPENDENT_TASK_ID],
      verificationRequirements: [
        {
          requirementId: "vr-view",
          requirementLevel: "required",
          kind: "static",
          description: "视图重建与逐字段一致证据",
        },
      ],
    },
    {
      obligationId: "obl-gate",
      title: "P1-03 验收在任务满足判定之前达成",
      requirementLevel: "required",
      taskIds: [DISPATCH_GATE_TASK_ID],
      verificationRequirements: [
        {
          requirementId: "vr-gate",
          requirementLevel: "required",
          kind: "reviewer",
          description: "集成验收逐项对照",
        },
      ],
    },
  ],
  taskHierarchy: {
    parentOf: [
      { parentTaskId: DISPATCH_GATE_TASK_ID, childTaskId: DISPATCH_ELIGIBLE_TASK_ID },
      { parentTaskId: DISPATCH_GATE_TASK_ID, childTaskId: DISPATCH_DEPENDENT_TASK_ID },
      { parentTaskId: DISPATCH_GATE_TASK_ID, childTaskId: DISPATCH_BLOCKED_TASK_ID },
      { parentTaskId: DISPATCH_GATE_TASK_ID, childTaskId: DISPATCH_DEFERRED_TASK_ID },
    ],
  },
  executionDag: {
    dependsOn: [
      {
        taskId: DISPATCH_DEPENDENT_TASK_ID,
        dependsOnId: DISPATCH_ELIGIBLE_TASK_ID,
        requires: { kind: "output-contract", label: "唯一 lease + 可重放 Run events" },
      },
      {
        taskId: DISPATCH_GATE_TASK_ID,
        dependsOnId: DISPATCH_DEPENDENT_TASK_ID,
        requires: { kind: "gate-result", label: "视图重建与验收证据" },
      },
    ],
  },
};

// ------------------------------------------------------------------------ //
// Role binding / budget fixtures                                             //
// ------------------------------------------------------------------------ //

export const ROLE_BINDING_FIXTURE_V1: RoleBindingRefV1 = {
  schemaVersion: 1,
  bindingId: "binding-run-short-lived-v1",
  templateId: "template-short-lived-runner",
  templateRevision: "2026-09-05",
  bindingVersion: 1,
  policyRevision: "auth-policy-runtime-v1",
};

export const BUDGET_FIXTURE_V1: TaskBudgetV1 = {
  tokenBudget: 100_000,
  deadline: "2026-09-06T00:00:00.000Z",
};

export const DECLARED_PERMISSIONS_FIXTURE_V1 = {
  tools: ["read", "write"],
  writeScope: ["src/contracts", "tests/dispatch"],
};

// ------------------------------------------------------------------------ //
// Claim command builder                                                      //
// ------------------------------------------------------------------------ //

export type BuildDispatchClaimDeps = {
  commandId: string;
  correlationId: string;
  submittedAt: string;
  projectId: string;
  actor?: CommandIdentity["actor"];
  idempotencyKey?: string;
  goalId?: string;
  taskId?: string;
  attemptId?: string;
  runId?: string;
  roleBinding?: RoleBindingRefV1;
  declaredPermissions?: { tools: string[]; writeScope: string[] };
  budget?: TaskBudgetV1;
};

export function buildDispatchClaimCommand(
  deps: BuildDispatchClaimDeps,
): DispatchClaimCommand {
  return {
    commandId: deps.commandId,
    commandType: "DispatchClaimTask",
    schemaVersion: 1,
    identity: {
      projectId: deps.projectId,
      actor: deps.actor ?? { kind: "human", id: "user-1" },
      idempotencyKey: deps.idempotencyKey ?? "p1-03-claim",
    },
    aggregateId: deps.taskId ?? DISPATCH_ELIGIBLE_TASK_ID,
    expectedRevision: 0,
    correlationId: deps.correlationId,
    submittedAt: deps.submittedAt,
    payload: {
      goalId: deps.goalId ?? "goal-1",
      attemptId: deps.attemptId ?? "att-run-0001",
      runId: deps.runId ?? "run-0001",
      roleBinding: deps.roleBinding ?? ROLE_BINDING_FIXTURE_V1,
      declaredPermissions: deps.declaredPermissions ?? DECLARED_PERMISSIONS_FIXTURE_V1,
      budget: deps.budget ?? BUDGET_FIXTURE_V1,
    },
  };
}

// ------------------------------------------------------------------------ //
// Claim fold target (deterministic commit)                                   //
// ------------------------------------------------------------------------ //

export function buildClaimedRunSnapshot(
  command: DispatchClaimCommand,
  deps: { planRef: PlanRevisionRef; workspaceId: string; workspaceRevision: number },
): RunSnapshot {
  return {
    ref: runRefFor(command.identity.projectId, command.payload.goalId, command.payload.runId),
    revision: 1,
    schemaVersion: 1,
    task: {
      projectId: command.identity.projectId,
      goalId: command.payload.goalId,
      taskId: command.aggregateId,
    },
    attemptId: command.payload.attemptId,
    planRef: { ...deps.planRef },
    roleBinding: { ...command.payload.roleBinding },
    budget: { ...command.payload.budget },
    workspaceSnapshot: {
      workspaceId: deps.workspaceId,
      revision: deps.workspaceRevision,
    },
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
}

export function buildDispatchIntentFor(
  command: DispatchClaimCommand,
  deps: {
    planRef: PlanRevisionRef;
    workspaceId: string;
    workspaceRevision: number;
    requestedAt: string;
  },
): DispatchIntentV1 {
  const attemptRef = taskAttemptRefFor(
    command.identity.projectId,
    command.payload.goalId,
    command.aggregateId,
    command.payload.attemptId,
  );
  return {
    schemaVersion: 1,
    intentId: command.payload.attemptId,
    projectId: command.identity.projectId,
    workspaceId: deps.workspaceId,
    goalId: command.payload.goalId,
    taskId: command.aggregateId,
    planRef: { ...deps.planRef },
    attemptRef,
    runRef: runRefFor(command.identity.projectId, command.payload.goalId, command.payload.runId),
    roleBinding: { ...command.payload.roleBinding },
    workspaceSnapshot: {
      workspaceId: deps.workspaceId,
      revision: deps.workspaceRevision,
    },
    declaredPermissions: {
      tools: [...command.payload.declaredPermissions.tools],
      writeScope: [...command.payload.declaredPermissions.writeScope],
    },
    budget: { ...command.payload.budget },
    requestedAt: deps.requestedAt,
    correlationId: command.correlationId,
  };
}

export function buildDispatchClaimLedgerCommit(
  command: DispatchClaimCommand,
  deps: {
    eventId: string;
    occurredAt: string;
    workspaceId: string;
    planRef: PlanRevisionRef;
    workspaceRevision: number;
  },
): DispatchClaimLedgerCommitV1 {
  const leaseRef: TaskLeaseRef = taskLeaseRefFor(
    command.identity.projectId,
    command.payload.goalId,
    command.aggregateId,
  );
  const attemptRef: TaskAttemptRef = taskAttemptRefFor(
    command.identity.projectId,
    command.payload.goalId,
    command.aggregateId,
    command.payload.attemptId,
  );
  const runRef: RunRef = runRefFor(
    command.identity.projectId,
    command.payload.goalId,
    command.payload.runId,
  );
  const outboxRef: DispatchOutboxRef = dispatchOutboxRefFor(
    command.identity.projectId,
    command.payload.goalId,
    command.aggregateId,
    command.payload.attemptId,
  );
  const planRef = { ...deps.planRef };
  const intent = buildDispatchIntentFor(command, {
    planRef,
    workspaceId: deps.workspaceId,
    workspaceRevision: deps.workspaceRevision,
    requestedAt: deps.occurredAt,
  });
  const lease: TaskLeaseSnapshot = {
    ref: leaseRef,
    revision: 1,
    schemaVersion: 1,
    holderRunId: command.payload.runId,
    attemptId: command.payload.attemptId,
    grantedAt: deps.occurredAt,
    expiresAt: null,
  };
  const attempt: TaskAttemptSnapshot = {
    ref: attemptRef,
    revision: 1,
    schemaVersion: 1,
    runId: command.payload.runId,
    planRef,
    status: "claimed",
    startedAt: null,
    endedAt: null,
    endOutcome: null,
  };
  const run = buildClaimedRunSnapshot(command, {
    planRef,
    workspaceId: deps.workspaceId,
    workspaceRevision: deps.workspaceRevision,
  });
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
  const event: TaskClaimedEvent = {
    eventId: deps.eventId,
    eventType: "TaskClaimed",
    schemaVersion: 1,
    projectId: command.identity.projectId,
    workspaceId: deps.workspaceId,
    aggregateType: "TaskLease",
    aggregateId: command.aggregateId,
    aggregateRevision: 1,
    causationId: command.commandId,
    correlationId: command.correlationId,
    idempotencyKey: command.identity.idempotencyKey,
    actor: { ...command.identity.actor },
    occurredAt: deps.occurredAt,
    payload: {
      goalId: command.payload.goalId,
      taskId: command.aggregateId,
      attemptRef,
      runRef,
      planRef,
      roleBinding: { ...command.payload.roleBinding },
      declaredPermissions: {
        tools: [...command.payload.declaredPermissions.tools],
        writeScope: [...command.payload.declaredPermissions.writeScope],
      },
      budget: { ...command.payload.budget },
      intentId: command.payload.attemptId,
      claimedAt: deps.occurredAt,
    },
  };
  return {
    commitKind: "dispatch-claim",
    schemaVersion: 1,
    identity: { ...command.identity },
    fingerprint: dispatchClaimFingerprint(command),
    expectedVersions: [
      { ref: leaseRef, revision: 0 },
      { ref: attemptRef, revision: 0 },
      { ref: runRef, revision: 0 },
      { ref: outboxRef, revision: 0 },
    ],
    events: [event],
    snapshots: [lease, attempt, run, outbox],
    outboxIntents: [intent],
  };
}

export function dispatchClaimIdentityKey(command: DispatchClaimCommand): string {
  return commandIdentityKey(command.identity);
}

// ------------------------------------------------------------------------ //
// Start command builder + fold target                                        //
// ------------------------------------------------------------------------ //

export function buildDispatchStartCommand(
  deps: {
    commandId: string;
    correlationId: string;
    submittedAt: string;
    projectId: string;
    actor?: CommandIdentity["actor"];
    idempotencyKey?: string;
    runId: string;
    expectedRevision?: number;
    envelope: TaskEnvelopeV1;
    manifest: ContextManifestV1;
  },
): DispatchStartCommand {
  return {
    commandId: deps.commandId,
    commandType: "DispatchStartRun",
    schemaVersion: 1,
    identity: {
      projectId: deps.projectId,
      actor: deps.actor ?? { kind: "human", id: "user-1" },
      idempotencyKey: deps.idempotencyKey ?? "p1-03-start",
    },
    aggregateId: deps.runId,
    expectedRevision: deps.expectedRevision ?? 1,
    correlationId: deps.correlationId,
    submittedAt: deps.submittedAt,
    payload: { envelope: deps.envelope, manifest: deps.manifest },
  };
}

export function buildDispatchStartLedgerCommit(
  command: DispatchStartCommand,
  deps: {
    eventId: string;
    occurredAt: string;
    workspaceId: string;
    priorRun: RunSnapshot;
    priorAttempt: TaskAttemptSnapshot;
    priorOutbox: DispatchOutboxEntrySnapshot;
  },
): DispatchStartLedgerCommitV1 {
  const run: RunSnapshot = {
    ...deps.priorRun,
    revision: 2,
    status: "running",
    envelope: { ...command.payload.envelope },
    startedAt: deps.occurredAt,
  };
  const attempt: TaskAttemptSnapshot = { ...deps.priorAttempt, revision: 2, status: "started", startedAt: deps.occurredAt };
  const outbox: DispatchOutboxEntrySnapshot = { ...deps.priorOutbox, revision: 2, status: "started", startedAt: deps.occurredAt };
  const event: RunStartedEvent = {
    eventId: deps.eventId,
    eventType: "RunStarted",
    schemaVersion: 1,
    projectId: run.ref.projectId,
    workspaceId: deps.workspaceId,
    aggregateType: "Run",
    aggregateId: run.ref.runId,
    aggregateRevision: 2,
    causationId: command.commandId,
    correlationId: command.correlationId,
    idempotencyKey: command.identity.idempotencyKey,
    actor: { ...command.identity.actor },
    occurredAt: deps.occurredAt,
    payload: {
      taskId: run.task.taskId,
      attemptId: run.attemptId,
      envelope: { ...command.payload.envelope },
      manifest: { ...command.payload.manifest },
      startedAt: deps.occurredAt,
    },
  };
  return {
    commitKind: "dispatch-start",
    schemaVersion: 1,
    identity: { ...command.identity },
    fingerprint: dispatchStartFingerprint(command),
    expectedVersions: [
      { ref: run.ref, revision: 1 },
      { ref: attempt.ref, revision: 1 },
      { ref: outbox.ref, revision: 1 },
    ],
    events: [event],
    snapshots: [run, attempt, outbox],
    outboxIntents: [],
  };
}

// ------------------------------------------------------------------------ //
// Envelope fixture                                                           //
// ------------------------------------------------------------------------ //

export function buildEnvelopeFixture(
  deps: {
    envelopeId: string;
    projectId: string;
    workspaceId: string;
    goalId: string;
    taskId: string;
    runId: string;
    attemptId: string;
    planRef: PlanRevisionRef;
    workspaceRevision: number;
    bundleRef: ArtifactRef;
    roleBinding?: RoleBindingRefV1;
    budget?: TaskBudgetV1;
    permissions?: { policyRevision: string; tools: string[]; writeScope: string[] };
    sourceRefs?: { kind: "plan-revision" | "workspace" | "governance" | "artifact"; refId: string; revision: string; digest?: string }[];
  },
): TaskEnvelopeV1 {
  return {
    schemaVersion: 1,
    envelopeId: deps.envelopeId,
    projectId: deps.projectId,
    workspaceId: deps.workspaceId,
    goalId: deps.goalId,
    taskId: deps.taskId,
    runRef: runRefFor(deps.projectId, deps.goalId, deps.runId),
    attemptRef: taskAttemptRefFor(deps.projectId, deps.goalId, deps.taskId, deps.attemptId),
    planRef: { ...deps.planRef },
    roleBinding: deps.roleBinding ?? ROLE_BINDING_FIXTURE_V1,
    workspaceSnapshot: { workspaceId: deps.workspaceId, revision: deps.workspaceRevision },
    permissions: deps.permissions ?? {
      policyRevision: ROLE_BINDING_FIXTURE_V1.policyRevision,
      tools: [...DECLARED_PERMISSIONS_FIXTURE_V1.tools],
      writeScope: [...DECLARED_PERMISSIONS_FIXTURE_V1.writeScope],
    },
    budget: deps.budget ?? BUDGET_FIXTURE_V1,
    sourceRefs: deps.sourceRefs ?? [
      { kind: "plan-revision", refId: deps.planRef.planId, revision: "1", digest: deps.planRef.planId },
    ],
    bundleRef: deps.bundleRef,
  };
}

export function buildManifestFixture(deps: {
  workspaceId: string;
  workspaceRevision: number;
  planRef: PlanRevisionRef;
}): ContextManifestV1 {
  return {
    schemaVersion: 1,
    selectedRefs: [
      { kind: "plan-revision" as const, refId: deps.planRef.planId, revision: "1", digest: deps.planRef.planId },
      { kind: "workspace" as const, refId: deps.workspaceId, revision: String(deps.workspaceRevision) },
    ],
    gaps: [],
    freshness: {
      workspaceSnapshot: { workspaceId: deps.workspaceId, revision: deps.workspaceRevision },
      planRef: { ...deps.planRef },
    },
  };
}

// ------------------------------------------------------------------------ //
// Run-fact command + fold targets                                            //
// ------------------------------------------------------------------------ //

export type BuildRunFactDeps = {
  commandId: string;
  correlationId: string;
  submittedAt: string;
  projectId: string;
  actor?: CommandIdentity["actor"];
  idempotencyKey?: string;
  runId: string;
  expectedRevision: number;
  fact: { kind: "runtime_event"; event: RuntimeEventV1 } | { kind: "outcome_unknown"; reason: string };
};

export function buildRunFactCommand(deps: BuildRunFactDeps): RunFactCommand {
  return {
    commandId: deps.commandId,
    commandType: "RunFact",
    schemaVersion: 1,
    identity: {
      projectId: deps.projectId,
      actor: deps.actor ?? { kind: "human", id: "user-1" },
      idempotencyKey: deps.idempotencyKey ?? "p1-03-runfact",
    },
    aggregateId: deps.runId,
    expectedRevision: deps.expectedRevision,
    correlationId: deps.correlationId,
    submittedAt: deps.submittedAt,
    payload: { fact: deps.fact },
  };
}

/** Pure fold: the Run snapshot after one accepted runtime event. */
export function nextRunSnapshotForRuntimeEvent(
  current: RunSnapshot,
  event: RuntimeEventV1,
): RunSnapshot {
  const terminal = isTerminalRuntimeEvent(event);
  const next: RunSnapshot = {
    ...current,
    status: terminal ? "ended" : "running",
    outcome: terminal ? runtimeEventTerminalOutcome(event) : current.outcome,
    exitCode: event.payload.kind === "completed" ? event.payload.exitCode : current.exitCode,
    lastEventSeq: event.sequence,
    lastRuntimeEventId: event.eventId,
    lastFactEventId: "FILLED-BY-COMMIT",
    endedAt: terminal ? event.occurredAt : current.endedAt,
  };
  return next;
}

/** Pure fold: the Run snapshot after an outcome_unknown fact. */
export function nextRunSnapshotForOutcomeUnknown(
  current: RunSnapshot,
  deps: { observedAt: string },
): RunSnapshot {
  return {
    ...current,
    status: "ended",
    outcome: "outcome_unknown",
    endedAt: deps.observedAt,
  };
}

export function nextAttemptSnapshotForTerminal(
  current: TaskAttemptSnapshot,
  outcome: RunOutcome,
  endedAt: string,
): TaskAttemptSnapshot {
  return { ...current, revision: 3, status: "ended", endedAt, endOutcome: outcome };
}

export function nextOutboxSnapshotForTerminal(
  current: DispatchOutboxEntrySnapshot,
  doneAt: string,
): DispatchOutboxEntrySnapshot {
  return { ...current, revision: 3, status: "done", doneAt };
}

export function buildRunEventRecordedCommit(
  command: RunFactCommand,
  deps: {
    eventId: string;
    occurredAt: string;
    workspaceId: string;
    currentRun: RunSnapshot;
    currentAttempt: TaskAttemptSnapshot;
    currentOutbox: DispatchOutboxEntrySnapshot;
  },
): RunFactLedgerCommitV1 {
  const event = command.payload.fact;
  if (event.kind !== "runtime_event") throw new Error("expected runtime_event fact");
  const runtimeEvent = event.event;
  const terminal = isTerminalRuntimeEvent(runtimeEvent);
  const run = nextRunSnapshotForRuntimeEvent(deps.currentRun, runtimeEvent);
  run.lastFactEventId = deps.eventId;
  const snapshots: (RunSnapshot | TaskAttemptSnapshot | DispatchOutboxEntrySnapshot)[] = [run];
  const expectedVersions: ExpectedVersion[] = [{ ref: run.ref, revision: run.revision - 1 }];
  if (terminal) {
    const outcome = runtimeEventTerminalOutcome(runtimeEvent)!;
    const attempt = nextAttemptSnapshotForTerminal(deps.currentAttempt, outcome, runtimeEvent.occurredAt);
    const outbox = nextOutboxSnapshotForTerminal(deps.currentOutbox, runtimeEvent.occurredAt);
    snapshots.push(attempt, outbox);
    expectedVersions.push(
      { ref: attempt.ref, revision: attempt.revision - 1 },
      { ref: outbox.ref, revision: outbox.revision - 1 },
    );
  }
  const domainEvent: RunEventRecordedEvent = {
    eventId: deps.eventId,
    eventType: "RunEventRecorded",
    schemaVersion: 1,
    projectId: deps.currentRun.ref.projectId,
    workspaceId: deps.workspaceId,
    aggregateType: "Run",
    aggregateId: deps.currentRun.ref.runId,
    aggregateRevision: run.revision,
    causationId: command.commandId,
    correlationId: command.correlationId,
    idempotencyKey: command.identity.idempotencyKey,
    actor: { ...command.identity.actor },
    occurredAt: deps.occurredAt,
    payload: { taskId: deps.currentRun.task.taskId, runtimeEvent },
  };
  return {
    commitKind: "run-fact",
    schemaVersion: 1,
    identity: { ...command.identity },
    fingerprint: runFactFingerprint(command),
    expectedVersions,
    events: [domainEvent],
    snapshots,
    outboxIntents: [],
  };
}

export function buildRunOutcomeUnknownCommit(
  command: RunFactCommand,
  deps: {
    eventId: string;
    occurredAt: string;
    workspaceId: string;
    currentRun: RunSnapshot;
    currentAttempt: TaskAttemptSnapshot;
    currentOutbox: DispatchOutboxEntrySnapshot;
  },
): RunFactLedgerCommitV1 {
  const fact = command.payload.fact;
  if (fact.kind !== "outcome_unknown") throw new Error("expected outcome_unknown fact");
  const run = nextRunSnapshotForOutcomeUnknown(deps.currentRun, { observedAt: deps.occurredAt });
  const attempt = nextAttemptSnapshotForTerminal(deps.currentAttempt, "outcome_unknown", deps.occurredAt);
  const outbox = nextOutboxSnapshotForTerminal(deps.currentOutbox, deps.occurredAt);
  const domainEvent: RunOutcomeUnknownEvent = {
    eventId: deps.eventId,
    eventType: "RunOutcomeUnknown",
    schemaVersion: 1,
    projectId: deps.currentRun.ref.projectId,
    workspaceId: deps.workspaceId,
    aggregateType: "Run",
    aggregateId: deps.currentRun.ref.runId,
    aggregateRevision: run.revision,
    causationId: command.commandId,
    correlationId: command.correlationId,
    idempotencyKey: command.identity.idempotencyKey,
    actor: { ...command.identity.actor },
    occurredAt: deps.occurredAt,
    payload: { taskId: deps.currentRun.task.taskId, reason: fact.reason, observedAt: deps.occurredAt },
  };
  return {
    commitKind: "run-fact",
    schemaVersion: 1,
    identity: { ...command.identity },
    fingerprint: runFactFingerprint(command),
    expectedVersions: [
      { ref: run.ref, revision: run.revision - 1 },
      { ref: attempt.ref, revision: attempt.revision - 1 },
      { ref: outbox.ref, revision: outbox.revision - 1 },
    ],
    events: [domainEvent],
    snapshots: [run, attempt, outbox],
    outboxIntents: [],
  };
}

// ------------------------------------------------------------------------ //
// FakeRuntime script fixture                                                 //
// ------------------------------------------------------------------------ //

export type FakeRuntimeScriptItem = {
  sequence: number;
  eventType: "run_started" | "run_completed" | "run_crashed" | "run_cancelled" | "run_budget_exhausted";
  payload: RuntimeEventV1["payload"];
  occurredAt: string;
};

export type FakeRuntimeScriptV1 = {
  schemaVersion: 1;
  items: FakeRuntimeScriptItem[];
};

export const FAKE_RUNTIME_SCRIPT_COMPLETED_V1: FakeRuntimeScriptV1 = {
  schemaVersion: 1,
  items: [
    { sequence: 1, eventType: "run_started", payload: { kind: "started", startedAt: "2026-09-05T12:00:01.000Z" }, occurredAt: "2026-09-05T12:00:01.000Z" },
    { sequence: 2, eventType: "run_completed", payload: { kind: "completed", exitCode: 0 }, occurredAt: "2026-09-05T12:00:03.000Z" },
  ],
};

export const FAKE_RUNTIME_SCRIPT_CRASHED_V1: FakeRuntimeScriptV1 = {
  schemaVersion: 1,
  items: [
    { sequence: 1, eventType: "run_started", payload: { kind: "started", startedAt: "2026-09-05T12:00:01.000Z" }, occurredAt: "2026-09-05T12:00:01.000Z" },
    { sequence: 2, eventType: "run_crashed", payload: { kind: "crashed", error: "runtime trap" }, occurredAt: "2026-09-05T12:00:02.000Z" },
  ],
};

export const FAKE_RUNTIME_SCRIPT_BUDGET_EXHAUSTED_V1: FakeRuntimeScriptV1 = {
  schemaVersion: 1,
  items: [
    { sequence: 1, eventType: "run_started", payload: { kind: "started", startedAt: "2026-09-05T12:00:01.000Z" }, occurredAt: "2026-09-05T12:00:01.000Z" },
    { sequence: 2, eventType: "run_budget_exhausted", payload: { kind: "budget_exhausted", exhaustedAt: "2026-09-05T12:00:02.000Z" }, occurredAt: "2026-09-05T12:00:02.000Z" },
  ],
};

/** Rebase a script onto a run: stamps runRef + deterministic event ids. */
export function rebaseScriptForRun(
  script: FakeRuntimeScriptV1,
  runRef: RunRef,
): RuntimeEventV1[] {
  return script.items.map((item) => ({
    eventType: item.eventType,
    schemaVersion: 1 as const,
    eventId: "rt-" + runRef.runId + "-" + String(item.sequence).padStart(4, "0"),
    runRef: { ...runRef },
    sequence: item.sequence,
    occurredAt: item.occurredAt,
    payload: item.payload,
  }));
}
