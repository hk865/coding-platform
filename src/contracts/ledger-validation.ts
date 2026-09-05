/**
 * P1-02 pure commit validators shared by BOTH StateLedger adapters.
 *
 * Scope: StateLedger-level invariants for the versioned P1-02 commit kinds
 * (governance-install / governance-activate / plan-revision). These validators
 * are pure functions over the commit batch — the same rules run against the
 * InMemory ledger and the SQLite ledger so neither adapter can drift.
 *
 * They implement the frozen "Event/snapshot/expected-revision alignment"
 * rule of the StateLedger module interface: each commit kind carries exactly
 * the events+snapshots+expected versions its semantics define; anything else
 * is an invalid_commit (zero-write). Control-level guards (digest check,
 * install-not-found, non-empty plan guards, cycle detection) live in the
 * Control handlers, NOT here.
 */
import type {
  GovernanceActivateLedgerCommitV1,
  GovernanceInstallLedgerCommitV1,
  PlanRevisionLedgerCommitV1,
} from "./ledger.js";
import type {
  ArchitectureBaselineRevisionSnapshot,
  CompletionPolicyRevisionSnapshot,
  ProjectArchitectureBaselineActiveSnapshot,
  ProjectCompletionPolicyActiveSnapshot,
} from "./governance.js";
import { canonicalJson } from "./fingerprint.js";
import { isKnownEventType } from "./events.js";

function identityMatchesActor(
  projectId: string,
  idempotencyKey: string,
  actorKind: string,
  actorId: string,
  batchIdentity: { projectId: string; idempotencyKey: string; actor: { kind: string; id: string } },
): boolean {
  return (
    projectId === batchIdentity.projectId &&
    idempotencyKey === batchIdentity.idempotencyKey &&
    actorKind === batchIdentity.actor.kind &&
    actorId === batchIdentity.actor.id
  );
}

// ------------------------------------------------------------------------ //
// governance-install                                                        //
// ------------------------------------------------------------------------ //

export function validateGovernanceInstallCommit(
  batch: GovernanceInstallLedgerCommitV1,
): boolean {
  if (batch.schemaVersion !== 1) return false;
  if (batch.events.length !== 1 || batch.snapshots.length !== 1) return false;
  const event = batch.events[0]!;
  const snapshot = batch.snapshots[0]!;
  if (event.schemaVersion !== 1 || snapshot.schemaVersion !== 1) return false;
  if (!isKnownEventType(event.eventType)) return false;
  if (event.aggregateRevision !== 1) return false;
  if (snapshot.revision !== 1) return false;

  if (event.eventType === "CompletionPolicyInstalled") {
    if (event.aggregateType !== "CompletionPolicyRevision") return false;
    if (snapshot.ref.aggregateType !== "CompletionPolicyRevision") return false;
    const s = snapshot as CompletionPolicyRevisionSnapshot;
    if (
      s.ref.projectId !== event.projectId ||
      s.policyId !== event.aggregateId ||
      s.contentRevision !== event.payload.revision ||
      s.contentDigest !== event.payload.contentDigest
    ) {
      return false;
    }
    if (canonicalJson(s.content) !== canonicalJson(event.payload.content)) return false;
  } else if (event.eventType === "ArchitectureBaselineInstalled") {
    if (event.aggregateType !== "ArchitectureBaselineRevision") return false;
    if (snapshot.ref.aggregateType !== "ArchitectureBaselineRevision") return false;
    const s = snapshot as ArchitectureBaselineRevisionSnapshot;
    if (
      s.ref.projectId !== event.projectId ||
      s.baselineId !== event.aggregateId ||
      s.contentRevision !== event.payload.revision ||
      s.contentDigest !== event.payload.contentDigest
    ) {
      return false;
    }
    if (canonicalJson(s.content) !== canonicalJson(event.payload.content)) return false;
  } else {
    return false;
  }

  // Immutability CAS: exactly one expected version = the revision at 0.
  if (batch.expectedVersions.length !== 1) return false;
  const expected = batch.expectedVersions[0]!;
  if (expected.revision !== 0) return false;
  if (canonicalJson(expected.ref) !== canonicalJson(snapshot.ref)) return false;

  return identityMatchesActor(
    event.projectId,
    event.idempotencyKey,
    event.actor.kind,
    event.actor.id,
    batch.identity,
  );
}

// ------------------------------------------------------------------------ //
// governance-activate                                                       //
// ------------------------------------------------------------------------ //

export function validateGovernanceActivateCommit(
  batch: GovernanceActivateLedgerCommitV1,
): boolean {
  if (batch.schemaVersion !== 1) return false;
  if (batch.events.length !== 1 || batch.snapshots.length !== 1) return false;
  const event = batch.events[0]!;
  const snapshot = batch.snapshots[0]!;
  if (event.schemaVersion !== 1) return false;
  if (!isKnownEventType(event.eventType)) return false;
  if (event.aggregateRevision !== snapshot.revision) return false;
  if (!Number.isSafeInteger(event.aggregateRevision) || event.aggregateRevision < 1) return false;

  if (event.eventType === "CompletionPolicyActivated") {
    if (event.aggregateType !== "ProjectCompletionPolicyActive") return false;
    if (snapshot.ref.aggregateType !== "ProjectCompletionPolicyActive") return false;
    const s = snapshot as ProjectCompletionPolicyActiveSnapshot;
    if (
      s.ref.projectId !== event.projectId ||
      s.projectId !== event.projectId ||
      s.activeRevision.policyId !== event.payload.target.ref.policyId ||
      s.activeRevision.projectId !== event.payload.target.ref.projectId ||
      s.activeRevision.revision !== event.payload.target.ref.revision
    ) {
      return false;
    }
    if (canonicalJson(s.activeRevision) !== canonicalJson(event.payload.target.ref)) {
      return false;
    }
  } else if (event.eventType === "ArchitectureBaselineActivated") {
    if (event.aggregateType !== "ProjectArchitectureBaselineActive") return false;
    if (snapshot.ref.aggregateType !== "ProjectArchitectureBaselineActive") return false;
    const s = snapshot as ProjectArchitectureBaselineActiveSnapshot;
    if (
      s.ref.projectId !== event.projectId ||
      s.projectId !== event.projectId ||
      s.activeRevision.baselineId !== event.payload.target.ref.baselineId ||
      s.activeRevision.projectId !== event.payload.target.ref.projectId ||
      s.activeRevision.revision !== event.payload.target.ref.revision
    ) {
      return false;
    }
    if (canonicalJson(s.activeRevision) !== canonicalJson(event.payload.target.ref)) {
      return false;
    }
  } else {
    return false;
  }

  // CAS: [Project@expected, ActiveAggregate@(snapshot.revision - 1)].
  if (batch.expectedVersions.length !== 2) return false;
  if (batch.expectedVersions[0]!.ref.aggregateType !== "Project") return false;
  if (batch.expectedVersions[0]!.ref.projectId !== event.projectId) return false;
  if (batch.expectedVersions[1]!.revision !== snapshot.revision - 1) return false;
  if (canonicalJson(batch.expectedVersions[1]!.ref) !== canonicalJson(snapshot.ref)) return false;

  return identityMatchesActor(
    event.projectId,
    event.idempotencyKey,
    event.actor.kind,
    event.actor.id,
    batch.identity,
  );
}

// ------------------------------------------------------------------------ //
// plan-revision                                                             //
// ------------------------------------------------------------------------ //

export function validatePlanRevisionCommit(batch: PlanRevisionLedgerCommitV1): boolean {
  if (batch.schemaVersion !== 1) return false;
  if (batch.events.length !== 1 || batch.snapshots.length !== 2) return false;
  const event = batch.events[0]!;
  if (event.schemaVersion !== 1) return false;
  if (event.eventType !== "PlanRevisionAccepted") return false;
  if (!isKnownEventType(event.eventType)) return false;
  if (event.aggregateType !== "PlanRevision") return false;
  if (event.aggregateRevision !== 1) return false;

  const planSnapshot = batch.snapshots.find(
    (s): s is Extract<typeof s, { ref: { aggregateType: "PlanRevision" } }> =>
      s.ref.aggregateType === "PlanRevision",
  );
  const goalSnapshot = batch.snapshots.find(
    (s): s is Extract<typeof s, { ref: { aggregateType: "Goal" } }> => s.ref.aggregateType === "Goal",
  );
  if (planSnapshot === undefined || goalSnapshot === undefined) return false;
  if (planSnapshot.revision !== 1) return false;
  if (planSnapshot.schemaVersion !== 1) return false;

  // Plan snapshot aligns with the event aggregate identity.
  if (
    planSnapshot.ref.projectId !== event.projectId ||
    planSnapshot.planId !== event.aggregateId ||
    planSnapshot.goalRef.projectId !== event.projectId ||
    planSnapshot.goalRef.goalId !== event.payload.goalId
  ) {
    return false;
  }
  // The event carries the exact accepted snapshot (ReadModel replay source).
  if (canonicalJson(event.payload.planRevision) !== canonicalJson(planSnapshot)) return false;

  // Goal snapshot advances by one; workspace must stay consistent.
  if (goalSnapshot.revision !== event.aggregateRevision + 1) return false;
  if (goalSnapshot.activePlanRevision === null) return false;
  if (canonicalJson(goalSnapshot.activePlanRevision) !== canonicalJson(planSnapshot.ref)) {
    return false;
  }
  if (goalSnapshot.ref.projectId !== event.projectId || goalSnapshot.ref.goalId !== event.payload.goalId) {
    return false;
  }
  if (goalSnapshot.workspaceRef.projectId !== event.projectId) return false;
  if (goalSnapshot.workspaceRef.workspaceId !== event.workspaceId) return false;

  // CAS: [Goal@(goalSnapshot.revision - 1), PlanRevision@0].
  if (batch.expectedVersions.length !== 2) return false;
  if (batch.expectedVersions[0]!.revision !== goalSnapshot.revision - 1) return false;
  if (canonicalJson(batch.expectedVersions[0]!.ref) !== canonicalJson(goalSnapshot.ref)) return false;
  if (batch.expectedVersions[1]!.revision !== 0) return false;
  if (canonicalJson(batch.expectedVersions[1]!.ref) !== canonicalJson(planSnapshot.ref)) return false;

  return identityMatchesActor(
    event.projectId,
    event.idempotencyKey,
    event.actor.kind,
    event.actor.id,
    batch.identity,
  );
}
