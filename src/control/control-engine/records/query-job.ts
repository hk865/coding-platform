/** Control-owned canonical record construction. */
import type { QueryJobV1, QueryJobSnapshot, QueryRunV1, QueryRunSnapshot, QueryRunRef } from "../../../contracts/query-job.js";
import { queryJobRefFor, queryRunRefFor, queryJobAnswerRefFor, submitQueryJobFingerprint, recordQueryAnswerFingerprint, closeQueryJobFingerprint } from "../../../contracts/query-job.js";
import type { QueryJobRecordLedgerCommitV1, QueryAnswerRecordLedgerCommitV1, QueryCloseRecordLedgerCommitV1 } from "../../../contracts/ledger.js";
import type { SubmitQueryJobCommand, RecordQueryAnswerCommand, CloseQueryJobCommand } from "../../../contracts/query-job.js";



export function buildQueryJobRecordCommit(command: SubmitQueryJobCommand, deps: { eventId: string; occurredAt: string }): QueryJobRecordLedgerCommitV1 {
  const projectId = command.identity.projectId;
  const workspaceId = command.payload.intent.workspaceId;
  const job: QueryJobV1 = {
    schemaVersion: 1, queryJobId: command.aggregateId, projectId, workspaceId,
    goalId: command.payload.intent.goalId, intent: command.payload.intent,
    status: "pending", runRef: queryRunRefFor(projectId, workspaceId, command.aggregateId, command.payload.runId),
    answerRefs: [], closeReason: null, submittedAt: command.submittedAt, updatedAt: command.submittedAt,
  };
  const run: QueryRunV1 = { schemaVersion: 1, queryJobRef: queryJobRefFor(projectId, workspaceId, job.queryJobId), runId: command.payload.runId, status: "pending", startedAt: null, endedAt: null, outcome: null };
  const jobSnap: QueryJobSnapshot = { ref: queryJobRefFor(command.identity.projectId, job.workspaceId, job.queryJobId), revision: 1, schemaVersion: 1, job };
  const runRef = queryRunRefFor(command.identity.projectId, job.workspaceId, job.queryJobId, command.payload.runId);
  const runSnap: QueryRunSnapshot = { ref: runRef, revision: 1, schemaVersion: 1, run };
  return { commitKind: "query-job-record", schemaVersion: 1, identity: command.identity, fingerprint: submitQueryJobFingerprint(command), expectedVersions: [{ ref: jobSnap.ref, revision: 0 }, { ref: runSnap.ref, revision: 0 }], events: [
    { eventId: deps.eventId, eventType: "QueryJobSubmitted", schemaVersion: 1, projectId: command.identity.projectId, workspaceId: job.workspaceId, aggregateType: "QueryJob", aggregateId: job.queryJobId, aggregateRevision: 1, causationId: command.commandId, correlationId: command.correlationId, idempotencyKey: command.identity.idempotencyKey, actor: { ...command.identity.actor }, occurredAt: deps.occurredAt, payload: { job } },
    { eventId: deps.eventId + "-run", eventType: "QueryRunStarted", schemaVersion: 1, projectId: command.identity.projectId, workspaceId: job.workspaceId, aggregateType: "QueryRun", aggregateId: runRef.runId, aggregateRevision: 1, causationId: command.commandId, correlationId: command.correlationId, idempotencyKey: command.identity.idempotencyKey, actor: { ...command.identity.actor }, occurredAt: deps.occurredAt, payload: { run } },
  ], snapshots: [jobSnap, runSnap], outboxIntents: [] };
}


export function buildQueryAnswerRecordCommit(command: RecordQueryAnswerCommand, deps: { eventId: string; occurredAt: string; nextRevision: number; job: QueryJobV1; run: QueryRunV1 }): QueryAnswerRecordLedgerCommitV1 {
  const runRef: QueryRunRef = queryRunRefFor(command.identity.projectId, deps.job.workspaceId, deps.job.queryJobId, deps.run.runId);
  const answer = command.payload.answer;
  const job = deps.job;
  const run = deps.run;
  return { commitKind: "query-answer-record", schemaVersion: 1, identity: command.identity, fingerprint: recordQueryAnswerFingerprint(command), expectedVersions: [{ ref: queryJobAnswerRefFor(command.identity.projectId, job.workspaceId, job.queryJobId, answer.answerId), revision: 0 }, { ref: queryJobRefFor(command.identity.projectId, job.workspaceId, job.queryJobId), revision: deps.nextRevision - 1 }, { ref: runRef, revision: deps.nextRevision - 1 }], events: [{
    eventId: deps.eventId, eventType: "QueryJobAnswerRecorded", schemaVersion: 1, projectId: command.identity.projectId, workspaceId: job.workspaceId, aggregateType: "QueryJob", aggregateId: job.queryJobId, aggregateRevision: deps.nextRevision, causationId: command.commandId, correlationId: command.correlationId, idempotencyKey: command.identity.idempotencyKey, actor: { ...command.identity.actor }, occurredAt: deps.occurredAt, payload: { answer, job, run },
  }], snapshots: [{ ref: queryJobAnswerRefFor(command.identity.projectId, job.workspaceId, job.queryJobId, answer.answerId), revision: 1, schemaVersion: 1, answer }, { ref: queryJobRefFor(command.identity.projectId, job.workspaceId, job.queryJobId), revision: deps.nextRevision, schemaVersion: 1, job }, { ref: runRef, revision: deps.nextRevision, schemaVersion: 1, run }], outboxIntents: [] };
}


export function buildQueryCloseRecordCommit(command: CloseQueryJobCommand, deps: { eventId: string; occurredAt: string; nextRevision: number; job: QueryJobV1; run: QueryRunV1 }): QueryCloseRecordLedgerCommitV1 {
  const runRef: QueryRunRef = queryRunRefFor(command.identity.projectId, deps.job.workspaceId, deps.job.queryJobId, deps.run.runId);
  const job = deps.job;
  const run = deps.run;
  return { commitKind: "query-close-record", schemaVersion: 1, identity: command.identity, fingerprint: closeQueryJobFingerprint(command), expectedVersions: [{ ref: queryJobRefFor(command.identity.projectId, job.workspaceId, job.queryJobId), revision: deps.nextRevision - 1 }, { ref: runRef, revision: deps.nextRevision - 1 }], events: [{
    eventId: deps.eventId, eventType: "QueryJobClosed", schemaVersion: 1, projectId: command.identity.projectId, workspaceId: job.workspaceId, aggregateType: "QueryJob", aggregateId: job.queryJobId, aggregateRevision: deps.nextRevision, causationId: command.commandId, correlationId: command.correlationId, idempotencyKey: command.identity.idempotencyKey, actor: { ...command.identity.actor }, occurredAt: deps.occurredAt, payload: { reason: command.payload.reason, job, run },
  }], snapshots: [{ ref: queryJobRefFor(command.identity.projectId, job.workspaceId, job.queryJobId), revision: deps.nextRevision, schemaVersion: 1, job }, { ref: runRef, revision: deps.nextRevision, schemaVersion: 1, run }], outboxIntents: [] };
}