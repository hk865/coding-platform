/**
 * P1-07 frozen contract: Workspace leases + ConflictScope +
 * DispatchEngine.WorkspaceLeasePort (interfaces_to_freeze #1 — first consumer
 * P1-07). Authority: IMPLEMENTATION-HANDOFF.md "P1-07 契约与存储语义" (items
 * 1, 2, 3, 5, 6, 7, 8) + tickets/07-parallel-readers-single-writer.md +
 * ARCHITECTURE.md invariant #7.
 *
 * FROZEN semantics:
 *   - ConflictScope is the full-scope conflict key (project+workspace+
 *     scope-kind+id; revision is INFORMATIONAL and never participates in
 *     overlap). Overlap = syntactic intersection only (no semantic
 *     inference: task/stage/goal labels never overlap paths; different label
 *     kinds never overlap).
 *   - WorkspaceReadLease: SHARED / overlapping / re-entrant. Read-read never
 *     conflicts (any number of readers, including the same run, may hold
 *     overlapping read leases). Read-write overlap is a hard conflict.
 *   - WorkspaceWriteLease: EXCLUSIVE. Uniqueness is enforced by the
 *     WorkspaceWriteLeaseIndex aggregate per (project, workspace) — the
 *     workspace-level exclusivity is the MVP reading of invariant #7 (ONE
 *     writer per workspace; stronger than per-scope exclusivity).
 *   - Expiry semantics (MVP: no background recycle — P1-10): an expired
 *     (expiresAt <= now) lease is not admissible and does NOT block a
 *     requestor. Acquiring a new write lease over an expired active lease
 *     atomically vacates it (snapshot @2, releasedBy = null) — recorded, no
 *     ownership transfer, no retry/renewal.
 *   - read-only-capability-enforcement: every acquire resolves the
 *     WorkspaceCapabilityPort; unsupported is a hard rejection (never a
 *     silent degrade); a reader run can NEVER obtain a write lease
 *     (capability_readonly); write scopes must be ⊆ the declared permissions
 *     writeScope (scope_not_declared — 越权零写入) and ⊆ the capability cap.
 *   - acquire guards are IDENTITY-scoped: the holder run must EXIST
 *     (run_not_found); a lease is a control token with explicit release and
 *     expiry — it is legal to acquire for an ended run (a completed run may
 *     still record its outputs under the same runRef).
 */
import type { ActorRef, CommandFingerprint, CommandIdentity, CommitCursor } from "./command-event.js";
import { canonicalJson, sha256Hex } from "./fingerprint.js";
import type { RoleBindingRefV1, RunRef, TaskAttemptRef } from "./dispatch.js";
import type { PatchRecordRef } from "./patch.js";

// ------------------------------------------------------------------------ //
// Limits                                                                    //
// ------------------------------------------------------------------------ //

export const WORKSPACE_LEASE_MAX_ACTIVE_READ_LEASES = 256;

// ------------------------------------------------------------------------ //
// ConflictScope                                                             //
// ------------------------------------------------------------------------ //

export type ConflictScopeKind = "workspace" | "module" | "path" | "task" | "stage" | "goal";

export const CONFLICT_SCOPE_KINDS: readonly ConflictScopeKind[] = [
  "workspace",
  "module",
  "path",
  "task",
  "stage",
  "goal",
];

/** Full-scope conflict key. id = workspaceId | moduleRef | path prefix | taskId | stageId | goalId. */
export type ConflictScopeV1 = {
  schemaVersion: 1;
  projectId: string;
  workspaceId: string;
  kind: ConflictScopeKind;
  id: string;
  /** INFORMATIONAL workspace revision — never part of overlap. */
  revision: number | null;
};

export function isPathLikeScopeKind(kind: ConflictScopeKind): boolean {
  return kind === "module" || kind === "path";
}

/**
 * FROZEN syntactic overlap (pure): same project+workspace AND
 *   (a) either side is "workspace" -> true;
 *   (b) same kind + id -> true;
 *   (c) both path-like (module|path) and one id is a prefix of the other
 *       (path-segment boundary) -> true;
 *   (d) otherwise false. NO semantic inference — labels never overlap paths,
 *       different label kinds never overlap.
 */
export function scopeOverlap(a: ConflictScopeV1, b: ConflictScopeV1): boolean {
  if (a.projectId !== b.projectId) return false;
  if (a.workspaceId !== b.workspaceId) return false;
  if (a.kind === "workspace" || b.kind === "workspace") return true;
  if (a.kind === b.kind && a.id === b.id) return true;
  if (isPathLikeScopeKind(a.kind) && isPathLikeScopeKind(b.kind)) {
    const ai = a.id.replace(/\/+$/, "");
    const bi = b.id.replace(/\/+$/, "");
    return ai === bi || ai.startsWith(bi + "/") || bi.startsWith(ai + "/");
  }
  return false;
}

/** Canonical conflict key (excludes the informational revision). */
export function conflictScopeKeyFor(scope: ConflictScopeV1): string {
  return sha256Hex(
    canonicalJson({
      schemaVersion: scope.schemaVersion,
      projectId: scope.projectId,
      workspaceId: scope.workspaceId,
      kind: scope.kind,
      id: scope.id,
    }),
  );
}

/**
 * FROZEN declared-write-scope check (pure): entries are plain path prefixes
 * (module/path id or an ancestor directory), the workspaceId or "*" for a
 * workspace scope, and "<kind>:<id>" for label scopes (exact match only).
 */
export function scopeCoveredByWriteScope(scope: ConflictScopeV1, declaredWriteScope: string[]): boolean {
  if (scope.kind === "workspace") {
    return declaredWriteScope.includes(scope.workspaceId) || declaredWriteScope.includes("*");
  }
  if (isPathLikeScopeKind(scope.kind)) {
    const id = scope.id.replace(/\/+$/, "");
    return declaredWriteScope.some((entry) => {
      const e = entry.replace(/\/+$/, "");
      if (e.length === 0) return false;
      return id === e || id.startsWith(e + "/");
    });
  }
  return declaredWriteScope.includes(scope.kind + ":" + scope.id);
}

// ------------------------------------------------------------------------ //
// Lease holder                                                              //
// ------------------------------------------------------------------------ //

export type WorkspaceLeaseHolderV1 = {
  runRef: RunRef;
  attemptRef: TaskAttemptRef;
  roleBinding: RoleBindingRefV1;
};

// ------------------------------------------------------------------------ //
// Lease aggregates                                                          //
// ------------------------------------------------------------------------ //

export type WorkspaceReadLeaseRef = {
  aggregateType: "WorkspaceReadLease";
  projectId: string;
  leaseId: string;
};

export type WorkspaceReadLeaseIndexRef = {
  aggregateType: "WorkspaceReadLeaseIndex";
  projectId: string;
  workspaceId: string;
};

export type WorkspaceWriteLeaseRef = {
  aggregateType: "WorkspaceWriteLease";
  projectId: string;
  leaseId: string;
};

export type WorkspaceWriteLeaseIndexRef = {
  aggregateType: "WorkspaceWriteLeaseIndex";
  projectId: string;
  workspaceId: string;
};

export function workspaceReadLeaseRefFor(projectId: string, leaseId: string): WorkspaceReadLeaseRef {
  return { aggregateType: "WorkspaceReadLease", projectId, leaseId };
}

export function workspaceReadLeaseIndexRefFor(projectId: string, workspaceId: string): WorkspaceReadLeaseIndexRef {
  return { aggregateType: "WorkspaceReadLeaseIndex", projectId, workspaceId };
}

export function workspaceWriteLeaseRefFor(projectId: string, leaseId: string): WorkspaceWriteLeaseRef {
  return { aggregateType: "WorkspaceWriteLease", projectId, leaseId };
}

export function workspaceWriteLeaseIndexRefFor(projectId: string, workspaceId: string): WorkspaceWriteLeaseIndexRef {
  return { aggregateType: "WorkspaceWriteLeaseIndex", projectId, workspaceId };
}

export type WorkspaceReadLeaseV1 = {
  schemaVersion: 1;
  leaseId: string;
  projectId: string;
  workspaceId: string;
  scope: ConflictScopeV1;
  holder: WorkspaceLeaseHolderV1;
  grantedAt: string;
  expiresAt: string | null;
  status: "active" | "released";
  releasedAt: string | null;
  releasedBy: "holder" | null;
};

export type WorkspaceReadLeaseSnapshot = {
  ref: WorkspaceReadLeaseRef;
  revision: number;
  schemaVersion: 1;
  lease: WorkspaceReadLeaseV1;
};

export type WorkspaceReadLeaseIndexSnapshot = {
  ref: WorkspaceReadLeaseIndexRef;
  revision: number;
  schemaVersion: 1;
  /** Active (admissible at grant time at least) read leases — bounded display surface. */
  activeReadLeases: { leaseId: string; scope: ConflictScopeV1 }[];
};

export type WorkspaceWriteLeaseV1 = {
  schemaVersion: 1;
  leaseId: string;
  projectId: string;
  workspaceId: string;
  scope: ConflictScopeV1;
  holder: WorkspaceLeaseHolderV1;
  grantedAt: string;
  expiresAt: string | null;
  status: "active" | "released";
  releasedAt: string | null;
  releasedBy: "holder" | null;
  /** Patch records recorded under this lease (bind order). */
  patches: PatchRecordRef[];
  /** Workspace revision AFTER the last patch-recorded release (null if none). */
  postWriteWorkspaceRevision: number | null;
};

export type WorkspaceWriteLeaseSnapshot = {
  ref: WorkspaceWriteLeaseRef;
  revision: number;
  schemaVersion: 1;
  lease: WorkspaceWriteLeaseV1;
};

export type WorkspaceWriteLeaseIndexSnapshot = {
  ref: WorkspaceWriteLeaseIndexRef;
  revision: number;
  schemaVersion: 1;
  /** null = no active writer (the exclusivity invariant). */
  activeLeaseId: string | null;
  activeScope: ConflictScopeV1 | null;
  holderRunRef: RunRef | null;
};

// ------------------------------------------------------------------------ //
// Lease admissibility (pure)                                                //
// ------------------------------------------------------------------------ //

export type LeaseAdmissibility =
  | { admissible: true }
  | { admissible: false; reason: "expired" | "released" };

/**
 * FROZEN pure admissibility: a lease is effective ONLY while
 * status === "active" AND (expiresAt === null OR expiresAt > now). An expired
 * lease is not admissible but remains a recorded fact the holder may release
 * (already_expired — zero write).
 */
export function evaluateLeaseAdmissibility(
  lease: { status: "active" | "released"; expiresAt: string | null },
  now: string,
): LeaseAdmissibility {
  if (lease.status !== "active") return { admissible: false, reason: "released" };
  if (lease.expiresAt !== null && lease.expiresAt <= now) return { admissible: false, reason: "expired" };
  return { admissible: true };
}

// ------------------------------------------------------------------------ //
// Commands / receipts                                                       //
// ------------------------------------------------------------------------ //

export type AcquireWorkspaceReadLeaseCommand = {
  commandId: string;
  commandType: "AcquireWorkspaceReadLease";
  schemaVersion: 1;
  identity: CommandIdentity;
  /** leaseId (deterministic client identity of the logical lease). */
  aggregateId: string;
  /** expected WorkspaceReadLease revision (0 = new aggregate; acquire only). */
  expectedRevision: number;
  correlationId: string;
  submittedAt: string;
  payload: {
    projectId: string;
    workspaceId: string;
    scope: ConflictScopeV1;
    holder: WorkspaceLeaseHolderV1;
    expiresAt: string | null;
  };
};

export type AcquireWorkspaceWriteLeaseCommand = {
  commandId: string;
  commandType: "AcquireWorkspaceWriteLease";
  schemaVersion: 1;
  identity: CommandIdentity;
  aggregateId: string;
  expectedRevision: number;
  correlationId: string;
  submittedAt: string;
  payload: {
    projectId: string;
    workspaceId: string;
    scope: ConflictScopeV1;
    holder: WorkspaceLeaseHolderV1;
    expiresAt: string | null;
    /** The binding's declared writeScope the lease was requested under. */
    declaredWriteScope: string[];
  };
};

export type ReleaseWorkspaceLeaseCommand = {
  commandId: string;
  commandType: "ReleaseWorkspaceLease";
  schemaVersion: 1;
  identity: CommandIdentity;
  aggregateId: string;
  /** expected lease revision (1 = active single-shot lease). */
  expectedRevision: number;
  correlationId: string;
  submittedAt: string;
  payload: {
    projectId: string;
    workspaceId: string;
    kind: "read" | "write";
    leaseId: string;
    /** Only the holder may release (releasedBy is frozen to "holder"). */
    holderRunRef: RunRef;
  };
};

export type AcquireReadLeaseRejectionCode =
  | "invalid"
  | "run_not_found"
  | "workspace_not_found"
  | "capability_unsupported"
  | "capability_readonly"
  | "workspace_mismatch"
  | "read_lease_conflict"
  | "idempotency_conflict"
  | "revision_conflict"
  | "unavailable";

export type AcquireReadLeaseReceipt =
  | {
      status: "committed";
      commandId: string;
      replayed: boolean;
      leaseRef: WorkspaceReadLeaseRef;
      eventIds: string[];
      commitCursor: CommitCursor;
    }
  | { status: "rejected"; commandId: string; code: AcquireReadLeaseRejectionCode };

export type AcquireWriteLeaseRejectionCode =
  | "invalid"
  | "run_not_found"
  | "workspace_not_found"
  | "capability_unsupported"
  | "capability_readonly"
  | "workspace_mismatch"
  | "scope_exceeds_capability"
  | "scope_not_declared"
  | "read_lease_conflict"
  | "write_lease_conflict"
  | "idempotency_conflict"
  | "revision_conflict"
  | "unavailable";

export type AcquireWriteLeaseReceipt =
  | {
      status: "committed";
      commandId: string;
      replayed: boolean;
      leaseRef: WorkspaceWriteLeaseRef;
      eventIds: string[];
      commitCursor: CommitCursor;
    }
  | { status: "rejected"; commandId: string; code: AcquireWriteLeaseRejectionCode };

export type ReleaseLeaseRejectionCode =
  | "invalid"
  | "lease_not_found"
  | "kind_mismatch"
  | "not_holder"
  | "already_released"
  | "already_expired"
  | "idempotency_conflict"
  | "revision_conflict"
  | "unavailable";

export type ReleaseLeaseReceipt =
  | {
      status: "committed";
      commandId: string;
      replayed: boolean;
      leaseRef: WorkspaceReadLeaseRef | WorkspaceWriteLeaseRef;
      eventIds: string[];
      commitCursor: CommitCursor;
    }
  | { status: "rejected"; commandId: string; code: ReleaseLeaseRejectionCode };

// ------------------------------------------------------------------------ //
// Domain events (v1)                                                        //
// ------------------------------------------------------------------------ //

export type WorkspaceReadLeaseGrantedEvent = {
  eventId: string;
  eventType: "WorkspaceReadLeaseGranted";
  schemaVersion: 1;
  projectId: string;
  workspaceId: string;
  aggregateType: "WorkspaceReadLease";
  aggregateId: string;
  aggregateRevision: 1;
  causationId: string;
  correlationId: string;
  idempotencyKey: string;
  actor: ActorRef;
  occurredAt: string;
  payload: {
    leaseId: string;
    scope: ConflictScopeV1;
    holder: { runRef: RunRef; attemptRef: TaskAttemptRef };
    expiresAt: string | null;
  };
};

export type WorkspaceReadLeaseReleasedEvent = {
  eventId: string;
  eventType: "WorkspaceReadLeaseReleased";
  schemaVersion: 1;
  projectId: string;
  workspaceId: string;
  aggregateType: "WorkspaceReadLease";
  aggregateId: string;
  aggregateRevision: 2;
  causationId: string;
  correlationId: string;
  idempotencyKey: string;
  actor: ActorRef;
  occurredAt: string;
  payload: {
    leaseId: string;
    releasedAt: string;
    releasedBy: "holder" | null;
  };
};

export type WorkspaceWriteLeaseGrantedEvent = {
  eventId: string;
  eventType: "WorkspaceWriteLeaseGranted";
  schemaVersion: 1;
  projectId: string;
  workspaceId: string;
  aggregateType: "WorkspaceWriteLease";
  aggregateId: string;
  aggregateRevision: 1;
  causationId: string;
  correlationId: string;
  idempotencyKey: string;
  actor: ActorRef;
  occurredAt: string;
  payload: {
    leaseId: string;
    scope: ConflictScopeV1;
    holder: { runRef: RunRef; attemptRef: TaskAttemptRef };
    expiresAt: string | null;
  };
};

export type WorkspaceWriteLeaseReleasedEvent = {
  eventId: string;
  eventType: "WorkspaceWriteLeaseReleased";
  schemaVersion: 1;
  projectId: string;
  workspaceId: string;
  aggregateType: "WorkspaceWriteLease";
  aggregateId: string;
  aggregateRevision: 2;
  causationId: string;
  correlationId: string;
  idempotencyKey: string;
  actor: ActorRef;
  occurredAt: string;
  payload: {
    leaseId: string;
    releasedAt: string;
    releasedBy: "holder" | null;
    releasedVia: "explicit" | "patch-record" | "expiry-vacate";
    postWriteWorkspaceRevision: number | null;
  };
};

export type WorkspaceLeaseDomainEvent =
  | WorkspaceReadLeaseGrantedEvent
  | WorkspaceReadLeaseReleasedEvent
  | WorkspaceWriteLeaseGrantedEvent
  | WorkspaceWriteLeaseReleasedEvent;

// ------------------------------------------------------------------------ //
// Fingerprints                                                              //
// ------------------------------------------------------------------------ //

export function acquireReadLeaseFingerprint(command: AcquireWorkspaceReadLeaseCommand): CommandFingerprint {
  return sha256Hex(
    canonicalJson({
      commandType: command.commandType,
      projectId: command.identity.projectId,
      payload: command.payload,
    }),
  ) as CommandFingerprint;
}

export function acquireWriteLeaseFingerprint(command: AcquireWorkspaceWriteLeaseCommand): CommandFingerprint {
  return sha256Hex(
    canonicalJson({
      commandType: command.commandType,
      projectId: command.identity.projectId,
      payload: command.payload,
    }),
  ) as CommandFingerprint;
}

export function releaseLeaseFingerprint(command: ReleaseWorkspaceLeaseCommand): CommandFingerprint {
  return sha256Hex(
    canonicalJson({
      commandType: command.commandType,
      projectId: command.identity.projectId,
      payload: command.payload,
    }),
  ) as CommandFingerprint;
}

// ------------------------------------------------------------------------ //
// DispatchEngine.WorkspaceLeasePort (interfaces_to_freeze #1)               //
// ------------------------------------------------------------------------ //

export interface WorkspaceLeasePort {
  /** Shared, overlapping, re-entrant read lease (read-read NEVER conflicts). */
  acquireReadLease(command: AcquireWorkspaceReadLeaseCommand): Promise<AcquireReadLeaseReceipt>;
  /** Exclusive write lease (index CAS; workspace-level exclusivity = invariant #7). */
  acquireWriteLease(command: AcquireWorkspaceWriteLeaseCommand): Promise<AcquireWriteLeaseReceipt>;
  /** Explicit holder release (no cancel/preempt/force-release — P1-10). */
  releaseLease(command: ReleaseWorkspaceLeaseCommand): Promise<ReleaseLeaseReceipt>;
}
