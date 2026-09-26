/**
 * RecordStore in-memory physical backend (R3a §3.1/§7).
 *
 * This factory is the ONLY creator of the shared in-memory physical state:
 * exactly one `eventLog`, one `snapshots` Map, one `idempotency` Map, one
 * `identityClaims` Map and one `cursorSeq`. The legacy InMemoryLedger adapters
 * are handed those same object references through `legacyAccess`, so there is no
 * second event log / snapshot map / counter anywhere.
 *
 * Guarantees implemented here:
 *  - object identity is stable: publish and rollback mutate the Maps/array in
 *    place and never replace them;
 *  - the complete commit input is cloned before the first `await`, and reads and
 *    receipts are copies;
 *  - lookup → CAS → write happen in one synchronous atomic section (no `await`
 *    in the middle); all validation/encoding is done first, then the events and
 *    receipt are prepared, then published;
 *  - a write-phase failure undoes only the keys this commit touched (original
 *    Map values, previous eventLog length, previous cursor) - never a copy of the
 *    whole history;
 *  - `beforeWrite` runs exactly once, after every check and before the first
 *    write; replay/conflict never call it;
 *  - unmigrated legacy commit kinds keep their current synchronous execution.
 *
 * This file imports no WorkGraph module, never calls `StateLedger.commit`, runs
 * no Goal validator and performs no fingerprint computation.
 */
import type { CommitCursor, CommandFingerprint } from "../../contracts/command-event.js";
import type { DomainEvent } from "../../contracts/events.js";
import { makeCommitCursor, seqOfCommitCursor } from "../../contracts/ledger.js";
import type { AggregateSnapshot, VersionedRef } from "../../contracts/ledger.js";
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
  planPreparedCommit,
  revisionConflictFailure,
  unsupportedFailure,
  type PlannedCommit,
  type RecordSchemaRegistry,
} from "./record-codec.js";
import type {
  DecodeResult,
  EncodedDomainEvent,
  EncodedRecord,
  GoalRecordTransactionPort,
  InMemoryLegacyRecordState,
  LegacyIdempotencyRecord,
  LegacyRecordMechanics,
  PreparedCommit,
  RecordBackendSchemas,
  RecordBatchRead,
  RecordGuard,
  StoreCommitReceipt,
  StoreResult,
  StoredVersion,
} from "./ports.js";

export type InMemoryRecordBackendOptions = {
  schemas: RecordBackendSchemas;
  beforeWrite?: () => void;
};

/**
 * Transitional access to the ONE shared in-memory state, used only by the legacy
 * InMemoryLedger adapter(s). Not a business/model port.
 */
export type InMemoryLegacyRecordAccess = {
  readonly state: InMemoryLegacyRecordState;
  readonly beforeWrite: (() => void) | undefined;
  readonly mechanics: LegacyRecordMechanics;
};

export type InMemoryRecordBackend = {
  readonly records: GoalRecordTransactionPort;
  close(): Promise<void>;
  readonly legacyAccess: InMemoryLegacyRecordAccess;
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

  /** The single physical state. Never replaced, only mutated in place. */
  const state: InMemoryLegacyRecordState = {
    eventLog: [],
    snapshots: new Map<string, AggregateSnapshot>(),
    idempotency: new Map<string, LegacyIdempotencyRecord>(),
    identityClaims: new Map<string, string>(),
    cursorSeq: 0,
  };

  let closed = false;
  const assertOpen = (): void => {
    if (closed) throw new Error(CLOSED_MESSAGE);
  };

  // -------------------------------------------------------------------------
  // The ONE copy of the mechanical array-append helpers, shared by this port
  // and by the legacy adapters through `legacyAccess.mechanics`.
  // -------------------------------------------------------------------------

  const idempotencyRecord = (identityKey: string): LegacyIdempotencyRecord | undefined => {
    const found = state.idempotency.get(identityKey);
    if (found === undefined) return undefined;
    const checked = checkLegacyIdempotencyRecord(found);
    if (checked.status === "invalid") {
      // The legacy adapters have no failure channel here; silently reporting
      // "unused" would let a duplicate commit through.
      throw new Error(`InMemoryRecordStore: idempotency entry for ${identityKey} is damaged: ${checked.reason}`);
    }
    return cloneLegacyIdempotencyRecord(checked.value);
  };

  const appendEvents = (events: readonly { eventId: string; json: string }[]): {
    eventIds: string[];
    commitCursor: CommitCursor;
  } => {
    const eventIds: string[] = [];
    let lastCursor: CommitCursor | null = null;
    for (const event of events) {
      state.cursorSeq += 1;
      const cursor = makeCommitCursor(state.cursorSeq);
      state.eventLog.push({ cursor, event: JSON.parse(event.json) as DomainEvent });
      eventIds.push(event.eventId);
      lastCursor = cursor;
    }
    // Faithful to the legacy adapter: an empty append produced a null cursor.
    // The new store rejects empty event lists before reaching this point.
    return { eventIds, commitCursor: lastCursor as CommitCursor };
  };

  const upsertSnapshot = (refKey: string, json: string): void => {
    state.snapshots.set(refKey, JSON.parse(json) as AggregateSnapshot);
  };

  const persistIdempotency = (identityKey: string, value: LegacyIdempotencyRecord): void => {
    state.idempotency.set(identityKey, cloneLegacyIdempotencyRecord(value));
  };

  const nextEventSeq = (): number => state.cursorSeq + 1;

  const mechanics: LegacyRecordMechanics = {
    assertOpen,
    idempotencyRecord,
    appendEvents,
    upsertSnapshot,
    persistIdempotency,
    nextEventSeq,
  };

  // -------------------------------------------------------------------------
  // Reads
  // -------------------------------------------------------------------------

  /** In-transaction current revision; a damaged stored value is `corrupt`. */
  const currentRevisionOf = (refKey: string): DecodeResult<number | null> => {
    const snapshot = state.snapshots.get(refKey);
    if (snapshot === undefined) return { status: "decoded", value: null };
    const revision = snapshot.revision;
    if (!isRevision(revision)) {
      return { status: "invalid", reason: `snapshot ${refKey} has no usable revision` };
    }
    return { status: "decoded", value: revision };
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
      const checked = checkLegacyIdempotencyRecord(existing);
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

    // 3. The single fault-injection point: after every check, before the first write.
    beforeWrite?.();

    // 4. Publish atomically, undoing in place on failure.
    const previousEventLogLength = state.eventLog.length;
    const previousCursorSeq = state.cursorSeq;
    const previousSnapshots = new Map<string, { present: boolean; value: AggregateSnapshot | undefined }>();
    const hadIdempotency = state.idempotency.has(planned.identityKey);
    const previousIdempotency = state.idempotency.get(planned.identityKey);
    try {
      const written = appendEvents(
        planned.events.map((decoded) => ({ eventId: decoded.event.eventId, json: decoded.event.json })),
      );
      const versions: StoredVersion[] = [];
      const aggregateRevisions: VersionedRef[] = [];
      for (const record of planned.records) {
        const refKey = record.record.refKey;
        if (!previousSnapshots.has(refKey)) {
          previousSnapshots.set(refKey, { present: state.snapshots.has(refKey), value: state.snapshots.get(refKey) });
        }
        upsertSnapshot(refKey, record.record.json);
        versions.push({ refKey, revision: record.record.revision });
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
    } catch (error) {
      // In-place undo of exactly what this commit touched: the legacy adapters
      // hold references to these very objects, so they must never be replaced.
      state.eventLog.length = previousEventLogLength;
      state.cursorSeq = previousCursorSeq;
      for (const [refKey, before] of previousSnapshots) {
        if (before.present && before.value !== undefined) state.snapshots.set(refKey, before.value);
        else state.snapshots.delete(refKey);
      }
      if (hadIdempotency && previousIdempotency !== undefined) state.idempotency.set(planned.identityKey, previousIdempotency);
      else state.idempotency.delete(planned.identityKey);
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
    return structuredClone(commitPrepared(planned.value));
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
    const checked = checkLegacyIdempotencyRecord(existing);
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

  const records: GoalRecordTransactionPort = {
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
  };

  const legacyAccess: InMemoryLegacyRecordAccess = {
    state,
    beforeWrite,
    mechanics,
  };

  const close = async (): Promise<void> => {
    if (closed) return;
    closed = true;
  };

  return { records, close, legacyAccess };
}
