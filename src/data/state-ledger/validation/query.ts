/** Internal StateLedger query rules. Both adapters invoke these inside their commit protocol. */
import { validQueryExecutionBinding } from '../../../contracts/query-job.js';
import { canonicalJson } from "../../../contracts/fingerprint.js";
import { isKnownEventType } from "../../../contracts/events.js";
import { validQueryExecution } from "../../../contracts/query-job.js";
import { identityMatchesActor } from './batch-identity.js';



// ------------------------------------------------------------------------ //
// Query-job validators shared by both adapters.                              //
// ------------------------------------------------------------------------ //

export function validateQueryJobRecordCommit(batch: import("../../../contracts/ledger.js").QueryJobRecordLedgerCommitV1): boolean {
  if (batch.schemaVersion !== 1) return false;
  if (batch.events.length !== 2) return false;
  if (batch.snapshots.length !== 2) return false;
  if (batch.outboxIntents.length !== 0) return false;
  const [jobEvent, runEvent] = batch.events as [import("../../../contracts/query-job.js").QueryJobSubmittedEvent, import("../../../contracts/query-job.js").QueryRunStartedEvent];
  if (jobEvent.eventType !== "QueryJobSubmitted") return false;
  if (runEvent.eventType !== "QueryRunStarted") return false;
  if (!isKnownEventType(jobEvent.eventType) || !isKnownEventType(runEvent.eventType)) return false;
  const jobSnap = batch.snapshots[0] as import("../../../contracts/query-job.js").QueryJobSnapshot;
  const runSnap = batch.snapshots[1] as import("../../../contracts/query-job.js").QueryRunSnapshot;
  if (jobSnap.ref.aggregateType !== "QueryJob" || runSnap.ref.aggregateType !== "QueryRun") return false;
  if (!validQueryExecution(jobSnap.job.intent.execution)) return false;
  if (jobSnap.job.intent.execution?.implementationAuthorization && jobEvent.actor.kind !== 'human') return false;
  if (jobSnap.revision !== 1 || runSnap.revision !== 1) return false;
  if (canonicalJson(jobSnap.job) !== canonicalJson(jobEvent.payload.job)) return false;
  if (canonicalJson(runSnap.run) !== canonicalJson(runEvent.payload.run)) return false;
  if (jobSnap.job.queryJobId !== jobEvent.aggregateId) return false;
  if (jobSnap.job.projectId !== jobEvent.projectId || jobSnap.job.workspaceId !== jobEvent.workspaceId) return false;
  if (runSnap.run.queryJobRef.queryJobId !== jobSnap.job.queryJobId) return false;
  if (jobSnap.job.status !== "pending" || runSnap.run.status !== "pending") return false;
  if (batch.expectedVersions.length !== 2) return false;
  const jE = batch.expectedVersions.find((v) => v.ref.aggregateType === "QueryJob");
  const rE = batch.expectedVersions.find((v) => v.ref.aggregateType === "QueryRun");
  if (jE === undefined || jE.revision !== 0 || canonicalJson(jE.ref) !== canonicalJson(jobSnap.ref)) return false;
  if (rE === undefined || rE.revision !== 0 || canonicalJson(rE.ref) !== canonicalJson(runSnap.ref)) return false;
  return identityMatchesActor(jobEvent.projectId, jobEvent.idempotencyKey, jobEvent.actor.kind, jobEvent.actor.id, batch.identity);
}


export function validateQueryAnswerRecordCommit(batch: import("../../../contracts/ledger.js").QueryAnswerRecordLedgerCommitV1): boolean {
  if (batch.schemaVersion !== 1) return false;
  if (batch.events.length !== 1) return false;
  if (batch.snapshots.length !== 3) return false;
  if (batch.outboxIntents.length !== 0) return false;
  const event = batch.events[0]!;
  if (event.eventType !== "QueryJobAnswerRecorded") return false;
  if (!isKnownEventType(event.eventType)) return false;
  const answerSnap = batch.snapshots.find((s) => s.ref.aggregateType === "QueryJobAnswer") as import("../../../contracts/query-job.js").QueryJobAnswerSnapshot | undefined;
  const jobSnap = batch.snapshots.find((s) => s.ref.aggregateType === "QueryJob") as import("../../../contracts/query-job.js").QueryJobSnapshot | undefined;
  const runSnap = batch.snapshots.find((s) => s.ref.aggregateType === "QueryRun") as import("../../../contracts/query-job.js").QueryRunSnapshot | undefined;
  if (answerSnap === undefined || jobSnap === undefined || runSnap === undefined) return false;
  if (answerSnap.revision !== 1 || answerSnap.schemaVersion !== 1) return false;
  if (canonicalJson(answerSnap.answer) !== canonicalJson(event.payload.answer)) return false;
  if (canonicalJson(jobSnap.job) !== canonicalJson(event.payload.job)) return false;
  if (canonicalJson(runSnap.run) !== canonicalJson(event.payload.run)) return false;
  if (jobSnap.job.status !== "answered") return false;
  if (runSnap.run.status !== "answered" && runSnap.run.status !== "running") return false;
  if (jobSnap.job.answerRefs[jobSnap.job.answerRefs.length - 1]?.answerId !== answerSnap.answer.answerId) return false;
  if (batch.expectedVersions.length !== 3) return false;
  const aE = batch.expectedVersions.find((v) => v.ref.aggregateType === "QueryJobAnswer");
  if (aE === undefined || aE.revision !== 0) return false;
  const jE = batch.expectedVersions.find((v) => v.ref.aggregateType === "QueryJob");
  if (jE === undefined || jE.revision !== jobSnap.revision - 1) return false;
  const rE = batch.expectedVersions.find((v) => v.ref.aggregateType === "QueryRun");
  if (rE === undefined || rE.revision !== runSnap.revision - 1) return false;
  return identityMatchesActor(event.projectId, event.idempotencyKey, event.actor.kind, event.actor.id, batch.identity);
}


export function validateQueryCloseRecordCommit(batch: import("../../../contracts/ledger.js").QueryCloseRecordLedgerCommitV1): boolean {
  if (batch.schemaVersion !== 1) return false;
  if (batch.events.length !== 1) return false;
  if (batch.snapshots.length !== 2) return false;
  if (batch.outboxIntents.length !== 0) return false;
  const event = batch.events[0]!;
  if (event.eventType !== "QueryJobClosed") return false;
  if (!isKnownEventType(event.eventType)) return false;
  const jobSnap = batch.snapshots.find((s) => s.ref.aggregateType === "QueryJob") as import("../../../contracts/query-job.js").QueryJobSnapshot | undefined;
  const runSnap = batch.snapshots.find((s) => s.ref.aggregateType === "QueryRun") as import("../../../contracts/query-job.js").QueryRunSnapshot | undefined;
  if (jobSnap === undefined || runSnap === undefined) return false;
  if (canonicalJson(jobSnap.job) !== canonicalJson(event.payload.job)) return false;
  if (canonicalJson(runSnap.run) !== canonicalJson(event.payload.run)) return false;
  if (jobSnap.job.status !== "closed" || runSnap.run.status !== "closed") return false;
  if (jobSnap.job.closeReason?.code !== event.payload.reason.code) return false;
  if (event.payload.reason.code === 'cancelled' && runSnap.run.outcome !== 'cancelled') return false;
  const jE = batch.expectedVersions.find((v) => v.ref.aggregateType === "QueryJob");
  if (jE === undefined || jE.revision !== jobSnap.revision - 1) return false;
  const rE = batch.expectedVersions.find((v) => v.ref.aggregateType === "QueryRun");
  if (rE === undefined || rE.revision !== runSnap.revision - 1) return false;
  return identityMatchesActor(event.projectId, event.idempotencyKey, event.actor.kind, event.actor.id, batch.identity);
}




export function validateQueryJobStartCommit(batch: import("../../../contracts/ledger.js").QueryJobStartLedgerCommitV1): boolean {
  if (batch.schemaVersion !== 1 || batch.events.length !== 1 || batch.snapshots.length !== 2 || batch.expectedVersions.length !== 2 || batch.outboxIntents.length !== 0) return false;
  const [job, run] = batch.snapshots;
  const event = batch.events[0];
  if (job.ref.aggregateType !== "QueryJob" || run.ref.aggregateType !== "QueryRun" || event.eventType !== "QueryRunStarted") return false;
  if (run.run.execution && !validQueryExecutionBinding(run.run.execution, job.job)) return false;
  if (job.job.status !== "running" || run.run.status !== "running" || job.revision !== run.revision || job.revision < 2) return false;
  if (canonicalJson(job.job.runRef) !== canonicalJson(run.ref) || canonicalJson(run.run.queryJobRef) !== canonicalJson(job.ref)) return false;
  if (event.payload.job === undefined || canonicalJson(event.payload.job) !== canonicalJson(job.job) || canonicalJson(event.payload.run) !== canonicalJson(run.run)) return false;
  if (event.aggregateRevision !== run.revision || event.aggregateId !== run.ref.runId || event.projectId !== job.ref.projectId || event.workspaceId !== job.ref.workspaceId) return false;
  if (!batch.snapshots.every((snap) => batch.expectedVersions.some((v) => canonicalJson(v.ref) === canonicalJson(snap.ref) && v.revision === snap.revision - 1))) return false;
  return identityMatchesActor(event.projectId, event.idempotencyKey, event.actor.kind, event.actor.id, batch.identity);
}
