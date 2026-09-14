/** Internal StateLedger integration rules. Both adapters invoke these inside their commit protocol. */
import { canonicalJson } from "../../../contracts/fingerprint.js";
import { isKnownEventType } from "../../../contracts/events.js";
import type { IntegrationRecordLedgerCommitV1, PatchRecordLedgerCommitV1 } from "../../../contracts/ledger.js";
import { integrationResultRefFor } from "../../../contracts/integration.js";
import { patchRecordRefFor } from "../../../contracts/patch.js";
import { identityMatchesActor, expectedVersionOf } from './batch-identity.js';


export function validateIntegrationRecordCommit(batch: IntegrationRecordLedgerCommitV1): boolean {
  if (batch.schemaVersion !== 1) return false;
  if (batch.events.length !== 1) return false;
  if (batch.snapshots.length !== 1) return false;
  if (batch.outboxIntents.length !== 0) return false;
  const event = batch.events[0]!;
  if (event.schemaVersion !== 1) return false;
  if (event.eventType !== "IntegrationJoined") return false;
  if (!isKnownEventType(event.eventType)) return false;
  if (event.aggregateType !== "IntegrationResult") return false;
  const snapshot = batch.snapshots[0]!;
  if (snapshot.ref.aggregateType !== "IntegrationResult") return false;
  if (snapshot.schemaVersion !== 1) return false;
  const expectedRef = integrationResultRefFor(event.projectId, event.payload.goalId, event.payload.taskId);
  if (canonicalJson(snapshot.ref) !== canonicalJson(expectedRef)) return false;
  if (event.aggregateId !== event.payload.taskId) return false;
  if (snapshot.records.length !== snapshot.revision) return false;
  if (snapshot.revision !== event.aggregateRevision) return false;
  if (snapshot.records.length < 1) return false;
  if (expectedVersionOf(batch, snapshot.ref) !== snapshot.revision - 1) return false;
  if (event.occurredAt !== snapshot.records[snapshot.records.length - 1]!.generatedAt) return false;
  const last = snapshot.records[snapshot.records.length - 1]!;
  if (last.resultId !== event.payload.resultId) return false;
  if (last.taskId !== event.payload.taskId) return false;
  if (canonicalJson(last.runRef) !== canonicalJson(event.payload.runRef)) return false;
  if (last.workspaceRevision !== event.payload.workspaceRevision) return false;
  if (canonicalJson(last.inputs) !== canonicalJson(event.payload.inputs)) return false;
  if (canonicalJson(last.conflicts) !== canonicalJson(event.payload.conflicts)) return false;
  if (canonicalJson(last.gaps) !== canonicalJson(event.payload.gaps)) return false;
  if (last.explanation !== event.payload.explanation) return false;
  if (last.escalate !== event.payload.escalate) return false;
  if (last.generatedAt !== event.payload.generatedAt) return false;

  return identityMatchesActor(event.projectId, event.idempotencyKey, event.actor.kind, event.actor.id, batch.identity);
}


export function validatePatchRecordCommit(batch: PatchRecordLedgerCommitV1): boolean {
  if (batch.schemaVersion !== 1) return false;
  if (batch.events.length !== 2) return false;
  if (batch.snapshots.length !== 4) return false;
  if (batch.outboxIntents.length !== 0) return false;
  const patchEvent = batch.events[0]!;
  const releaseEvent = batch.events[1]!;
  if (patchEvent.schemaVersion !== 1 || releaseEvent.schemaVersion !== 1) return false;
  if (patchEvent.eventType !== "PatchRecorded") return false;
  if (releaseEvent.eventType !== "WorkspaceWriteLeaseReleased") return false;
  if (!isKnownEventType(patchEvent.eventType) || !isKnownEventType(releaseEvent.eventType)) return false;
  if (patchEvent.aggregateType !== "PatchRecord") return false;
  if (patchEvent.aggregateRevision !== 1) return false;
  if (releaseEvent.aggregateType !== "WorkspaceWriteLease") return false;
  if (releaseEvent.aggregateRevision !== 2) return false;
  const patch = batch.snapshots[0]!;
  const workspace = batch.snapshots[1]!;
  const lease = batch.snapshots[2]!;
  const index = batch.snapshots[3]!;
  if (patch.ref.aggregateType !== "PatchRecord") return false;
  if (workspace.ref.aggregateType !== "Workspace") return false;
  if (lease.ref.aggregateType !== "WorkspaceWriteLease") return false;
  if (index.ref.aggregateType !== "WorkspaceWriteLeaseIndex") return false;
  if (patch.revision !== 1) return false;
  const expectedPatchRef = patchRecordRefFor(patchEvent.projectId, patchEvent.payload.patchId);
  if (canonicalJson(patch.ref) !== canonicalJson(expectedPatchRef)) return false;
  if (patchEvent.aggregateId !== patchEvent.payload.patchId) return false;
  if (patchEvent.payload.patchId !== patch.patch.patchId) return false;
  if (patchEvent.payload.taskId !== patch.patch.taskId) return false;
  if (canonicalJson(patchEvent.payload.runRef) !== canonicalJson(patch.patch.runRef)) return false;
  if (patchEvent.payload.kind !== patch.patch.kind) return false;
  if (patchEvent.payload.title !== patch.patch.title) return false;
  if (canonicalJson(patchEvent.payload.changedPaths) !== canonicalJson(patch.patch.changedPaths)) return false;
  if (patchEvent.payload.beforeWorkspaceRevision !== patch.patch.beforeWorkspaceRevision) return false;
  if (patchEvent.payload.afterWorkspaceRevision !== patch.patch.afterWorkspaceRevision) return false;
  if (canonicalJson(patchEvent.payload.checkResults) !== canonicalJson(patch.patch.checkResults)) return false;
  if (canonicalJson(patchEvent.payload.usedInputEvidenceRefs) !== canonicalJson(patch.patch.usedInputEvidenceRefs)) return false;
  if (patch.recordedAt !== patchEvent.occurredAt) return false;
  // Workspace canonical advance N -> N+1 (only via patch-record).
  if (workspace.revision !== patch.patch.afterWorkspaceRevision) return false;
  if (expectedVersionOf(batch, workspace.ref) !== workspace.revision - 1) return false;
  // The write lease is released BY the patch record (@2, releasedVia patch-record).
  if (lease.revision !== 2) return false;
  if (lease.lease.status !== "released") return false;
  if (lease.lease.releasedAt !== releaseEvent.payload.releasedAt) return false;
  if (lease.lease.releasedBy !== releaseEvent.payload.releasedBy) return false;
  if (releaseEvent.payload.releasedVia !== "patch-record") return false;
  if (releaseEvent.payload.postWriteWorkspaceRevision !== workspace.revision) return false;
  if (lease.lease.postWriteWorkspaceRevision !== workspace.revision) return false;
  if (releaseEvent.payload.leaseId !== lease.ref.leaseId) return false;
  if (releaseEvent.aggregateId !== lease.ref.leaseId) return false;
  if (releaseEvent.projectId !== patchEvent.projectId) return false;
  if (canonicalJson(patchEvent.payload.usedInputEvidenceRefs) !== canonicalJson(patch.patch.usedInputEvidenceRefs)) return false;
  if (expectedVersionOf(batch, patch.ref) !== 0) return false;
  if (expectedVersionOf(batch, lease.ref) !== 1) return false;
  if (index.activeLeaseId !== null || index.activeScope !== null || index.holderRunRef !== null) return false;
  const indexWait = expectedVersionOf(batch, index.ref);
  if (indexWait === null || index.revision !== indexWait + 1) return false;
  if (!lease.lease.patches.some((r) => canonicalJson(r) === canonicalJson(patch.ref))) return false;

  return identityMatchesActor(patchEvent.projectId, patchEvent.idempotencyKey, patchEvent.actor.kind, patchEvent.actor.id, batch.identity);
}
