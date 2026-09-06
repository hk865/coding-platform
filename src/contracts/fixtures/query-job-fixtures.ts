/** P1-09 shared fixtures: query-job scenario + builders + ledger folds. */
import type { CommandIdentity } from "../command-event.js";
import { sha256Hex } from "../fingerprint.js";
import type { QueryJobIntentV1, QueryJobV1, QueryJobSnapshot, QueryRunV1, QueryRunSnapshot, QueryJobAnswerV1, QueryJobAnswerSnapshot, QueryJobRef, QueryRunRef, QueryTaskRef } from "../query-job.js";
import { queryJobRefFor, queryRunRefFor, queryJobAnswerRefFor, submitQueryJobFingerprint, recordQueryAnswerFingerprint, closeQueryJobFingerprint } from "../query-job.js";
import type { QueryJobRecordLedgerCommitV1, QueryAnswerRecordLedgerCommitV1, QueryCloseRecordLedgerCommitV1 } from "../ledger.js";
import type { SubmitQueryJobCommand, RecordQueryAnswerCommand, CloseQueryJobCommand } from "../query-job.js";

export const P109_PROJECT = "proj-alpha";
export const P109_WORKSPACE = "ws-shared";
export const P109_GOAL = "goal-p109-1";
export const P109_QUERY = "query-p109-1";
export const P109_RUN = "qrun-p109-1";
export const P109_ANSWER = "answer-p109-1";
export const P109_SCHEMA = "2026-09-06T00:00:00.000Z";

export function p109TaskRef(taskId: string): QueryTaskRef {
  return { aggregateType: "Task", projectId: P109_PROJECT, goalId: P109_GOAL, taskId };
}
export function p109RunRef(runId: string): import("../dispatch.js").RunRef {
  return { aggregateType: "Run", projectId: P109_PROJECT, goalId: P109_GOAL, runId };
}
export function p109QuestRef(runId: string): QueryRunRef {
  return queryRunRefFor(P109_PROJECT, P109_WORKSPACE, P109_QUERY, runId);
}

export function buildP109Intent(overrides: Partial<QueryJobIntentV1> = {}): QueryJobIntentV1 {
  return {
    schemaVersion: 1, intentId: "intent-" + P109_QUERY, projectId: P109_PROJECT, workspaceId: P109_WORKSPACE, goalId: P109_GOAL,
    question: "为什么这两项可以并行、当前风险是什么？",
    focusTaskRefs: [p109TaskRef("task-a"), p109TaskRef("task-b")],
    budget: { maxTokens: 1000, deadline: null },
    multiTurn: { maxRounds: 2 },
    correlationId: "corr-" + P109_QUERY, ...overrides,
  };
}

export function buildP109Job(intent: QueryJobIntentV1, runRef: QueryRunRef | null = null): QueryJobV1 {
  return {
    schemaVersion: 1, queryJobId: P109_QUERY, projectId: P109_PROJECT, workspaceId: P109_WORKSPACE, goalId: intent.goalId,
    intent, status: runRef === null ? "pending" : "running", runRef, answerRefs: [], closeReason: null,
    submittedAt: P109_SCHEMA, updatedAt: P109_SCHEMA,
  };
}

export function buildP109Run(job: QueryJobV1, runId: string = P109_RUN, status: QueryRunV1["status"] = "pending", outcome: QueryRunV1["outcome"] = null): QueryRunV1 {
  return {
    schemaVersion: 1, queryJobRef: queryJobRefFor(P109_PROJECT, P109_WORKSPACE, job.queryJobId), runId,
    status, startedAt: status === "pending" ? null : P109_SCHEMA, endedAt: outcome === null ? null : P109_SCHEMA, outcome,
  };
}

export function buildP109Answer(runRef: QueryRunRef, roundIndex = 1, stale = false): QueryJobAnswerV1 {
  return {
    schemaVersion: 1, answerId: P109_ANSWER + "-r" + String(roundIndex), queryJobRef: queryJobRefFor(P109_PROJECT, P109_WORKSPACE, P109_QUERY), runRef,
    roundIndex, answer: "有限来源的答案（带引用；无隐藏思维链）",
    sources: [{ kind: "event", refKey: "task-a@1", version: "1", label: "task a" }],
    followsAnswerRef: roundIndex > 1 ? queryJobAnswerRefFor(P109_PROJECT, P109_WORKSPACE, P109_QUERY, P109_ANSWER + "-r" + String(roundIndex - 1)) : null,
    stale, staleReason: stale ? "source_changed" : null, answeredAt: P109_SCHEMA,
    bodyRef: { kind: "artifact", contentType: "application/json", digest: sha256Hex("p109-answer-" + String(roundIndex)), sizeBytes: 256, source: { kind: "artifact", refId: "body-p109-answer", revision: "1", digest: sha256Hex("p109-answer-" + String(roundIndex)) } },
  };
}

export function buildP109SubmitCommand(job: QueryJobV1, runRef: QueryRunRef, deps: { commandId: string; actor?: CommandIdentity["actor"] }): SubmitQueryJobCommand {
  return { commandId: deps.commandId, commandType: "SubmitQueryJob", schemaVersion: 1, identity: { projectId: P109_PROJECT, actor: deps.actor ?? { kind: "human", id: "user-1" }, idempotencyKey: deps.commandId + "-idem" }, aggregateId: job.queryJobId, expectedRevision: 0, correlationId: deps.commandId + "-corr", submittedAt: P109_SCHEMA, payload: { intent: job.intent, runId: runRef.runId } };
}

export function buildP109AnswerCommand(job: QueryJobV1, run: QueryRunV1, answer: QueryJobAnswerV1, expectedRevision: number, deps: { commandId: string }): RecordQueryAnswerCommand {
  return { commandId: deps.commandId, commandType: "RecordQueryAnswer", schemaVersion: 1, identity: { projectId: P109_PROJECT, actor: { kind: "system", id: "query-runtime" }, idempotencyKey: deps.commandId + "-idem" }, aggregateId: job.queryJobId, expectedRevision, correlationId: deps.commandId + "-corr", submittedAt: P109_SCHEMA, payload: { answer } };
}

export function buildP109CloseCommand(job: QueryJobV1, reasonCode: "timeout" | "gap" | "failed" | "stale_source" | "cancelled", expectedRevision: number, deps: { commandId: string }): CloseQueryJobCommand {
  return { commandId: deps.commandId, commandType: "CloseQueryJob", schemaVersion: 1, identity: { projectId: P109_PROJECT, actor: { kind: "system", id: "query-runtime" }, idempotencyKey: deps.commandId + "-idem" }, aggregateId: job.queryJobId, expectedRevision, correlationId: deps.commandId + "-corr", submittedAt: P109_SCHEMA, payload: { reason: { code: reasonCode, message: "fixture close " + reasonCode }, jobRef: queryJobRefFor(P109_PROJECT, P109_WORKSPACE, job.queryJobId), runRef: queryRunRefFor(P109_PROJECT, P109_WORKSPACE, job.queryJobId, job.runRef?.runId ?? P109_RUN) } };
}

export function buildQueryJobRecordCommit(command: SubmitQueryJobCommand, deps: { eventId: string; occurredAt: string }): QueryJobRecordLedgerCommitV1 {
  const job = buildP109Job(command.payload.intent);
  const run = buildP109Run(job, command.payload.runId, "pending");
  const jobSnap: QueryJobSnapshot = { ref: queryJobRefFor(P109_PROJECT, P109_WORKSPACE, job.queryJobId), revision: 1, schemaVersion: 1, job };
  const runRef = queryRunRefFor(P109_PROJECT, P109_WORKSPACE, job.queryJobId, command.payload.runId);
  const runSnap: QueryRunSnapshot = { ref: runRef, revision: 1, schemaVersion: 1, run };
  return { commitKind: "query-job-record", schemaVersion: 1, identity: command.identity, fingerprint: submitQueryJobFingerprint(command), expectedVersions: [{ ref: jobSnap.ref, revision: 0 }, { ref: runSnap.ref, revision: 0 }], events: [
    { eventId: deps.eventId, eventType: "QueryJobSubmitted", schemaVersion: 1, projectId: P109_PROJECT, workspaceId: P109_WORKSPACE, aggregateType: "QueryJob", aggregateId: job.queryJobId, aggregateRevision: 1, causationId: command.commandId, correlationId: command.correlationId, idempotencyKey: command.identity.idempotencyKey, actor: { ...command.identity.actor }, occurredAt: deps.occurredAt, payload: { job } },
    { eventId: deps.eventId + "-run", eventType: "QueryRunStarted", schemaVersion: 1, projectId: P109_PROJECT, workspaceId: P109_WORKSPACE, aggregateType: "QueryRun", aggregateId: runRef.runId, aggregateRevision: 1, causationId: command.commandId, correlationId: command.correlationId, idempotencyKey: command.identity.idempotencyKey, actor: { ...command.identity.actor }, occurredAt: deps.occurredAt, payload: { run } },
  ], snapshots: [jobSnap, runSnap], outboxIntents: [] };
}

export function buildQueryAnswerRecordCommit(command: RecordQueryAnswerCommand, deps: { eventId: string; occurredAt: string; nextRevision: number; job: QueryJobV1; run: QueryRunV1 }): QueryAnswerRecordLedgerCommitV1 {
  const runRef: QueryRunRef = queryRunRefFor(P109_PROJECT, P109_WORKSPACE, deps.job.queryJobId, deps.run.runId);
  const answer = command.payload.answer;
  const job = deps.job;
  const run = deps.run;
  return { commitKind: "query-answer-record", schemaVersion: 1, identity: command.identity, fingerprint: recordQueryAnswerFingerprint(command), expectedVersions: [{ ref: queryJobAnswerRefFor(P109_PROJECT, P109_WORKSPACE, job.queryJobId, answer.answerId), revision: 0 }, { ref: queryJobRefFor(P109_PROJECT, P109_WORKSPACE, job.queryJobId), revision: deps.nextRevision - 1 }, { ref: runRef, revision: deps.nextRevision - 1 }], events: [{
    eventId: deps.eventId, eventType: "QueryJobAnswerRecorded", schemaVersion: 1, projectId: P109_PROJECT, workspaceId: P109_WORKSPACE, aggregateType: "QueryJob", aggregateId: job.queryJobId, aggregateRevision: deps.nextRevision, causationId: command.commandId, correlationId: command.correlationId, idempotencyKey: command.identity.idempotencyKey, actor: { ...command.identity.actor }, occurredAt: deps.occurredAt, payload: { answer, job, run },
  }], snapshots: [{ ref: queryJobAnswerRefFor(P109_PROJECT, P109_WORKSPACE, job.queryJobId, answer.answerId), revision: 1, schemaVersion: 1, answer }, { ref: queryJobRefFor(P109_PROJECT, P109_WORKSPACE, job.queryJobId), revision: deps.nextRevision, schemaVersion: 1, job }, { ref: runRef, revision: deps.nextRevision, schemaVersion: 1, run }], outboxIntents: [] };
}

export function buildQueryCloseRecordCommit(command: CloseQueryJobCommand, deps: { eventId: string; occurredAt: string; nextRevision: number; job: QueryJobV1; run: QueryRunV1 }): QueryCloseRecordLedgerCommitV1 {
  const runRef: QueryRunRef = queryRunRefFor(P109_PROJECT, P109_WORKSPACE, deps.job.queryJobId, deps.run.runId);
  const job = deps.job;
  const run = deps.run;
  return { commitKind: "query-close-record", schemaVersion: 1, identity: command.identity, fingerprint: closeQueryJobFingerprint(command), expectedVersions: [{ ref: queryJobRefFor(P109_PROJECT, P109_WORKSPACE, job.queryJobId), revision: deps.nextRevision - 1 }, { ref: runRef, revision: deps.nextRevision - 1 }], events: [{
    eventId: deps.eventId, eventType: "QueryJobClosed", schemaVersion: 1, projectId: P109_PROJECT, workspaceId: P109_WORKSPACE, aggregateType: "QueryJob", aggregateId: job.queryJobId, aggregateRevision: deps.nextRevision, causationId: command.commandId, correlationId: command.correlationId, idempotencyKey: command.identity.idempotencyKey, actor: { ...command.identity.actor }, occurredAt: deps.occurredAt, payload: { reason: command.payload.reason, job, run },
  }], snapshots: [{ ref: queryJobRefFor(P109_PROJECT, P109_WORKSPACE, job.queryJobId), revision: deps.nextRevision, schemaVersion: 1, job }, { ref: runRef, revision: deps.nextRevision, schemaVersion: 1, run }], outboxIntents: [] };
}
