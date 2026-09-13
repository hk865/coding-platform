/**
 * Consistent StateLedger test double for P1-00 (integration replaces it with
 * the real InMemoryLedger from lane A). Scripted load/commit, full recording.
 */
import type {
  AggregateRef,
  LedgerCommit,
  LedgerCommitReceipt,
  SnapshotResult,
  StateLedger,
  PendingDispatchSelection,
} from "../../../src/contracts/ledger.js";
import { makeCommitCursor } from "../../../src/contracts/ledger.js";
import { canonicalJson } from "../../../src/contracts/fingerprint.js";
import type { DispatchOutboxEntrySnapshot } from "../../../src/contracts/dispatch.js";

export type LoadBehavior = (ref: AggregateRef) => Promise<SnapshotResult> | SnapshotResult;
export type CommitBehavior = (
  batch: LedgerCommit,
) => Promise<LedgerCommitReceipt> | LedgerCommitReceipt;

export function notFoundResult(ref: AggregateRef): SnapshotResult {
  return { status: "not_found", ref };
}

export function defaultCommittedReceiptFor(batch: LedgerCommit): LedgerCommitReceipt {
  return {
    status: "committed",
    replayed: false,
    identity: batch.identity,
    aggregateRevisions: batch.snapshots.map((s) => ({ ref: s.ref, revision: s.revision })),
    eventIds: batch.events.map((e) => e.eventId),
    commitCursor: makeCommitCursor(1),
  };
}

/** Supplies the scripted outbox population; the double owns production-order
 * selection, deterministic ordering, and only then limit application. */
export type PendingIntentsBehavior = () => Promise<DispatchOutboxEntrySnapshot[]> | DispatchOutboxEntrySnapshot[];

export class ScriptedStateLedger implements StateLedger {
  readonly loads: AggregateRef[] = [];
  readonly commits: LedgerCommit[] = [];
  readonly pendingIntentsCalls: Array<{ limit: number; selection?: PendingDispatchSelection }> = [];

  constructor(
    private readonly options: {
      load?: LoadBehavior;
      commit?: CommitBehavior;
      pendingIntents?: PendingIntentsBehavior;
    } = {},
  ) {}

  async load(ref: AggregateRef): Promise<SnapshotResult> {
    this.loads.push(ref);
    if (this.options.load) return this.options.load(ref);
    return notFoundResult(ref);
  }

  async commit(batch: LedgerCommit): Promise<LedgerCommitReceipt> {
    this.commits.push(batch);
    if (this.options.commit) return this.options.commit(batch);
    return defaultCommittedReceiptFor(batch);
  }

  async events(): Promise<never> {
    throw new Error("ScriptedStateLedger.events is not used by ControlEngine tests");
  }

  async pendingDispatchIntents(limit: number, selection?: PendingDispatchSelection): Promise<DispatchOutboxEntrySnapshot[]> {
    this.pendingIntentsCalls.push({ limit, ...(selection ? { selection } : {}) });
    const candidates = this.options.pendingIntents ? await this.options.pendingIntents() : [];
    return candidates
      .filter((entry) => entry.status === "pending")
      .filter((entry) => !selection || (entry.intent.work?.kind === "review" ? "review" : "ordinary") === selection.workKind)
      // Production orders by canonicalJson(ref) (key-sorted), not by literal
      // insertion order; the double must select the same rows in the same order.
      .sort((a, b) => canonicalJson(a.ref).localeCompare(canonicalJson(b.ref)))
      .slice(0, Math.max(0, limit));
  }
}
