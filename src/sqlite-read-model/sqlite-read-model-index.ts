/**
 * SQLite ReadModelIndex adapter — P1-01 "Goal persisted and visible".
 *
 * ENTRY FILE (shared baseline, integrator, 2026-09-05). The exported surface
 * below is FROZEN for P1-01 lane B: lane B fills in the implementation inside
 * this directory and must NOT change the exported signatures/options.
 *
 * Driver decision: Node 24 built-in node:sqlite (DatabaseSync) — zero runtime
 * dependencies. Projection storage, checkpoint, dedupe and Goal index live in
 * one SQLite database file; the index is a rebuildable EVENT PROJECTION
 * (canonical Goal state comes from the StateLedger snapshots, never from here).
 * Acceptance gate: tests/contract-suite/goal-view.contract.suite.ts, wired
 * via tests/sqlite-read-model/sqlite-read-model-index.contract.test.ts.
 * P1-01 lane B depends only on interfaces/contracts — NOT on lane A's code.
 */
import { DatabaseSync } from "node:sqlite";
import type { EventPage } from "../contracts/ledger.js";
import type {
  GoalViewQuery,
  GoalViewResult,
  ProjectionReceipt,
  ReadModelIndex,
} from "../contracts/goal-view.js";

export interface SqliteReadModelIndexOptions {
  /** ":memory:" (per-connection ephemeral) or a single SQLite file path. */
  path: string;
}

const NOT_IMPLEMENTED = "SqliteReadModelIndex: implementation pending (P1-01 lane B)";

export class SqliteReadModelIndex implements ReadModelIndex {
  private readonly db: DatabaseSync;
  private closed = false;

  /** The path this read model is backed by (":memory:" or the file path). */
  readonly dbPath: string;

  constructor(options: SqliteReadModelIndexOptions) {
    if (typeof options.path !== "string" || options.path.length === 0) {
      throw new Error("SqliteReadModelIndex: path must be a non-empty string");
    }
    this.dbPath = options.path;
    this.db = new DatabaseSync(options.path);
  }

  async advance(page: EventPage): Promise<ProjectionReceipt> {
    this.assertOpen();
    throw new Error(NOT_IMPLEMENTED);
  }

  async goal(query: GoalViewQuery): Promise<GoalViewResult> {
    this.assertOpen();
    throw new Error(NOT_IMPLEMENTED);
  }

  /**
   * Adapter-specific disposal — NOT part of the ReadModelIndex interface.
   * Idempotent; a closed index rejects further use.
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
    if (this.closed) throw new Error("SqliteReadModelIndex: read model is closed");
  }
}

export function createSqliteReadModelIndex(
  options: SqliteReadModelIndexOptions,
): SqliteReadModelIndex {
  return new SqliteReadModelIndex(options);
}
