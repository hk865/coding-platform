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
import type {
  HandoffPacketRef,
  HandoffPacketSnapshot,
  HandoffRecordedEvent,
  ReplacementAttemptRef,
  ReplacementAttemptSnapshot,
  ReplacementClaimedEvent,
} from "./handoff.js";
import type {
  WorkspaceReadLeaseGrantedEvent,
  WorkspaceReadLeaseIndexRef,
  WorkspaceReadLeaseIndexSnapshot,
  WorkspaceReadLeaseRef,
  WorkspaceReadLeaseReleasedEvent,
  WorkspaceReadLeaseSnapshot,
  WorkspaceWriteLeaseGrantedEvent,
  WorkspaceWriteLeaseIndexRef,
  WorkspaceWriteLeaseIndexSnapshot,
  WorkspaceWriteLeaseRef,
  WorkspaceWriteLeaseReleasedEvent,
  WorkspaceWriteLeaseSnapshot,
} from "./workspace-lease.js";
import type { IntegrationJoinedEvent, IntegrationResultRef, IntegrationResultSnapshot } from "./integration.js";
import type { PatchRecordedEvent, PatchRecordRef, PatchRecordSnapshot } from "./patch.js";
import type {
  ContinuationRecordRef,
  ContinuationRecordSnapshot,
  ContinuationRecordedEvent,
  ExecutionNoteRef,
  ExecutionNoteSnapshot,
  ExecutionNoteRecordedEvent,
  WorkContextBindingSnapshot,
  WorkContextBoundEvent,
  WorkContextRef,
  WorkRunLinkedEvent,
} from "./context-continuity.js";
import type {
  ArchitectureCandidateProposalRecordedEvent,
  ArchitectureCandidateProposalRef,
  ArchitectureCandidateProposalSnapshot,
  ArchitectureDecisionBriefRecordedEvent,
  ArchitectureDecisionBriefRef,
  ArchitectureDecisionBriefSnapshot,
  ArchitectureFindingRecordedEvent,
  ArchitectureFindingRef,
  ArchitectureFindingSnapshot,
  ArchitectureInspectionRecordedEvent,
  ArchitectureInspectionRef,
  ArchitectureInspectionSnapshot,
} from "./architecture-inspection.js";
import type { ControlIntentRecordedEvent, ControlIntentRef, ControlIntentSnapshot, SafePointAcknowledgedEvent } from "./control-intent.js";
import type { QueryJobAnswerRecordedEvent, QueryJobAnswerRef, QueryJobAnswerSnapshot, QueryJobClosedEvent, QueryJobRef, QueryJobSnapshot, QueryJobSubmittedEvent, QueryRunRef, QueryRunSnapshot, QueryRunStartedEvent } from "./query-job.js";
import type { GoalRevisionRecordedEvent, GoalRevisionSnapshot, PlanProposalRecordedEvent, PlanProposalSnapshot, UserDecisionRecordedEvent, UserDecisionSnapshot } from "./goal-change.js";

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
  | GoalPhaseRef
  | HandoffPacketRef
  | ReplacementAttemptRef
  | WorkspaceReadLeaseRef
  | WorkspaceReadLeaseIndexRef
  | WorkspaceWriteLeaseRef
  | WorkspaceWriteLeaseIndexRef
  | IntegrationResultRef
  | PatchRecordRef
  | WorkContextRef
  | ExecutionNoteRef
  | ContinuationRecordRef
  | ArchitectureInspectionRef
  | ArchitectureFindingRef
  | ArchitectureDecisionBriefRef
  | ArchitectureCandidateProposalRef
  | ControlIntentRef
  | QueryJobRef
  | QueryRunRef
  | QueryJobAnswerRef
  | PlanProposalSnapshot["ref"]
  | UserDecisionSnapshot["ref"]
  | GoalRevisionSnapshot["ref"];

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
  | GoalPhaseSnapshot
  | HandoffPacketSnapshot
  | ReplacementAttemptSnapshot
  | WorkspaceReadLeaseSnapshot
  | WorkspaceReadLeaseIndexSnapshot
  | WorkspaceWriteLeaseSnapshot
  | WorkspaceWriteLeaseIndexSnapshot
  | IntegrationResultSnapshot
  | PatchRecordSnapshot
  | WorkContextBindingSnapshot
  | ExecutionNoteSnapshot
  | ContinuationRecordSnapshot
  | ArchitectureInspectionSnapshot
  | ArchitectureFindingSnapshot
  | ArchitectureDecisionBriefSnapshot
  | ArchitectureCandidateProposalSnapshot
  | ControlIntentSnapshot
  | QueryJobSnapshot
  | QueryRunSnapshot
  | QueryJobAnswerSnapshot
  | PlanProposalSnapshot
  | UserDecisionSnapshot
  | GoalRevisionSnapshot;

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

/** P1-06: handoff-record — one immutable HandoffPacket aggregate (body-first). */
export type HandoffRecordLedgerCommitV1 = {
  commitKind: "handoff-record";
  schemaVersion: 1;
  identity: CommandIdentity;
  fingerprint: CommandFingerprint;
  /** [HandoffPacket@0]. */
  expectedVersions: ExpectedVersion[];
  events: [HandoffRecordedEvent];
  snapshots: [HandoffPacketSnapshot];
  outboxIntents: [];
};

/** P1-06: replacement-claim — B's new Attempt lifecycle for the SAME Task
 * (lease CAS@N + new TaskAttempt/Run/DispatchOutboxEntry + ReplacementAttempt). */
export type ReplacementClaimLedgerCommitV1 = {
  commitKind: "replacement-claim";
  schemaVersion: 1;
  identity: CommandIdentity;
  fingerprint: CommandFingerprint;
  /** [TaskLease@N, TaskAttempt@0, Run@0, DispatchOutboxEntry@0, ReplacementAttempt@0]. */
  expectedVersions: ExpectedVersion[];
  events: [ReplacementClaimedEvent];
  snapshots: [TaskLeaseSnapshot, TaskAttemptSnapshot, RunSnapshot, DispatchOutboxEntrySnapshot, ReplacementAttemptSnapshot];
  outboxIntents: [DispatchIntentV1];
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

/** P1-07: workspace-read-lease-acquire — shared read lease + read lease index (atomic). */
export type WorkspaceReadLeaseAcquireLedgerCommitV1 = {
  commitKind: "workspace-read-lease-acquire";
  schemaVersion: 1;
  identity: CommandIdentity;
  fingerprint: CommandFingerprint;
  /** [ReadLease@0, ReadLeaseIndex@(index.revision - 1)]. */
  expectedVersions: ExpectedVersion[];
  events: [WorkspaceReadLeaseGrantedEvent];
  snapshots: [WorkspaceReadLeaseSnapshot, WorkspaceReadLeaseIndexSnapshot];
  outboxIntents: [];
};

/** P1-07: workspace-read-lease-release — read lease @2 + index clear entry (atomic). */
export type WorkspaceReadLeaseReleaseLedgerCommitV1 = {
  commitKind: "workspace-read-lease-release";
  schemaVersion: 1;
  identity: CommandIdentity;
  fingerprint: CommandFingerprint;
  /** [ReadLease@1, ReadLeaseIndex@(index.revision - 1)]. */
  expectedVersions: ExpectedVersion[];
  events: [WorkspaceReadLeaseReleasedEvent];
  snapshots: [WorkspaceReadLeaseSnapshot, WorkspaceReadLeaseIndexSnapshot];
  outboxIntents: [];
};

/** P1-07: workspace-write-lease-acquire — exclusive write lease + index CAS (atomic). */
export type WorkspaceWriteLeaseAcquireLedgerCommitV1 = {
  commitKind: "workspace-write-lease-acquire";
  schemaVersion: 1;
  identity: CommandIdentity;
  fingerprint: CommandFingerprint;
  /** [WriteLease@0, WriteLeaseIndex@(index.revision - 1)] (+ [VacatedLease@1] when an expired active lease is vacated in the same commit). */
  expectedVersions: ExpectedVersion[];
  events: [WorkspaceWriteLeaseGrantedEvent];
  /** New lease @1 + index @N+1 (+ vacated old lease @2 when expiry-vacate). */
  snapshots:
    | [WorkspaceWriteLeaseSnapshot, WorkspaceWriteLeaseIndexSnapshot]
    | [WorkspaceWriteLeaseSnapshot, WorkspaceWriteLeaseIndexSnapshot, WorkspaceWriteLeaseSnapshot];
  /** Non-null when an expired active lease was vacated (releasedVia = "expiry-vacate"). */
  vacatedLeaseRef: WorkspaceWriteLeaseRef | null;
  outboxIntents: [];
};

/** P1-07: workspace-write-lease-release — explicit holder release (atomic; index CAS). */
export type WorkspaceWriteLeaseReleaseLedgerCommitV1 = {
  commitKind: "workspace-write-lease-release";
  schemaVersion: 1;
  identity: CommandIdentity;
  fingerprint: CommandFingerprint;
  /** [WriteLease@1, WriteLeaseIndex@(index.revision - 1)]. */
  expectedVersions: ExpectedVersion[];
  events: [WorkspaceWriteLeaseReleasedEvent];
  snapshots: [WorkspaceWriteLeaseSnapshot, WorkspaceWriteLeaseIndexSnapshot];
  outboxIntents: [];
};

/** P1-07: integration-record — accumulating join records (revision == count, CAS). */
export type IntegrationRecordLedgerCommitV1 = {
  commitKind: "integration-record";
  schemaVersion: 1;
  identity: CommandIdentity;
  fingerprint: CommandFingerprint;
  /** [IntegrationResult@(snapshot.revision - 1)]. */
  expectedVersions: ExpectedVersion[];
  events: [IntegrationJoinedEvent];
  snapshots: [IntegrationResultSnapshot];
  outboxIntents: [];
};

/** P1-07: patch-record — patch @1 + canonical Workspace revision advance + write lease release + index clear (ONE atomic commit). */
export type PatchRecordLedgerCommitV1 = {
  commitKind: "patch-record";
  schemaVersion: 1;
  identity: CommandIdentity;
  fingerprint: CommandFingerprint;
  /** [PatchRecord@0, Workspace@N, WriteLease@1, WriteLeaseIndex@M]. */
  expectedVersions: ExpectedVersion[];
  events: [PatchRecordedEvent, WorkspaceWriteLeaseReleasedEvent];
  snapshots: [PatchRecordSnapshot, WorkspaceSnapshot, WorkspaceWriteLeaseSnapshot, WorkspaceWriteLeaseIndexSnapshot];
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


/** P1-16: work-context-bind — one durable WorkContextBinding (created exactly once; CAS@0). */
export type WorkContextBindLedgerCommitV1 = {
  commitKind: "work-context-bind";
  schemaVersion: 1;
  identity: CommandIdentity;
  fingerprint: CommandFingerprint;
  /** [WorkContextBinding@0]. */
  expectedVersions: ExpectedVersion[];
  events: [WorkContextBoundEvent];
  snapshots: [WorkContextBindingSnapshot];
  outboxIntents: [];
};

/** P1-16: work-context-link — append a run to the binding (run linkage CAS@N). */
export type WorkContextLinkLedgerCommitV1 = {
  commitKind: "work-context-link";
  schemaVersion: 1;
  identity: CommandIdentity;
  fingerprint: CommandFingerprint;
  /** [WorkContextBinding@(snapshot.revision - 1)]. */
  expectedVersions: ExpectedVersion[];
  events: [WorkRunLinkedEvent];
  snapshots: [WorkContextBindingSnapshot];
  outboxIntents: [];
};

/** P1-16: execution-note-record — one immutable ExecutionNote (body-first; CAS@0). */
export type ExecutionNoteRecordLedgerCommitV1 = {
  commitKind: "execution-note-record";
  schemaVersion: 1;
  identity: CommandIdentity;
  fingerprint: CommandFingerprint;
  /** [ExecutionNote@0]. */
  expectedVersions: ExpectedVersion[];
  events: [ExecutionNoteRecordedEvent];
  snapshots: [ExecutionNoteSnapshot];
  outboxIntents: [];
};

/** P1-16: continuation-record — one immutable continuation report (CAS@0). */
export type ContinuationRecordLedgerCommitV1 = {
  commitKind: "continuation-record";
  schemaVersion: 1;
  identity: CommandIdentity;
  fingerprint: CommandFingerprint;
  /** [ContinuationRecord@0]. */
  expectedVersions: ExpectedVersion[];
  events: [ContinuationRecordedEvent];
  snapshots: [ContinuationRecordSnapshot];
  outboxIntents: [];
};


/** P1-12: architecture-inspection-record — one immutable inspection (CAS@0). */
export type ArchitectureInspectionRecordLedgerCommitV1 = {
  commitKind: "architecture-inspection-record";
  schemaVersion: 1;
  identity: CommandIdentity;
  fingerprint: CommandFingerprint;
  expectedVersions: ExpectedVersion[];
  events: [ArchitectureInspectionRecordedEvent];
  snapshots: [ArchitectureInspectionSnapshot];
  outboxIntents: [];
};

/** P1-12: architecture-finding-record — one immutable finding (CAS@0). */
export type ArchitectureFindingRecordLedgerCommitV1 = {
  commitKind: "architecture-finding-record";
  schemaVersion: 1;
  identity: CommandIdentity;
  fingerprint: CommandFingerprint;
  expectedVersions: ExpectedVersion[];
  events: [ArchitectureFindingRecordedEvent];
  snapshots: [ArchitectureFindingSnapshot];
  outboxIntents: [];
};

/** P1-12: architecture-brief-record — one immutable decision brief (CAS@0). */
export type ArchitectureBriefRecordLedgerCommitV1 = {
  commitKind: "architecture-brief-record";
  schemaVersion: 1;
  identity: CommandIdentity;
  fingerprint: CommandFingerprint;
  expectedVersions: ExpectedVersion[];
  events: [ArchitectureDecisionBriefRecordedEvent];
  snapshots: [ArchitectureDecisionBriefSnapshot];
  outboxIntents: [];
};

/** P1-12: architecture-proposal-record — one immutable candidate proposal (CAS@0). */
export type ArchitectureProposalRecordLedgerCommitV1 = {
  commitKind: "architecture-proposal-record";
  schemaVersion: 1;
  identity: CommandIdentity;
  fingerprint: CommandFingerprint;
  expectedVersions: ExpectedVersion[];
  events: [ArchitectureCandidateProposalRecordedEvent];
  snapshots: [ArchitectureCandidateProposalSnapshot];
  outboxIntents: [];
};


/** P1-10: control-intent-record — one durable desired-state intent (CAS@0). */
export type ControlIntentRecordLedgerCommitV1 = {
  commitKind: "control-intent-record";
  schemaVersion: 1;
  identity: CommandIdentity;
  fingerprint: CommandFingerprint;
  expectedVersions: ExpectedVersion[];
  events: [ControlIntentRecordedEvent];
  snapshots: [ControlIntentSnapshot];
  outboxIntents: [];
};

/** P1-10: control-ack — append one safe-point acknowledgement (intent CAS@N). */
export type ControlAckRecordLedgerCommitV1 = {
  commitKind: "control-ack";
  schemaVersion: 1;
  identity: CommandIdentity;
  fingerprint: CommandFingerprint;
  expectedVersions: ExpectedVersion[];
  events: [SafePointAcknowledgedEvent];
  snapshots: [ControlIntentSnapshot];
  outboxIntents: [];
};


/** P1-09: query-job-record — QueryJob @0 + QueryRun @0 (atomic; durable intent first). */
export type QueryJobRecordLedgerCommitV1 = {
  commitKind: "query-job-record";
  schemaVersion: 1;
  identity: CommandIdentity;
  fingerprint: CommandFingerprint;
  expectedVersions: ExpectedVersion[];
  events: [QueryJobSubmittedEvent, QueryRunStartedEvent];
  snapshots: [QueryJobSnapshot, QueryRunSnapshot];
  outboxIntents: [];
};

/** P1-09: query-answer-record — answer @0 + job/run advanced (atomic). */
export type QueryAnswerRecordLedgerCommitV1 = {
  commitKind: "query-answer-record";
  schemaVersion: 1;
  identity: CommandIdentity;
  fingerprint: CommandFingerprint;
  expectedVersions: ExpectedVersion[];
  events: [QueryJobAnswerRecordedEvent];
  snapshots: [QueryJobAnswerSnapshot, QueryJobSnapshot, QueryRunSnapshot];
  outboxIntents: [];
};

/** P1-09: query-close-record — job/run closed (atomic). */
export type QueryCloseRecordLedgerCommitV1 = {
  commitKind: "query-close-record";
  schemaVersion: 1;
  identity: CommandIdentity;
  fingerprint: CommandFingerprint;
  expectedVersions: ExpectedVersion[];
  events: [QueryJobClosedEvent];
  snapshots: [QueryJobSnapshot, QueryRunSnapshot];
  outboxIntents: [];
};


/** P1-11: plan-change-proposal-record — one immutable proposal (CAS@0). */
export type PlanChangeProposalRecordLedgerCommitV1 = {
  commitKind: "plan-change-proposal-record";
  schemaVersion: 1;
  identity: CommandIdentity;
  fingerprint: CommandFingerprint;
  expectedVersions: ExpectedVersion[];
  events: [PlanProposalRecordedEvent];
  snapshots: [PlanProposalSnapshot];
  outboxIntents: [];
};

/** P1-11: user-decision-record — one immutable decision (CAS@0). */
export type UserDecisionRecordLedgerCommitV1 = {
  commitKind: "user-decision-record";
  schemaVersion: 1;
  identity: CommandIdentity;
  fingerprint: CommandFingerprint;
  expectedVersions: ExpectedVersion[];
  events: [UserDecisionRecordedEvent];
  snapshots: [UserDecisionSnapshot];
  outboxIntents: [];
};

/** P1-11: goal-change-apply — accepted decision -> new PlanRevision + GoalRevision + Goal CAS (atomic). */
export type GoalChangeApplyLedgerCommitV1 = {
  commitKind: "goal-change-apply";
  schemaVersion: 1;
  identity: CommandIdentity;
  fingerprint: CommandFingerprint;
  expectedVersions: ExpectedVersion[];
  events: [PlanRevisionAcceptedEvent, GoalRevisionRecordedEvent];
  snapshots: [import("./plan.js").PlanRevisionSnapshot, GoalRevisionSnapshot, import("./ledger.js").GoalSnapshot];
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
  | GoalReductionLedgerCommitV1
  | HandoffRecordLedgerCommitV1
  | ReplacementClaimLedgerCommitV1
  | WorkspaceReadLeaseAcquireLedgerCommitV1
  | WorkspaceReadLeaseReleaseLedgerCommitV1
  | WorkspaceWriteLeaseAcquireLedgerCommitV1
  | WorkspaceWriteLeaseReleaseLedgerCommitV1
  | IntegrationRecordLedgerCommitV1
  | PatchRecordLedgerCommitV1
  | WorkContextBindLedgerCommitV1
  | WorkContextLinkLedgerCommitV1
  | ExecutionNoteRecordLedgerCommitV1
  | ContinuationRecordLedgerCommitV1
  | ArchitectureInspectionRecordLedgerCommitV1
  | ArchitectureFindingRecordLedgerCommitV1
  | ArchitectureBriefRecordLedgerCommitV1
  | ArchitectureProposalRecordLedgerCommitV1
  | ControlIntentRecordLedgerCommitV1
  | ControlAckRecordLedgerCommitV1
  | QueryJobRecordLedgerCommitV1
  | QueryAnswerRecordLedgerCommitV1
  | QueryCloseRecordLedgerCommitV1
  | PlanChangeProposalRecordLedgerCommitV1
  | UserDecisionRecordLedgerCommitV1
  | GoalChangeApplyLedgerCommitV1;

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