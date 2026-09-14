/** Control-owned canonical record construction. */
import type { AcquireWorkspaceReadLeaseCommand, AcquireWorkspaceWriteLeaseCommand, ReleaseWorkspaceLeaseCommand, WorkspaceReadLeaseIndexSnapshot, WorkspaceReadLeaseSnapshot, WorkspaceWriteLeaseIndexSnapshot, WorkspaceWriteLeaseSnapshot } from "../../../contracts/workspace-lease.js";
import { acquireReadLeaseFingerprint, acquireWriteLeaseFingerprint, releaseLeaseFingerprint, workspaceReadLeaseIndexRefFor, workspaceReadLeaseRefFor, workspaceWriteLeaseIndexRefFor, workspaceWriteLeaseRefFor } from "../../../contracts/workspace-lease.js";
import type { IntegrationResultSnapshot, IntegrationTaskResultV1, RecordIntegrationResultCommand } from "../../../contracts/integration.js";
import { integrationResultRefFor, recordIntegrationFingerprint } from "../../../contracts/integration.js";
import type { RecordPatchCommand } from "../../../contracts/patch.js";
import { patchRecordRefFor, recordPatchFingerprint } from "../../../contracts/patch.js";



// ------------------------------------------------------------------------ //
// Ledger commit builders (fold targets — fold equality is a frozen rule)    //
// ------------------------------------------------------------------------ //

export type BuildP107ReadAcquireCommitDeps = {
  eventId: string;
  occurredAt: string;
  indexSnapshot: WorkspaceReadLeaseIndexSnapshot;
  /** Version observed while checking for overlapping writers (0 if absent). */
  writeIndexRevision?: number;
};


export function buildWorkspaceReadLeaseAcquireLedgerCommit(
  command: AcquireWorkspaceReadLeaseCommand,
  deps: BuildP107ReadAcquireCommitDeps,
): import("../../../contracts/ledger.js").WorkspaceReadLeaseAcquireLedgerCommitV1 {
  const leaseId = command.aggregateId;
  const leaseSnapshot: WorkspaceReadLeaseSnapshot = {
    ref: workspaceReadLeaseRefFor(command.identity.projectId, leaseId),
    revision: 1,
    schemaVersion: 1,
    lease: {
      schemaVersion: 1,
      leaseId,
      projectId: command.payload.projectId,
      workspaceId: command.payload.workspaceId,
      scope: command.payload.scope,
      holder: command.payload.holder,
      grantedAt: deps.occurredAt,
      expiresAt: command.payload.expiresAt,
      status: "active",
      releasedAt: null,
      releasedBy: null,
    },
  };
  const index = deps.indexSnapshot;
  const nextIndex: WorkspaceReadLeaseIndexSnapshot = {
    ref: workspaceReadLeaseIndexRefFor(command.identity.projectId, command.payload.workspaceId),
    revision: index.revision + 1,
    schemaVersion: 1,
    activeReadLeases: [
      ...index.activeReadLeases,
      { leaseId, scope: command.payload.scope },
    ],
  };
  return {
    commitKind: "workspace-read-lease-acquire",
    schemaVersion: 1,
    identity: command.identity,
    fingerprint: acquireReadLeaseFingerprint(command),
    expectedVersions: [
      { ref: leaseSnapshot.ref, revision: 0 },
      { ref: index.ref, revision: index.revision },
      { ref: workspaceWriteLeaseIndexRefFor(command.identity.projectId, command.payload.workspaceId), revision: deps.writeIndexRevision ?? 0 },
    ],
    events: [workspaceReadLeaseGrantedEventFor(command, deps.eventId, deps.occurredAt)],
    snapshots: [leaseSnapshot, nextIndex],
    outboxIntents: [],
  };
}


export type BuildP107ReadReleaseCommitDeps = {
  eventId: string;
  occurredAt: string;
  indexSnapshot: WorkspaceReadLeaseIndexSnapshot;
};


export function buildWorkspaceReadLeaseReleaseLedgerCommit(
  command: ReleaseWorkspaceLeaseCommand,
  activeSnapshot: WorkspaceReadLeaseSnapshot,
  deps: BuildP107ReadReleaseCommitDeps,
): import("../../../contracts/ledger.js").WorkspaceReadLeaseReleaseLedgerCommitV1 {
  const leaseSnapshot: WorkspaceReadLeaseSnapshot = {
    ref: activeSnapshot.ref,
    revision: 2,
    schemaVersion: 1,
    lease: { ...activeSnapshot.lease, status: "released", releasedAt: deps.occurredAt, releasedBy: "holder" },
  };
  const index = deps.indexSnapshot;
  const nextIndex: WorkspaceReadLeaseIndexSnapshot = {
    ref: index.ref,
    revision: index.revision + 1,
    schemaVersion: 1,
    activeReadLeases: index.activeReadLeases.filter((e) => e.leaseId !== command.payload.leaseId),
  };
  return {
    commitKind: "workspace-read-lease-release",
    schemaVersion: 1,
    identity: command.identity,
    fingerprint: releaseLeaseFingerprint(command),
    expectedVersions: [
      { ref: activeSnapshot.ref, revision: 1 },
      { ref: index.ref, revision: index.revision },
    ],
    events: [workspaceReadLeaseReleasedEventFor(command, deps.eventId, deps.occurredAt)],
    snapshots: [leaseSnapshot, nextIndex],
    outboxIntents: [],
  };
}


export type BuildP107WriteAcquireCommitDeps = {
  eventId: string;
  occurredAt: string;
  indexSnapshot: WorkspaceWriteLeaseIndexSnapshot;
  /** Version observed while checking for overlapping readers (0 if absent). */
  readIndexRevision?: number;
  /** Expired active lease vacated in the same commit (null otherwise). */
  vacatedSnapshot?: WorkspaceWriteLeaseSnapshot;
};


export function buildWorkspaceWriteLeaseAcquireLedgerCommit(
  command: AcquireWorkspaceWriteLeaseCommand,
  deps: BuildP107WriteAcquireCommitDeps,
): import("../../../contracts/ledger.js").WorkspaceWriteLeaseAcquireLedgerCommitV1 {
  const leaseId = command.aggregateId;
  const leaseSnapshot: WorkspaceWriteLeaseSnapshot = {
    ref: workspaceWriteLeaseRefFor(command.identity.projectId, leaseId),
    revision: 1,
    schemaVersion: 1,
    lease: {
      schemaVersion: 1,
      leaseId,
      projectId: command.payload.projectId,
      workspaceId: command.payload.workspaceId,
      scope: command.payload.scope,
      holder: command.payload.holder,
      grantedAt: deps.occurredAt,
      expiresAt: command.payload.expiresAt,
      status: "active",
      releasedAt: null,
      releasedBy: null,
      patches: [],
      postWriteWorkspaceRevision: null,
    },
  };
  const index = deps.indexSnapshot;
  const nextIndex: WorkspaceWriteLeaseIndexSnapshot = {
    ref: workspaceWriteLeaseIndexRefFor(command.identity.projectId, command.payload.workspaceId),
    revision: index.revision + 1,
    schemaVersion: 1,
    activeLeaseId: leaseId,
    activeScope: command.payload.scope,
    holderRunRef: command.payload.holder.runRef,
  };
  let vacatedSnap: WorkspaceWriteLeaseSnapshot | null = null;
  let vacatedRef: WorkspaceWriteLeaseSnapshot["ref"] | null = null;
  const vacated = deps.vacatedSnapshot;
  if (vacated !== undefined) {
    vacatedRef = vacated.ref;
    vacatedSnap = {
      ref: vacated.ref,
      revision: 2,
      schemaVersion: 1,
      lease: {
        ...vacated.lease,
        status: "released",
        releasedAt: deps.occurredAt,
        releasedBy: null,
      },
    };
  }
  const expectedVersions: import("../../../contracts/ledger.js").ExpectedVersion[] = [
    { ref: leaseSnapshot.ref, revision: 0 },
    { ref: index.ref, revision: index.revision },
    { ref: workspaceReadLeaseIndexRefFor(command.identity.projectId, command.payload.workspaceId), revision: deps.readIndexRevision ?? 0 },
  ];
  if (vacatedSnap !== null && vacatedRef !== null) {
    expectedVersions.push({ ref: vacatedRef, revision: 1 });
  }
  return {
    commitKind: "workspace-write-lease-acquire",
    schemaVersion: 1,
    identity: command.identity,
    fingerprint: acquireWriteLeaseFingerprint(command),
    expectedVersions,
    events: [workspaceWriteLeaseGrantedEventFor(command, deps.eventId, deps.occurredAt)],
    snapshots: vacatedSnap === null ? [leaseSnapshot, nextIndex] : [leaseSnapshot, nextIndex, vacatedSnap],
    vacatedLeaseRef: vacatedSnap === null ? null : vacatedRef,
    outboxIntents: [],
  };
}


export type BuildP107WriteReleaseCommitDeps = {
  eventId: string;
  occurredAt: string;
  indexSnapshot: WorkspaceWriteLeaseIndexSnapshot;
};


export function buildWorkspaceWriteLeaseReleaseLedgerCommit(
  command: ReleaseWorkspaceLeaseCommand,
  activeSnapshot: WorkspaceWriteLeaseSnapshot,
  deps: BuildP107WriteReleaseCommitDeps,
): import("../../../contracts/ledger.js").WorkspaceWriteLeaseReleaseLedgerCommitV1 {
  const leaseSnapshot: WorkspaceWriteLeaseSnapshot = {
    ref: activeSnapshot.ref,
    revision: 2,
    schemaVersion: 1,
    lease: { ...activeSnapshot.lease, status: "released", releasedAt: deps.occurredAt, releasedBy: "holder" },
  };
  const index = deps.indexSnapshot;
  const nextIndex: WorkspaceWriteLeaseIndexSnapshot = {
    ref: index.ref,
    revision: index.revision + 1,
    schemaVersion: 1,
    activeLeaseId: null,
    activeScope: null,
    holderRunRef: null,
  };
  return {
    commitKind: "workspace-write-lease-release",
    schemaVersion: 1,
    identity: command.identity,
    fingerprint: releaseLeaseFingerprint(command),
    expectedVersions: [
      { ref: activeSnapshot.ref, revision: 1 },
      { ref: index.ref, revision: index.revision },
    ],
    events: [workspaceWriteLeaseReleasedEventFor(command, deps.eventId, deps.occurredAt)],
    snapshots: [leaseSnapshot, nextIndex],
    outboxIntents: [],
  };
}


export type BuildP107IntegrationCommitDeps = {
  eventId: string;
  occurredAt: string;
  priorRecords: IntegrationTaskResultV1[];
};


export function buildIntegrationRecordLedgerCommit(
  command: RecordIntegrationResultCommand,
  deps: BuildP107IntegrationCommitDeps,
): import("../../../contracts/ledger.js").IntegrationRecordLedgerCommitV1 {
  const result = command.payload.result;
  const snapshot: IntegrationResultSnapshot = {
    ref: integrationResultRefFor(command.identity.projectId, result.goalId, result.taskId),
    revision: deps.priorRecords.length + 1,
    schemaVersion: 1,
    records: [...deps.priorRecords, result],
  };
  return {
    commitKind: "integration-record",
    schemaVersion: 1,
    identity: command.identity,
    fingerprint: recordIntegrationFingerprint(command),
    expectedVersions: [{ ref: snapshot.ref, revision: deps.priorRecords.length }],
    events: [
      { ...integrationJoinedEventFor(command, deps.eventId, deps.occurredAt), aggregateRevision: snapshot.revision },
    ],
    snapshots: [snapshot],
    outboxIntents: [],
  };
}


export type BuildP107PatchCommitDeps = {
  eventId: string;
  occurredAt: string;
  workspaceRevisionBefore: number;
  activeLeaseSnapshot: WorkspaceWriteLeaseSnapshot;
  writeIndexSnapshot: WorkspaceWriteLeaseIndexSnapshot;
};


export function buildPatchRecordLedgerCommit(
  command: RecordPatchCommand,
  deps: BuildP107PatchCommitDeps,
): import("../../../contracts/ledger.js").PatchRecordLedgerCommitV1 {
  const patch = command.payload.patch;
  const patchSnapshot: import("../../../contracts/patch.js").PatchRecordSnapshot = {
    ref: patchRecordRefFor(command.identity.projectId, patch.patchId),
    revision: 1,
    schemaVersion: 1,
    patch,
    recordedAt: deps.occurredAt,
  };
  const workspaceSnapshot = {
    ref: { aggregateType: "Workspace" as const, projectId: command.identity.projectId, workspaceId: patch.workspaceId },
    revision: patch.afterWorkspaceRevision,
  };
  const lease = deps.activeLeaseSnapshot;
  const leaseSnapshot: WorkspaceWriteLeaseSnapshot = {
    ref: lease.ref,
    revision: 2,
    schemaVersion: 1,
    lease: {
      ...lease.lease,
      status: "released",
      releasedAt: deps.occurredAt,
      releasedBy: "holder",
      patches: [...lease.lease.patches, patchSnapshot.ref],
      postWriteWorkspaceRevision: patch.afterWorkspaceRevision,
    },
  };
  const index = deps.writeIndexSnapshot;
  const nextIndex: WorkspaceWriteLeaseIndexSnapshot = {
    ref: index.ref,
    revision: index.revision + 1,
    schemaVersion: 1,
    activeLeaseId: null,
    activeScope: null,
    holderRunRef: null,
  };
  return {
    commitKind: "patch-record",
    schemaVersion: 1,
    identity: command.identity,
    fingerprint: recordPatchFingerprint(command),
    expectedVersions: [
      { ref: patchSnapshot.ref, revision: 0 },
      { ref: workspaceSnapshot.ref, revision: deps.workspaceRevisionBefore },
      { ref: lease.ref, revision: 1 },
      { ref: index.ref, revision: index.revision },
    ],
    events: [patchRecordedEventFor(command, deps.eventId, deps.occurredAt), workspaceWriteLeaseReleasedViaPatchEventFor(command, deps.eventId, deps.occurredAt, patch.afterWorkspaceRevision, lease.ref.leaseId)],
    snapshots: [patchSnapshot, workspaceSnapshot, leaseSnapshot, nextIndex],
    outboxIntents: [],
  };
}


// ------------------------------------------------------------------------ //
// Event folds (used by the commit builders above)                           //
// ------------------------------------------------------------------------ //

function workspaceReadLeaseGrantedEventFor(command: AcquireWorkspaceReadLeaseCommand, eventId: string, occurredAt: string) : import("../../../contracts/workspace-lease.js").WorkspaceReadLeaseGrantedEvent {
  return {
    eventId,
    eventType: "WorkspaceReadLeaseGranted" as const,
    schemaVersion: 1 as const,
    projectId: command.identity.projectId,
    workspaceId: command.payload.workspaceId,
    aggregateType: "WorkspaceReadLease" as const,
    aggregateId: command.aggregateId,
    aggregateRevision: 1,
    causationId: command.commandId,
    correlationId: command.correlationId,
    idempotencyKey: command.identity.idempotencyKey,
    actor: command.identity.actor,
    occurredAt,
    payload: {
      leaseId: command.aggregateId,
      scope: command.payload.scope,
      holder: { runRef: command.payload.holder.runRef, attemptRef: command.payload.holder.attemptRef },
      expiresAt: command.payload.expiresAt,
    },
  };
}


function workspaceReadLeaseReleasedEventFor(command: ReleaseWorkspaceLeaseCommand, eventId: string, occurredAt: string) : import("../../../contracts/workspace-lease.js").WorkspaceReadLeaseReleasedEvent {
  return {
    eventId,
    eventType: "WorkspaceReadLeaseReleased" as const,
    schemaVersion: 1 as const,
    projectId: command.identity.projectId,
    workspaceId: command.payload.workspaceId,
    aggregateType: "WorkspaceReadLease" as const,
    aggregateId: command.payload.leaseId,
    aggregateRevision: 2,
    causationId: command.commandId,
    correlationId: command.correlationId,
    idempotencyKey: command.identity.idempotencyKey,
    actor: command.identity.actor,
    occurredAt,
    payload: { leaseId: command.payload.leaseId, releasedAt: occurredAt, releasedBy: "holder" },
  };
}


function workspaceWriteLeaseGrantedEventFor(command: AcquireWorkspaceWriteLeaseCommand, eventId: string, occurredAt: string) : import("../../../contracts/workspace-lease.js").WorkspaceWriteLeaseGrantedEvent {
  return {
    eventId,
    eventType: "WorkspaceWriteLeaseGranted" as const,
    schemaVersion: 1 as const,
    projectId: command.identity.projectId,
    workspaceId: command.payload.workspaceId,
    aggregateType: "WorkspaceWriteLease" as const,
    aggregateId: command.aggregateId,
    aggregateRevision: 1,
    causationId: command.commandId,
    correlationId: command.correlationId,
    idempotencyKey: command.identity.idempotencyKey,
    actor: command.identity.actor,
    occurredAt,
    payload: {
      leaseId: command.aggregateId,
      scope: command.payload.scope,
      holder: { runRef: command.payload.holder.runRef, attemptRef: command.payload.holder.attemptRef },
      expiresAt: command.payload.expiresAt,
    },
  };
}


function workspaceWriteLeaseReleasedEventFor(command: ReleaseWorkspaceLeaseCommand, eventId: string, occurredAt: string) : import("../../../contracts/workspace-lease.js").WorkspaceWriteLeaseReleasedEvent {
  return {
    eventId,
    eventType: "WorkspaceWriteLeaseReleased" as const,
    schemaVersion: 1,
    projectId: command.identity.projectId,
    workspaceId: command.payload.workspaceId,
    aggregateType: "WorkspaceWriteLease" as const,
    aggregateId: command.payload.leaseId,
    aggregateRevision: 2,
    causationId: command.commandId,
    correlationId: command.correlationId,
    idempotencyKey: command.identity.idempotencyKey,
    actor: command.identity.actor,
    occurredAt,
    payload: { leaseId: command.payload.leaseId, releasedAt: occurredAt, releasedBy: "holder", releasedVia: "explicit", postWriteWorkspaceRevision: null },
  };
}


function workspaceWriteLeaseReleasedViaPatchEventFor(command: RecordPatchCommand, eventId: string, occurredAt: string, postWriteWorkspaceRevision: number, leaseId: string) : import("../../../contracts/workspace-lease.js").WorkspaceWriteLeaseReleasedEvent {
  const patch = command.payload.patch;
  return {
    eventId,
    eventType: "WorkspaceWriteLeaseReleased" as const,
    schemaVersion: 1,
    projectId: command.identity.projectId,
    workspaceId: patch.workspaceId,
    aggregateType: "WorkspaceWriteLease" as const,
    aggregateId: leaseId,
    aggregateRevision: 2,
    causationId: command.commandId,
    correlationId: command.correlationId,
    idempotencyKey: command.identity.idempotencyKey,
    actor: command.identity.actor,
    occurredAt,
    payload: { leaseId, releasedAt: occurredAt, releasedBy: "holder", releasedVia: "patch-record", postWriteWorkspaceRevision },
  };
}


function integrationJoinedEventFor(command: RecordIntegrationResultCommand, eventId: string, occurredAt: string) : import("../../../contracts/integration.js").IntegrationJoinedEvent {
  const result = command.payload.result;
  return {
    eventId,
    eventType: "IntegrationJoined" as const,
    schemaVersion: 1,
    projectId: command.identity.projectId,
    workspaceId: result.workspaceId,
    aggregateType: "IntegrationResult" as const,
    aggregateId: result.taskId,
    aggregateRevision: 0, // patched below by the caller (see buildIntegrationRecordLedgerCommit)
    causationId: command.commandId,
    correlationId: command.correlationId,
    idempotencyKey: command.identity.idempotencyKey,
    actor: command.identity.actor,
    occurredAt,
    payload: {
      resultId: result.resultId,
      goalId: result.goalId,
      taskId: result.taskId,
      runRef: result.runRef,
      attemptRef: result.attemptRef,
      workspaceRevision: result.workspaceRevision,
      planRef: result.planRef,
      inputs: result.inputs,
      conflicts: result.conflicts,
      gaps: result.gaps,
      explanation: result.explanation,
      escalate: result.escalate,
      generatedAt: result.generatedAt,
    },
  };
}


function patchRecordedEventFor(command: RecordPatchCommand, eventId: string, occurredAt: string) : import("../../../contracts/patch.js").PatchRecordedEvent {
  const patch = command.payload.patch;
  return {
    eventId,
    eventType: "PatchRecorded" as const,
    schemaVersion: 1,
    projectId: command.identity.projectId,
    workspaceId: patch.workspaceId,
    aggregateType: "PatchRecord" as const,
    aggregateId: patch.patchId,
    aggregateRevision: 1,
    causationId: command.commandId,
    correlationId: command.correlationId,
    idempotencyKey: command.identity.idempotencyKey,
    actor: command.identity.actor,
    occurredAt,
    payload: {
      patchId: patch.patchId,
      goalId: patch.goalId,
      taskId: patch.taskId,
      runRef: patch.runRef,
      attemptRef: patch.attemptRef,
      kind: patch.kind,
      title: patch.title,
      changedPaths: patch.changedPaths,
      beforeWorkspaceRevision: patch.beforeWorkspaceRevision,
      afterWorkspaceRevision: patch.afterWorkspaceRevision,
      checkResults: patch.checkResults,
      usedInputEvidenceRefs: patch.usedInputEvidenceRefs,
      generatedAt: patch.generatedAt,
    },
  };
}