/** P1-13 shared fixtures: remediation patch/task builders + ledger folds. */
import type { CommandIdentity } from "../command-event.js";
import type { RemediationPlanPatchV1, RemediationPlanPatchSnapshot, RemediationTaskV1, RemediationTaskSnapshot, RemediationDeduplicationKeyV1, SubmitRemediationPlanPatchCommand, CreateRemediationTaskCommand, AdvanceRemediationTaskCommand } from "../remediation.js";
import { remediationDedupKeyOf, remediationPlanPatchRefFor, remediationTaskRefFor, submitRemediationPlanPatchFingerprint, createRemediationTaskFingerprint, advanceRemediationTaskFingerprint } from "../remediation.js";
import type { RemediationPlanPatchRecordLedgerCommitV1, RemediationTaskRecordLedgerCommitV1, RemediationTaskAdvanceLedgerCommitV1 } from "../ledger.js";
import { P113_SCHEMA, P113_PROJECT, p113PolicyPin } from "./architecture-evolution-policy-fixtures.js";

export const P113_WORKSPACE = "ws-shared";
export const P113_GOAL = "goal-1";
export const P113_FINDING = "finding-p113-1";
export const P113_PATCH = "patch-p113-1";
export const P113_TASK = "task-p113-1";

export function p113FindingRef(projectId: string = P113_PROJECT) {
  return { aggregateType: "ArchitectureFinding" as const, projectId, workspaceId: P113_WORKSPACE, findingId: P113_FINDING };
}
export function p113PatchRef(projectId: string = P113_PROJECT) {
  return remediationPlanPatchRefFor(projectId, P113_WORKSPACE, P113_PATCH);
}
export function p113TaskRef(projectId: string = P113_PROJECT) {
  return remediationTaskRefFor(projectId, P113_WORKSPACE, P113_TASK);
}
export function p113DedupKey(workspaceRevision = 2): RemediationDeduplicationKeyV1 {
  return { schemaVersion: 1, projectId: P113_PROJECT, workspaceId: P113_WORKSPACE, findingId: P113_FINDING, policyRevision: 1, workspaceRevision };
}

export function buildP113PlanPatchV1(overrides: Partial<RemediationPlanPatchV1> = {}): RemediationPlanPatchV1 {
  return {
    schemaVersion: 1,
    patchId: P113_PATCH,
    projectId: P113_PROJECT,
    workspaceId: P113_WORKSPACE,
    findingRef: p113FindingRef(),
    findingId: P113_FINDING,
    workspaceRevision: 2,
    policyPin: p113PolicyPin(),
    planBaselinePin: { ref: { aggregateType: "ArchitectureBaselineRevision" as const, projectId: P113_PROJECT, baselineId: "architecture-baseline-1", revision: 1 }, digest: "baseline-digest-fixed" },
    completionPolicyPin: { ref: { aggregateType: "CompletionPolicyRevision" as const, projectId: P113_PROJECT, policyId: "completion-policy-1", revision: 1 }, digest: "policy-digest-fixed" },
    verdict: { allowed: true, reasons: [] },
    proposedPatch: { changedPaths: ["src/control/widget.ts"], changeSummary: "局部修复：移除重复分支", bodyRef: null },
    ...overrides,
  };
}

export function buildP113TaskV1(status: RemediationTaskV1["status"] = "pending", overrides: Partial<RemediationTaskV1> = {}): RemediationTaskV1 {
  return {
    schemaVersion: 1,
    taskId: P113_TASK,
    projectId: P113_PROJECT,
    workspaceId: P113_WORKSPACE,
    dedupKey: p113DedupKey(),
    findingRef: p113FindingRef(),
    patchRef: p113PatchRef(),
    status,
    writerRunRef: null,
    evidenceRefs: [],
    planBaselinePin: { ref: { aggregateType: "ArchitectureBaselineRevision" as const, projectId: P113_PROJECT, baselineId: "architecture-baseline-1", revision: 1 }, digest: "baseline-digest-fixed" },
    completionPolicyPin: { ref: { aggregateType: "CompletionPolicyRevision" as const, projectId: P113_PROJECT, policyId: "completion-policy-1", revision: 1 }, digest: "policy-digest-fixed" },
    result: null,
    createdAt: P113_SCHEMA,
    updatedAt: P113_SCHEMA,
    ...overrides,
  };
}

export function buildP113SubmitPatchCommand(patch: RemediationPlanPatchV1, deps: { commandId: string; actor?: CommandIdentity["actor"] }): SubmitRemediationPlanPatchCommand {
  return { commandId: deps.commandId, commandType: "SubmitRemediationPlanPatch", schemaVersion: 1, identity: { projectId: patch.projectId, actor: deps.actor ?? { kind: "system", id: "architecture-reconciler" }, idempotencyKey: deps.commandId + "-idem" }, aggregateId: patch.patchId, expectedRevision: 0, correlationId: deps.commandId + "-corr", submittedAt: P113_SCHEMA, payload: { patch } };
}

export function buildP113CreateTaskCommand(patchRef: ReturnType<typeof p113PatchRef>, deps: { commandId: string; taskId?: string }): CreateRemediationTaskCommand {
  return { commandId: deps.commandId, commandType: "CreateRemediationTask", schemaVersion: 1, identity: { projectId: P113_PROJECT, actor: { kind: "system", id: "control-engine" }, idempotencyKey: deps.commandId + "-idem" }, aggregateId: deps.taskId ?? P113_TASK, expectedRevision: 0, correlationId: deps.commandId + "-corr", submittedAt: P113_SCHEMA, payload: { patchRef, taskId: deps.taskId ?? P113_TASK } };
}

export function buildP113AdvanceTaskCommand(taskId: string, expectedRevision: number, payload: { status: "writing" | "verifying" | "resolved" | "failed" | "blocked"; writerRunRef?: import("../dispatch.js").RunRef | null; evidenceRefs?: import("../evidence.js").EvidenceRef[]; result?: RemediationTaskV1["result"] }, deps: { commandId: string }): AdvanceRemediationTaskCommand {
  return { commandId: deps.commandId, commandType: "AdvanceRemediationTask", schemaVersion: 1, identity: { projectId: P113_PROJECT, actor: { kind: "system", id: "control-engine" }, idempotencyKey: deps.commandId + "-idem" }, aggregateId: taskId, expectedRevision, correlationId: deps.commandId + "-corr", submittedAt: P113_SCHEMA, payload: { status: payload.status, writerRunRef: payload.writerRunRef ?? null, evidenceRefs: payload.evidenceRefs ?? [], result: payload.result ?? null } };
}

// ------------------------------------------------------------------------ //
// Ledger folds                                                              //
// ------------------------------------------------------------------------ //

export function buildP113PlanPatchRecordCommit(command: SubmitRemediationPlanPatchCommand, deps: { eventId: string; occurredAt: string; recordedAt?: string }): RemediationPlanPatchRecordLedgerCommitV1 {
  const patch = command.payload.patch;
  const snap: RemediationPlanPatchSnapshot = { ref: remediationPlanPatchRefFor(patch.projectId, patch.workspaceId, patch.patchId), revision: 1, schemaVersion: 1, patch, recordedAt: deps.recordedAt ?? deps.occurredAt };
  return {
    commitKind: "remediation-plan-patch-record",
    schemaVersion: 1,
    identity: { ...command.identity },
    fingerprint: submitRemediationPlanPatchFingerprint(command),
    expectedVersions: [{ ref: snap.ref, revision: 0 }],
    events: [{
      eventId: deps.eventId,
      eventType: "RemediationPlanPatchRecorded",
      schemaVersion: 1,
      projectId: patch.projectId,
      workspaceId: patch.workspaceId,
      aggregateType: "RemediationPlanPatch",
      aggregateId: patch.patchId,
      aggregateRevision: 1,
      causationId: command.commandId,
      correlationId: command.correlationId,
      idempotencyKey: command.identity.idempotencyKey,
      actor: { ...command.identity.actor },
      occurredAt: deps.occurredAt,
      payload: { patch, recordedAt: snap.recordedAt },
    }],
    snapshots: [snap],
    outboxIntents: [],
  };
}

export function buildP113TaskRecordCommit(command: CreateRemediationTaskCommand, deps: { eventId: string; occurredAt: string; task: RemediationTaskV1 }): RemediationTaskRecordLedgerCommitV1 {
  const snap: RemediationTaskSnapshot = { ref: remediationTaskRefFor(taskProject(deps.task), deps.task.workspaceId, deps.task.taskId), revision: 1, schemaVersion: 1, task: deps.task };
  return {
    commitKind: "remediation-task-record",
    schemaVersion: 1,
    identity: { ...command.identity },
    fingerprint: createRemediationTaskFingerprint(command),
    expectedVersions: [{ ref: snap.ref, revision: 0 }],
    events: [{
      eventId: deps.eventId,
      eventType: "RemediationTaskCreated",
      schemaVersion: 1,
      projectId: deps.task.projectId,
      workspaceId: deps.task.workspaceId,
      aggregateType: "RemediationTask",
      aggregateId: deps.task.taskId,
      aggregateRevision: 1,
      causationId: command.commandId,
      correlationId: command.correlationId,
      idempotencyKey: command.identity.idempotencyKey,
      actor: { ...command.identity.actor },
      occurredAt: deps.occurredAt,
      payload: { task: deps.task },
    }],
    snapshots: [snap],
    outboxIntents: [],
  };
}

function taskProject(task: RemediationTaskV1): string {
  return task.projectId;
}

export function buildP113TaskAdvanceCommit(command: AdvanceRemediationTaskCommand, deps: { eventId: string; occurredAt: string; nextRevision: number; task: RemediationTaskV1 }): RemediationTaskAdvanceLedgerCommitV1 {
  const snap: RemediationTaskSnapshot = { ref: remediationTaskRefFor(deps.task.projectId, deps.task.workspaceId, deps.task.taskId), revision: deps.nextRevision, schemaVersion: 1, task: deps.task };
  return {
    commitKind: "remediation-task-advance",
    schemaVersion: 1,
    identity: { ...command.identity },
    fingerprint: advanceRemediationTaskFingerprint(command),
    expectedVersions: [{ ref: snap.ref, revision: deps.nextRevision - 1 }],
    events: [{
      eventId: deps.eventId,
      eventType: "RemediationTaskAdvanced",
      schemaVersion: 1,
      projectId: deps.task.projectId,
      workspaceId: deps.task.workspaceId,
      aggregateType: "RemediationTask",
      aggregateId: deps.task.taskId,
      aggregateRevision: deps.nextRevision,
      causationId: command.commandId,
      correlationId: command.correlationId,
      idempotencyKey: command.identity.idempotencyKey,
      actor: { ...command.identity.actor },
      occurredAt: deps.occurredAt,
      payload: { task: deps.task },
    }],
    snapshots: [snap],
    outboxIntents: [],
  };
}

export function p113DedupKeyHex(workspaceRevision = 2): string {
  return remediationDedupKeyOf(p113DedupKey(workspaceRevision));
}
