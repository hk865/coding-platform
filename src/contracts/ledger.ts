/**
 * StateLedger Interface — snapshot / atomic commit / ordered Event read.
 * Authority: dev_docs/interfaces/state-ledger.md (slice v1).
 * P1-00 versioned extensions (explicitly recorded in the interface doc):
 *  - LedgerCommit is a kind-tagged union: "goal-create" (slice v1) and
 *    "bootstrap" (P1-00); bootstrap commits only succeed on an empty ledger
 *    unless replayed (same identity + fingerprint);
 *  - LedgerCommitReceipt rejection code adds "not_empty" for that guard;
 *  - AggregateRef adds BootstrapManifestRef; EventPage carries the
 *    versioned DomainEvent union instead of GoalCreatedEvent only.
 * P1-02 versioned extensions (recorded in the interface doc):
 *  - LedgerCommit adds "governance-install" / "governance-activate" /
 *    "plan-revision" kinds (immutable governance revision persistence,
 *    per-kind active refs, accepted PlanRevision + Goal active plan);
 *  - AggregateRef/AggregateSnapshot add CompletionPolicyRevision /
 *    ArchitectureBaselineRevision / ProjectCompletionPolicyActive /
 *    ProjectArchitectureBaselineActive / PlanRevision;
 *  - GoalSnapshot.activePlanRevision becomes PlanRevisionRef | null and its
 *    revision becomes number (v1 GoalCreated still creates null/1; the
 *    P1-02 plan-revision commit advances the goal snapshot to revision 2).
 */
import type {
  CommandFingerprint,
  CommandIdentity,
  CommitCursor,
  GoalCreatedEvent,
} from "./command-event.js";
import type {
  BootstrapCommandIdentity,
  BootstrapManifestRef,
  BootstrapManifestSnapshot,
  ProjectBootstrappedEventV1,
  WorkspaceBootstrappedEventV1,
} from "./bootstrap.js";
import type { DomainEvent } from "./events.js";
import type {
  ArchitectureBaselineActivatedEvent,
  ArchitectureBaselineInstalledEvent,
  ArchitectureBaselineRevisionRef,
  ArchitectureBaselineRevisionSnapshot,
  CompletionPolicyActivatedEvent,
  CompletionPolicyInstalledEvent,
  CompletionPolicyRevisionRef,
  CompletionPolicyRevisionSnapshot,
  ProjectArchitectureBaselineActiveRef,
  ProjectArchitectureBaselineActiveSnapshot,
  ProjectCompletionPolicyActiveRef,
  ProjectCompletionPolicyActiveSnapshot,
} from "./governance.js";
import type { PlanRevisionAcceptedEvent, PlanRevisionRef, PlanRevisionSnapshot } from "./plan.js";

export type ProjectRef = {
  aggregateType: "Project";
  projectId: string;
};

export type WorkspaceRef = {
  aggregateType: "Workspace";
  projectId: string;
  workspaceId: string;
};

export type GoalRef = {
  aggregateType: "Goal";
  projectId: string;
  goalId: string;
};

export type AggregateRef =
  | ProjectRef
  | WorkspaceRef
  | GoalRef
  | BootstrapManifestRef
  | CompletionPolicyRevisionRef
  | ArchitectureBaselineRevisionRef
  | ProjectCompletionPolicyActiveRef
  | ProjectArchitectureBaselineActiveRef
  | PlanRevisionRef;

export type ProjectSnapshot = {
  ref: ProjectRef;
  revision: number;
};

export type WorkspaceSnapshot = {
  ref: WorkspaceRef;
  revision: number;
};

export type GoalSnapshot = {
  ref: GoalRef;
  workspaceRef: WorkspaceRef;
  objective: string;
  desiredState: "active";
  /** null after GoalCreated@1; a PlanRevisionRef after ApplyPlanRevision. */
  activePlanRevision: PlanRevisionRef | null;
  /** 1 at creation; 2+ after an accepted plan revision. */
  revision: number;
};

export type AggregateSnapshot =
  | ProjectSnapshot
  | WorkspaceSnapshot
  | GoalSnapshot
  | BootstrapManifestSnapshot
  | CompletionPolicyRevisionSnapshot
  | ArchitectureBaselineRevisionSnapshot
  | ProjectCompletionPolicyActiveSnapshot
  | ProjectArchitectureBaselineActiveSnapshot
  | PlanRevisionSnapshot;

export type SnapshotResult =
  | { status: "found"; snapshot: AggregateSnapshot }
  | { status: "not_found"; ref: AggregateRef };

export type ExpectedVersion = { ref: AggregateRef; revision: number };
export type VersionedRef = { ref: AggregateRef; revision: number };

export type GoalCreateLedgerCommitV1 = {
  commitKind: "goal-create";
  schemaVersion: 1;
  identity: CommandIdentity;
  fingerprint: CommandFingerprint;
  expectedVersions: ExpectedVersion[];
  events: GoalCreatedEvent[];
  snapshots: GoalSnapshot[];
  outboxIntents: [];
};

export type BootstrapLedgerCommitV1 = {
  commitKind: "bootstrap";
  schemaVersion: 1;
  identity: BootstrapCommandIdentity;
  fingerprint: CommandFingerprint;
  /** No pre-existing state is expected — bootstrap is only-if-empty. */
  expectedVersions: [];
  events: (ProjectBootstrappedEventV1 | WorkspaceBootstrappedEventV1)[];
  snapshots: (ProjectSnapshot | WorkspaceSnapshot | BootstrapManifestSnapshot)[];
  outboxIntents: [];
};

export type GovernanceInstallLedgerCommitV1 = {
  commitKind: "governance-install";
  schemaVersion: 1;
  identity: CommandIdentity;
  fingerprint: CommandFingerprint;
  /** [{ revision aggregate, 0 }] — immutability CAS; install never overwrites. */
  expectedVersions: ExpectedVersion[];
  events: (CompletionPolicyInstalledEvent | ArchitectureBaselineInstalledEvent)[];
  snapshots: (CompletionPolicyRevisionSnapshot | ArchitectureBaselineRevisionSnapshot)[];
  outboxIntents: [];
};

export type GovernanceActivateLedgerCommitV1 = {
  commitKind: "governance-activate";
  schemaVersion: 1;
  identity: CommandIdentity;
  fingerprint: CommandFingerprint;
  /** [Project@expected, ActiveAggregate@expected] — project CAS + kind CAS. */
  expectedVersions: ExpectedVersion[];
  events: (CompletionPolicyActivatedEvent | ArchitectureBaselineActivatedEvent)[];
  snapshots: (ProjectCompletionPolicyActiveSnapshot | ProjectArchitectureBaselineActiveSnapshot)[];
  outboxIntents: [];
};

export type PlanRevisionLedgerCommitV1 = {
  commitKind: "plan-revision";
  schemaVersion: 1;
  identity: CommandIdentity;
  fingerprint: CommandFingerprint;
  /** [Goal@expected, PlanRevision@0]. */
  expectedVersions: ExpectedVersion[];
  events: [PlanRevisionAcceptedEvent];
  snapshots: (PlanRevisionSnapshot | GoalSnapshot)[];
  outboxIntents: [];
};

export type LedgerCommit =
  | GoalCreateLedgerCommitV1
  | BootstrapLedgerCommitV1
  | GovernanceInstallLedgerCommitV1
  | GovernanceActivateLedgerCommitV1
  | PlanRevisionLedgerCommitV1;

export type LedgerCommitReceipt =
  | {
      status: "committed";
      replayed: boolean;
      identity: CommandIdentity | BootstrapCommandIdentity;
      aggregateRevisions: VersionedRef[];
      eventIds: string[];
      commitCursor: CommitCursor;
    }
  | {
      status: "rejected";
      code:
        | "invalid_commit"
        | "revision_conflict"
        | "idempotency_conflict"
        | "not_empty"
        | "unavailable";
      currentVersions?: VersionedRef[];
    };

export type EventQuery = {
  afterCursor: CommitCursor | null;
  limit: number;
};

export type PositionedEvent = {
  cursor: CommitCursor;
  event: DomainEvent;
};

export type EventPage = {
  afterCursor: CommitCursor | null;
  throughCursor: CommitCursor | null;
  events: PositionedEvent[];
  hasMore: boolean;
};

export interface StateLedger {
  load(ref: AggregateRef): Promise<SnapshotResult>;
  commit(batch: LedgerCommit): Promise<LedgerCommitReceipt>;
  events(query: EventQuery): Promise<EventPage>;
}

/**
 * Cursor order semantics for P1-00 InMemory ledger: sequential, monotonically
 * increasing, zero-padded decimal sequence. Cursors stay OPAQUE to all
 * consumers: only ledger adapters and the ReadModelIndex may call
 * compareCommitCursor; everyone else must treat them as opaque tokens (no
 * string comparison, no decoding).
 */
export function makeCommitCursor(sequence: number): CommitCursor {
  if (!Number.isSafeInteger(sequence) || sequence < 1) {
    throw new Error("invalid cursor sequence: " + String(sequence));
  }
  return ("c" + String(sequence).padStart(10, "0")) as CommitCursor;
}

export function seqOfCommitCursor(cursor: CommitCursor): number {
  const match = /^c(\d{10})$/.exec(String(cursor));
  if (!match?.[1]) throw new Error("not a ledger cursor: " + String(cursor));
  const seq = Number.parseInt(match[1], 10);
  if (!Number.isSafeInteger(seq) || seq < 1) {
    throw new Error("invalid cursor sequence: " + String(seq));
  }
  return seq;
}

/** -1 | 0 | 1 — numeric log order, never lexicographic. */
export function compareCommitCursor(a: CommitCursor, b: CommitCursor): -1 | 0 | 1 {
  const sa = seqOfCommitCursor(a);
  const sb = seqOfCommitCursor(b);
  return sa < sb ? -1 : sa > sb ? 1 : 0;
}
