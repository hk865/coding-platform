import type {
  AggregateRef,
  AggregateSnapshot,
  BootstrapLedgerCommitV1,
  EventPage,
  EventQuery,
  GoalCreateLedgerCommitV1,
  LedgerCommit,
  LedgerCommitReceipt,
  PositionedEvent,
  SnapshotResult,
  StateLedger,
  VersionedRef,
} from "../contracts/ledger.js";
import { makeCommitCursor, seqOfCommitCursor } from "../contracts/ledger.js";
import { bootstrapIdentityKey } from "../contracts/bootstrap.js";
import type { CommandFingerprint } from "../contracts/command-event.js";
import { commandIdentityKey } from "../contracts/command-event.js";
import type { DomainEvent } from "../contracts/events.js";
import { isKnownEventType } from "../contracts/events.js";
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
  if (batch.commitKind === "goal-create") {
    return "goal-create:" + commandIdentityKey(batch.identity);
  }
  return "bootstrap:" + bootstrapIdentityKey(batch.identity);
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
    if (batch.commitKind === "goal-create") {
      return this.commitGoalCreate(batch);
    }
    return this.commitBootstrap(batch);
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
