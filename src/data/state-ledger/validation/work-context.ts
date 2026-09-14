/** Internal StateLedger work-context rules. Both adapters invoke these inside their commit protocol. */
import { validMemoryGovernanceWitness, memoryNoteBodyDigest } from '../../../contracts/memory-values.js';
import { canonicalJson } from "../../../contracts/fingerprint.js";
import { isKnownEventType } from "../../../contracts/events.js";
import { WORK_CONTEXT_MAX_RUN_LINKS } from "../../../contracts/context-continuity.js";
import { identityMatchesActor } from './batch-identity.js';


export function validateWorkContextBindCommit(batch: import("../../../contracts/ledger.js").WorkContextBindLedgerCommitV1): boolean {
  if (batch.schemaVersion !== 1) return false;
  if (batch.events.length !== 1) return false;
  if (batch.snapshots.length !== 1) return false;
  if (batch.outboxIntents.length !== 0) return false;
  const event = batch.events[0]!;
  if (event.schemaVersion !== 1) return false;
  if (event.eventType !== "WorkContextBound") return false;
  if (!isKnownEventType(event.eventType)) return false;
  if (event.aggregateType !== "WorkContextBinding") return false;
  if (event.aggregateRevision !== 1) return false;
  const snapshot = batch.snapshots[0]!;
  if (snapshot.ref.aggregateType !== "WorkContextBinding") return false;
  if (snapshot.revision !== 1 || snapshot.schemaVersion !== 1) return false;
  const binding = snapshot.binding;
  if (binding.workId !== event.aggregateId) return false;
  if (canonicalJson(binding as never) !== canonicalJson(event.payload.binding)) return false;
  if (binding.projectId !== event.projectId) return false;
  if (binding.workspaceId !== event.workspaceId) return false;
  if (binding.status !== "active") return false;
  if (snapshot.ref.projectId !== event.projectId) return false;
  if (snapshot.ref.workspaceId !== event.workspaceId) return false;
  if (snapshot.ref.workId !== binding.workId) return false;
  if (binding.linkedRunRefs.length !== 1) return false;
  const firstLink = binding.linkedRunRefs[0];
  if (firstLink === undefined) return false;
  if (canonicalJson(firstLink) !== canonicalJson(binding.initialRunRef)) return false;

  // Immutability CAS: exactly one expected version = the binding at 0.
  if (batch.expectedVersions.length !== 1) return false;
  const expected = batch.expectedVersions[0]!;
  if (expected.revision !== 0) return false;
  if (canonicalJson(expected.ref) !== canonicalJson(snapshot.ref)) return false;

  return identityMatchesActor(event.projectId, event.idempotencyKey, event.actor.kind, event.actor.id, batch.identity);
}


export function validateWorkContextLinkCommit(batch: import("../../../contracts/ledger.js").WorkContextLinkLedgerCommitV1): boolean {
  if (batch.schemaVersion !== 1) return false;
  if (batch.events.length !== 1) return false;
  if (batch.snapshots.length !== 1) return false;
  if (batch.outboxIntents.length !== 0) return false;
  const event = batch.events[0]!;
  if (event.schemaVersion !== 1) return false;
  if (event.eventType !== "WorkRunLinked") return false;
  if (!isKnownEventType(event.eventType)) return false;
  if (event.aggregateType !== "WorkContextBinding") return false;
  if (event.aggregateRevision < 2) return false;
  const snapshot = batch.snapshots[0]!;
  if (snapshot.ref.aggregateType !== "WorkContextBinding") return false;
  if (snapshot.revision !== event.aggregateRevision) return false;
  if (snapshot.schemaVersion !== 1) return false;
  const binding = snapshot.binding;
  if (binding.workId !== event.aggregateId) return false;
  if (binding.projectId !== event.projectId) return false;
  if (binding.workspaceId !== event.workspaceId) return false;
  const lastLink = binding.linkedRunRefs[binding.linkedRunRefs.length - 1];
  if (lastLink === undefined || event.payload.runRef.runId !== lastLink.runId) return false;
  if (canonicalJson(event.payload.linkedRunRefs) !== canonicalJson(binding.linkedRunRefs)) return false;
  if (binding.linkedRunRefs.length > WORK_CONTEXT_MAX_RUN_LINKS) return false;

  // CAS: the binding advanced by exactly 1.
  if (batch.expectedVersions.length !== 1) return false;
  const expected = batch.expectedVersions[0]!;
  if (expected.revision !== snapshot.revision - 1) return false;
  if (canonicalJson(expected.ref) !== canonicalJson(snapshot.ref)) return false;

  return identityMatchesActor(event.projectId, event.idempotencyKey, event.actor.kind, event.actor.id, batch.identity);
}


export function validateExecutionNoteRecordCommit(batch: import("../../../contracts/ledger.js").ExecutionNoteRecordLedgerCommitV1): boolean {
  if (batch.schemaVersion !== 1) return false;
  if (batch.events.length !== 1) return false;
  if (batch.snapshots.length !== 1) return false;
  if (batch.outboxIntents.length !== 0) return false;
  const event = batch.events[0]!;
  if (event.schemaVersion !== 1) return false;
  if (event.eventType !== "ExecutionNoteRecorded") return false;
  if (!isKnownEventType(event.eventType)) return false;
  if (event.aggregateType !== "ExecutionNote") return false;
  if (event.aggregateRevision !== 1) return false;
  const snapshot = batch.snapshots[0]!;
  if (snapshot.ref.aggregateType !== "ExecutionNote") return false;
  if (snapshot.revision !== 1 || snapshot.schemaVersion !== 1) return false;
  const note = snapshot.note;
  if (note.noteId !== event.aggregateId) return false;
  if (canonicalJson(note) !== canonicalJson(event.payload.note)) return false;
  if (note.projectId !== event.projectId) return false;
  if (note.workspaceId !== event.workspaceId) return false;
  if (note.noFullTranscript !== true) return false;
  if (snapshot.ref.projectId !== event.projectId) return false;
  if (snapshot.ref.workspaceId !== event.workspaceId) return false;
  if (snapshot.ref.workId !== note.workId) return false;
  if (snapshot.ref.noteId !== note.noteId) return false;
  if (snapshot.recordedAt !== event.payload.recordedAt) return false;

  if(note.memoryGovernance!==undefined&&(!validMemoryGovernanceWitness(note.memoryGovernance)||note.bodyRef.digest!==memoryNoteBodyDigest(note)))return false;
  const requiredVersions=[{ref:snapshot.ref,revision:0},...(note.memoryGovernance?.versions??[]).map(pin=>({ref:{aggregateType:pin.kind,projectId:note.projectId},revision:pin.revision}))];
  if(canonicalJson(batch.expectedVersions)!==canonicalJson(requiredVersions))return false;

  return identityMatchesActor(event.projectId, event.idempotencyKey, event.actor.kind, event.actor.id, batch.identity);
}


export function validateContinuationRecordCommit(batch: import("../../../contracts/ledger.js").ContinuationRecordLedgerCommitV1): boolean {
  if (batch.schemaVersion !== 1) return false;
  if (batch.events.length !== 1) return false;
  if (batch.snapshots.length !== 1) return false;
  if (batch.outboxIntents.length !== 0) return false;
  const event = batch.events[0]!;
  if (event.schemaVersion !== 1) return false;
  if (event.eventType !== "ContinuationRecorded") return false;
  if (!isKnownEventType(event.eventType)) return false;
  if (event.aggregateType !== "ContinuationRecord") return false;
  if (event.aggregateRevision !== 1) return false;
  const snapshot = batch.snapshots[0]!;
  if (snapshot.ref.aggregateType !== "ContinuationRecord") return false;
  if (snapshot.revision !== 1 || snapshot.schemaVersion !== 1) return false;
  const result = snapshot.result;
  if (result.reportId !== event.aggregateId) return false;
  if (canonicalJson(result) !== canonicalJson(event.payload.result)) return false;
  if (result.projectId !== event.projectId) return false;
  if (result.workspaceId !== event.workspaceId) return false;
  if (snapshot.ref.projectId !== event.projectId) return false;
  if (snapshot.ref.workspaceId !== event.workspaceId) return false;
  if (snapshot.ref.workId !== result.workId) return false;
  if (snapshot.ref.reportId !== result.reportId) return false;
  if (result.status === "restored_original" && result.originalRunRef === null) return false;
  if (result.status === "took_over" && result.takeoverRunRef === null) return false;
  if (result.status === "unsupported" && result.unsupportedCapabilities.length === 0) return false;
  if (result.status === "rejected" && result.rejectionCode === null) return false;

  if (batch.expectedVersions.length !== 1) return false;
  const expected = batch.expectedVersions[0]!;
  if (expected.revision !== 0) return false;
  if (canonicalJson(expected.ref) !== canonicalJson(snapshot.ref)) return false;

  return identityMatchesActor(event.projectId, event.idempotencyKey, event.actor.kind, event.actor.id, batch.identity);
}
