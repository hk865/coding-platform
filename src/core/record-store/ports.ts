/**
 * RecordStore physical protocol — the minimal slice R3a actually implements.
 *
 * This is a trusted component-to-component physical protocol, NOT a model-facing
 * command DSL. The WorkGraph compiles domain writes into `PreparedCommit`; the
 * store only checks schemas, versions and JSON consistency and performs one
 * atomic transaction. The store never decides domain policy and never imports
 * WorkGraph.
 *
 * Deliberately NOT published in this batch (later batches extend this file):
 *   - `read`, `events`, `readIndex`, bodies, runtime records, index tables;
 *   - `not_ready` / `index_conflict` failures and the whole
 *     `DurableIndexName` union — nothing in this slice produces them;
 *   - `indexCommitOrderBindings`.
 * Publishing any of those now would let a consumer depend on an unimplemented
 * capability, so `PreparedCommit` types the not-yet-used collections as the
 * empty tuple `readonly []`: the type system AND the runtime both reject
 * non-empty input instead of accepting it and silently ignoring it.
 */
import type { CommitCursor, CommandFingerprint } from "../../contracts/command-event.js";
import type { VersionedRef } from "../../contracts/ledger.js";
import type { RecordLookupIndex } from './lookup-ports.js';

// --------------------------------------------------------------------------
// Failures and results
// --------------------------------------------------------------------------

export type StoreError =
  | "invalid"
  | "not_found"
  | "revision_conflict"
  | "unique_conflict"
  | "idempotency_conflict"
  | "corrupt"
  | "unsupported"
  | "unavailable";

export type StoreFailure =
  | {
      status: "rejected";
      code: Exclude<StoreError, "revision_conflict" | "unique_conflict">;
      reason: string;
    }
  | {
      /**
       * Reports the version observed INSIDE the failed transaction. `null` means
       * the row genuinely did not exist; it is not a stand-in for "unknown".
       * Consumers must not re-read the latest version and report that instead.
       */
      status: "rejected";
      code: "revision_conflict";
      reason: string;
      current: { refKey: string; revision: number | null }[];
    }
  | {
      status: "rejected";
      code: "unique_conflict";
      reason: string;
      current: { claimKey: string; owner: string | null }[];
    };

export type StoreResult<T> = { status: "ready"; value: T } | StoreFailure;

export type DecodeResult<T> =
  | { status: "decoded"; value: T }
  | { status: "invalid"; reason: string };

// --------------------------------------------------------------------------
// Mechanical DTOs
// --------------------------------------------------------------------------

export type EncodedRecord = {
  /** Canonical key of the FULL aggregate ref (never a bare local id). */
  refKey: string;
  /** Encoding version selector, e.g. `GoalSnapshot@1`. Not an aggregate revision. */
  schemaId: string;
  revision: number;
  /** Decoded JSON value semantics; storage may re-encode text, not change its value. */
  json: string;
};

export type RecordGuard = { refKey: string; expectedRevision: number | null };

/** Exact compare-and-swap on a unique physical slot. */
export type UniqueClaimChange = {
  claimKey: string;
  expectedOwner: string | null;
  nextOwner: string | null;
};

export type CommitCursorBinding = { refKey: string; field: "since" | "until" };

export type StoredVersion = { refKey: string; revision: number };

export type EncodedDomainEvent = {
  eventId: string;
  eventType: string;
  schemaVersion: number;
  occurredAt: string;
  json: string;
};

export type PreparedCommit = {
  identityKey: string;
  fingerprint: string;
  guards: readonly RecordGuard[];
  records: readonly EncodedRecord[];
  claims: readonly UniqueClaimChange[];
  /** Not implemented in this batch: only the empty tuple is accepted. */
  indexGuards: readonly [];
  /** Not implemented in this batch: only the empty tuple is accepted. */
  indexChanges: readonly [];
  events: readonly EncodedDomainEvent[];
  /** CAS on the read-through cursor, including null for an empty ledger. */
  ledgerHorizon?: CommitCursor | null;
  /** Fill registered, top-level null cursor fields from this commit's last event. */
  commitCursorBindings?: readonly CommitCursorBinding[];
};

export type StoreCommitReceipt =
  | {
      status: "committed";
      replayed: boolean;
      identityKey: string;
      versions: StoredVersion[];
      eventIds: string[];
      cursor: CommitCursor;
    }
  | StoreFailure;

export type RecordBatchRead = {
  records: EncodedRecord[];
  missing: string[];
  readThrough: CommitCursor | null;
};

// --------------------------------------------------------------------------
// Schema registration
// --------------------------------------------------------------------------

/**
 * Registers one record shape. `aggregateType` is required because the legacy
 * `snapshot_json` table has no schemaId column: the store selects a codec from
 * the aggregateType of the full ref, and must not hard-code Goal or blindly try
 * every registered schema.
 */
export type EncodedRecordSchema = {
  readonly schemaId: string;
  readonly aggregateType: string;
  /** Explicit top-level fields eligible for commit cursor binding. */
  readonly commitCursorFields?: readonly ("since" | "until")[];
  validate(record: EncodedRecord): DecodeResult<EncodedRecord>;
};

export type EncodedEventSchema = {
  readonly eventType: string;
  readonly schemaVersion: number;
  validate(event: EncodedDomainEvent): DecodeResult<EncodedDomainEvent>;
};

export type RecordBackendSchemas = {
  readonly records: readonly EncodedRecordSchema[];
  readonly events: readonly EncodedEventSchema[];
  /** N0/R3c exact candidate lookup; does not implement range claims/indexChanges. */
  readonly lookups?: readonly RecordLookupIndex[];
};

// --------------------------------------------------------------------------
// The port this batch implements
// --------------------------------------------------------------------------

/**
 * Only `readMany` / `lookupCommit` / `commit` are needed by the Goal creation
 * chain, plus `eventAt` to restore the ORIGINAL created result on replay.
 *
 * `eventAt` is deliberately not a bonus: the legacy `events(afterCursor)` page
 * query cannot do an efficient random read, so replaying a commit must not scan
 * every event from the beginning and must not re-derive the cursor by
 * decrementing it inside the WorkGraph.
 */
export interface GoalRecordTransactionPort {
  readMany(refKeys: readonly string[]): Promise<StoreResult<RecordBatchRead>>;
  lookupCommit(input: {
    identityKey: string;
    fingerprint: string;
  }): Promise<StoreResult<Extract<StoreCommitReceipt, { status: "committed" }>>>;
  commit(input: PreparedCommit): Promise<StoreCommitReceipt>;
  eventAt(
    cursor: CommitCursor,
  ): Promise<StoreResult<{ cursor: CommitCursor; event: EncodedDomainEvent }>>;
}

// --------------------------------------------------------------------------
// Persisted idempotency encoding (compatible with the reference database)
// --------------------------------------------------------------------------

/**
 * The legacy idempotency row, byte-compatible with the existing
 * `fingerprint / event_ids_json / aggregate_revisions_json / commit_cursor`
 * storage. Owned only by the target backend; no old adapter receives access.
 */
export type PersistedIdempotencyRecord = {
  fingerprint: CommandFingerprint;
  eventIds: string[];
  aggregateRevisions: VersionedRef[];
  commitCursor: CommitCursor;
};
