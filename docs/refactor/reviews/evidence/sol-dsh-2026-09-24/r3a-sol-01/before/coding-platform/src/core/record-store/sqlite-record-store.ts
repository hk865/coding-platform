/**
 * RecordStore SQLite physical backend (R3a §3.1/§7).
 *
 * One synchronous factory owns exactly one `DatabaseSync`, the closed flag, the
 * original 4-core-table initialisation/compatibility check and `busy_timeout`.
 * `records` and `legacyAccess` share that ONE connection and ONE set of tables,
 * so the unmigrated StateLedger commit kinds and the new Goal transaction see
 * the same physical state without either one wrapping the other.
 *
 * Guarantees implemented here:
 *  - `commit` is one `BEGIN IMMEDIATE` → identity lookup → all record guards →
 *    append the original event JSON → upsert the original snapshot JSON →
 *    persist the original idempotency format → `COMMIT`; any throw before
 *    `COMMIT` fully `ROLLBACK`s (no partial event/snapshot/receipt);
 *  - CAS is on the full canonical `ref_key` and reports the revision observed
 *    INSIDE the transaction (`null` = the row genuinely does not exist), with
 *    `expectedRevision: 0` meaning "really exists at revision 0";
 *  - `beforeWrite` runs exactly once, after every check and before the first
 *    write, inside the transaction; replay/conflict/schema init never call it;
 *  - `eventAt` is an exact `events.id` primary-key read; unknown/corrupt event
 *    schema is never disguised as `not_found`.
 *
 * This file imports no WorkGraph module, never calls `StateLedger.commit`, runs
 * no Goal validator and performs no fingerprint computation.
 */
import { DatabaseSync } from "node:sqlite";
import type { CommitCursor, CommandFingerprint } from "../../contracts/command-event.js";
import { makeCommitCursor, seqOfCommitCursor } from "../../contracts/ledger.js";
import type { VersionedRef } from "../../contracts/ledger.js";
import { initRecordStoreSchema } from "./migrations.js";
import {
  applyEventSchema,
  applyRecordSchema,
  checkLegacyIdempotencyRecord,
  cloneLegacyIdempotencyRecord,
  committedReceiptFromIdempotency,
  corruptFailure,
  createRecordSchemaRegistry,
  decodeRecordBody,
  decodeRefKey,
  decodeStoredEventBody,
  guardIsSatisfied,
  idempotencyConflictFailure,
  invalidFailure,
  isNonEmptyString,
  isRevision,
  messageOf,
  notFoundFailure,
  parseJsonObject,
  planPreparedCommit,
  revisionConflictFailure,
  unsupportedFailure,
  type PlannedCommit,
  type RecordSchemaRegistry,
} from "./record-codec.js";
import type {
  DecodeResult,
  GoalRecordTransactionPort,
  LegacyIdempotencyRecord,
  LegacyRecordMechanics,
  PreparedCommit,
  RecordBackendSchemas,
  RecordBatchRead,
  RecordGuard,
  StoreCommitReceipt,
  StoreResult,
  StoredVersion,
  EncodedDomainEvent,
  EncodedRecord,
} from "./ports.js";

export type SqliteRecordBackendOptions = {
  path: string;
  schemas: RecordBackendSchemas;
  beforeWrite?: () => void;
};

/**
 * Transitional access to the ONE shared physical state, used only by the legacy
 * StateLedger adapters. Not a business/model port.
 */
export type SqliteLegacyRecordAccess = {
  readonly path: string;
  readonly connection: DatabaseSync;
  readonly beforeWrite: (() => void) | undefined;
  readonly mechanics: LegacyRecordMechanics;
};

export type SqliteRecordBackend = {
  readonly records: GoalRecordTransactionPort;
  close(): Promise<void>;
  readonly legacyAccess: SqliteLegacyRecordAccess;
};

type SnapshotRow = { snapshot_json: string };
type IdempotencyRow = {
  fingerprint: string;
  event_ids_json: string;
  aggregate_revisions_json: string;
  commit_cursor: string;
};
type EventRow = { event_json: string };

const CLOSED_MESSAGE = "SqliteRecordStore: backend is closed";

export function createSqliteRecordBackend(options: SqliteRecordBackendOptions): SqliteRecordBackend {
  if (typeof options !== "object" || options === null) {
    throw new Error("SqliteRecordBackend: options must be an object");
  }
  const path = options.path;
  if (typeof path !== "string" || path.length === 0) {
    throw new Error("SqliteRecordBackend: path must be a non-empty string");
  }
  const beforeWrite = options.beforeWrite;
  if (beforeWrite !== undefined && typeof beforeWrite !== "function") {
    throw new Error("SqliteRecordBackend: beforeWrite must be a function");
  }

  // 1. Registration is verified BEFORE the database is touched: a bad registry
  //    must not create/open a file or run any DDL.
  const registry: RecordSchemaRegistry = createRecordSchemaRegistry(options.schemas);

  // 2. Open the one connection; any failure after opening (pragma or DDL
  //    compatibility) closes it and rethrows the ORIGINAL error synchronously.
  const db = new DatabaseSync(path);
  try {
    db.exec("PRAGMA busy_timeout = 5000");
    initRecordStoreSchema(db);
  } catch (error) {
    try {
      db.close();
    } catch {
      // already unusable - nothing left to release
    }
    throw error;
  }

  let closed = false;
  const assertOpen = (): void => {
    if (closed) throw new Error(CLOSED_MESSAGE);
  };

  // -------------------------------------------------------------------------
  // The ONE copy of the mechanical SQL helpers, shared by this port and by the
  // legacy adapters through `legacyAccess.mechanics`.
  // -------------------------------------------------------------------------

  /** Read + validate the stored idempotency row; `undefined` = identity unused. */
  const readIdempotency = (identityKey: string): DecodeResult<LegacyIdempotencyRecord | undefined> => {
    const row = db
      .prepare(
        "SELECT fingerprint, event_ids_json, aggregate_revisions_json, commit_cursor FROM idempotency WHERE identity_key = ?",
      )
      .get(identityKey) as IdempotencyRow | undefined;
    if (row === undefined) return { status: "decoded", value: undefined };
    const parsed = parseIdempotencyRow(row);
    if (parsed.status === "invalid") return parsed;
    return { status: "decoded", value: parsed.value };
  };

  const parseIdempotencyRow = (row: IdempotencyRow): DecodeResult<LegacyIdempotencyRecord> => {
    let eventIds: unknown;
    let aggregateRevisions: unknown;
    try {
      eventIds = JSON.parse(row.event_ids_json);
      aggregateRevisions = JSON.parse(row.aggregate_revisions_json);
    } catch (error) {
      return { status: "invalid", reason: `idempotency row JSON is damaged: ${messageOf(error)}` };
    }
    return checkLegacyIdempotencyRecord({
      fingerprint: row.fingerprint,
      eventIds,
      aggregateRevisions,
      commitCursor: row.commit_cursor,
    });
  };

  const idempotencyRecord = (identityKey: string): LegacyIdempotencyRecord | undefined => {
    const existing = readIdempotency(identityKey);
    if (existing.status === "invalid") {
      // The legacy adapters have no failure channel here; the original adapter
      // threw while parsing such a row, and silently treating it as "unused"
      // would let a duplicate commit through.
      throw new Error(`SqliteRecordStore: idempotency row for ${identityKey} is damaged: ${existing.reason}`);
    }
    return existing.value === undefined ? undefined : cloneLegacyIdempotencyRecord(existing.value);
  };

  const appendEvents = (events: readonly { eventId: string; json: string }[]): {
    eventIds: string[];
    commitCursor: CommitCursor;
  } => {
    const statement = db.prepare("INSERT INTO events (event_json) VALUES (?)");
    const eventIds: string[] = [];
    let lastSeq = 0;
    for (const event of events) {
      const result = statement.run(event.json);
      lastSeq = Number(result.lastInsertRowid);
      eventIds.push(event.eventId);
    }
    return { eventIds, commitCursor: makeCommitCursor(lastSeq) };
  };

  const upsertSnapshot = (refKey: string, json: string): void => {
    db.prepare(
      "INSERT INTO snapshots (ref_key, snapshot_json) VALUES (?, ?) ON CONFLICT(ref_key) DO UPDATE SET snapshot_json = excluded.snapshot_json",
    ).run(refKey, json);
  };

  const persistIdempotency = (identityKey: string, value: LegacyIdempotencyRecord): void => {
    db.prepare(
      "INSERT INTO idempotency (identity_key, fingerprint, event_ids_json, aggregate_revisions_json, commit_cursor) VALUES (?, ?, ?, ?, ?)",
    ).run(
      identityKey,
      String(value.fingerprint),
      JSON.stringify(value.eventIds),
      JSON.stringify(value.aggregateRevisions),
      String(value.commitCursor),
    );
  };

  /**
   * Next append sequence from `sqlite_sequence` (falling back to MAX(id)+1 on a
   * database old enough to have no AUTOINCREMENT table yet). The caller must
   * already hold the write transaction: the value is only stable under
   * `BEGIN IMMEDIATE`.
   */
  const nextEventSeq = (): number => {
    if (!db.isTransaction) {
      throw new Error("SqliteRecordStore: nextEventSeq requires an active BEGIN IMMEDIATE write transaction");
    }
    try {
      const row = db
        .prepare("SELECT COALESCE((SELECT seq FROM sqlite_sequence WHERE name = 'events'), 0) + 1 AS next_seq")
        .get() as { next_seq: number | bigint } | undefined;
      return Number(row?.next_seq ?? 1);
    } catch {
      const row = db.prepare("SELECT COALESCE(MAX(id), 0) + 1 AS next_seq FROM events").get() as
        | { next_seq: number | bigint }
        | undefined;
      return Number(row?.next_seq ?? 1);
    }
  };

  const mechanics: LegacyRecordMechanics = {
    assertOpen,
    idempotencyRecord,
    appendEvents,
    upsertSnapshot,
    persistIdempotency,
    nextEventSeq,
  };

  // -------------------------------------------------------------------------
  // Transaction wrappers (no async write queue: the whole section is synchronous)
  // -------------------------------------------------------------------------

  const withWriteTransaction = (work: () => StoreCommitReceipt): StoreCommitReceipt => {
    if (db.isTransaction) {
      throw new Error("SqliteRecordStore: commit requires no open transaction on the shared connection");
    }
    db.exec("BEGIN IMMEDIATE");
    try {
      const receipt = work();
      db.exec("COMMIT");
      return receipt;
    } catch (error) {
      try {
        db.exec("ROLLBACK");
      } catch {
        // no live transaction left to roll back - nothing else to do
      }
      throw error;
    }
  };

  const withReadTransaction = <T>(work: () => T): T => {
    if (db.isTransaction) {
      throw new Error("SqliteRecordStore: readMany requires no open transaction on the shared connection");
    }
    db.exec("BEGIN");
    try {
      const value = work();
      db.exec("COMMIT");
      return value;
    } catch (error) {
      try {
        db.exec("ROLLBACK");
      } catch {
        // no live transaction left to roll back - nothing else to do
      }
      throw error;
    }
  };

  // -------------------------------------------------------------------------
  // Reads
  // -------------------------------------------------------------------------

  const readThrough = (): CommitCursor | null => {
    const row = db.prepare("SELECT MAX(id) AS max_id FROM events").get() as { max_id: number | bigint | null } | undefined;
    const max = row?.max_id;
    if (max === null || max === undefined) return null;
    return makeCommitCursor(Number(max));
  };

  /**
   * Revision observed inside the current read/write transaction. A row that
   * exists but cannot yield a revision is `corrupt`, never a revision conflict.
   */
  const currentRevisionOf = (refKey: string): DecodeResult<number | null> => {
    const row = db.prepare("SELECT snapshot_json FROM snapshots WHERE ref_key = ?").get(refKey) as SnapshotRow | undefined;
    if (row === undefined) return { status: "decoded", value: null };
    if (typeof row.snapshot_json !== "string") {
      return { status: "invalid", reason: `snapshot ${refKey} is not stored as text` };
    }
    const parsed = parseJsonObject(row.snapshot_json);
    if (parsed.status === "invalid") {
      return { status: "invalid", reason: `snapshot ${refKey} is damaged: ${parsed.reason}` };
    }
    const revision = parsed.value["revision"];
    if (!isRevision(revision)) {
      return { status: "invalid", reason: `snapshot ${refKey} has no usable revision` };
    }
    return { status: "decoded", value: revision };
  };

  const guardConflicts = (
    guards: readonly RecordGuard[],
  ): DecodeResult<{ refKey: string; revision: number | null }[]> => {
    const conflicts: { refKey: string; revision: number | null }[] = [];
    for (const guard of guards) {
      const current = currentRevisionOf(guard.refKey);
      if (current.status === "invalid") return current;
      if (!guardIsSatisfied(guard.expectedRevision, current.value)) {
        conflicts.push({ refKey: guard.refKey, revision: current.value });
      }
    }
    return { status: "decoded", value: conflicts };
  };

  const readManyInside = (refKeys: readonly string[]): StoreResult<RecordBatchRead> => {
    const records: EncodedRecord[] = [];
    const missing: string[] = [];
    for (const refKey of refKeys) {
      const decodedKey = decodeRefKey(refKey);
      if (decodedKey.status === "invalid") return invalidFailure(decodedKey.reason);
      const schema = registry.recordByAggregateType(decodedKey.value.aggregateType);
      if (schema === undefined) {
        // Unknown aggregate type is a capability gap of this narrow store, not a
        // missing row.
        return unsupportedFailure(`no record schema registered for aggregateType ${decodedKey.value.aggregateType}`);
      }
      const row = db.prepare("SELECT snapshot_json FROM snapshots WHERE ref_key = ?").get(refKey) as
        | SnapshotRow
        | undefined;
      if (row === undefined) {
        missing.push(refKey);
        continue;
      }
      if (typeof row.snapshot_json !== "string") {
        return corruptFailure(`snapshot ${refKey} is not stored as text`);
      }
      const decoded = decodeRecordBody({
        refKey,
        schemaId: schema.schemaId,
        revision: null,
        json: row.snapshot_json,
      });
      if (decoded.status === "invalid") return corruptFailure(`snapshot ${refKey} is damaged: ${decoded.reason}`);
      const applied = applyRecordSchema(decoded.value, schema);
      if (applied.status === "invalid") {
        return corruptFailure(`snapshot ${refKey} is damaged: ${applied.reason}`);
      }
      records.push(applied.value.record);
    }
    return { status: "ready", value: { records, missing, readThrough: readThrough() } };
  };

  // -------------------------------------------------------------------------
  // Commit
  // -------------------------------------------------------------------------

  const commitInsideTransaction = (planned: PlannedCommit): StoreCommitReceipt => {
    // 1. Identity lookup first: a same-identity/same-fingerprint commit is a
    //    replay even if the current versions moved on since the original write.
    const existing = readIdempotency(planned.identityKey);
    if (existing.status === "invalid") {
      return corruptFailure(`idempotency row for ${planned.identityKey} is damaged: ${existing.reason}`);
    }
    if (existing.value !== undefined) {
      if (String(existing.value.fingerprint) !== planned.fingerprint) {
        return idempotencyConflictFailure(
          `identity ${planned.identityKey} was committed with a different fingerprint`,
        );
      }
      return committedReceiptFromIdempotency(planned.identityKey, existing.value);
    }

    // 2. All record guards, inside the transaction, on the full canonical ref_key.
    const conflicts = guardConflicts(planned.guards);
    if (conflicts.status === "invalid") {
      return corruptFailure(conflicts.reason);
    }
    if (conflicts.value.length > 0) {
      return revisionConflictFailure("record version changed", conflicts.value);
    }

    // 3. The single fault-injection point: after every check, before the first write.
    beforeWrite?.();

    // 4. Writes, all inside this one transaction.
    const written = appendEvents(planned.events.map((decoded) => ({ eventId: decoded.event.eventId, json: decoded.event.json })));
    const versions: StoredVersion[] = [];
    const aggregateRevisions: VersionedRef[] = [];
    for (const record of planned.records) {
      upsertSnapshot(record.record.refKey, record.record.json);
      versions.push({ refKey: record.record.refKey, revision: record.record.revision });
      aggregateRevisions.push({ ref: record.ref, revision: record.record.revision });
    }
    persistIdempotency(planned.identityKey, {
      fingerprint: planned.fingerprint as CommandFingerprint,
      eventIds: written.eventIds,
      aggregateRevisions,
      commitCursor: written.commitCursor,
    });

    return {
      status: "committed",
      replayed: false,
      identityKey: planned.identityKey,
      versions,
      eventIds: written.eventIds,
      cursor: written.commitCursor,
    };
  };

  const commit = async (input: PreparedCommit): Promise<StoreCommitReceipt> => {
    assertOpen();
    // Copy before anything else so the caller cannot mutate an in-flight commit.
    const prepared = structuredClone(input);
    const planned = planPreparedCommit(prepared, registry);
    if (planned.status === "invalid") return invalidFailure(planned.reason);
    return withWriteTransaction(() => commitInsideTransaction(planned.value));
  };

  const lookupCommit = async (input: {
    identityKey: string;
    fingerprint: string;
  }): Promise<StoreResult<Extract<StoreCommitReceipt, { status: "committed" }>>> => {
    assertOpen();
    if (typeof input !== "object" || input === null) {
      return invalidFailure("lookupCommit input must be an object");
    }
    const identityKey = input.identityKey;
    const fingerprint = input.fingerprint;
    if (!isNonEmptyString(identityKey)) return invalidFailure("lookupCommit identityKey must be a non-empty string");
    if (!isNonEmptyString(fingerprint)) return invalidFailure("lookupCommit fingerprint must be a non-empty string");
    const existing = readIdempotency(identityKey);
    if (existing.status === "invalid") {
      return corruptFailure(`idempotency row for ${identityKey} is damaged: ${existing.reason}`);
    }
    if (existing.value === undefined) {
      return notFoundFailure(`identity ${identityKey} has not been committed`);
    }
    if (String(existing.value.fingerprint) !== fingerprint) {
      return idempotencyConflictFailure(`identity ${identityKey} was committed with a different fingerprint`);
    }
    return { status: "ready", value: committedReceiptFromIdempotency(identityKey, existing.value) };
  };

  const eventAt = async (
    cursor: CommitCursor,
  ): Promise<StoreResult<{ cursor: CommitCursor; event: EncodedDomainEvent }>> => {
    assertOpen();
    let seq: number;
    try {
      seq = seqOfCommitCursor(cursor);
    } catch (error) {
      return invalidFailure(`not a ledger cursor: ${messageOf(error)}`);
    }
    const row = db.prepare("SELECT event_json FROM events WHERE id = ?").get(seq) as EventRow | undefined;
    if (row === undefined) return notFoundFailure(`no event at cursor ${String(cursor)}`);
    if (typeof row.event_json !== "string") return corruptFailure(`event ${String(cursor)} is not stored as text`);
    const decoded = decodeStoredEventBody(row.event_json);
    if (decoded.status === "invalid") return corruptFailure(`event ${String(cursor)} is damaged: ${decoded.reason}`);
    const schema = registry.eventByTypeVersion(decoded.value.event.eventType, decoded.value.event.schemaVersion);
    if (schema === undefined) {
      return unsupportedFailure(
        `no event schema registered for ${decoded.value.event.eventType}@${decoded.value.event.schemaVersion}`,
      );
    }
    const applied = applyEventSchema(decoded.value, schema);
    if (applied.status === "invalid") return corruptFailure(`event ${String(cursor)} is damaged: ${applied.reason}`);
    return { status: "ready", value: { cursor, event: applied.value.event } };
  };

  const records: GoalRecordTransactionPort = {
    readMany: async (refKeys: readonly string[]): Promise<StoreResult<RecordBatchRead>> => {
      assertOpen();
      if (!Array.isArray(refKeys) || !refKeys.every((key) => isNonEmptyString(key))) {
        return invalidFailure("readMany refKeys must be an array of non-empty strings");
      }
      // Copy before the first await so a caller mutating the array cannot change
      // the read set.
      const keys = [...refKeys];
      return withReadTransaction(() => readManyInside(keys));
    },
    lookupCommit,
    commit,
    eventAt,
  };

  const legacyAccess: SqliteLegacyRecordAccess = {
    path,
    connection: db,
    beforeWrite,
    mechanics,
  };

  const close = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    try {
      db.close();
    } catch {
      // already closed or closing - nothing left to do
    }
  };

  return { records, close, legacyAccess };
}
