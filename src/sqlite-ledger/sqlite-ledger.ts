/**
 * SQLite StateLedger adapter — P1-01 "Goal persisted and visible".
 *
 * ENTRY FILE (shared baseline, integrator, 2026-09-05). The exported surface
 * below is FROZEN for P1-01 lane A: lane A fills in the implementation inside
 * this directory and must NOT change the exported signatures/options. Any
 * change to the surface requires integrator coordination.
 *
 * Driver decision: Node 24 built-in node:sqlite (DatabaseSync) — zero runtime
 * dependencies (the project already pins engines node >=24.15.0 <25).
 * Contract, restart, transaction and fault-injection semantics fixed in
 * IMPLEMENTATION-HANDOFF.md — "P1-01 契约与存储语义（冻结）".
 * Acceptance gate: tests/contract-suite/state-ledger.contract.suite.ts,
 * wired via tests/sqlite-ledger/sqlite-ledger.contract.test.ts.
 */
import { DatabaseSync } from "node:sqlite";
import type {
  AggregateRef,
  EventPage,
  EventQuery,
  LedgerCommit,
  LedgerCommitReceipt,
  SnapshotResult,
  StateLedger,
} from "../contracts/ledger.js";

export interface SqliteStateLedgerOptions {
  /** ":memory:" (per-connection ephemeral) or a single SQLite file path. */
  path: string;
  /**
   * Fault-injection seam — the contract suite's createWithFault mapping.
   * Invoked INSIDE the commit transaction, after all validation and
   * idempotency/CAS resolution, immediately before the first SQL write.
   * Throwing rolls back the WHOLE transaction (events + snapshots +
   * idempotency record) and commit() rejects. Mirrors InMemoryLedger.beforeWrite.
   */
  beforeWrite?: () => void;
}

const NOT_IMPLEMENTED = "SqliteStateLedger: implementation pending (P1-01 lane A)";

export class SqliteStateLedger implements StateLedger {
  private readonly db: DatabaseSync;
  private closed = false;

  /** The path this ledger is backed by (":memory:" or the file path). */
  readonly dbPath: string;

  constructor(options: SqliteStateLedgerOptions) {
    if (typeof options.path !== "string" || options.path.length === 0) {
      throw new Error("SqliteStateLedger: path must be a non-empty string");
    }
    this.dbPath = options.path;
    this.db = new DatabaseSync(options.path);
  }

  async load(ref: AggregateRef): Promise<SnapshotResult> {
    this.assertOpen();
    throw new Error(NOT_IMPLEMENTED);
  }

  async commit(batch: LedgerCommit): Promise<LedgerCommitReceipt> {
    this.assertOpen();
    throw new Error(NOT_IMPLEMENTED);
  }

  async events(query: EventQuery): Promise<EventPage> {
    this.assertOpen();
    throw new Error(NOT_IMPLEMENTED);
  }

  /**
   * Adapter-specific disposal — NOT part of the StateLedger interface
   * (StateLedger stays load/commit/events). Idempotent; a closed ledger
   * rejects further use with a clear error.
   */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    try {
      this.db.close();
    } catch {
      // already closed or closing — nothing left to do
    }
  }

  private assertOpen(): void {
    if (this.closed) throw new Error("SqliteStateLedger: ledger is closed");
  }
}

export function createSqliteStateLedger(
  options: SqliteStateLedgerOptions,
): SqliteStateLedger {
  return new SqliteStateLedger(options);
}
