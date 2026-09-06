import type {
  AggregateRef,
  AggregateSnapshot,
  BootstrapLedgerCommitV1,
  EventPage,
  EventQuery,
  GoalCreateLedgerCommitV1,
  GovernanceActivateLedgerCommitV1,
  GovernanceInstallLedgerCommitV1,
  LedgerCommit,
  LedgerCommitReceipt,
  PlanRevisionLedgerCommitV1,
  PositionedEvent,
  SnapshotResult,
  StateLedger,
  VersionedRef,
} from "../contracts/ledger.js";
import {
  validateDispatchClaimCommit,
  validateDispatchStartCommit,
  validateGovernanceActivateCommit,
  validateGovernanceInstallCommit,
  validatePlanRevisionCommit,
  validateRunFactCommit,
  validateEvidenceIntakeCommit,
  validateTaskReductionCommit,
  validateGoalReductionCommit,
  validateHandoffRecordCommit,
  validateWorkspaceReadLeaseAcquireCommit,
  validateWorkspaceReadLeaseReleaseCommit,
  validateWorkspaceWriteLeaseAcquireCommit,
  validateWorkspaceWriteLeaseReleaseCommit,
  validateIntegrationRecordCommit,
  validatePatchRecordCommit,
  validateReplacementClaimCommit,
} from "../contracts/ledger-validation.js";
import type {
  DispatchClaimLedgerCommitV1,
  DispatchStartLedgerCommitV1,
  RunFactLedgerCommitV1,
} from "../contracts/ledger.js";
import type { DispatchOutboxEntrySnapshot } from "../contracts/dispatch.js";
import { makeCommitCursor, seqOfCommitCursor } from "../contracts/ledger.js";
import { bootstrapIdentityKey } from "../contracts/bootstrap.js";
import type { CommandFingerprint } from "../contracts/command-event.js";
import { commandIdentityKey } from "../contracts/command-event.js";
import type { DomainEvent } from "../contracts/events.js";
import { isKnownEventType } from "../contracts/events.js";
import {
  validateContinuationRecordCommit,
  validateExecutionNoteRecordCommit,
  validateWorkContextBindCommit,
  validateWorkContextLinkCommit,
  validateArchitectureInspectionRecordCommit,
  validateArchitectureFindingRecordCommit,
  validateArchitectureBriefRecordCommit,
  validateArchitectureProposalRecordCommit,
  validateControlIntentRecordCommit,
  validateControlAckRecordCommit,
  validateQueryJobRecordCommit,
  validateQueryAnswerRecordCommit,
  validateQueryCloseRecordCommit,
  validatePlanChangeProposalRecordCommit,
  validateUserDecisionRecordCommit,
  validateGoalChangeApplyCommit,
  validateRemediationPlanPatchRecordCommit,
  validateRemediationTaskRecordCommit,
  validateRemediationTaskAdvanceCommit,
} from "../contracts/ledger-validation.js";
import { canonicalJson } from "../contracts/fingerprint.js";
import type { CommitCursor } from "../contracts/command-event.js";

/**
 * Fault-injection + construction options for the InMemory StateLedger.
 * The only injection point is the commit seam: it runs after every validation
 * and idempotency/CAS resolution has passed, and immediately BEFORE any state
 * is mutated (events log, snapshots, idempotency index). Throwing from this
 * hook simulates a crash whose atomicity guarantee the contract suite verifies.
 */
export interface InMemoryLedgerOptions {
  /** Invoked immediately before the atomic write; throw to simulate a crash. */
  beforeWrite?: () => void;
}

interface IdempotencyRecord {
  fingerprint: CommandFingerprint;
  eventIds: string[];
  aggregateRevisions: VersionedRef[];
  commitCursor: CommitCursor;
}

function identityKeyFor(batch: LedgerCommit): string {
  if (batch.commitKind === "bootstrap") {
    return "bootstrap:" + bootstrapIdentityKey(batch.identity);
  }
  // goal-create / governance-install / governance-activate / plan-revision all
  // carry a project-scoped CommandIdentity; the kind prefix keeps identity
  // namespaces disjoint per command family.
  return batch.commitKind + ":" + commandIdentityKey(batch.identity);
}

/** Signify a versioned ref entry used by the CAS conflict currentVersions. */
interface CurrentVersion {
  ref: AggregateRef;
  revision: number;
}

export class InMemoryLedger implements StateLedger {
  private readonly eventLog: PositionedEvent[] = [];
  private readonly snapshots = new Map<string, AggregateSnapshot>();
  private readonly idempotency = new Map<string, IdempotencyRecord>();
  private cursorSeq = 0;
  private readonly beforeWrite: (() => void) | undefined;

  constructor(options: InMemoryLedgerOptions = {}) {
    this.beforeWrite = options.beforeWrite;
  }

  async load(ref: AggregateRef): Promise<SnapshotResult> {
    const snapshot = this.snapshots.get(this.refKey(ref));
    if (snapshot === undefined) {
      return { status: "not_found", ref };
    }
    return { status: "found", snapshot };
  }

  async commit(batch: LedgerCommit): Promise<LedgerCommitReceipt> {
    switch (batch.commitKind) {
      case "goal-create":
        return this.commitGoalCreate(batch);
      case "bootstrap":
        return this.commitBootstrap(batch);
      case "governance-install":
        return this.commitGovernanceInstall(batch);
      case "governance-activate":
        return this.commitGovernanceActivate(batch);
      case "plan-revision":
        return this.commitPlanRevision(batch);
      case "dispatch-claim":
        return this.commitDispatchClaim(batch);
      case "dispatch-start":
        return this.commitDispatchStart(batch);
      case "run-fact":
        return this.commitRunFact(batch);
      case "evidence-intake":
        return this.commitEvidenceIntake(batch);
      case "verification-result":
        return this.commitTaskReduction(batch);
      case "goal-reduction":
        return this.commitGoalReduction(batch);
      case "handoff-record":
        return this.commitHandoffRecord(batch);
      case "replacement-claim":
        return this.commitReplacementClaim(batch);
      case "workspace-read-lease-acquire":
        return this.commitWorkspaceReadLeaseAcquire(batch);
      case "workspace-read-lease-release":
        return this.commitWorkspaceReadLeaseRelease(batch);
      case "workspace-write-lease-acquire":
        return this.commitWorkspaceWriteLeaseAcquire(batch);
      case "workspace-write-lease-release":
        return this.commitWorkspaceWriteLeaseRelease(batch);
      case "integration-record":
        return this.commitIntegrationRecord(batch);
      case "patch-record":
        return this.commitPatchRecord(batch);
      case "work-context-bind":
        return this.commitWorkContextBind(batch);
      case "work-context-link":
        return this.commitWorkContextLink(batch);
      case "execution-note-record":
        return this.commitExecutionNoteRecord(batch);
      case "continuation-record":
        return this.commitContinuationRecord(batch);
      case "architecture-inspection-record":
        return this.commitArchitectureInspectionRecord(batch);
      case "architecture-finding-record":
        return this.commitArchitectureFindingRecord(batch);
      case "architecture-brief-record":
        return this.commitArchitectureBriefRecord(batch);
      case "architecture-proposal-record":
        return this.commitArchitectureProposalRecord(batch);
      case "control-intent-record":
        return this.commitControlIntentRecord(batch);
      case "control-ack":
        return this.commitControlAckRecord(batch);
      case "query-job-record":
        return this.commitQueryJobRecord(batch);
      case "plan-change-proposal-record":
        return this.commitPlanChangeProposalRecord(batch);
      case "user-decision-record":
        return this.commitUserDecisionRecord(batch);
      case "goal-change-apply":
        return this.commitGoalChangeApply(batch);
      case "query-answer-record":
        return this.commitQueryAnswerRecord(batch);
      case "query-close-record":
        return this.commitQueryCloseRecord(batch);
      case "remediation-plan-patch-record":
        return this.commitRemediationPlanPatchRecord(batch);
      case "remediation-task-record":
        return this.commitRemediationTaskRecord(batch);
      case "remediation-task-advance":
        return this.commitRemediationTaskAdvance(batch);
    }
  }

  async events(query: EventQuery): Promise<EventPage> {
    const limit = Math.max(0, Math.floor(query.limit));
    let startIndex = this.eventLog.length;
    if (query.afterCursor === null) {
      startIndex = 0;
    } else {
      const afterSeq = seqOfCommitCursor(query.afterCursor);
      for (let i = 0; i < this.eventLog.length; i += 1) {
        if (seqOfCommitCursor(this.eventLog[i]!.cursor) > afterSeq) {
          startIndex = i;
          break;
        }
      }
    }
    const slice = this.eventLog.slice(startIndex, startIndex + limit);
    const throughCursor =
      slice.length > 0 ? slice[slice.length - 1]!.cursor : query.afterCursor;
    const hasMore = startIndex + slice.length < this.eventLog.length;
    return {
      afterCursor: query.afterCursor,
      throughCursor,
      events: slice,
      hasMore,
    };
  }

  // ---------------------------------------------------------------------------
  // goal-create
  // ---------------------------------------------------------------------------

  private async commitGoalCreate(
    batch: GoalCreateLedgerCommitV1,
  ): Promise<LedgerCommitReceipt> {
    if (!this.validateGoalCreate(batch)) {
      return { status: "rejected", code: "invalid_commit" };
    }

    const key = identityKeyFor(batch);
    const existing = this.idempotency.get(key);

    // Doc semantics: replay/conflict is decided ONLY by identity + the stored
    // fingerprint. The ledger must NOT recompute a fingerprint from event/snapshot
    // content — that is the ControlEngine's job (it builds the fingerprint and
    // folds the matching content). We only compare the incoming batch.fingerprint
    // against the stored one.
    if (existing !== undefined) {
      if (existing.fingerprint !== batch.fingerprint) {
        return { status: "rejected", code: "idempotency_conflict" };
      }
      // Same identity+fingerprint => ALWAYS replay (doc semantics), even when a
      // retry mints new eventId/causationId/occurredAt. The original outcome
      // (eventIds/aggregateRevisions/commitCursor) is returned and nothing is
      // appended — volatile per-attempt ids never enter the log on a replay.
      return {
        status: "committed",
        replayed: true,
        identity: batch.identity,
        aggregateRevisions: existing.aggregateRevisions,
        eventIds: existing.eventIds,
        commitCursor: existing.commitCursor,
      };
    }

    const currentVersions = this.casConflicts(batch.expectedVersions);
    if (currentVersions.length > 0) {
      return { status: "rejected", code: "revision_conflict", currentVersions };
    }

    this.beforeWrite?.();

    const written = this.appendEvents(batch.events);
    for (const snapshot of batch.snapshots) {
      this.snapshots.set(this.refKey(snapshot.ref), snapshot);
    }
    const aggregateRevisions: VersionedRef[] = batch.snapshots.map((s) => ({
      ref: s.ref,
      revision: s.revision,
    }));
    this.idempotency.set(key, {
      fingerprint: batch.fingerprint,
      eventIds: written.eventIds,
      aggregateRevisions,
      commitCursor: written.commitCursor,
    });

    return {
      status: "committed",
      replayed: false,
      identity: batch.identity,
      aggregateRevisions,
      eventIds: written.eventIds,
      commitCursor: written.commitCursor,
    };
  }

  private validateGoalCreate(batch: GoalCreateLedgerCommitV1): boolean {
    if (batch.schemaVersion !== 1) return false;
    if (batch.events.length !== 1 || batch.snapshots.length !== 1) return false;
    const ev = batch.events[0]!;
    const snap = batch.snapshots[0]!;
    if (ev.schemaVersion !== 1) return false;
    if (ev.eventType !== "GoalCreated") return false;
    if (!isKnownEventType(ev.eventType)) return false;
    if (ev.aggregateType !== "Goal") return false;
    if (ev.aggregateRevision !== 1) return false;
    if (snap.ref.aggregateType !== "Goal") return false;
    if (snap.revision !== 1) return false;
    // Event / snapshot alignment (StateLedger interface local invariants).
    if (snap.ref.projectId !== snap.workspaceRef.projectId) return false;
    if (snap.ref.projectId !== ev.projectId) return false;
    if (snap.ref.goalId !== ev.aggregateId) return false;
    if (snap.workspaceRef.workspaceId !== ev.workspaceId) return false;
    // Command/Event interface invariants: event must mirror the command identity.
    if (ev.projectId !== batch.identity.projectId) return false;
    if (ev.idempotencyKey !== batch.identity.idempotencyKey) return false;
    if (ev.actor.kind !== batch.identity.actor.kind || ev.actor.id !== batch.identity.actor.id) {
      return false;
    }
    return true;
  }

  // ---------------------------------------------------------------------------
  // bootstrap
  // ---------------------------------------------------------------------------

  private async commitBootstrap(
    batch: BootstrapLedgerCommitV1,
  ): Promise<LedgerCommitReceipt> {
    if (!this.validateBootstrap(batch)) {
      return { status: "rejected", code: "invalid_commit" };
    }

    const key = identityKeyFor(batch);
    const existing = this.idempotency.get(key);

    // Idempotency check MUST precede the empty-ledger guard: a replay of an
    // already-committed bootstrap is accepted regardless of ledger state.
    if (existing !== undefined) {
      if (existing.fingerprint === batch.fingerprint) {
        return {
          status: "committed",
          replayed: true,
          identity: batch.identity,
          aggregateRevisions: existing.aggregateRevisions,
          eventIds: existing.eventIds,
          commitCursor: existing.commitCursor,
        };
      }
      return { status: "rejected", code: "idempotency_conflict" };
    }

    if (!this.isEmpty()) {
      return { status: "rejected", code: "not_empty" };
    }

    this.beforeWrite?.();

    const written = this.appendEvents(batch.events);
    for (const snapshot of batch.snapshots) {
      this.snapshots.set(this.refKey(snapshot.ref), snapshot);
    }
    const aggregateRevisions: VersionedRef[] = batch.snapshots.map((s) => ({
      ref: s.ref,
      revision: s.revision,
    }));
    this.idempotency.set(key, {
      fingerprint: batch.fingerprint,
      eventIds: written.eventIds,
      aggregateRevisions,
      commitCursor: written.commitCursor,
    });

    return {
      status: "committed",
      replayed: false,
      identity: batch.identity,
      aggregateRevisions,
      eventIds: written.eventIds,
      commitCursor: written.commitCursor,
    };
  }

  private validateBootstrap(batch: BootstrapLedgerCommitV1): boolean {
    if (batch.schemaVersion !== 1) return false;
    if (batch.events.length === 0) return false;
    for (const ev of batch.events) {
      if (ev.schemaVersion !== 1) return false;
      if (ev.eventType !== "ProjectBootstrapped" && ev.eventType !== "WorkspaceBootstrapped") {
        return false;
      }
      if (!isKnownEventType(ev.eventType)) return false;
      if (ev.aggregateRevision !== 1) return false;
    }
    for (const snapshot of batch.snapshots) {
      if (snapshot.revision !== 1) return false;
    }
    return true;
  }

  // ---------------------------------------------------------------------------
  // governance-install / governance-activate / plan-revision (P1-02)
  // ---------------------------------------------------------------------------

  /**
   * P1-02 install: immutable revision persistence. Control folds the exact
   * commit; the ledger enforces immutability via idempotency + CAS at
   * expected revision 0 (validated by the shared kind validator).
   */
  private async commitGovernanceInstall(
    batch: GovernanceInstallLedgerCommitV1,
  ): Promise<LedgerCommitReceipt> {
    if (!validateGovernanceInstallCommit(batch)) {
      return { status: "rejected", code: "invalid_commit" };
    }
    return this.commitGeneric(batch);
  }

  /**
   * P1-02 activate: typed Project active ref movement under CAS (Project
   * revision + per-kind active-aggregate revision). Rejections never move the
   * active ref (zero-write).
   */
  private async commitGovernanceActivate(
    batch: GovernanceActivateLedgerCommitV1,
  ): Promise<LedgerCommitReceipt> {
    if (!validateGovernanceActivateCommit(batch)) {
      return { status: "rejected", code: "invalid_commit" };
    }
    return this.commitGeneric(batch);
  }

  /**
   * P1-02 plan acceptance: goal snapshot advance + immutable PlanRevision in
   * ONE atomic commit (validated for exact event/snapshot/expected alignment).
   */
  private async commitPlanRevision(
    batch: PlanRevisionLedgerCommitV1,
  ): Promise<LedgerCommitReceipt> {
    if (!validatePlanRevisionCommit(batch)) {
      return { status: "rejected", code: "invalid_commit" };
    }
    return this.commitGeneric(batch);
  }

  /**
   * Generic P1-02 commit path: idempotency (replay-or-conflict by identity +
   * stored fingerprint, decided FIRST) -> CAS -> write. Shared by the three
   * P1-02 kinds; the kind validator already ran.
   */
  private async commitGeneric(
    batch: LedgerCommit,
  ): Promise<LedgerCommitReceipt> {
    return this.commitGenericWithIdempotency(batch);
  }

  // ---------------------------------------------------------------------------
  // P1-03 dispatch / run commits
  // ---------------------------------------------------------------------------

  private async commitDispatchClaim(
    batch: DispatchClaimLedgerCommitV1,
  ): Promise<LedgerCommitReceipt> {
    if (!validateDispatchClaimCommit(batch)) {
      return { status: "rejected", code: "invalid_commit" };
    }
    return this.commitGenericWithIdempotency(batch);
  }

  private async commitDispatchStart(
    batch: DispatchStartLedgerCommitV1,
  ): Promise<LedgerCommitReceipt> {
    if (!validateDispatchStartCommit(batch)) {
      return { status: "rejected", code: "invalid_commit" };
    }
    return this.commitGenericWithIdempotency(batch);
  }

  /**
   * run-fact: NO ledger-level idempotency record — de-duplication is decided
   * by the Control handler against the committed per-run sequence (frozen
   * P1-03 semantics). Same command identity retried after the fact committed
   * surfaces as a CAS revision_conflict (caller re-reads and sees
   * duplicate/stale).
   */
  private async commitEvidenceIntake(batch: import("../contracts/ledger.js").EvidenceIntakeLedgerCommitV1): Promise<LedgerCommitReceipt> {
    if (!validateEvidenceIntakeCommit(batch)) {
      return { status: "rejected", code: "invalid_commit" };
    }
    return this.commitGenericWithIdempotency(batch);
  }

  private async commitTaskReduction(batch: import("../contracts/ledger.js").TaskReductionLedgerCommitV1): Promise<LedgerCommitReceipt> {
    if (!validateTaskReductionCommit(batch)) {
      return { status: "rejected", code: "invalid_commit" };
    }
    return this.commitGenericWithIdempotency(batch);
  }

  /** P1-05: goal-reduction — full idempotency + CAS via the shared machinery. */
  private async commitGoalReduction(batch: import("../contracts/ledger.js").GoalReductionLedgerCommitV1): Promise<LedgerCommitReceipt> {
    if (!validateGoalReductionCommit(batch)) {
      return { status: "rejected", code: "invalid_commit" };
    }
    return this.commitGenericWithIdempotency(batch);
  }

  /** P1-06: handoff-record — one immutable HandoffPacket (full idempotency + CAS). */
  private async commitHandoffRecord(batch: import("../contracts/ledger.js").HandoffRecordLedgerCommitV1): Promise<LedgerCommitReceipt> {
    if (!validateHandoffRecordCommit(batch)) {
      return { status: "rejected", code: "invalid_commit" };
    }
    return this.commitGenericWithIdempotency(batch);
  }

  /** P1-06: replacement-claim — lease CAS@N + new attempt/run/outbox/replacement (full idempotency). */
  private async commitReplacementClaim(batch: import("../contracts/ledger.js").ReplacementClaimLedgerCommitV1): Promise<LedgerCommitReceipt> {
    if (!validateReplacementClaimCommit(batch)) {
      return { status: "rejected", code: "invalid_commit" };
    }
    return this.commitGenericWithIdempotency(batch);
  }

  // ---------------------------------------------------------------------------
  // P1-07 commit kinds (validators shared with SqliteStateLedger)
  // ---------------------------------------------------------------------------

  private async commitWorkspaceReadLeaseAcquire(batch: import("../contracts/ledger.js").WorkspaceReadLeaseAcquireLedgerCommitV1): Promise<LedgerCommitReceipt> {
    if (!validateWorkspaceReadLeaseAcquireCommit(batch)) {
      return { status: "rejected", code: "invalid_commit" };
    }
    return this.commitGenericWithIdempotency(batch);
  }

  private async commitWorkspaceReadLeaseRelease(batch: import("../contracts/ledger.js").WorkspaceReadLeaseReleaseLedgerCommitV1): Promise<LedgerCommitReceipt> {
    if (!validateWorkspaceReadLeaseReleaseCommit(batch)) {
      return { status: "rejected", code: "invalid_commit" };
    }
    return this.commitGenericWithIdempotency(batch);
  }

  private async commitWorkspaceWriteLeaseAcquire(batch: import("../contracts/ledger.js").WorkspaceWriteLeaseAcquireLedgerCommitV1): Promise<LedgerCommitReceipt> {
    if (!validateWorkspaceWriteLeaseAcquireCommit(batch)) {
      return { status: "rejected", code: "invalid_commit" };
    }
    return this.commitGenericWithIdempotency(batch);
  }

  private async commitWorkspaceWriteLeaseRelease(batch: import("../contracts/ledger.js").WorkspaceWriteLeaseReleaseLedgerCommitV1): Promise<LedgerCommitReceipt> {
    if (!validateWorkspaceWriteLeaseReleaseCommit(batch)) {
      return { status: "rejected", code: "invalid_commit" };
    }
    return this.commitGenericWithIdempotency(batch);
  }

  private async commitIntegrationRecord(batch: import("../contracts/ledger.js").IntegrationRecordLedgerCommitV1): Promise<LedgerCommitReceipt> {
    if (!validateIntegrationRecordCommit(batch)) {
      return { status: "rejected", code: "invalid_commit" };
    }
    return this.commitGenericWithIdempotency(batch);
  }

  private async commitPatchRecord(batch: import("../contracts/ledger.js").PatchRecordLedgerCommitV1): Promise<LedgerCommitReceipt> {
    if (!validatePatchRecordCommit(batch)) {
      return { status: "rejected", code: "invalid_commit" };
    }
    return this.commitGenericWithIdempotency(batch);
  }

  /** P1-16: work-context-bind — one durable WorkContextBinding (CAS@0). */
  private async commitWorkContextBind(batch: import("../contracts/ledger.js").WorkContextBindLedgerCommitV1): Promise<LedgerCommitReceipt> {
    if (!validateWorkContextBindCommit(batch)) {
      return { status: "rejected", code: "invalid_commit" };
    }
    return this.commitGenericWithIdempotency(batch);
  }

  /** P1-16: work-context-link — append a run link (CAS@N). */
  private async commitWorkContextLink(batch: import("../contracts/ledger.js").WorkContextLinkLedgerCommitV1): Promise<LedgerCommitReceipt> {
    if (!validateWorkContextLinkCommit(batch)) {
      return { status: "rejected", code: "invalid_commit" };
    }
    return this.commitGenericWithIdempotency(batch);
  }

  /** P1-16: execution-note-record — one immutable note (body-first; CAS@0). */
  private async commitExecutionNoteRecord(batch: import("../contracts/ledger.js").ExecutionNoteRecordLedgerCommitV1): Promise<LedgerCommitReceipt> {
    if (!validateExecutionNoteRecordCommit(batch)) {
      return { status: "rejected", code: "invalid_commit" };
    }
    return this.commitGenericWithIdempotency(batch);
  }

  /** P1-16: continuation-record — one immutable continuation report (CAS@0). */
  private async commitContinuationRecord(batch: import("../contracts/ledger.js").ContinuationRecordLedgerCommitV1): Promise<LedgerCommitReceipt> {
    if (!validateContinuationRecordCommit(batch)) {
      return { status: "rejected", code: "invalid_commit" };
    }
    return this.commitGenericWithIdempotency(batch);
  }

  /** P1-12: architecture-inspection-record — one immutable inspection (CAS@0). */
  private async commitArchitectureInspectionRecord(batch: import("../contracts/ledger.js").ArchitectureInspectionRecordLedgerCommitV1): Promise<LedgerCommitReceipt> {
    if (!validateArchitectureInspectionRecordCommit(batch)) {
      return { status: "rejected", code: "invalid_commit" };
    }
    return this.commitGenericWithIdempotency(batch);
  }

  /** P1-12: architecture-finding-record — one immutable finding (CAS@0). */
  private async commitArchitectureFindingRecord(batch: import("../contracts/ledger.js").ArchitectureFindingRecordLedgerCommitV1): Promise<LedgerCommitReceipt> {
    if (!validateArchitectureFindingRecordCommit(batch)) {
      return { status: "rejected", code: "invalid_commit" };
    }
    return this.commitGenericWithIdempotency(batch);
  }

  /** P1-12: architecture-brief-record — one immutable decision brief (CAS@0). */
  private async commitArchitectureBriefRecord(batch: import("../contracts/ledger.js").ArchitectureBriefRecordLedgerCommitV1): Promise<LedgerCommitReceipt> {
    if (!validateArchitectureBriefRecordCommit(batch)) {
      return { status: "rejected", code: "invalid_commit" };
    }
    return this.commitGenericWithIdempotency(batch);
  }

  /** P1-10: control-intent-record — one durable desired-state intent (CAS@0). */
  private async commitControlIntentRecord(batch: import("../contracts/ledger.js").ControlIntentRecordLedgerCommitV1): Promise<LedgerCommitReceipt> {
    if (!validateControlIntentRecordCommit(batch)) {
      return { status: "rejected", code: "invalid_commit" };
    }
    return this.commitGenericWithIdempotency(batch);
  }

  /** P1-10: control-ack — append one safe-point acknowledgement (CAS@N). */
  private async commitControlAckRecord(batch: import("../contracts/ledger.js").ControlAckRecordLedgerCommitV1): Promise<LedgerCommitReceipt> {
    if (!validateControlAckRecordCommit(batch)) {
      return { status: "rejected", code: "invalid_commit" };
    }
    return this.commitGenericWithIdempotency(batch);
  }

  /** P1-09: query-job-record — QueryJob + QueryRun @1 (atomic). */
  private async commitQueryJobRecord(batch: import("../contracts/ledger.js").QueryJobRecordLedgerCommitV1): Promise<LedgerCommitReceipt> {
    if (!validateQueryJobRecordCommit(batch)) {
      return { status: "rejected", code: "invalid_commit" };
    }
    return this.commitGenericWithIdempotency(batch);
  }

  /** P1-09: query-answer-record — answer + advanced job/run (atomic). */
  private async commitQueryAnswerRecord(batch: import("../contracts/ledger.js").QueryAnswerRecordLedgerCommitV1): Promise<LedgerCommitReceipt> {
    if (!validateQueryAnswerRecordCommit(batch)) {
      return { status: "rejected", code: "invalid_commit" };
    }
    return this.commitGenericWithIdempotency(batch);
  }

  private async commitPlanChangeProposalRecord(batch: import("../contracts/ledger.js").PlanChangeProposalRecordLedgerCommitV1): Promise<LedgerCommitReceipt> {
    if (!validatePlanChangeProposalRecordCommit(batch)) return { status: "rejected", code: "invalid_commit" };
    return this.commitGenericWithIdempotency(batch);
  }

  private async commitUserDecisionRecord(batch: import("../contracts/ledger.js").UserDecisionRecordLedgerCommitV1): Promise<LedgerCommitReceipt> {
    if (!validateUserDecisionRecordCommit(batch)) return { status: "rejected", code: "invalid_commit" };
    return this.commitGenericWithIdempotency(batch);
  }

  private async commitGoalChangeApply(batch: import("../contracts/ledger.js").GoalChangeApplyLedgerCommitV1): Promise<LedgerCommitReceipt> {
    if (!validateGoalChangeApplyCommit(batch)) return { status: "rejected", code: "invalid_commit" };
    return this.commitGenericWithIdempotency(batch);
  }

  private async commitRemediationPlanPatchRecord(batch: import("../contracts/ledger.js").RemediationPlanPatchRecordLedgerCommitV1): Promise<LedgerCommitReceipt> {
    if (!validateRemediationPlanPatchRecordCommit(batch)) return { status: "rejected", code: "invalid_commit" };
    return this.commitGenericWithIdempotency(batch);
  }

  private async commitRemediationTaskRecord(batch: import("../contracts/ledger.js").RemediationTaskRecordLedgerCommitV1): Promise<LedgerCommitReceipt> {
    if (!validateRemediationTaskRecordCommit(batch)) return { status: "rejected", code: "invalid_commit" };
    return this.commitGenericWithIdempotency(batch);
  }

  private async commitRemediationTaskAdvance(batch: import("../contracts/ledger.js").RemediationTaskAdvanceLedgerCommitV1): Promise<LedgerCommitReceipt> {
    if (!validateRemediationTaskAdvanceCommit(batch)) return { status: "rejected", code: "invalid_commit" };
    return this.commitGenericWithIdempotency(batch);
  }

  /** P1-09: query-close-record — closed job/run (atomic). */
  private async commitQueryCloseRecord(batch: import("../contracts/ledger.js").QueryCloseRecordLedgerCommitV1): Promise<LedgerCommitReceipt> {
    if (!validateQueryCloseRecordCommit(batch)) {
      return { status: "rejected", code: "invalid_commit" };
    }
    return this.commitGenericWithIdempotency(batch);
  }

  /** P1-12: architecture-proposal-record — one immutable candidate proposal (CAS@0). */
  private async commitArchitectureProposalRecord(batch: import("../contracts/ledger.js").ArchitectureProposalRecordLedgerCommitV1): Promise<LedgerCommitReceipt> {
    if (!validateArchitectureProposalRecordCommit(batch)) {
      return { status: "rejected", code: "invalid_commit" };
    }
    return this.commitGenericWithIdempotency(batch);
  }

  private async commitRunFact(batch: RunFactLedgerCommitV1): Promise<LedgerCommitReceipt> {
    if (!validateRunFactCommit(batch)) {
      return { status: "rejected", code: "invalid_commit" };
    }
    const currentVersions = this.casConflicts(batch.expectedVersions);
    if (currentVersions.length > 0) {
      return { status: "rejected", code: "revision_conflict", currentVersions };
    }
    this.beforeWrite?.();
    const written = this.appendEvents(batch.events);
    for (const snapshot of batch.snapshots) {
      this.snapshots.set(this.refKey(snapshot.ref), snapshot);
    }
    return {
      status: "committed",
      replayed: false,
      identity: batch.identity,
      aggregateRevisions: batch.snapshots.map((s) => ({ ref: s.ref, revision: s.revision })),
      eventIds: written.eventIds,
      commitCursor: written.commitCursor,
    };
  }

  async pendingDispatchIntents(limit: number): Promise<DispatchOutboxEntrySnapshot[]> {
    const pending: DispatchOutboxEntrySnapshot[] = [];
    for (const snapshot of this.snapshots.values()) {
      if (snapshot.ref.aggregateType !== "DispatchOutboxEntry") continue;
      const entry = snapshot as DispatchOutboxEntrySnapshot;
      if (entry.status !== "pending") continue;
      pending.push(entry);
    }
    pending.sort((a, b) => this.refKey(a.ref).localeCompare(this.refKey(b.ref)));
    return pending.slice(0, Math.max(0, limit));
  }

  private async commitGenericWithIdempotency(
    batch: LedgerCommit,
  ): Promise<LedgerCommitReceipt> {
    const key = identityKeyFor(batch);
    const existing = this.idempotency.get(key);
    if (existing !== undefined) {
      if (existing.fingerprint !== batch.fingerprint) {
        return { status: "rejected", code: "idempotency_conflict" };
      }
      return {
        status: "committed",
        replayed: true,
        identity: batch.identity,
        aggregateRevisions: existing.aggregateRevisions,
        eventIds: existing.eventIds,
        commitCursor: existing.commitCursor,
      };
    }

    const currentVersions = this.casConflicts(batch.expectedVersions);
    if (currentVersions.length > 0) {
      return { status: "rejected", code: "revision_conflict", currentVersions };
    }

    this.beforeWrite?.();

    const written = this.appendEvents(batch.events);
    for (const snapshot of batch.snapshots) {
      this.snapshots.set(this.refKey(snapshot.ref), snapshot);
    }
    const aggregateRevisions: VersionedRef[] = batch.snapshots.map((s) => ({
      ref: s.ref,
      revision: s.revision,
    }));
    this.idempotency.set(key, {
      fingerprint: batch.fingerprint,
      eventIds: written.eventIds,
      aggregateRevisions,
      commitCursor: written.commitCursor,
    });

    return {
      status: "committed",
      replayed: false,
      identity: batch.identity,
      aggregateRevisions,
      eventIds: written.eventIds,
      commitCursor: written.commitCursor,
    };
  }

  // ---------------------------------------------------------------------------
  // shared machinery
  // ---------------------------------------------------------------------------

  private isEmpty(): boolean {
    return (
      this.eventLog.length === 0 &&
      this.snapshots.size === 0 &&
      this.idempotency.size === 0
    );
  }

  private casConflicts(expectedVersions: { ref: AggregateRef; revision: number }[]): CurrentVersion[] {
    const conflicts: CurrentVersion[] = [];
    for (const expected of expectedVersions) {
      const currentRevision = this.snapshots.get(this.refKey(expected.ref))?.revision ?? 0;
      if (currentRevision !== expected.revision) {
        conflicts.push({ ref: expected.ref, revision: currentRevision });
      }
    }
    return conflicts;
  }

  private appendEvents(events: DomainEvent[]): { eventIds: string[]; commitCursor: CommitCursor } {
    const eventIds: string[] = [];
    let lastCursor: CommitCursor | null = null;
    for (const ev of events) {
      this.cursorSeq += 1;
      const cursor = makeCommitCursor(this.cursorSeq);
      this.eventLog.push({ cursor, event: ev });
      eventIds.push(ev.eventId);
      lastCursor = cursor;
    }
    return { eventIds, commitCursor: lastCursor! };
  }

  private refKey(ref: AggregateRef): string {
    return canonicalJson(ref);
  }
}

export function createInMemoryLedger(options?: InMemoryLedgerOptions): InMemoryLedger {
  return new InMemoryLedger(options);
}
