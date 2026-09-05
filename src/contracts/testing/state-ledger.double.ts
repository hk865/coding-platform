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
} from "../ledger.js";
import { makeCommitCursor } from "../ledger.js";

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

export class ScriptedStateLedger implements StateLedger {
  readonly loads: AggregateRef[] = [];
  readonly commits: LedgerCommit[] = [];

  constructor(
    private readonly options: {
      load?: LoadBehavior;
      commit?: CommitBehavior;
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
}
