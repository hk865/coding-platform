/**
 * RecordStore SQLite physical backend (R3a §3.1/§7, N0/R3c lookup index).
 *
 * One synchronous factory owns exactly one `DatabaseSync`, the closed flag, the
 * original 4-core-table initialisation/compatibility check, `busy_timeout` and
 * the safe expression indexes for every registered lookup. The Goal transaction
 * and the candidate lookup share that ONE connection and ONE set of tables, so
 * neither wraps the other and no second connection or snapshot reader exists.
 *
 * Guarantees implemented here:
 *  - `commit` is one `BEGIN IMMEDIATE` -> identity lookup -> all record guards ->
 *    append the original event JSON -> upsert the original snapshot JSON ->
 *    persist the original idempotency format -> `COMMIT`; any throw before
 *    `COMMIT` fully `ROLLBACK`s (no partial event/snapshot/receipt/index);
 *  - CAS is on the full canonical `ref_key` and reports the revision observed
 *    INSIDE the transaction (`null` = the row genuinely does not exist), with
 *    `expectedRevision: 0` meaning "really exists at revision 0";
 *  - `beforeWrite` runs exactly once, after every check and before the first
 *    write, inside the transaction; replay/conflict/schema init never call it;
 *  - `eventAt` is an exact `events.id` primary-key read; unknown/corrupt event
 *    schema is never disguised as `not_found`;
 *  - `lookup` uses the registered expression index as a keyset and then reuses
 *    the exact `readMany` snapshot reader, so a damaged candidate is `corrupt`.
 *
 * This file imports no WorkGraph module, never calls `StateLedger.commit`, runs
 * no Goal validator and performs no fingerprint computation.
 */
import { DatabaseSync } from "node:sqlite";
import type { CommitCursor, CommandFingerprint } from "../../contracts/command-event.js";
import { makeCommitCursor, seqOfCommitCursor } from "../../contracts/ledger.js";
import type { VersionedRef } from "../../contracts/ledger.js";
import { initRecordStoreSchema } from "./migrations.js";
import { applyEventSchema, applyRecordSchema, bindPreparedRecords, checkPersistedIdempotencyRecord, committedReceiptFromIdempotency, corruptFailure, createRecordSchemaRegistry, decodeRecordBody, decodeRefKey, decodeStoredEventBody, guardIsSatisfied, idempotencyConflictFailure, invalidFailure, isNonEmptyString, messageOf, notFoundFailure, planPreparedCommit, revisionConflictFailure, uniqueConflictFailure, unsupportedFailure, type PlannedCommit, type RecordSchemaRegistry } from "./record-codec.js";
import { decodeGuardedRevision } from "./guarded-revision.js";
import { findClaimConflicts, ledgerHorizonMatches, RejectedInsideTransaction, type ClaimConflict } from "./commit-extensions.js";
import { createRecordLookupRegistry, decodeCountRequest, decodeLookupRequest, decodeOrderedLookupRequest, decodeTextSearchRequest, lookupMatcherOf, orderedRangePlanOf, searchTextFrom, textSearchMatches, type DecodedCountRequest, type DecodedLookupRequest, type DecodedOrderedLookupRequest, type RecordLookupRegistry } from "./lookup-index.js";
import { TEXT_SEARCH_CANDIDATE_MAX } from "./lookup-ports.js";
import type { LookupValue, OrderedLookupRequest, RecordCountPort, RecordCountRequest, RecordCountResult, RecordOrderedLookupPage, RecordOrderedLookupPort, RecordLookupPage, RecordLookupPort, RecordLookupRequest, RecordTextSearchPort, TextSearchPage, TextSearchRequest } from "./lookup-ports.js";
import { createSqliteTextSearch } from "./sqlite-text-search.js";
import type { DecodeResult, GoalRecordTransactionPort, PersistedIdempotencyRecord, PreparedCommit, RecordBackendSchemas, RecordBatchRead, RecordGuard, StoreCommitReceipt, StoreResult, StoredVersion, UniqueClaimChange, EncodedDomainEvent, EncodedRecord } from "./ports.js";

export type SqliteRecordBackendOptions = {
  path: string;
  schemas: RecordBackendSchemas;
  beforeWrite?: () => void;
  /**
   * Slice 4B L10 (lead P5): the FTS5 availability probe, injectable so a test
   * can force the `unsupported` path. The default is the real temporary-table
   * probe. It is the only double the spec allows here (spec §7).
   */
  fullTextProbe?: () => boolean;
  /** Slice 4B L10 checked-candidate cap; defaults to the port constant. */
  textSearchCandidateMax?: number;
};

export type SqliteRecordBackend = {
  readonly records: GoalRecordTransactionPort & RecordLookupPort & RecordOrderedLookupPort & RecordCountPort & RecordTextSearchPort;
  close(): Promise<void>;
};

type SnapshotRow = { snapshot_json: string };
type IdempotencyRow = {
  fingerprint: string;
  event_ids_json: string;
  aggregate_revisions_json: string;
  commit_cursor: string;
};
type EventRow = { event_json: string };

/** Quote one SQL identifier; registered lookup names are logical, never SQL. */
function quoteIdentifier(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/** Deterministic short suffix so a changed path set becomes a distinct index. */
function lookupIndexSuffix(value: string): string {
  let hash = 0x811c9dc5;
  for (let position = 0; position < value.length; position += 1) {
    hash ^= value.charCodeAt(position);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/** Validated paths are plain member names; quote is belt-and-braces only. */
function lookupJsonPath(path: string): string {
  return `'$.${path.replace(/'/g, "''")}'`;
}

/**
 * One safe expression index per registered lookup over the unique `snapshots`
 * table: aggregate type, each (json_type, json_extract) scalar and the full
 * ref_key. The type column keeps booleans distinct from 1/0, and SQLite keeps
 * the index current inside the same snapshot write transaction.
 */
function createLookupIndexes(db: DatabaseSync, lookups: RecordLookupRegistry): void {
  for (const index of lookups.indexes) {
    const columns: string[] = [`json_extract(ref_key, '$.aggregateType')`];
    for (const path of index.paths) {
      const jsonPath = lookupJsonPath(path);
      columns.push(`json_type(snapshot_json, ${jsonPath})`);
      columns.push(`json_extract(snapshot_json, ${jsonPath})`);
    }
    // Slice 2A L1: the ordered column follows the equality prefix, exactly the
    // ORDER BY expression; the default `'text'` also enters the fingerprint.
    if (index.orderBy !== undefined) columns.push(`json_extract(snapshot_json, ${lookupJsonPath(index.orderBy.path)})`);
    columns.push("ref_key");
    // S1: an unordered index keeps exactly the pre-2A fingerprint so existing
    // databases keep their index names; only an ordered index appends the
    // ordering column and its value type.
    const fingerprint = index.orderBy === undefined
      ? `${index.aggregateType}\u0000${index.paths.join("\u0000")}`
      : `${index.aggregateType}\u0000${index.paths.join("\u0000")}\u0000${index.orderBy.path}\u0000${index.orderBy.valueType}`;
    const name = `next_lookup_${index.name.replace(/[^A-Za-z0-9_]/g, "_")}_${lookupIndexSuffix(fingerprint)}`;
    db.exec(`CREATE INDEX IF NOT EXISTS ${quoteIdentifier(name)} ON snapshots (${columns.join(", ")})`);
  }
}

/** Parameterised predicate for one request scalar (never a raw SQL request). */
function lookupPredicate(path: string, value: LookupValue): { sql: string; params: (string | number)[] } {
  const jsonPath = lookupJsonPath(path);
  const matcher = lookupMatcherOf(value);
  if (matcher.kind === "null") return { sql: `json_extract(snapshot_json, ${jsonPath}) IS NULL`, params: [] };
  if (matcher.kind === "boolean") {
    return {
      sql: `json_type(snapshot_json, ${jsonPath}) = '${matcher.jsonType}' AND json_extract(snapshot_json, ${jsonPath}) = ${matcher.value ? 1 : 0}`,
      params: [],
    };
  }
  if (matcher.kind === "number") {
    return {
      sql: `json_type(snapshot_json, ${jsonPath}) IN ('integer', 'real') AND json_extract(snapshot_json, ${jsonPath}) = ?`,
      params: [matcher.value],
    };
  }
  return {
    sql: `json_type(snapshot_json, ${jsonPath}) = 'text' AND json_extract(snapshot_json, ${jsonPath}) = ?`,
    params: [matcher.value],
  };
}

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
  const fullTextProbe = options.fullTextProbe;
  if (fullTextProbe !== undefined && typeof fullTextProbe !== "function") {
    throw new Error("SqliteRecordBackend: fullTextProbe must be a function");
  }
  const textSearchCandidateMax = options.textSearchCandidateMax ?? TEXT_SEARCH_CANDIDATE_MAX;
  if (!Number.isSafeInteger(textSearchCandidateMax) || textSearchCandidateMax < 1) {
    throw new Error("SqliteRecordBackend: textSearchCandidateMax must be a positive safe integer");
  }

  // 1. Registration is verified BEFORE the database is touched: a bad registry
  //    must not create/open a file or run any DDL.
  const registry: RecordSchemaRegistry = createRecordSchemaRegistry(options.schemas);
  const lookups: RecordLookupRegistry = createRecordLookupRegistry(options.schemas, registry);

  // 2. Open the one connection; any failure after opening (pragma, DDL
  //    compatibility or lookup index creation) closes it and rethrows the
  //    ORIGINAL error synchronously.
  const db = new DatabaseSync(path);
  let textSearch!: ReturnType<typeof createSqliteTextSearch>;
  try {
    db.exec("PRAGMA busy_timeout = 5000");
    initRecordStoreSchema(db);
    createLookupIndexes(db, lookups);
    // Slice 4B L10 (P5): the FTS5 candidate tables, created or rebuilt here and
    // kept current inside the one snapshot write transaction below.
    textSearch = createSqliteTextSearch(db, lookups, fullTextProbe);
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
  // The ONE copy of the mechanical SQL helpers used by this port.
  // -------------------------------------------------------------------------

  /** Read + validate the stored idempotency row; `undefined` = identity unused. */
  const readIdempotency = (identityKey: string): DecodeResult<PersistedIdempotencyRecord | undefined> => {
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

  const parseIdempotencyRow = (row: IdempotencyRow): DecodeResult<PersistedIdempotencyRecord> => {
    let eventIds: unknown;
    let aggregateRevisions: unknown;
    try {
      eventIds = JSON.parse(row.event_ids_json);
      aggregateRevisions = JSON.parse(row.aggregate_revisions_json);
    } catch (error) {
      return { status: "invalid", reason: `idempotency row JSON is damaged: ${messageOf(error)}` };
    }
    return checkPersistedIdempotencyRecord({
      fingerprint: row.fingerprint,
      eventIds,
      aggregateRevisions,
      commitCursor: row.commit_cursor,
    });
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

  const persistIdempotency = (identityKey: string, value: PersistedIdempotencyRecord): void => {
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

  /** Owner observed in the current transaction on the shared identity_claims table. */
  const readClaimOwner = (claimKey: string): string | null => {
    const row = db
      .prepare("SELECT owner_key FROM identity_claims WHERE claim_key = ?")
      .get(claimKey) as { owner_key: unknown } | undefined;
    if (row === undefined) return null;
    if (!isNonEmptyString(row.owner_key)) {
      throw new Error(`identity_claims.owner_key for ${claimKey} is not non-empty text`);
    }
    return row.owner_key;
  };

  /** Apply one already-CAS-verified claim; null removes the slot row. */
  const applyClaim = (change: UniqueClaimChange): void => {
    if (change.nextOwner === null) {
      db.prepare("DELETE FROM identity_claims WHERE claim_key = ?").run(change.claimKey);
      return;
    }
    db.prepare(
      "INSERT INTO identity_claims (claim_key, owner_key) VALUES (?, ?) ON CONFLICT(claim_key) DO UPDATE SET owner_key = excluded.owner_key",
    ).run(change.claimKey, change.nextOwner);
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
      throw new Error("SqliteRecordStore: read requires no open transaction on the shared connection");
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
   * Revision observed inside the current read/write transaction, decoded from
   * the RAW `snapshot_json` text by the shared mechanical guard helper (never
   * by reading only its numeric `revision` field). A row that exists but is not
   * text, or whose body names another ref / unregistered schema, is `corrupt`,
   * never a revision conflict. `null` means the row genuinely does not exist.
   */
  const currentRevisionOf = (refKey: string): DecodeResult<number | null> => {
    const row = db.prepare("SELECT snapshot_json FROM snapshots WHERE ref_key = ?").get(refKey) as SnapshotRow | undefined;
    if (row === undefined) return decodeGuardedRevision(registry, refKey, null);
    if (typeof row.snapshot_json !== "string") {
      return { status: "invalid", reason: `snapshot ${refKey} is not stored as text` };
    }
    const decoded = decodeGuardedRevision(registry, refKey, row.snapshot_json);
    // Same diagnostic wording as the read path: the helper's mechanical reason
    // is preserved, never replaced by a fabricated revision.
    if (decoded.status === "invalid") {
      return { status: "invalid", reason: `snapshot ${refKey} is damaged: ${decoded.reason}` };
    }
    return decoded;
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

    // 3. Exact unique claim slots observed in this transaction. A tampered owner
    //    column is `corrupt`, never a fabricated conflict.
    let claimConflicts: ClaimConflict[];
    try {
      claimConflicts = findClaimConflicts(planned.claims, readClaimOwner);
    } catch (error) {
      return corruptFailure(`unique claim row is damaged: ${messageOf(error)}`);
    }
    if (claimConflicts.length > 0) {
      return uniqueConflictFailure("unique claim owner changed", claimConflicts);
    }

    // 4. Ledger horizon CAS, only when the caller supplied the field (null means
    //    the ledger must still be empty; a cursor is an exact tail CAS).
    if (planned.ledgerHorizon !== undefined) {
      const observed = readThrough();
      if (!ledgerHorizonMatches(planned.ledgerHorizon, observed)) {
        return revisionConflictFailure(
          `ledger horizon changed: expected ${String(planned.ledgerHorizon)} but observed ${String(observed)}`,
          [],
        );
      }
    }

    // 5. The single fault-injection point: after every check, before the first write.
    beforeWrite?.();

    // 6. Writes, all inside this one transaction. The real last-event cursor is
    //    bound (and the final schema re-validated) before any snapshot or claim
    //    is written; a rejection throws so the transaction fully rolls back.
    //    The ledger's pre-commit maximum is read before the append so the
    //    full-text maintained-through cursor advances only over this commit's
    //    events, never over a gap another writer left (R8).
    const previousMax = readThrough();
    const written = appendEvents(planned.events.map((decoded) => ({ eventId: decoded.event.eventId, json: decoded.event.json })));
    const boundRecords = bindPreparedRecords(planned.records, planned.commitCursorBindings, written.commitCursor, registry);
    if (boundRecords.status === "invalid") {
      throw new RejectedInsideTransaction(invalidFailure(boundRecords.reason));
    }
    const versions: StoredVersion[] = [];
    const aggregateRevisions: VersionedRef[] = [];
    for (const record of boundRecords.value) {
      // Persist the decoded JSON value, not the raw artifact: the expression
      // index is computed from this text, so it must encode the same value the
      // JS candidate extraction uses (duplicate keys last-wins, JS numbers).
      upsertSnapshot(record.record.refKey, JSON.stringify(record.parsed));
      textSearch.indexRecord(record.record.refKey, record.aggregateType, record.parsed);
      versions.push({ refKey: record.record.refKey, revision: record.record.revision });
      aggregateRevisions.push({ ref: record.ref, revision: record.record.revision });
    }
    textSearch.advanceThrough(
      previousMax === null ? null : seqOfCommitCursor(previousMax),
      seqOfCommitCursor(written.commitCursor),
    );
    for (const claim of planned.claims) applyClaim(claim);
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
    try {
      return withWriteTransaction(() => commitInsideTransaction(planned.value));
    } catch (error) {
      if (error instanceof RejectedInsideTransaction) return error.failure;
      throw error;
    }
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

  /** Registered candidate lookup: expression-index keyset then exact readMany. */
  const lookupInside = (request: DecodedLookupRequest): StoreResult<RecordLookupPage> => {
    const index = request.index;
    const conditions: string[] = [`json_extract(ref_key, '$.aggregateType') = ?`];
    const params: (string | number)[] = [index.aggregateType];
    for (let position = 0; position < index.paths.length; position += 1) {
      const predicate = lookupPredicate(index.paths[position]!, request.values[position]!);
      conditions.push(predicate.sql);
      params.push(...predicate.params);
    }
    if (request.after !== null) {
      conditions.push("ref_key COLLATE BINARY > ?");
      params.push(request.after);
    }
    params.push(request.limit + 1);
    let rows: { ref_key: string }[];
    try {
      rows = db
        .prepare(`SELECT ref_key FROM snapshots WHERE ${conditions.join(" AND ")} ORDER BY ref_key COLLATE BINARY ASC LIMIT ?`)
        .all(...params) as unknown as { ref_key: string }[];
    } catch (error) {
      return corruptFailure(`lookup index ${index.name} could not be read: ${messageOf(error)}`);
    }
    const hasNext = rows.length > request.limit;
    const pageRefs = rows.slice(0, request.limit).map((row) => row.ref_key);
    const read = readManyInside(pageRefs);
    if (read.status !== "ready") return corruptFailure(read.reason);
    if (read.value.missing.length > 0) {
      return corruptFailure(`lookup candidate ${read.value.missing[0]} has no snapshot`);
    }
    return {
      status: "ready",
      value: {
        records: read.value.records,
        next: hasNext ? pageRefs[pageRefs.length - 1]! : null,
        readThrough: read.value.readThrough,
      },
    };
  };

  const lookup = async (request: RecordLookupRequest): Promise<StoreResult<RecordLookupPage>> => {
    assertOpen();
    const decoded = decodeLookupRequest(lookups, request);
    if (decoded.status === "unsupported") return unsupportedFailure(decoded.reason);
    if (decoded.status === "invalid") return invalidFailure(decoded.reason);
    return withReadTransaction(() => lookupInside(decoded.value));
  };

  /**
   * Registered ordered keyset read (Slice 2A L1): equality prefix, candidate
   * filter, and a continuation whose order column carries the one range term
   * `orderedRangePlanOf` chooses (round 4), plus the `(order, ref_key)` row-value
   * filter only where it is still needed, all ordered by the indexed order
   * column so SQLite needs no temporary sort.
   */
  const lookupOrderedInside = (request: DecodedOrderedLookupRequest): StoreResult<RecordOrderedLookupPage> => {
    const index = request.index;
    const orderBy = index.orderBy!;
    const orderPath = lookupJsonPath(orderBy.path);
    const orderExpr = `json_extract(snapshot_json, ${orderPath})`;
    const conditions: string[] = [`json_extract(ref_key, '$.aggregateType') = ?`];
    const params: (string | number)[] = [index.aggregateType];
    for (let position = 0; position < index.paths.length; position += 1) {
      const jsonPath = lookupJsonPath(index.paths[position]!);
      conditions.push(`json_type(snapshot_json, ${jsonPath}) = 'text'`);
      conditions.push(`json_extract(snapshot_json, ${jsonPath}) = ?`);
      params.push(request.values[position]!);
    }
    if (orderBy.valueType === 'integer') {
      conditions.push(`json_type(snapshot_json, ${orderPath}) = 'integer'`);
    } else {
      conditions.push(`json_type(snapshot_json, ${orderPath}) = 'text'`);
      conditions.push(`${orderExpr} <> ''`);
    }
    // Slice 2A L1 continuation (lead round 4): the order column carries exactly
    // one range term, chosen in code, so SQLite seeks the ordered index instead
    // of scanning the whole equality prefix. The row-value keyset stays only
    // where that one term does not already imply it; the integer safe range
    // supplies the other side (ascending: upper; descending: lower).
    const plan = orderedRangePlanOf(request);
    const safeIntegerMax = 9007199254740991;
    const lowerBoundSql = plan.term === null ? null : `${orderExpr} ${plan.term.inclusive ? '>=' : '>'} ?`;
    const upperBoundSql = plan.term === null ? null : `${orderExpr} ${plan.term.inclusive ? '<=' : '<'} ?`;
    if (request.direction === 'asc') {
      if (plan.term !== null) {
        conditions.push(lowerBoundSql!);
        params.push(plan.term.value);
      } else if (orderBy.valueType === 'integer') {
        conditions.push(`${orderExpr} >= ?`);
        params.push(-safeIntegerMax);
      }
      if (orderBy.valueType === 'integer') {
        conditions.push(`${orderExpr} <= ?`);
        params.push(safeIntegerMax);
      }
    } else {
      if (orderBy.valueType === 'integer') {
        conditions.push(`${orderExpr} >= ?`);
        params.push(-safeIntegerMax);
      }
      if (plan.term !== null) {
        conditions.push(upperBoundSql!);
        params.push(plan.term.value);
      } else if (orderBy.valueType === 'integer') {
        conditions.push(`${orderExpr} <= ?`);
        params.push(safeIntegerMax);
      }
    }
    if (plan.keyset && request.after !== null) {
      const operator = request.direction === 'asc' ? '>' : '<';
      conditions.push(`(${orderExpr}, ref_key COLLATE BINARY) ${operator} (?, ?)`);
      params.push(request.after.order, request.after.refKey);
    }
    const direction = request.direction === 'asc' ? 'ASC' : 'DESC';
    params.push(request.limit + 1);
    let rows: { ref_key: string; order_value: string | number }[];
    try {
      rows = db
        .prepare(`SELECT ref_key, ${orderExpr} AS order_value FROM snapshots WHERE ${conditions.join(' AND ')} ORDER BY ${orderExpr} ${direction}, ref_key COLLATE BINARY ${direction} LIMIT ?`)
        .all(...params) as unknown as { ref_key: string; order_value: string | number }[];
    } catch (error) {
      return corruptFailure(`lookup index ${index.name} could not be read: ${messageOf(error)}`);
    }
    const hasNext = rows.length > request.limit;
    const pageRows = rows.slice(0, request.limit);
    const pageRefs = pageRows.map((row) => row.ref_key);
    const read = readManyInside(pageRefs);
    if (read.status !== 'ready') return corruptFailure(read.reason);
    if (read.value.missing.length > 0) return corruptFailure(`lookup candidate ${read.value.missing[0]} has no snapshot`);
    const last = pageRows[pageRows.length - 1];
    return {
      status: 'ready',
      value: {
        records: read.value.records,
        next: hasNext && last !== undefined ? { order: last.order_value, refKey: last.ref_key } : null,
        readThrough: read.value.readThrough,
      },
    };
  };

  const lookupOrdered = async (request: OrderedLookupRequest): Promise<StoreResult<RecordOrderedLookupPage>> => {
    assertOpen();
    const decoded = decodeOrderedLookupRequest(lookups, request);
    if (decoded.status === "unsupported") return unsupportedFailure(decoded.reason);
    if (decoded.status === "invalid") return invalidFailure(decoded.reason);
    return withReadTransaction(() => lookupOrderedInside(decoded.value));
  };

  /**
   * Registered candidate count (Slice 2C L3): the same equality predicates and
   * expression index as `lookup`, with no snapshot read. A distinct count
   * de-duplicates by (type class, value) because SQLite's own DISTINCT treats
   * true/1 and false/0 as equal and separates integer/real that JS normalizes.
   */
  const countInside = (request: DecodedCountRequest): StoreResult<RecordCountResult> => {
    const index = request.index;
    const conditions: string[] = [`json_extract(ref_key, '$.aggregateType') = ?`];
    const params: (string | number)[] = [index.aggregateType];
    if (index.orderBy !== undefined) {
      for (let position = 0; position < request.values.length; position += 1) {
        const jsonPath = lookupJsonPath(index.paths[position]!);
        conditions.push(`json_type(snapshot_json, ${jsonPath}) = 'text'`);
        conditions.push(`json_extract(snapshot_json, ${jsonPath}) = ?`);
        // decodeCountRequest guarantees non-empty text for an ordered index.
        params.push(request.values[position] as string);
      }
      const orderPath = lookupJsonPath(index.orderBy.path);
      const orderExpr = `json_extract(snapshot_json, ${orderPath})`;
      if (index.orderBy.valueType === 'integer') {
        conditions.push(`json_type(snapshot_json, ${orderPath}) = 'integer'`);
        conditions.push(`${orderExpr} >= ?`);
        params.push(-9007199254740991);
        conditions.push(`${orderExpr} <= ?`);
        params.push(9007199254740991);
      } else {
        conditions.push(`json_type(snapshot_json, ${orderPath}) = 'text'`);
        conditions.push(`${orderExpr} <> ''`);
      }
    } else {
      for (let position = 0; position < request.values.length; position += 1) {
        const predicate = lookupPredicate(index.paths[position]!, request.values[position]!);
        conditions.push(predicate.sql);
        params.push(...predicate.params);
      }
    }
    let count: number;
    try {
      if (request.distinctPath === null) {
        const row = db
          .prepare(`SELECT COUNT(*) AS total FROM snapshots WHERE ${conditions.join(' AND ')}`)
          .get(...params) as { total: number | bigint } | undefined;
        count = Number(row?.total ?? 0);
      } else {
        const distinctPath = lookupJsonPath(request.distinctPath);
        const typeClass = `CASE WHEN json_type(snapshot_json, ${distinctPath}) IN ('integer', 'real') THEN 'number' ELSE json_type(snapshot_json, ${distinctPath}) END`;
        const distinctConditions = [
          ...conditions,
          `json_type(snapshot_json, ${distinctPath}) IN ('text', 'integer', 'real', 'true', 'false')`,
        ];
        const row = db
          .prepare(`SELECT COUNT(*) AS total FROM (SELECT DISTINCT ${typeClass} AS value_type, json_extract(snapshot_json, ${distinctPath}) AS value FROM snapshots WHERE ${distinctConditions.join(' AND ')})`)
          .get(...params) as { total: number | bigint } | undefined;
        count = Number(row?.total ?? 0);
      }
    } catch (error) {
      return corruptFailure(`lookup index ${index.name} could not be counted: ${messageOf(error)}`);
    }
    return { status: 'ready', value: { count, readThrough: readThrough() } };
  };

  const countLookup = async (request: RecordCountRequest): Promise<StoreResult<RecordCountResult>> => {
    assertOpen();
    const decoded = decodeCountRequest(lookups, request);
    if (decoded.status === "unsupported") return unsupportedFailure(decoded.reason);
    if (decoded.status === "invalid") return invalidFailure(decoded.reason);
    return withReadTransaction(() => countInside(decoded.value));
  };

  /**
   * Slice 4B L10 full-text read: the FTS5 window query is only a candidate
   * superset; every candidate is rechecked against the substring rule.
   */
  const searchText = async (request: TextSearchRequest): Promise<StoreResult<TextSearchPage>> => {
    assertOpen();
    if (!textSearch.available) {
      return unsupportedFailure("SQLite FTS5 is not available for full-text search");
    }
    const decoded = decodeTextSearchRequest(lookups, request);
    if (decoded.status === "unsupported") return unsupportedFailure(decoded.reason);
    if (decoded.status === "invalid") return invalidFailure(decoded.reason);
    return withReadTransaction(() => {
      const definition = decoded.value.index;
      // R8: the candidate table must be maintained through the ledger's current
      // maximum. A gap (an unregistered open, an unavailable probe, another
      // writer) is `unavailable` / `index_not_ready`, never a silently partial
      // answer.
      if (!textSearch.isCurrent(definition.name)) {
        return { status: "rejected", code: "unavailable", reason: "index_not_ready" };
      }
      const textPaths = definition.text!.paths;
      const page = textSearch.candidates(
        definition,
        decoded.value.values,
        decoded.value.windows,
        decoded.value.after,
        textSearchCandidateMax,
      );
      const matched: string[] = [];
      let position = 0;
      for (; position < page.refKeys.length; position += 1) {
        if (matched.length >= decoded.value.limit) break;
        const refKey = page.refKeys[position]!;
        const row = db.prepare("SELECT snapshot_json FROM snapshots WHERE ref_key = ?").get(refKey) as
          | SnapshotRow
          | undefined;
        if (row === undefined) return corruptFailure(`text search candidate ${refKey} has no snapshot`);
        if (typeof row.snapshot_json !== "string") return corruptFailure(`snapshot ${refKey} is not stored as text`);
        let body: Record<string, unknown>;
        try {
          body = JSON.parse(row.snapshot_json) as Record<string, unknown>;
        } catch (error) {
          return corruptFailure(`snapshot ${refKey} is damaged: ${messageOf(error)}`);
        }
        if (textSearchMatches(searchTextFrom(body, textPaths), decoded.value.terms)) matched.push(refKey);
      }
      const exhausted = !page.hasMore && position >= page.refKeys.length;
      const next = exhausted ? null : (page.refKeys[position - 1] ?? null);
      const read = readManyInside(matched);
      if (read.status !== "ready") return corruptFailure(read.reason);
      if (read.value.missing.length > 0) {
        return corruptFailure(`text search candidate ${read.value.missing[0]} has no snapshot`);
      }
      return {
        status: "ready",
        value: { records: read.value.records, next, complete: exhausted, readThrough: read.value.readThrough },
      };
    });
  };

  const records: GoalRecordTransactionPort & RecordLookupPort & RecordOrderedLookupPort & RecordCountPort & RecordTextSearchPort = {
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
    lookup,
    lookupOrdered,
    countLookup,
    searchText,
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

  return { records, close };
}
