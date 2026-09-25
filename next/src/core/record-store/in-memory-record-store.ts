/**
 * RecordStore in-memory physical backend (R3a §3.1/§7, N0/R3c lookup index).
 *
 * This factory is the ONLY creator of the shared in-memory physical state:
 * exactly one `eventLog`, one `snapshots` Map, one `idempotency` Map, one
 * `claims` Map and one `cursorSeq`. No second event log, snapshot map, claim
 * map or counter exists anywhere.
 *
 * Guarantees implemented here:
 *  - object identity is stable: publish and rollback mutate the Maps/array in
 *    place and never replace them;
 *  - the complete commit input is cloned before the first `await`, and reads and
 *    receipts are copies;
 *  - lookup -> CAS -> write happen in one synchronous atomic section (no `await`
 *    in the middle); all validation/encoding is done first, then the events,
 *    receipt and lookup candidates are published;
 *  - a write-phase failure undoes exactly the keys this commit touched (original
 *    Map values, previous eventLog length, previous cursor and previous lookup
 *    candidates) - never a copy of the whole history;
 *  - `beforeWrite` runs exactly once, after every check and before the first
 *    write; replay/conflict never call it;
 *  - the candidate lookup index is updated only for records written by a commit
 *    and only from their already validated parsed bodies.
 *
 * This file imports no WorkGraph module, never calls `StateLedger.commit`, runs
 * no Goal validator and performs no fingerprint computation.
 */
import type { CommitCursor, CommandFingerprint } from "../../contracts/command-event.js";
import { makeCommitCursor, seqOfCommitCursor } from "../../contracts/ledger.js";
import type { VersionedRef } from "../../contracts/ledger.js";
import { applyEventSchema, applyRecordSchema, bindPreparedRecords, checkPersistedIdempotencyRecord, clonePersistedIdempotencyRecord, committedReceiptFromIdempotency, corruptFailure, createRecordSchemaRegistry, decodeRecordBody, decodeRefKey, decodeStoredEventBody, guardIsSatisfied, idempotencyConflictFailure, invalidFailure, isNonEmptyString, messageOf, notFoundFailure, planPreparedCommit, revisionConflictFailure, uniqueConflictFailure, unsupportedFailure, type PlannedCommit, type RecordSchemaRegistry } from "./record-codec.js";
import { decodeGuardedRevision } from "./guarded-revision.js";
import { findClaimConflicts, ledgerHorizonMatches, RejectedInsideTransaction } from "./commit-extensions.js";
import { compareRefKeys, createRecordLookupRegistry, decodeLookupRequest, encodeLookupValues, lookupIndexKeyOf, type RecordLookupRegistry, type RegisteredLookupIndex } from "./lookup-index.js";
import type { RecordLookupPage, RecordLookupPort, RecordLookupRequest } from "./lookup-ports.js";
import type { DecodeResult, EncodedDomainEvent, EncodedRecord, GoalRecordTransactionPort, PersistedIdempotencyRecord, PreparedCommit, RecordBackendSchemas, RecordBatchRead, RecordGuard, StoreCommitReceipt, StoreResult, StoredVersion } from "./ports.js";

export type InMemoryRecordBackendOptions = {
  schemas: RecordBackendSchemas;
  beforeWrite?: () => void;
};

export type InMemoryRecordBackend = {
  readonly records: GoalRecordTransactionPort & RecordLookupPort;
  close(): Promise<void>;
};

/**
 * The single in-memory physical state. A local shape (not the removed legacy
 * access type): no caller receives this object or any write helper over it.
 */
type InMemoryPhysicalState = {
  readonly eventLog: { cursor: CommitCursor; event: Record<string, unknown> }[];
  readonly snapshots: Map<string, Record<string, unknown>>;
  readonly idempotency: Map<string, PersistedIdempotencyRecord>;
  /** Exact unique slot -> owner. Absent key = no owner. */
  readonly claims: Map<string, string>;
  cursorSeq: number;
};

/** Candidate index for one registered lookup: value key -> refKeys, plus reverse. */
type MemoryLookupIndex = {
  readonly definition: RegisteredLookupIndex;
  readonly buckets: Map<string, Set<string>>;
  readonly keyByRef: Map<string, string>;
};

const CLOSED_MESSAGE = "InMemoryRecordStore: backend is closed";

export function createInMemoryRecordBackend(options: InMemoryRecordBackendOptions): InMemoryRecordBackend {
  if (typeof options !== "object" || options === null) {
    throw new Error("InMemoryRecordBackend: options must be an object");
  }
  const beforeWrite = options.beforeWrite;
  if (beforeWrite !== undefined && typeof beforeWrite !== "function") {
    throw new Error("InMemoryRecordBackend: beforeWrite must be a function");
  }
  // Registration is verified before any state exists, exactly like the SQLite
  // factory verifies it before opening the database.
  const registry: RecordSchemaRegistry = createRecordSchemaRegistry(options.schemas);
  const lookups: RecordLookupRegistry = createRecordLookupRegistry(options.schemas, registry);

  /** The single physical state. Never replaced, only mutated in place. */
  const state: InMemoryPhysicalState = {
    eventLog: [],
    snapshots: new Map<string, Record<string, unknown>>(),
    idempotency: new Map<string, PersistedIdempotencyRecord>(),
    claims: new Map<string, string>(),
    cursorSeq: 0,
  };

  let closed = false;
  const assertOpen = (): void => {
    if (closed) throw new Error(CLOSED_MESSAGE);
  };

  // -------------------------------------------------------------------------
  // The in-memory candidate index: one bucket map per registered lookup. It is
  // updated only for records written by a commit and only from their already
  // validated parsed bodies; replay/conflict/rollback never change it.
  // -------------------------------------------------------------------------

  const lookupIndexes: MemoryLookupIndex[] = lookups.indexes.map((definition) => ({
    definition,
    buckets: new Map<string, Set<string>>(),
    keyByRef: new Map<string, string>(),
  }));
  const lookupIndexByName = new Map<string, MemoryLookupIndex>(
    lookupIndexes.map((index) => [index.definition.name, index]),
  );

  /** Replace one ref's candidate entry (key === null removes it). */
  const setLookupEntry = (index: MemoryLookupIndex, refKey: string, key: string | null): void => {
    const previousKey = index.keyByRef.get(refKey);
    if (previousKey !== undefined) {
      const previousBucket = index.buckets.get(previousKey);
      if (previousBucket !== undefined) {
        previousBucket.delete(refKey);
        if (previousBucket.size === 0) index.buckets.delete(previousKey);
      }
      index.keyByRef.delete(refKey);
    }
    if (key === null) return;
    let bucket = index.buckets.get(key);
    if (bucket === undefined) {
      bucket = new Set<string>();
      index.buckets.set(key, bucket);
    }
    bucket.add(refKey);
    index.keyByRef.set(refKey, key);
  };

  // -------------------------------------------------------------------------
  // The ONE copy of the mechanical array-append helpers used by this port.
  // -------------------------------------------------------------------------

  const appendEvents = (events: readonly { eventId: string; json: string }[]): {
    eventIds: string[];
    commitCursor: CommitCursor;
  } => {
    const eventIds: string[] = [];
    let lastCursor: CommitCursor | null = null;
    for (const event of events) {
      state.cursorSeq += 1;
      const cursor = makeCommitCursor(state.cursorSeq);
      state.eventLog.push({ cursor, event: JSON.parse(event.json) as Record<string, unknown> });
      eventIds.push(event.eventId);
      lastCursor = cursor;
    }
    // Historical append contract: an empty event list produced a null cursor;
    // the store rejects empty event lists before reaching this point.
    return { eventIds, commitCursor: lastCursor as CommitCursor };
  };

  const upsertSnapshot = (refKey: string, json: string): void => {
    state.snapshots.set(refKey, JSON.parse(json) as Record<string, unknown>);
  };

  const persistIdempotency = (identityKey: string, value: PersistedIdempotencyRecord): void => {
    state.idempotency.set(identityKey, clonePersistedIdempotencyRecord(value));
  };

  /** Read-through cursor of the single event log; null = the ledger is empty. */
  const observedLedgerHorizon = (): CommitCursor | null => {
    const last = state.eventLog[state.eventLog.length - 1];
    return last === undefined ? null : last.cursor;
  };

  /** Owner observed in the current synchronous transaction; null = free slot. */
  const readClaimOwner = (claimKey: string): string | null => state.claims.get(claimKey) ?? null;

  // -------------------------------------------------------------------------
  // Reads
  // -------------------------------------------------------------------------

  /**
   * In-transaction current revision. The EXACT stored body for the guarded key
   * (never just its numeric `revision`) is decoded by the shared mechanical
   * guard helper, so a same-revision body that names another ref or an
   * unregistered schema is `corrupt` instead of being waved through as an
   * unchanged version. `null` means the Map genuinely has no entry for the key.
   */
  const currentRevisionOf = (refKey: string): DecodeResult<number | null> => {
    const snapshot = state.snapshots.get(refKey);
    if (snapshot === undefined) return decodeGuardedRevision(registry, refKey, null);
    let json: string;
    try {
      json = JSON.stringify(snapshot);
    } catch (error) {
      return { status: "invalid", reason: `snapshot ${refKey} is not JSON serializable: ${messageOf(error)}` };
    }
    const decoded = decodeGuardedRevision(registry, refKey, json);
    // Same diagnostic wording as the read path: the helper's mechanical reason
    // is preserved, never replaced by a fabricated revision.
    if (decoded.status === "invalid") {
      return { status: "invalid", reason: `snapshot ${refKey} is damaged: ${decoded.reason}` };
    }
    return decoded;
  };

  const guardConflicts = (guards: readonly RecordGuard[]): DecodeResult<{ refKey: string; revision: number | null }[]> => {
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

  const readManyKeys = (refKeys: readonly string[]): StoreResult<RecordBatchRead> => {
    const records: EncodedRecord[] = [];
    const missing: string[] = [];
    for (const refKey of refKeys) {
      const decodedKey = decodeRefKey(refKey);
      if (decodedKey.status === "invalid") return invalidFailure(decodedKey.reason);
      const schema = registry.recordByAggregateType(decodedKey.value.aggregateType);
      if (schema === undefined) {
        return unsupportedFailure(`no record schema registered for aggregateType ${decodedKey.value.aggregateType}`);
      }
      const snapshot = state.snapshots.get(refKey);
      if (snapshot === undefined) {
        missing.push(refKey);
        continue;
      }
      let json: string;
      try {
        json = JSON.stringify(snapshot);
      } catch (error) {
        return corruptFailure(`snapshot ${refKey} is not JSON serializable: ${messageOf(error)}`);
      }
      const decoded = decodeRecordBody({ refKey, schemaId: schema.schemaId, revision: null, json });
      if (decoded.status === "invalid") return corruptFailure(`snapshot ${refKey} is damaged: ${decoded.reason}`);
      const applied = applyRecordSchema(decoded.value, schema);
      if (applied.status === "invalid") {
        return corruptFailure(`snapshot ${refKey} is damaged: ${applied.reason}`);
      }
      records.push(applied.value.record);
    }
    const last = state.eventLog[state.eventLog.length - 1];
    return {
      status: "ready",
      value: { records, missing, readThrough: last === undefined ? null : last.cursor },
    };
  };

  // -------------------------------------------------------------------------
  // Commit
  // -------------------------------------------------------------------------

  /** Fully synchronous: lookup → CAS → write, with no `await` in between. */
  const commitPrepared = (planned: PlannedCommit): StoreCommitReceipt => {
    // 1. Identity lookup first: replay wins over the current versions.
    const existing = state.idempotency.get(planned.identityKey);
    if (existing !== undefined) {
      const checked = checkPersistedIdempotencyRecord(existing);
      if (checked.status === "invalid") {
        return corruptFailure(`idempotency entry for ${planned.identityKey} is damaged: ${checked.reason}`);
      }
      if (String(checked.value.fingerprint) !== planned.fingerprint) {
        return idempotencyConflictFailure(`identity ${planned.identityKey} was committed with a different fingerprint`);
      }
      return committedReceiptFromIdempotency(planned.identityKey, checked.value);
    }

    // 2. All record guards.
    const conflicts = guardConflicts(planned.guards);
    if (conflicts.status === "invalid") return corruptFailure(conflicts.reason);
    if (conflicts.value.length > 0) {
      return revisionConflictFailure("record version changed", conflicts.value);
    }

    // 3. Exact unique claim slots observed in this transaction.
    const claimConflicts = findClaimConflicts(planned.claims, readClaimOwner);
    if (claimConflicts.length > 0) {
      return uniqueConflictFailure("unique claim owner changed", claimConflicts);
    }

    // 4. Ledger horizon CAS, only when the caller supplied the field (null means
    //    the ledger must still be empty; a cursor is an exact tail CAS).
    if (planned.ledgerHorizon !== undefined) {
      const observed = observedLedgerHorizon();
      if (!ledgerHorizonMatches(planned.ledgerHorizon, observed)) {
        return revisionConflictFailure(
          `ledger horizon changed: expected ${String(planned.ledgerHorizon)} but observed ${String(observed)}`,
          [],
        );
      }
    }

    // 5. The single fault-injection point: after every check, before the first write.
    beforeWrite?.();

    // 6. Publish atomically, undoing in place on failure.
    const previousEventLogLength = state.eventLog.length;
    const previousCursorSeq = state.cursorSeq;
    const previousSnapshots = new Map<string, { present: boolean; value: Record<string, unknown> | undefined }>();
    const previousLookupEntries: { index: MemoryLookupIndex; refKey: string; key: string | undefined }[] = [];
    const previousClaims = new Map<string, string | undefined>();
    const hadIdempotency = state.idempotency.has(planned.identityKey);
    const previousIdempotency = state.idempotency.get(planned.identityKey);
    try {
      const written = appendEvents(
        planned.events.map((decoded) => ({ eventId: decoded.event.eventId, json: decoded.event.json })),
      );
      // Bind the REAL last-event cursor and run the final registered schema
      // validation before any snapshot is written; a rejection here rolls the
      // already-appended events back.
      const boundRecords = bindPreparedRecords(
        planned.records,
        planned.commitCursorBindings,
        written.commitCursor,
        registry,
      );
      if (boundRecords.status === "invalid") {
        throw new RejectedInsideTransaction(invalidFailure(boundRecords.reason));
      }
      const versions: StoredVersion[] = [];
      const aggregateRevisions: VersionedRef[] = [];
      for (const record of boundRecords.value) {
        const refKey = record.record.refKey;
        if (!previousSnapshots.has(refKey)) {
          previousSnapshots.set(refKey, { present: state.snapshots.has(refKey), value: state.snapshots.get(refKey) });
        }
        // Persist the decoded JSON value, not the raw artifact: duplicate keys
        // are already resolved last-wins and numbers use the JS representation,
        // so the candidate index and every later read see the same value.
        upsertSnapshot(refKey, JSON.stringify(record.parsed));
        for (const index of lookupIndexes) {
          if (index.definition.aggregateType !== record.aggregateType) continue;
          previousLookupEntries.push({ index, refKey, key: index.keyByRef.get(refKey) });
          setLookupEntry(index, refKey, lookupIndexKeyOf(index.definition, record.parsed));
        }
        versions.push({ refKey, revision: record.record.revision });
        aggregateRevisions.push({ ref: record.ref, revision: record.record.revision });
      }
      for (const claim of planned.claims) {
        if (!previousClaims.has(claim.claimKey)) previousClaims.set(claim.claimKey, state.claims.get(claim.claimKey));
        if (claim.nextOwner === null) state.claims.delete(claim.claimKey);
        else state.claims.set(claim.claimKey, claim.nextOwner);
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
    } catch (error) {
      // In-place undo of exactly what this commit touched. The Maps/array are
      // mutated, never replaced, so object identity stays stable.
      state.eventLog.length = previousEventLogLength;
      state.cursorSeq = previousCursorSeq;
      for (const [refKey, before] of previousSnapshots) {
        if (before.present && before.value !== undefined) state.snapshots.set(refKey, before.value);
        else state.snapshots.delete(refKey);
      }
      for (const [claimKey, before] of previousClaims) {
        if (before === undefined) state.claims.delete(claimKey);
        else state.claims.set(claimKey, before);
      }
      if (hadIdempotency && previousIdempotency !== undefined) state.idempotency.set(planned.identityKey, previousIdempotency);
      else state.idempotency.delete(planned.identityKey);
      for (let entry = previousLookupEntries.length - 1; entry >= 0; entry -= 1) {
        const undo = previousLookupEntries[entry]!;
        setLookupEntry(undo.index, undo.refKey, undo.key ?? null);
      }
      throw error;
    }
  };

  const commit = async (input: PreparedCommit): Promise<StoreCommitReceipt> => {
    assertOpen();
    // Clone the complete input BEFORE the first await (there is none below, so
    // the whole commit is one synchronous atomic section).
    const prepared = structuredClone(input);
    const planned = planPreparedCommit(prepared, registry);
    if (planned.status === "invalid") return invalidFailure(planned.reason);
    try {
      return structuredClone(commitPrepared(planned.value));
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
    const existing = state.idempotency.get(identityKey);
    if (existing === undefined) return notFoundFailure(`identity ${identityKey} has not been committed`);
    const checked = checkPersistedIdempotencyRecord(existing);
    if (checked.status === "invalid") {
      return corruptFailure(`idempotency entry for ${identityKey} is damaged: ${checked.reason}`);
    }
    if (String(checked.value.fingerprint) !== fingerprint) {
      return idempotencyConflictFailure(`identity ${identityKey} was committed with a different fingerprint`);
    }
    return { status: "ready", value: structuredClone(committedReceiptFromIdempotency(identityKey, checked.value)) };
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
    const direct = state.eventLog[seq - 1];
    const positioned =
      direct !== undefined && direct.cursor === cursor ? direct : state.eventLog.find((entry) => entry.cursor === cursor);
    if (positioned === undefined) return notFoundFailure(`no event at cursor ${String(cursor)}`);
    let json: string;
    try {
      json = JSON.stringify(positioned.event);
    } catch (error) {
      return corruptFailure(`event ${String(cursor)} is not JSON serializable: ${messageOf(error)}`);
    }
    const decoded = decodeStoredEventBody(json);
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

  /** Registered candidate lookup; the caller must re-read canonical rows. */
  const lookup = async (request: RecordLookupRequest): Promise<StoreResult<RecordLookupPage>> => {
    assertOpen();
    const decoded = decodeLookupRequest(lookups, request);
    if (decoded.status === "unsupported") return unsupportedFailure(decoded.reason);
    if (decoded.status === "invalid") return invalidFailure(decoded.reason);
    const index = lookupIndexByName.get(decoded.value.index.name);
    if (index === undefined) return unsupportedFailure(`no lookup index registered as ${decoded.value.index.name}`);
    const refs = index.buckets.get(encodeLookupValues(decoded.value.values));
    const after = decoded.value.after;
    const candidates: string[] = [];
    if (refs !== undefined) {
      for (const refKey of refs) {
        if (after === null || compareRefKeys(refKey, after) > 0) candidates.push(refKey);
      }
      candidates.sort(compareRefKeys);
    }
    const pageRefs = candidates.slice(0, decoded.value.limit);
    const read = readManyKeys(pageRefs);
    if (read.status !== "ready") return corruptFailure(read.reason);
    if (read.value.missing.length > 0) {
      return corruptFailure(`lookup candidate ${read.value.missing[0]} has no snapshot`);
    }
    return {
      status: "ready",
      value: {
        records: read.value.records,
        next: candidates.length > decoded.value.limit ? pageRefs[pageRefs.length - 1]! : null,
        readThrough: read.value.readThrough,
      },
    };
  };

  const records: GoalRecordTransactionPort & RecordLookupPort = {
    readMany: async (refKeys: readonly string[]): Promise<StoreResult<RecordBatchRead>> => {
      assertOpen();
      if (!Array.isArray(refKeys) || !refKeys.every((key) => isNonEmptyString(key))) {
        return invalidFailure("readMany refKeys must be an array of non-empty strings");
      }
      // Copy before the first await so a caller mutating the array cannot change
      // the read set.
      return readManyKeys([...refKeys]);
    },
    lookupCommit,
    commit,
    eventAt,
    lookup,
  };

  const close = async (): Promise<void> => {
    if (closed) return;
    closed = true;
  };

  return { records, close };
}
