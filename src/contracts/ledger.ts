/**
 * StateLedger Interface — snapshot / atomic commit / ordered Event read.
 * Authority: dev_docs/interfaces/state-ledger.md (slice v1).
 * P1-00 versioned extensions: kind-tagged LedgerCommit union with
 * "goal-create" (slice v1) and "bootstrap"; bootstrap commits only succeed on
 * an empty ledger unless replayed; AggregateRef adds BootstrapManifestRef;
 * LedgerCommitReceipt rejection code adds "not_empty".
 * P1-02 versioned extensions: "governance-install" / "governance-activate" /
 * "plan-revision" commit kinds; immutable governance revision aggregates,
 * per-kind active refs, accepted PlanRevision + Goal active plan.
 * P1-03 versioned extensions (recorded in the interface doc):
 *  - "dispatch-claim" / "dispatch-start" / "run-fact" commit kinds
 *    (TaskLease / TaskAttempt / Run / DispatchOutboxEntry aggregates);
 *  - LedgerCommit.outboxIntents is FIRST non-empty on dispatch-claim
 *    (the durable DispatchIntent rides the atomic commit);
 *  - StateLedger adds pendingDispatchIntents (read-only outbox scan).
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
import type {
  DispatchIntentV1,
  DispatchOutboxEntrySnapshot,
  DispatchOutboxRef,
  RunEventRecordedEvent,
  RunOutcomeUnknownEvent,
  RunSnapshot,
  RunStartedEvent,
  RunRef,
  TaskAttemptRef,
  TaskAttemptSnapshot,
  TaskClaimedEvent,
  TaskLeaseRef,
  TaskLeaseSnapshot,
} from "./dispatch.js";
import type {
  EvidenceAdmittedEvent,
  EvidenceRef,
  EvidenceSnapshot,
  TaskEvidenceIndexRef,
  TaskEvidenceIndexSnapshot,
} from "./evidence.js";
import type {
  TaskReductionRef,
  TaskReductionSnapshot,
  TaskReductionUpdatedEvent,
} from "./reduction.js";
import type {
  GoalPhaseRef,
  GoalPhaseSnapshot,
  GoalPhaseUpdatedEvent,
} from "./goal-phase.js";

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
  | PlanRevisionRef
  | TaskLeaseRef
  | TaskAttemptRef
  | RunRef
  | DispatchOutboxRef
  | EvidenceRef
  | TaskEvidenceIndexRef
  | TaskReductionRef
  | GoalPhaseRef;

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
  | PlanRevisionSnapshot
  | TaskLeaseSnapshot
  | TaskAttemptSnapshot
  | RunSnapshot
  | DispatchOutboxEntrySnapshot
  | EvidenceSnapshot
  | TaskEvidenceIndexSnapshot
  | TaskReductionSnapshot
  | GoalPhaseSnapshot;

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

/** P1-03: atomic unique claim — durable outbox intent + lease + attempt + run. */
export type DispatchClaimLedgerCommitV1 = {
  commitKind: "dispatch-claim";
  schemaVersion: 1;
  identity: CommandIdentity;
  fingerprint: CommandFingerprint;
  /** [TaskLease@0, TaskAttempt@0, Run@0, DispatchOutboxEntry@0]. */
  expectedVersions: ExpectedVersion[];
  events: [TaskClaimedEvent];
  snapshots: [TaskLeaseSnapshot, TaskAttemptSnapshot, RunSnapshot, DispatchOutboxEntrySnapshot];
  /** FIRST non-empty outbox: the durable dispatch intent rides the atomic commit. */
  outboxIntents: [DispatchIntentV1];
};

/** P1-03: run start — a.s.a.p. before the RunPort is invoked (outbox -> started). */
export type DispatchStartLedgerCommitV1 = {
  commitKind: "dispatch-start";
  schemaVersion: 1;
  identity: CommandIdentity;
  fingerprint: CommandFingerprint;
  /** [Run@1, TaskAttempt@1, DispatchOutboxEntry@1]. */
  expectedVersions: ExpectedVersion[];
  events: [RunStartedEvent];
  snapshots: [RunSnapshot, TaskAttemptSnapshot, DispatchOutboxEntrySnapshot];
  outboxIntents: [];
};

/** P1-03: one committed runtime fact (event or explicit outcome_unknown). */
export type RunFactLedgerCommitV1 = {
  commitKind: "run-fact";
  schemaVersion: 1;
  identity: CommandIdentity;
  fingerprint: CommandFingerprint;
  /** Non-terminal: [Run@k]. Terminal: [Run@k, TaskAttempt@k', DispatchOutboxEntry@k'']. */
  expectedVersions: ExpectedVersion[];
  events: [RunEventRecordedEvent | RunOutcomeUnknownEvent];
  snapshots: (RunSnapshot | TaskAttemptSnapshot | DispatchOutboxEntrySnapshot)[];
  outboxIntents: [];
};

/**
 * P1-04: evidence-intake — one immutable Evidence + the task evidence index
 * update (atomic). FULL ledger idempotency (replay returns the original
 * outcome; same evidenceId under another identity becomes a CAS conflict).
 */
export type EvidenceIntakeLedgerCommitV1 = {
  commitKind: "evidence-intake";
  schemaVersion: 1;
  identity: CommandIdentity;
  fingerprint: CommandFingerprint;
  /** [Evidence@0, TaskEvidenceIndex@(index.revision - 1)]. */
  expectedVersions: ExpectedVersion[];
  events: [EvidenceAdmittedEvent];
  snapshots: [EvidenceSnapshot, TaskEvidenceIndexSnapshot];
  outboxIntents: [];
};

/** P1-04: verification-result — the deterministic Task/Gate reduction state. */
export type TaskReductionLedgerCommitV1 = {
  commitKind: "verification-result";
  schemaVersion: 1;
  identity: CommandIdentity;
  fingerprint: CommandFingerprint;
  /** [TaskReduction@(snapshot.revision - 1)]. */
  expectedVersions: ExpectedVersion[];
  events: [TaskReductionUpdatedEvent];
  snapshots: [TaskReductionSnapshot];
  outboxIntents: [];
};

/** P1-05: goal-reduction — the deterministic Goal phase state (per (projectId, goalId)). */
export type GoalReductionLedgerCommitV1 = {
  commitKind: "goal-reduction";
  schemaVersion: 1;
  identity: CommandIdentity;
  fingerprint: CommandFingerprint;
  /** [GoalPhase@(snapshot.revision - 1)]. */
  expectedVersions: ExpectedVersion[];
  events: [GoalPhaseUpdatedEvent];
  snapshots: [GoalPhaseSnapshot];
  outboxIntents: [];
};

export type LedgerCommit =
  | GoalCreateLedgerCommitV1
  | BootstrapLedgerCommitV1
  | GovernanceInstallLedgerCommitV1
  | GovernanceActivateLedgerCommitV1
  | PlanRevisionLedgerCommitV1
  | DispatchClaimLedgerCommitV1
  | DispatchStartLedgerCommitV1
  | RunFactLedgerCommitV1
  | EvidenceIntakeLedgerCommitV1
  | TaskReductionLedgerCommitV1
  | GoalReductionLedgerCommitV1;

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
  /** P1-03: durable-outbox scan (pending intents, deterministic order). */
  pendingDispatchIntents(limit: number): Promise<DispatchOutboxEntrySnapshot[]>;
}

/**
 * Cursor order semantics: sequential, monotonically increasing, zero-padded
 * decimal sequence. Cursors stay OPAQUE to all consumers: only ledger adapters
 * and the ReadModelIndex may call compareCommitCursor; everyone else must
 * treat them as opaque tokens.
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