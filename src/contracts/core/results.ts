/**
 * Core result contracts (skeleton/CONTRACTS.md §4).
 *
 * Write results keep the original fine-grained failure code and reason; a
 * rejected write never fabricates a value, and a committed write always
 * carries the real commit cursor and whether it replayed an earlier result.
 */
import type { CommitCursor } from "../command-event.js";
import type { VersionPin } from "./identity.js";
/**
 * Closed failure vocabulary of the core ports. `corrupt` deliberately does
 * not appear: the domain ports map undecodable/storage-level damage to
 * `unavailable` with a preserved reason, and the RecordStore keeps its own
 * wider `StoreError` union (core/record-store/ports.ts).
 */
export type CoreError = "invalid" | "forbidden" | "revision_conflict" | "idempotency_conflict" | "not_found" | "dependency_blocked" | "cycle" | "busy" | "source_stale" | "incomplete" | "capacity" | "unsupported" | "unavailable" | "cancelled";
/** Keyed by `CoreError`, so a code added there must be added here (the list is the keys, in this order). */
const CORE_ERROR_KEYS: Readonly<Record<CoreError, true>> = {
    invalid: true, forbidden: true, revision_conflict: true, idempotency_conflict: true, not_found: true,
    dependency_blocked: true, cycle: true, busy: true, source_stale: true, incomplete: true, capacity: true,
    unsupported: true, unavailable: true, cancelled: true,
};
/** The one runtime list of the core failure codes, in the order of `CoreError`. */
export const CORE_ERRORS = Object.keys(CORE_ERROR_KEYS) as [CoreError, ...CoreError[]];
export type CoreRejection = {
    status: "rejected";
    code: CoreError;
    reason: string;
    current?: VersionPin[];
};
/** R3b exact material read subset. Projection `not_ready` is published with its
 * real ReadStamp only when an indexed read actually consumes that state. */
export type ReadResult<T> = {
    status: "ready";
    value: T;
} | {
    status: "not_found";
} | { status: 'not_ready'; observed: ReadStamp | null; required: ReadStamp } | CoreRejection;
/** A committed write always carries its real commit cursor; a branch that writes nothing must not report committed. */
export type WriteResult<T> = {
    status: "committed";
    value: T;
    replayed: boolean;
    cursor: CommitCursor;
} | CoreRejection;

export type ReadStamp =
  | { kind: 'platform'; cursor: CommitCursor }
  | { kind: 'plan'; ref: import('../plan.js').PlanRevisionRef }
  | { kind: 'source'; capture: import('./source.js').SourceCaptureRef }
  | { kind: 'session'; ref: import('./identity.js').SessionRef; cursor: string };
export type Page<T> = { items: T[]; nextCursor: string | null; basis: ReadStamp };
export type OperationReceipt<T> =
  | { status: 'accepted'; operationRef: import('./operations.js').OperationRef; replayed: boolean; cursor: CommitCursor }
  | { status: 'completed'; operationRef: import('./operations.js').OperationRef; value: T; replayed: boolean; cursor: CommitCursor }
  | CoreRejection;
