/** Internal StateLedger workspace-leases rules. Both adapters invoke these inside their commit protocol. */
import { canonicalJson } from "../../../contracts/fingerprint.js";
import { isKnownEventType } from "../../../contracts/events.js";
import type { WorkspaceReadLeaseAcquireLedgerCommitV1, WorkspaceReadLeaseReleaseLedgerCommitV1, WorkspaceWriteLeaseAcquireLedgerCommitV1, WorkspaceWriteLeaseReleaseLedgerCommitV1 } from "../../../contracts/ledger.js";
import type { WorkspaceWriteLeaseIndexSnapshot, WorkspaceWriteLeaseSnapshot } from "../../../contracts/workspace-lease.js";
import { workspaceReadLeaseIndexRefFor, workspaceReadLeaseRefFor, workspaceWriteLeaseIndexRefFor, workspaceWriteLeaseRefFor } from "../../../contracts/workspace-lease.js";
import { identityMatchesActor, expectedVersionOf } from './batch-identity.js';


export function validateWorkspaceReadLeaseAcquireCommit(batch: WorkspaceReadLeaseAcquireLedgerCommitV1): boolean {
  if (batch.schemaVersion !== 1) return false;
  if (batch.events.length !== 1) return false;
  if (batch.snapshots.length !== 2) return false;
  if (batch.outboxIntents.length !== 0) return false;
  const event = batch.events[0]!;
  if (event.schemaVersion !== 1) return false;
  if (event.eventType !== "WorkspaceReadLeaseGranted") return false;
  if (!isKnownEventType(event.eventType)) return false;
  if (event.aggregateType !== "WorkspaceReadLease") return false;
  if (event.aggregateRevision !== 1) return false;
  const lease = batch.snapshots[0]!;
  const index = batch.snapshots[1]!;
  if (lease.ref.aggregateType !== "WorkspaceReadLease") return false;
  if (index.ref.aggregateType !== "WorkspaceReadLeaseIndex") return false;
  if (lease.revision !== 1) return false;
  if (lease.schemaVersion !== 1) return false;
  if (index.schemaVersion !== 1) return false;
  const expectedLeaseRef = workspaceReadLeaseRefFor(event.projectId, event.payload.leaseId);
  if (canonicalJson(lease.ref) !== canonicalJson(expectedLeaseRef)) return false;
  const expectedIndexRef = workspaceReadLeaseIndexRefFor(event.projectId, event.workspaceId);
  if (canonicalJson(index.ref) !== canonicalJson(expectedIndexRef)) return false;
  if (event.aggregateId !== event.payload.leaseId) return false;
  if (event.projectId !== lease.ref.projectId) return false;
  if (event.workspaceId !== index.ref.workspaceId) return false;
  if (event.payload.leaseId !== lease.lease.leaseId) return false;
  if (canonicalJson(event.payload.scope) !== canonicalJson(lease.lease.scope)) return false;
  if (canonicalJson(event.payload.holder) !== canonicalJson({ runRef: lease.lease.holder.runRef, attemptRef: lease.lease.holder.attemptRef })) return false;
  if (event.payload.expiresAt !== lease.lease.expiresAt) return false;
  if (lease.lease.status !== "active") return false;
  if (lease.lease.grantedAt !== event.occurredAt) return false;
  if (lease.lease.releasedAt !== null || lease.lease.releasedBy !== null) return false;
  const indexWait = expectedVersionOf(batch, index.ref);
  if (indexWait === null || index.revision !== indexWait + 1) return false;
  if (expectedVersionOf(batch, lease.ref) !== 0) return false;
  const opposingIndexRevision = expectedVersionOf(batch, workspaceWriteLeaseIndexRefFor(event.projectId, event.workspaceId));
  if (opposingIndexRevision === null || !Number.isInteger(opposingIndexRevision) || opposingIndexRevision < 0) return false;
  if (!index.activeReadLeases.some((e) => e.leaseId === lease.lease.leaseId && canonicalJson(e.scope) === canonicalJson(lease.lease.scope))) return false;

  return identityMatchesActor(event.projectId, event.idempotencyKey, event.actor.kind, event.actor.id, batch.identity);
}


export function validateWorkspaceReadLeaseReleaseCommit(batch: WorkspaceReadLeaseReleaseLedgerCommitV1): boolean {
  if (batch.schemaVersion !== 1) return false;
  if (batch.events.length !== 1) return false;
  if (batch.snapshots.length !== 2) return false;
  if (batch.outboxIntents.length !== 0) return false;
  const event = batch.events[0]!;
  if (event.schemaVersion !== 1) return false;
  if (event.eventType !== "WorkspaceReadLeaseReleased") return false;
  if (!isKnownEventType(event.eventType)) return false;
  if (event.aggregateType !== "WorkspaceReadLease") return false;
  if (event.aggregateRevision !== 2) return false;
  const lease = batch.snapshots[0]!;
  const index = batch.snapshots[1]!;
  if (lease.ref.aggregateType !== "WorkspaceReadLease") return false;
  if (index.ref.aggregateType !== "WorkspaceReadLeaseIndex") return false;
  if (lease.revision !== 2) return false;
  if (lease.lease.status !== "released") return false;
  if (lease.lease.releasedAt !== event.payload.releasedAt) return false;
  if (lease.lease.releasedBy !== event.payload.releasedBy) return false;
  if (event.aggregateId !== lease.ref.leaseId) return false;
  if (event.payload.leaseId !== lease.ref.leaseId) return false;
  if (expectedVersionOf(batch, lease.ref) !== 1) return false;
  const indexWait = expectedVersionOf(batch, index.ref);
  if (indexWait === null || index.revision !== indexWait + 1) return false;
  if (index.activeReadLeases.some((e) => e.leaseId === lease.ref.leaseId)) return false;

  return identityMatchesActor(event.projectId, event.idempotencyKey, event.actor.kind, event.actor.id, batch.identity);
}


export function validateWriteLeaseIndexSnapshot(index: WorkspaceWriteLeaseIndexSnapshot, lease: WorkspaceWriteLeaseSnapshot, batch: { expectedVersions: { ref: { aggregateType: string }; revision: number }[] }): boolean {
  if (index.schemaVersion !== 1) return false;
  if (index.activeLeaseId !== lease.ref.leaseId) return false;
  if (canonicalJson(index.activeScope) !== canonicalJson(lease.lease.scope)) return false;
  if (canonicalJson(index.holderRunRef) !== canonicalJson(lease.lease.holder.runRef)) return false;
  const indexWait = expectedVersionOf(batch, index.ref);
  return indexWait !== null && index.revision === indexWait + 1;
}


export function validateWorkspaceWriteLeaseAcquireCommit(batch: WorkspaceWriteLeaseAcquireLedgerCommitV1): boolean {
  if (batch.schemaVersion !== 1) return false;
  if (batch.events.length !== 1) return false;
  if (batch.snapshots.length !== 2 && batch.snapshots.length !== 3) return false;
  if (batch.outboxIntents.length !== 0) return false;
  const event = batch.events[0]!;
  if (event.schemaVersion !== 1) return false;
  if (event.eventType !== "WorkspaceWriteLeaseGranted") return false;
  if (!isKnownEventType(event.eventType)) return false;
  if (event.aggregateType !== "WorkspaceWriteLease") return false;
  if (event.aggregateRevision !== 1) return false;
  const lease = batch.snapshots[0]!;
  const index = batch.snapshots[1]!;
  if (lease.ref.aggregateType !== "WorkspaceWriteLease") return false;
  if (index.ref.aggregateType !== "WorkspaceWriteLeaseIndex") return false;
  if (lease.revision !== 1) return false;
  const expectedLeaseRef = workspaceWriteLeaseRefFor(event.projectId, event.payload.leaseId);
  if (canonicalJson(lease.ref) !== canonicalJson(expectedLeaseRef)) return false;
  const expectedIndexRef = workspaceWriteLeaseIndexRefFor(event.projectId, event.workspaceId);
  if (canonicalJson(index.ref) !== canonicalJson(expectedIndexRef)) return false;
  if (event.aggregateId !== event.payload.leaseId) return false;
  if (event.projectId !== lease.ref.projectId) return false;
  if (event.payload.leaseId !== lease.lease.leaseId) return false;
  if (canonicalJson(event.payload.scope) !== canonicalJson(lease.lease.scope)) return false;
  if (canonicalJson(event.payload.holder) !== canonicalJson({ runRef: lease.lease.holder.runRef, attemptRef: lease.lease.holder.attemptRef })) return false;
  if (event.payload.expiresAt !== lease.lease.expiresAt) return false;
  if (lease.lease.status !== "active") return false;
  if (lease.lease.grantedAt !== event.occurredAt) return false;
  if (lease.lease.releasedAt !== null || lease.lease.releasedBy !== null) return false;
  if (expectedVersionOf(batch, lease.ref) !== 0) return false;
  const opposingIndexRevision = expectedVersionOf(batch, workspaceReadLeaseIndexRefFor(event.projectId, event.workspaceId));
  if (opposingIndexRevision === null || !Number.isInteger(opposingIndexRevision) || opposingIndexRevision < 0) return false;
  if (!validateWriteLeaseIndexSnapshot(index, lease, batch)) return false;
  if (batch.vacatedLeaseRef !== null) {
    if (batch.snapshots.length !== 3) return false;
    const vacated = batch.snapshots[2]!;
    if (vacated.ref.aggregateType !== "WorkspaceWriteLease") return false;
    if (canonicalJson(vacated.ref) !== canonicalJson(batch.vacatedLeaseRef)) return false;
    if (vacated.revision !== 2) return false;
    if (vacated.lease.status !== "released") return false;
    if (vacated.lease.releasedBy !== null) return false;
    if (vacated.lease.releasedAt !== event.occurredAt) return false;
    if (expectedVersionOf(batch, vacated.ref) !== 1) return false;
  }

  return identityMatchesActor(event.projectId, event.idempotencyKey, event.actor.kind, event.actor.id, batch.identity);
}


export function validateWorkspaceWriteLeaseReleaseCommit(batch: WorkspaceWriteLeaseReleaseLedgerCommitV1): boolean {
  if (batch.schemaVersion !== 1) return false;
  if (batch.events.length !== 1) return false;
  if (batch.snapshots.length !== 2) return false;
  if (batch.outboxIntents.length !== 0) return false;
  const event = batch.events[0]!;
  if (event.schemaVersion !== 1) return false;
  if (event.eventType !== "WorkspaceWriteLeaseReleased") return false;
  if (!isKnownEventType(event.eventType)) return false;
  if (event.aggregateType !== "WorkspaceWriteLease") return false;
  if (event.aggregateRevision !== 2) return false;
  const lease = batch.snapshots[0]!;
  const index = batch.snapshots[1]!;
  if (lease.ref.aggregateType !== "WorkspaceWriteLease") return false;
  if (index.ref.aggregateType !== "WorkspaceWriteLeaseIndex") return false;
  if (lease.revision !== 2) return false;
  if (lease.lease.status !== "released") return false;
  if (lease.lease.releasedAt !== event.payload.releasedAt) return false;
  if (lease.lease.releasedBy !== event.payload.releasedBy) return false;
  if (event.payload.releasedVia !== "explicit") return false;
  if (event.payload.postWriteWorkspaceRevision !== null) return false;
  if (lease.lease.postWriteWorkspaceRevision !== null) return false;
  if (event.aggregateId !== lease.ref.leaseId) return false;
  if (event.payload.leaseId !== lease.ref.leaseId) return false;
  if (expectedVersionOf(batch, lease.ref) !== 1) return false;
  if (index.activeLeaseId !== null || index.activeScope !== null || index.holderRunRef !== null) return false;
  const indexWait = expectedVersionOf(batch, index.ref);
  if (indexWait === null || index.revision !== indexWait + 1) return false;

  return identityMatchesActor(event.projectId, event.idempotencyKey, event.actor.kind, event.actor.id, batch.identity);
}
