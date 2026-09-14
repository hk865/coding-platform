/** Control-owned canonical record construction. */
import type { RemediationPlanPatchSnapshot, RemediationTaskV1, RemediationTaskSnapshot, SubmitRemediationPlanPatchCommand, CreateRemediationTaskCommand, AdvanceRemediationTaskCommand } from "../../../contracts/remediation.js";
import { remediationPlanPatchRefFor, remediationTaskRefFor, submitRemediationPlanPatchFingerprint, createRemediationTaskFingerprint, advanceRemediationTaskFingerprint } from "../../../contracts/remediation.js";
import type { RemediationPlanPatchRecordLedgerCommitV1, RemediationTaskRecordLedgerCommitV1, RemediationTaskAdvanceLedgerCommitV1 } from "../../../contracts/ledger.js";



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