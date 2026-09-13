/** Control-owned canonical record construction. */


import type { BindWorkContextCommand, LinkWorkRunCommand, RecordContinuationCommand, RecordExecutionNoteCommand, WorkContextBindingV1 } from "../../../contracts/context-continuity.js";
import { bindWorkContextFingerprint, continuationRecordRefFor, executionNoteRefFor, linkWorkRunFingerprint, recordContinuationFingerprint, recordExecutionNoteFingerprint, workContextRefFor } from "../../../contracts/context-continuity.js";
import type { ContinuationRecordLedgerCommitV1, ExecutionNoteRecordLedgerCommitV1, WorkContextBindLedgerCommitV1, WorkContextLinkLedgerCommitV1 } from "../../../contracts/ledger.js";




// ------------------------------------------------------------------------ //
// Ledger-fold builders (fold-equality targets for the Control handlers)      //
// ------------------------------------------------------------------------ //

export function buildWorkContextBindLedgerCommit(
  command: BindWorkContextCommand,
  deps: { eventId: string; occurredAt: string },
): WorkContextBindLedgerCommitV1 {
  const binding: WorkContextBindingV1 = {
    schemaVersion: 1,
    workId: command.aggregateId,
    projectId: command.identity.projectId,
    workspaceId: command.payload.workspaceId,
    workKind: command.payload.workKind,
    goalId: command.payload.goalId,
    taskId: command.payload.taskId,
    planRef: command.payload.planRef,
    planRevision: command.payload.planRevision,
    roleBindingRef: command.payload.roleBindingRef,
    initialRunRef: command.payload.initialRunRef,
    createdAt: command.submittedAt,
    linkedRunRefs: [{ ...command.payload.initialRunRef }],
    status: "active",
  };
  const ref = workContextRefFor(command.identity.projectId, command.payload.workspaceId, command.aggregateId);
  return {
    commitKind: "work-context-bind",
    schemaVersion: 1,
    identity: command.identity,
    fingerprint: bindWorkContextFingerprint(command),
    expectedVersions: [{ ref, revision: 0 }],
    events: [
      {
        eventId: deps.eventId,
        eventType: "WorkContextBound",
        schemaVersion: 1,
        projectId: command.identity.projectId,
        workspaceId: command.payload.workspaceId,
        aggregateType: "WorkContextBinding",
        aggregateId: command.aggregateId,
        aggregateRevision: 1,
        causationId: command.commandId,
        correlationId: command.correlationId,
        idempotencyKey: command.identity.idempotencyKey,
        actor: { ...command.identity.actor },
        occurredAt: deps.occurredAt,
        payload: {
          workKind: binding.workKind,
          goalId: binding.goalId,
          taskId: binding.taskId,
          planRef: binding.planRef,
          planRevision: binding.planRevision,
          roleBindingRef: binding.roleBindingRef,
          binding,
        },
      },
    ],
    snapshots: [{ ref, revision: 1, schemaVersion: 1, binding }],
    outboxIntents: [],
  };
}


export function buildWorkContextLinkLedgerCommit(
  command: LinkWorkRunCommand,
  deps: { eventId: string; occurredAt: string; currentRevision: number; nextBinding: WorkContextBindingV1 },
): WorkContextLinkLedgerCommitV1 {
  const ref = workContextRefFor(command.identity.projectId, command.payload.workspaceId, command.aggregateId);
  const revision = deps.currentRevision + 1;
  return {
    commitKind: "work-context-link",
    schemaVersion: 1,
    identity: command.identity,
    fingerprint: linkWorkRunFingerprint(command),
    expectedVersions: [{ ref, revision: deps.currentRevision }],
    events: [
      {
        eventId: deps.eventId,
        eventType: "WorkRunLinked",
        schemaVersion: 1,
        projectId: command.identity.projectId,
        workspaceId: command.payload.workspaceId,
        aggregateType: "WorkContextBinding",
        aggregateId: command.aggregateId,
        aggregateRevision: revision,
        causationId: command.commandId,
        correlationId: command.correlationId,
        idempotencyKey: command.identity.idempotencyKey,
        actor: { ...command.identity.actor },
        occurredAt: deps.occurredAt,
        payload: { runRef: { ...command.payload.runRef }, linkedRunRefs: deps.nextBinding.linkedRunRefs.map((r) => ({ ...r })) },
      },
    ],
    snapshots: [{ ref, revision, schemaVersion: 1, binding: deps.nextBinding }],
    outboxIntents: [],
  };
}


export function buildExecutionNoteRecordLedgerCommit(
  command: RecordExecutionNoteCommand,
  deps: { eventId: string; occurredAt: string },
): ExecutionNoteRecordLedgerCommitV1 {
  const note = command.payload.note;
  const ref = executionNoteRefFor(command.identity.projectId, note.workspaceId, note.workId, note.noteId);
  return {
    commitKind: "execution-note-record",
    schemaVersion: 1,
    identity: command.identity,
    fingerprint: recordExecutionNoteFingerprint(command),
    expectedVersions: [{ ref, revision: 0 }],
    events: [
      {
        eventId: deps.eventId,
        eventType: "ExecutionNoteRecorded",
        schemaVersion: 1,
        projectId: command.identity.projectId,
        workspaceId: note.workspaceId,
        aggregateType: "ExecutionNote",
        aggregateId: note.noteId,
        aggregateRevision: 1,
        causationId: command.commandId,
        correlationId: command.correlationId,
        idempotencyKey: command.identity.idempotencyKey,
        actor: { ...command.identity.actor },
        occurredAt: deps.occurredAt,
        payload: { note, recordedAt: deps.occurredAt },
      },
    ],
    snapshots: [{ ref, revision: 1, schemaVersion: 1, note, recordedAt: deps.occurredAt }],
    outboxIntents: [],
  };
}


export function buildContinuationRecordLedgerCommit(
  command: RecordContinuationCommand,
  deps: { eventId: string; occurredAt: string },
): ContinuationRecordLedgerCommitV1 {
  const result = command.payload.result;
  const ref = continuationRecordRefFor(command.identity.projectId, result.workspaceId, result.workId, result.reportId);
  return {
    commitKind: "continuation-record",
    schemaVersion: 1,
    identity: command.identity,
    fingerprint: recordContinuationFingerprint(command),
    expectedVersions: [{ ref, revision: 0 }],
    events: [
      {
        eventId: deps.eventId,
        eventType: "ContinuationRecorded",
        schemaVersion: 1,
        projectId: command.identity.projectId,
        workspaceId: result.workspaceId,
        aggregateType: "ContinuationRecord",
        aggregateId: result.reportId,
        aggregateRevision: 1,
        causationId: command.commandId,
        correlationId: command.correlationId,
        idempotencyKey: command.identity.idempotencyKey,
        actor: { ...command.identity.actor },
        occurredAt: deps.occurredAt,
        payload: { result, recordedAt: deps.occurredAt },
      },
    ],
    snapshots: [{ ref, revision: 1, schemaVersion: 1, result }],
    outboxIntents: [],
  };
}