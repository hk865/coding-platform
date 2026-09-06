
/**
 * SQLite StateLedger adapter - P1-01 "Goal persisted and visible".
 *
 * ENTRY FILE (shared baseline, integrator, 2026-09-05). The exported surface
 * below is FROZEN for P1-01 lane A: lane A fills in the implementation inside
 * this directory and must NOT change the exported signatures/options. Any
 * change to the surface requires integrator coordination.
 *
 * Driver decision: Node 24 built-in node:sqlite (DatabaseSync) - zero runtime
 * dependencies (the project already pins engines node >=24.15.0 <25).
 * Contract, restart, transaction and fault-injection semantics fixed in
 * IMPLEMENTATION-HANDOFF.md - "P1-01 contract and storage semantics (frozen)".
 * Acceptance gate: tests/contract-suite/state-ledger.contract.suite.ts,
 * wired via tests/sqlite-ledger/sqlite-ledger.contract.test.ts.
 *
 * Storage model (chosen by lane A, consistent with the frozen semantics):
 *  - one SQLite file (or ":memory:"); tables:
 *      events(id INTEGER PRIMARY KEY AUTOINCREMENT, event_json TEXT)
 *        - id is the persistent monotonic global cursor (never reuses a
 *          sequence value across restart because of AUTOINCREMENT);
 *      snapshots(ref_key TEXT PRIMARY KEY, snapshot_json TEXT)
 *        - ref_key is canonicalJson(ref) (full AggregateRef, never downgraded
 *          to local goalId/workspaceId);
 *      idempotency(identity_key TEXT PRIMARY KEY, fingerprint TEXT,
 *                  event_ids_json TEXT, aggregate_revisions_json TEXT,
 *                  commit_cursor TEXT)
 *        - identity_key is "goal-create:"+commandIdentityKey or
 *          "bootstrap:"+bootstrapIdentityKey;
 *  - one commit = one BEGIN IMMEDIATE .. COMMIT block; any throw (beforeWrite
 *    fault injection or storage error) ROLLBACKs the whole transaction and
 *    propagates the error (never swallowed into an "unavailable" rejection -
 *    that code stays reserved).
 */
import { DatabaseSync } from "node:sqlite";
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
  validateReplacementClaimCommit,
  validateWorkspaceReadLeaseAcquireCommit,
  validateWorkspaceReadLeaseReleaseCommit,
  validateWorkspaceWriteLeaseAcquireCommit,
  validateWorkspaceWriteLeaseReleaseCommit,
  validateIntegrationRecordCommit,
  validatePatchRecordCommit,
  validateWorkContextBindCommit,
  validateWorkContextLinkCommit,
  validateExecutionNoteRecordCommit,
  validateContinuationRecordCommit,
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
import { canonicalJson } from "../contracts/fingerprint.js";
import type { CommitCursor } from "../contracts/command-event.js";

export interface SqliteStateLedgerOptions {
  /** ":memory:" (per-connection ephemeral) or a single SQLite file path. */
  path: string;
  /**
   * Fault-injection seam - the contract suite's createWithFault mapping.
   * Invoked INSIDE the commit transaction, after all validation and
   * idempotency/CAS resolution, immediately before the first SQL write.
   * Throwing rolls back the WHOLE transaction (events + snapshots +
   * idempotency record) and commit() rejects. Mirrors InMemoryLedger.beforeWrite.
   */
  beforeWrite?: () => void;
}

/** A persisted idempotency result - the durable outcome for replay. */
interface IdempotencyRecord {
  fingerprint: string;
  eventIds: string[];
  aggregateRevisions: VersionedRef[];
  commitCursor: CommitCursor;
}

interface CurrentVersion {
  ref: AggregateRef;
  revision: number;
}

export class SqliteStateLedger implements StateLedger {
  private readonly db: DatabaseSync;
  private closed = false;
  private readonly beforeWrite: (() => void) | undefined;

  /** The path this ledger is backed by (":memory:" or the file path). */
  readonly dbPath: string;

  constructor(options: SqliteStateLedgerOptions) {
    if (typeof options.path !== "string" || options.path.length === 0) {
      throw new Error("SqliteStateLedger: path must be a non-empty string");
    }
    this.dbPath = options.path;
    this.beforeWrite = options.beforeWrite;
    this.db = new DatabaseSync(options.path);
    this.initSchema();
  }

  async load(ref: AggregateRef): Promise<SnapshotResult> {
    this.assertOpen();
    const key = this.refKey(ref);
    const row = this.db
      .prepare("SELECT snapshot_json FROM snapshots WHERE ref_key = ?")
      .get(key) as { snapshot_json: string } | undefined;
    if (row === undefined) {
      return { status: "not_found", ref };
    }
    return { status: "found", snapshot: JSON.parse(row.snapshot_json) as AggregateSnapshot };
  }

  async commit(batch: LedgerCommit): Promise<LedgerCommitReceipt> {
    this.assertOpen();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const receipt = this.commitDispatch(batch);
      this.db.exec("COMMIT");
      return receipt;
    } catch (err) {
      try {
        this.db.exec("ROLLBACK");
      } catch {
        // no live transaction left to roll back - nothing else to do
      }
      throw err;
    }
  }

  async events(query: EventQuery): Promise<EventPage> {
    this.assertOpen();
    const limit = Number.isFinite(query.limit)
      ? Math.max(0, Math.floor(query.limit))
      : Number.MAX_SAFE_INTEGER;
    const fetchLimit = limit < Number.MAX_SAFE_INTEGER ? limit + 1 : Number.MAX_SAFE_INTEGER;
    const afterSeq = query.afterCursor === null ? 0 : seqOfCommitCursor(query.afterCursor);
    const rows = this.db
      .prepare("SELECT id, event_json FROM events WHERE id > ? ORDER BY id ASC LIMIT ?")
      .all(afterSeq, fetchLimit) as { id: number | bigint; event_json: string }[];
    const hasMore = rows.length > limit;
    const slice = rows.slice(0, limit);
    const events: PositionedEvent[] = slice.map((row) => ({
      cursor: makeCommitCursor(Number(row.id)),
      event: JSON.parse(row.event_json) as DomainEvent,
    }));
    const throughCursor =
      events.length > 0 ? events[events.length - 1]!.cursor : query.afterCursor;
    return { afterCursor: query.afterCursor, throughCursor, events, hasMore };
  }

  /**
   * Adapter-specific disposal - NOT part of the StateLedger interface
   * (StateLedger stays load/commit/events). Idempotent; a closed ledger
   * rejects further use with a clear error.
   */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    try {
      this.db.close();
    } catch {
      // already closed or closing - nothing left to do
    }
  }

  private assertOpen(): void {
    if (this.closed) throw new Error("SqliteStateLedger: ledger is closed");
  }

  // ---------------------------------------------------------------------------
  // schema / storage helpers
  // ---------------------------------------------------------------------------

  private initSchema(): void {
    this.db.exec(
      "CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY AUTOINCREMENT, event_json TEXT NOT NULL);" +
        "CREATE TABLE IF NOT EXISTS snapshots (ref_key TEXT PRIMARY KEY, snapshot_json TEXT NOT NULL);" +
        "CREATE TABLE IF NOT EXISTS idempotency (identity_key TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, event_ids_json TEXT NOT NULL, aggregate_revisions_json TEXT NOT NULL, commit_cursor TEXT NOT NULL);",
    );
  }

  private refKey(ref: AggregateRef): string {
    return canonicalJson(ref);
  }

  private identityKeyFor(batch: LedgerCommit): string {
    if (batch.commitKind === "bootstrap") {
      return "bootstrap:" + bootstrapIdentityKey(batch.identity);
    }
    // goal-create / governance-install / governance-activate / plan-revision all
    // carry a project-scoped CommandIdentity; the kind prefix keeps identity
    // namespaces disjoint per command family.
    return batch.commitKind + ":" + commandIdentityKey(batch.identity);
  }

  private idempotencyRecord(key: string): IdempotencyRecord | undefined {
    const row = this.db
      .prepare(
        "SELECT fingerprint, event_ids_json, aggregate_revisions_json, commit_cursor FROM idempotency WHERE identity_key = ?",
      )
      .get(key) as
      | {
          fingerprint: string;
          event_ids_json: string;
          aggregate_revisions_json: string;
          commit_cursor: string;
        }
      | undefined;
    if (row === undefined) return undefined;
    return {
      fingerprint: row.fingerprint,
      eventIds: JSON.parse(row.event_ids_json) as string[],
      aggregateRevisions: JSON.parse(row.aggregate_revisions_json) as VersionedRef[],
      commitCursor: row.commit_cursor as CommitCursor,
    };
  }

  private casConflicts(
    expectedVersions: { ref: AggregateRef; revision: number }[],
  ): CurrentVersion[] {
    const conflicts: CurrentVersion[] = [];
    for (const expected of expectedVersions) {
      const key = this.refKey(expected.ref);
      const row = this.db
        .prepare("SELECT snapshot_json FROM snapshots WHERE ref_key = ?")
        .get(key) as { snapshot_json: string } | undefined;
      const current =
        row === undefined ? 0 : (JSON.parse(row.snapshot_json) as AggregateSnapshot).revision;
      if (current !== expected.revision) {
        conflicts.push({ ref: expected.ref, revision: current });
      }
    }
    return conflicts;
  }

  private isEmpty(): boolean {
    const events = Number(
      (this.db.prepare("SELECT COUNT(*) AS c FROM events").get() as { c: number | bigint }).c,
    );
    const snapshots = Number(
      (this.db.prepare("SELECT COUNT(*) AS c FROM snapshots").get() as { c: number | bigint }).c,
    );
    const idempotency = Number(
      (this.db.prepare("SELECT COUNT(*) AS c FROM idempotency").get() as { c: number | bigint })
        .c,
    );
    return events === 0 && snapshots === 0 && idempotency === 0;
  }

  private appendEvents(events: DomainEvent[]): { eventIds: string[]; commitCursor: CommitCursor } {
    const stmt = this.db.prepare("INSERT INTO events (event_json) VALUES (?)");
    const eventIds: string[] = [];
    let lastSeq = 0;
    for (const event of events) {
      const result = stmt.run(JSON.stringify(event));
      lastSeq = Number(result.lastInsertRowid);
      eventIds.push(event.eventId);
    }
    return { eventIds, commitCursor: makeCommitCursor(lastSeq) };
  }

  private upsertSnapshot(snapshot: AggregateSnapshot): void {
    this.db
      .prepare(
        "INSERT INTO snapshots (ref_key, snapshot_json) VALUES (?, ?) ON CONFLICT(ref_key) DO UPDATE SET snapshot_json = excluded.snapshot_json",
      )
      .run(this.refKey(snapshot.ref), JSON.stringify(snapshot));
  }

  private persistIdempotency(
    key: string,
    fingerprint: CommandFingerprint,
    eventIds: string[],
    aggregateRevisions: VersionedRef[],
    commitCursor: CommitCursor,
  ): void {
    this.db
      .prepare(
        "INSERT INTO idempotency (identity_key, fingerprint, event_ids_json, aggregate_revisions_json, commit_cursor) VALUES (?, ?, ?, ?, ?)",
      )
      .run(
        key,
        String(fingerprint),
        JSON.stringify(eventIds),
        JSON.stringify(aggregateRevisions),
        String(commitCursor),
      );
  }

  private replayReceipt(batch: LedgerCommit, existing: IdempotencyRecord): LedgerCommitReceipt {
    return {
      status: "committed",
      replayed: true,
      identity: batch.identity,
      aggregateRevisions: existing.aggregateRevisions,
      eventIds: existing.eventIds,
      commitCursor: existing.commitCursor,
    };
  }

  // ---------------------------------------------------------------------------
  // goal-create
  // ---------------------------------------------------------------------------

  private commitGoalCreate(batch: GoalCreateLedgerCommitV1): LedgerCommitReceipt {
    if (!this.validateGoalCreate(batch)) {
      return { status: "rejected", code: "invalid_commit" };
    }

    const key = this.identityKeyFor(batch);
    const existing = this.idempotencyRecord(key);

    // Replay / conflict is decided ONLY by identity + the stored fingerprint.
    // The ledger never recomputes a fingerprint from event/snapshot content -
    // that is the ControlEngine's job. We only compare batch.fingerprint
    // against the stored one.
    if (existing !== undefined) {
      if (existing.fingerprint !== String(batch.fingerprint)) {
        return { status: "rejected", code: "idempotency_conflict" };
      }
      // Same identity+fingerprint => ALWAYS replay (doc semantics), even when a
      // retry mints new eventId/causationId/occurredAt. Original outcome is
      // returned and nothing is appended - volatile per-attempt ids never enter
      // the durable log on a replay.
      return this.replayReceipt(batch, existing);
    }

    const currentVersions = this.casConflicts(batch.expectedVersions);
    if (currentVersions.length > 0) {
      return { status: "rejected", code: "revision_conflict", currentVersions };
    }

    this.beforeWrite?.();

    const written = this.appendEvents(batch.events);
    for (const snapshot of batch.snapshots) {
      this.upsertSnapshot(snapshot);
    }
    const aggregateRevisions: VersionedRef[] = batch.snapshots.map((snapshot) => ({
      ref: snapshot.ref,
      revision: snapshot.revision,
    }));
    this.persistIdempotency(
      key,
      batch.fingerprint,
      written.eventIds,
      aggregateRevisions,
      written.commitCursor,
    );

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
    const event = batch.events[0]!;
    const snapshot = batch.snapshots[0]!;
    if (event.schemaVersion !== 1) return false;
    if (event.eventType !== "GoalCreated") return false;
    if (!isKnownEventType(event.eventType)) return false;
    if (event.aggregateType !== "Goal") return false;
    if (event.aggregateRevision !== 1) return false;
    if (snapshot.ref.aggregateType !== "Goal") return false;
    if (snapshot.revision !== 1) return false;
    // Event / snapshot alignment (StateLedger interface local invariants).
    if (snapshot.ref.projectId !== snapshot.workspaceRef.projectId) return false;
    if (snapshot.ref.projectId !== event.projectId) return false;
    if (snapshot.ref.goalId !== event.aggregateId) return false;
    if (snapshot.workspaceRef.workspaceId !== event.workspaceId) return false;
    // Command/Event interface invariants: event must mirror the command identity.
    if (event.projectId !== batch.identity.projectId) return false;
    if (event.idempotencyKey !== batch.identity.idempotencyKey) return false;
    if (event.actor.kind !== batch.identity.actor.kind || event.actor.id !== batch.identity.actor.id) {
      return false;
    }
    return true;
  }

  // ---------------------------------------------------------------------------
  // bootstrap
  // ---------------------------------------------------------------------------

  private commitDispatch(batch: LedgerCommit): LedgerCommitReceipt {
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

  // ---------------------------------------------------------------------------
  // P1-02 commit kinds (validators shared with InMemoryLedger)
  // ---------------------------------------------------------------------------

  private commitGovernanceInstall(batch: GovernanceInstallLedgerCommitV1): LedgerCommitReceipt {
    if (!validateGovernanceInstallCommit(batch)) {
      return { status: "rejected", code: "invalid_commit" };
    }
    return this.commitGeneric(batch);
  }

  private commitGovernanceActivate(batch: GovernanceActivateLedgerCommitV1): LedgerCommitReceipt {
    if (!validateGovernanceActivateCommit(batch)) {
      return { status: "rejected", code: "invalid_commit" };
    }
    return this.commitGeneric(batch);
  }

  private commitPlanRevision(batch: PlanRevisionLedgerCommitV1): LedgerCommitReceipt {
    if (!validatePlanRevisionCommit(batch)) {
      return { status: "rejected", code: "invalid_commit" };
    }
    return this.commitGeneric(batch);
  }

  // ---------------------------------------------------------------------------
  // P1-03 dispatch / run commits
  // ---------------------------------------------------------------------------

  private commitDispatchClaim(batch: DispatchClaimLedgerCommitV1): LedgerCommitReceipt {
    if (!validateDispatchClaimCommit(batch)) {
      return { status: "rejected", code: "invalid_commit" };
    }
    return this.commitGeneric(batch);
  }

  private commitDispatchStart(batch: DispatchStartLedgerCommitV1): LedgerCommitReceipt {
    if (!validateDispatchStartCommit(batch)) {
      return { status: "rejected", code: "invalid_commit" };
    }
    return this.commitGeneric(batch);
  }

  private commitEvidenceIntake(batch: import("../contracts/ledger.js").EvidenceIntakeLedgerCommitV1): import("../contracts/ledger.js").LedgerCommitReceipt {
    if (!validateEvidenceIntakeCommit(batch)) {
      return { status: "rejected", code: "invalid_commit" };
    }
    return this.commitGeneric(batch);
  }

  private commitTaskReduction(batch: import("../contracts/ledger.js").TaskReductionLedgerCommitV1): import("../contracts/ledger.js").LedgerCommitReceipt {
    if (!validateTaskReductionCommit(batch)) {
      return { status: "rejected", code: "invalid_commit" };
    }
    return this.commitGeneric(batch);
  }

  /** P1-05: goal-reduction — full idempotency + CAS via the shared machinery. */
  private commitGoalReduction(batch: import("../contracts/ledger.js").GoalReductionLedgerCommitV1): import("../contracts/ledger.js").LedgerCommitReceipt {
    if (!validateGoalReductionCommit(batch)) {
      return { status: "rejected", code: "invalid_commit" };
    }
    return this.commitGeneric(batch);
  }

  /** P1-06: handoff-record — one immutable HandoffPacket (full idempotency + CAS). */
  private commitHandoffRecord(batch: import("../contracts/ledger.js").HandoffRecordLedgerCommitV1): import("../contracts/ledger.js").LedgerCommitReceipt {
    if (!validateHandoffRecordCommit(batch)) {
      return { status: "rejected", code: "invalid_commit" };
    }
    return this.commitGeneric(batch);
  }

  /** P1-06: replacement-claim — lease CAS@N + new attempt/run/outbox/replacement (full idempotency). */
  private commitReplacementClaim(batch: import("../contracts/ledger.js").ReplacementClaimLedgerCommitV1): import("../contracts/ledger.js").LedgerCommitReceipt {
    if (!validateReplacementClaimCommit(batch)) {
      return { status: "rejected", code: "invalid_commit" };
    }
    return this.commitGeneric(batch);
  }

  // ---------------------------------------------------------------------------
  // P1-07 commit kinds (validators shared with InMemoryLedger)
  // ---------------------------------------------------------------------------

  private commitWorkspaceReadLeaseAcquire(batch: import("../contracts/ledger.js").WorkspaceReadLeaseAcquireLedgerCommitV1): import("../contracts/ledger.js").LedgerCommitReceipt {
    if (!validateWorkspaceReadLeaseAcquireCommit(batch)) {
      return { status: "rejected", code: "invalid_commit" };
    }
    return this.commitGeneric(batch);
  }

  private commitWorkspaceReadLeaseRelease(batch: import("../contracts/ledger.js").WorkspaceReadLeaseReleaseLedgerCommitV1): import("../contracts/ledger.js").LedgerCommitReceipt {
    if (!validateWorkspaceReadLeaseReleaseCommit(batch)) {
      return { status: "rejected", code: "invalid_commit" };
    }
    return this.commitGeneric(batch);
  }

  private commitWorkspaceWriteLeaseAcquire(batch: import("../contracts/ledger.js").WorkspaceWriteLeaseAcquireLedgerCommitV1): import("../contracts/ledger.js").LedgerCommitReceipt {
    if (!validateWorkspaceWriteLeaseAcquireCommit(batch)) {
      return { status: "rejected", code: "invalid_commit" };
    }
    return this.commitGeneric(batch);
  }

  private commitWorkspaceWriteLeaseRelease(batch: import("../contracts/ledger.js").WorkspaceWriteLeaseReleaseLedgerCommitV1): import("../contracts/ledger.js").LedgerCommitReceipt {
    if (!validateWorkspaceWriteLeaseReleaseCommit(batch)) {
      return { status: "rejected", code: "invalid_commit" };
    }
    return this.commitGeneric(batch);
  }

  private commitIntegrationRecord(batch: import("../contracts/ledger.js").IntegrationRecordLedgerCommitV1): import("../contracts/ledger.js").LedgerCommitReceipt {
    if (!validateIntegrationRecordCommit(batch)) {
      return { status: "rejected", code: "invalid_commit" };
    }
    return this.commitGeneric(batch);
  }

  private commitPatchRecord(batch: import("../contracts/ledger.js").PatchRecordLedgerCommitV1): import("../contracts/ledger.js").LedgerCommitReceipt {
    if (!validatePatchRecordCommit(batch)) {
      return { status: "rejected", code: "invalid_commit" };
    }
    return this.commitGeneric(batch);
  }

  private commitWorkContextBind(batch: import("../contracts/ledger.js").WorkContextBindLedgerCommitV1): import("../contracts/ledger.js").LedgerCommitReceipt {
    if (!validateWorkContextBindCommit(batch)) {
      return { status: "rejected", code: "invalid_commit" };
    }
    return this.commitGeneric(batch);
  }

  private commitWorkContextLink(batch: import("../contracts/ledger.js").WorkContextLinkLedgerCommitV1): import("../contracts/ledger.js").LedgerCommitReceipt {
    if (!validateWorkContextLinkCommit(batch)) {
      return { status: "rejected", code: "invalid_commit" };
    }
    return this.commitGeneric(batch);
  }

  private commitExecutionNoteRecord(batch: import("../contracts/ledger.js").ExecutionNoteRecordLedgerCommitV1): import("../contracts/ledger.js").LedgerCommitReceipt {
    if (!validateExecutionNoteRecordCommit(batch)) {
      return { status: "rejected", code: "invalid_commit" };
    }
    return this.commitGeneric(batch);
  }

  private commitContinuationRecord(batch: import("../contracts/ledger.js").ContinuationRecordLedgerCommitV1): import("../contracts/ledger.js").LedgerCommitReceipt {
    if (!validateContinuationRecordCommit(batch)) {
      return { status: "rejected", code: "invalid_commit" };
    }
    return this.commitGeneric(batch);
  }

  private commitArchitectureInspectionRecord(batch: import("../contracts/ledger.js").ArchitectureInspectionRecordLedgerCommitV1): import("../contracts/ledger.js").LedgerCommitReceipt {
    if (!validateArchitectureInspectionRecordCommit(batch)) {
      return { status: "rejected", code: "invalid_commit" };
    }
    return this.commitGeneric(batch);
  }

  private commitArchitectureFindingRecord(batch: import("../contracts/ledger.js").ArchitectureFindingRecordLedgerCommitV1): import("../contracts/ledger.js").LedgerCommitReceipt {
    if (!validateArchitectureFindingRecordCommit(batch)) {
      return { status: "rejected", code: "invalid_commit" };
    }
    return this.commitGeneric(batch);
  }

  private commitArchitectureBriefRecord(batch: import("../contracts/ledger.js").ArchitectureBriefRecordLedgerCommitV1): import("../contracts/ledger.js").LedgerCommitReceipt {
    if (!validateArchitectureBriefRecordCommit(batch)) {
      return { status: "rejected", code: "invalid_commit" };
    }
    return this.commitGeneric(batch);
  }

  private commitControlIntentRecord(batch: import("../contracts/ledger.js").ControlIntentRecordLedgerCommitV1): import("../contracts/ledger.js").LedgerCommitReceipt {
    if (!validateControlIntentRecordCommit(batch)) {
      return { status: "rejected", code: "invalid_commit" };
    }
    return this.commitGeneric(batch);
  }

  private commitControlAckRecord(batch: import("../contracts/ledger.js").ControlAckRecordLedgerCommitV1): import("../contracts/ledger.js").LedgerCommitReceipt {
    if (!validateControlAckRecordCommit(batch)) {
      return { status: "rejected", code: "invalid_commit" };
    }
    return this.commitGeneric(batch);
  }

  private commitQueryJobRecord(batch: import("../contracts/ledger.js").QueryJobRecordLedgerCommitV1): import("../contracts/ledger.js").LedgerCommitReceipt {
    if (!validateQueryJobRecordCommit(batch)) {
      return { status: "rejected", code: "invalid_commit" };
    }
    return this.commitGeneric(batch);
  }

  private commitQueryAnswerRecord(batch: import("../contracts/ledger.js").QueryAnswerRecordLedgerCommitV1): import("../contracts/ledger.js").LedgerCommitReceipt {
    if (!validateQueryAnswerRecordCommit(batch)) {
      return { status: "rejected", code: "invalid_commit" };
    }
    return this.commitGeneric(batch);
  }

  private commitPlanChangeProposalRecord(batch: import("../contracts/ledger.js").PlanChangeProposalRecordLedgerCommitV1): import("../contracts/ledger.js").LedgerCommitReceipt {
    if (!validatePlanChangeProposalRecordCommit(batch)) return { status: "rejected", code: "invalid_commit" };
    return this.commitGeneric(batch);
  }

  private commitUserDecisionRecord(batch: import("../contracts/ledger.js").UserDecisionRecordLedgerCommitV1): import("../contracts/ledger.js").LedgerCommitReceipt {
    if (!validateUserDecisionRecordCommit(batch)) return { status: "rejected", code: "invalid_commit" };
    return this.commitGeneric(batch);
  }

  private commitGoalChangeApply(batch: import("../contracts/ledger.js").GoalChangeApplyLedgerCommitV1): import("../contracts/ledger.js").LedgerCommitReceipt {
    if (!validateGoalChangeApplyCommit(batch)) return { status: "rejected", code: "invalid_commit" };
    return this.commitGeneric(batch);
  }

  private commitQueryCloseRecord(batch: import("../contracts/ledger.js").QueryCloseRecordLedgerCommitV1): import("../contracts/ledger.js").LedgerCommitReceipt {
    if (!validateQueryCloseRecordCommit(batch)) {
      return { status: "rejected", code: "invalid_commit" };
    }
    return this.commitGeneric(batch);
  }

  private commitRemediationPlanPatchRecord(batch: import("../contracts/ledger.js").RemediationPlanPatchRecordLedgerCommitV1): import("../contracts/ledger.js").LedgerCommitReceipt {
    if (!validateRemediationPlanPatchRecordCommit(batch)) return { status: "rejected", code: "invalid_commit" };
    return this.commitGeneric(batch);
  }

  private commitRemediationTaskRecord(batch: import("../contracts/ledger.js").RemediationTaskRecordLedgerCommitV1): import("../contracts/ledger.js").LedgerCommitReceipt {
    if (!validateRemediationTaskRecordCommit(batch)) return { status: "rejected", code: "invalid_commit" };
    return this.commitGeneric(batch);
  }

  private commitRemediationTaskAdvance(batch: import("../contracts/ledger.js").RemediationTaskAdvanceLedgerCommitV1): import("../contracts/ledger.js").LedgerCommitReceipt {
    if (!validateRemediationTaskAdvanceCommit(batch)) return { status: "rejected", code: "invalid_commit" };
    return this.commitGeneric(batch);
  }

  private commitArchitectureProposalRecord(batch: import("../contracts/ledger.js").ArchitectureProposalRecordLedgerCommitV1): import("../contracts/ledger.js").LedgerCommitReceipt {
    if (!validateArchitectureProposalRecordCommit(batch)) {
      return { status: "rejected", code: "invalid_commit" };
    }
    return this.commitGeneric(batch);
  }

  /**
   * run-fact: NO ledger-level idempotency record — de-duplication is decided
   * by the Control handler against the committed per-run sequence (frozen
   * P1-03 semantics; same pattern as InMemoryLedger).
   */
  private commitRunFact(batch: RunFactLedgerCommitV1): LedgerCommitReceipt {
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
      this.upsertSnapshot(snapshot);
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
    const rows = this.db
      .prepare("SELECT snapshot_json FROM snapshots")
      .all() as { snapshot_json: string }[];
    const pending: DispatchOutboxEntrySnapshot[] = [];
    for (const row of rows) {
      const snapshot = JSON.parse(row.snapshot_json) as { ref?: { aggregateType?: string }; status?: string };
      if (snapshot.ref?.aggregateType !== "DispatchOutboxEntry") continue;
      const entry = snapshot as unknown as DispatchOutboxEntrySnapshot;
      if (entry.status !== "pending") continue;
      pending.push(entry);
    }
    pending.sort((a, b) => this.refKey(a.ref).localeCompare(this.refKey(b.ref)));
    return pending.slice(0, Math.max(0, limit));
  }

  /**
   * Generic P1-02 commit path: idempotency (replay-or-conflict) FIRST, then
   * CAS, then one atomic write; the kind validator already ran.
   */
  private commitGeneric(batch: LedgerCommit): LedgerCommitReceipt {
    const key = this.identityKeyFor(batch);
    const existing = this.idempotencyRecord(key);
    if (existing !== undefined) {
      if (existing.fingerprint !== String(batch.fingerprint)) {
        return { status: "rejected", code: "idempotency_conflict" };
      }
      return this.replayReceipt(batch, existing);
    }

    const currentVersions = this.casConflicts(batch.expectedVersions);
    if (currentVersions.length > 0) {
      return { status: "rejected", code: "revision_conflict", currentVersions };
    }

    this.beforeWrite?.();

    const written = this.appendEvents(batch.events);
    for (const snapshot of batch.snapshots) {
      this.upsertSnapshot(snapshot);
    }
    const aggregateRevisions: VersionedRef[] = batch.snapshots.map((snapshot) => ({
      ref: snapshot.ref,
      revision: snapshot.revision,
    }));
    this.persistIdempotency(
      key,
      batch.fingerprint,
      written.eventIds,
      aggregateRevisions,
      written.commitCursor,
    );

    return {
      status: "committed",
      replayed: false,
      identity: batch.identity,
      aggregateRevisions,
      eventIds: written.eventIds,
      commitCursor: written.commitCursor,
    };
  }

  private commitBootstrap(batch: BootstrapLedgerCommitV1): LedgerCommitReceipt {
    if (!this.validateBootstrap(batch)) {
      return { status: "rejected", code: "invalid_commit" };
    }

    const key = this.identityKeyFor(batch);
    const existing = this.idempotencyRecord(key);

    // Idempotency check MUST precede the empty-ledger guard: a replay of an
    // already-committed bootstrap is accepted regardless of ledger state.
    if (existing !== undefined) {
      if (existing.fingerprint === String(batch.fingerprint)) {
        return this.replayReceipt(batch, existing);
      }
      return { status: "rejected", code: "idempotency_conflict" };
    }

    if (!this.isEmpty()) {
      return { status: "rejected", code: "not_empty" };
    }

    this.beforeWrite?.();

    const written = this.appendEvents(batch.events);
    for (const snapshot of batch.snapshots) {
      this.upsertSnapshot(snapshot);
    }
    const aggregateRevisions: VersionedRef[] = batch.snapshots.map((snapshot) => ({
      ref: snapshot.ref,
      revision: snapshot.revision,
    }));
    this.persistIdempotency(
      key,
      batch.fingerprint,
      written.eventIds,
      aggregateRevisions,
      written.commitCursor,
    );

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
    for (const event of batch.events) {
      if (event.schemaVersion !== 1) return false;
      if (event.eventType !== "ProjectBootstrapped" && event.eventType !== "WorkspaceBootstrapped") {
        return false;
      }
      if (!isKnownEventType(event.eventType)) return false;
      if (event.aggregateRevision !== 1) return false;
    }
    for (const snapshot of batch.snapshots) {
      if (snapshot.revision !== 1) return false;
    }
    return true;
  }
}

export function createSqliteStateLedger(
  options: SqliteStateLedgerOptions,
): SqliteStateLedger {
  return new SqliteStateLedger(options);
}
