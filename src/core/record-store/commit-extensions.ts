/**
 * Shared mechanical extension points for the two RecordStore backends.
 *
 * The backend owns the transaction and calls these functions only inside that
 * transaction. They deliberately have no I/O and no domain callbacks: they only
 * validate mechanical shapes, compare owners/horizons observed in the current
 * transaction and rewrite registered top-level cursor fields.
 *
 * No backend may guess the next cursor: {@link bindCommitCursor} receives the
 * real last-event cursor the caller obtained inside its write transaction, and
 * the caller runs the final registered record schema validation afterwards. On
 * any failure after the first write the backend rolls its transaction back.
 */
import type { CommitCursor } from "../../contracts/command-event.js";
import type { CommitCursorBinding, DecodeResult, EncodedRecord, StoreFailure, UniqueClaimChange } from "./ports.js";

export type ClaimConflict = { claimKey: string; owner: string | null };

/** The only top-level fields a commit cursor may ever be bound to. */
export const COMMIT_CURSOR_FIELDS: readonly ("since" | "until")[] = Object.freeze(["since", "until"]);

/**
 * Thrown by a backend INSIDE its write transaction when a mechanically valid
 * input fails after the first write (e.g. the final registered schema rejects
 * the bound cursor). The backend rolls its transaction back and returns the
 * carried failure instead of committing a partial write.
 */
export class RejectedInsideTransaction extends Error {
  readonly failure: StoreFailure;

  constructor(failure: StoreFailure) {
    super(failure.reason);
    this.name = "RejectedInsideTransaction";
    this.failure = failure;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyText(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function parseRecordObject(json: unknown): DecodeResult<Record<string, unknown>> {
  if (typeof json !== "string") return { status: "invalid", reason: "record json must be a string" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (error) {
    return { status: "invalid", reason: `record json is not parseable: ${messageOf(error)}` };
  }
  if (!isObject(parsed)) return { status: "invalid", reason: "record json body is not a JSON object" };
  return { status: "decoded", value: parsed };
}

/** Validate distinct exact claim slots and owner strings before any writes. */
export function validateUniqueClaims(claims: readonly UniqueClaimChange[]): DecodeResult<readonly UniqueClaimChange[]> {
  if (!Array.isArray(claims)) return { status: "invalid", reason: "PreparedCommit.claims must be an array" };
  const seen = new Set<string>();
  const validated: UniqueClaimChange[] = [];
  for (const raw of claims) {
    if (!isObject(raw)) return { status: "invalid", reason: "every UniqueClaimChange must be an object" };
    const claimKey = raw["claimKey"];
    if (!isNonEmptyText(claimKey)) {
      return { status: "invalid", reason: "UniqueClaimChange.claimKey must be a non-empty string" };
    }
    const expectedOwner = raw["expectedOwner"];
    if (expectedOwner !== null && !isNonEmptyText(expectedOwner)) {
      return {
        status: "invalid",
        reason: `UniqueClaimChange ${claimKey} expectedOwner must be null or a non-empty string`,
      };
    }
    const nextOwner = raw["nextOwner"];
    if (nextOwner !== null && !isNonEmptyText(nextOwner)) {
      return { status: "invalid", reason: `UniqueClaimChange ${claimKey} nextOwner must be null or a non-empty string` };
    }
    if (seen.has(claimKey)) return { status: "invalid", reason: `duplicate unique claim ${claimKey}` };
    seen.add(claimKey);
    validated.push({
      claimKey,
      expectedOwner: expectedOwner as string | null,
      nextOwner: nextOwner as string | null,
    });
  }
  return { status: "decoded", value: validated };
}

/** Compare owners observed in the current write transaction. */
export function findClaimConflicts(
  claims: readonly UniqueClaimChange[],
  readOwner: (claimKey: string) => string | null,
): ClaimConflict[] {
  const conflicts: ClaimConflict[] = [];
  for (const claim of claims) {
    const owner = readOwner(claim.claimKey);
    if (owner !== claim.expectedOwner) conflicts.push({ claimKey: claim.claimKey, owner });
  }
  return conflicts;
}

/** A null horizon means the ledger must still have no committed event. */
export function ledgerHorizonMatches(expected: CommitCursor | null, observed: CommitCursor | null): boolean {
  return expected === observed;
}

/**
 * Bind only registered top-level null fields in guarded written records to the
 * final event cursor. This validates the binding mechanically (shape, duplicate
 * target, registered whitelist, null placeholder) and returns fresh records.
 * The caller then runs the final registered record schema validation and must
 * roll the transaction back on any `invalid` result.
 */
export function bindCommitCursor(
  records: readonly EncodedRecord[],
  bindings: readonly CommitCursorBinding[],
  cursor: CommitCursor,
  allowedFields: (schemaId: string) => readonly ("since" | "until")[],
): DecodeResult<readonly EncodedRecord[]> {
  if (!Array.isArray(records)) return { status: "invalid", reason: "records must be an array" };
  if (!Array.isArray(bindings)) return { status: "invalid", reason: "commitCursorBindings must be an array" };
  if (bindings.length === 0) return { status: "decoded", value: [...records] };

  const recordByKey = new Map<string, EncodedRecord>();
  for (const entry of records) {
    const value: unknown = entry;
    if (!isObject(value)) return { status: "invalid", reason: "every EncodedRecord must be an object" };
    const refKey = value["refKey"];
    if (!isNonEmptyText(refKey)) {
      return { status: "invalid", reason: "EncodedRecord.refKey must be a non-empty string" };
    }
    if (recordByKey.has(refKey)) return { status: "invalid", reason: `duplicate record for ${refKey}` };
    recordByKey.set(refKey, entry);
  }

  const seen = new Set<string>();
  const fieldsByRefKey = new Map<string, ("since" | "until")[]>();
  for (const raw of bindings) {
    if (!isObject(raw)) return { status: "invalid", reason: "every CommitCursorBinding must be an object" };
    const refKey = raw["refKey"];
    const field = raw["field"];
    if (!isNonEmptyText(refKey)) {
      return { status: "invalid", reason: "CommitCursorBinding.refKey must be a non-empty string" };
    }
    if (field !== "since" && field !== "until") {
      return { status: "invalid", reason: "CommitCursorBinding.field must be 'since' or 'until'" };
    }
    const bindingKey = `${refKey}\u0000${field}`;
    if (seen.has(bindingKey)) {
      return { status: "invalid", reason: `duplicate commit cursor binding for ${refKey}.${field}` };
    }
    seen.add(bindingKey);
    const record = recordByKey.get(refKey);
    if (record === undefined) {
      return { status: "invalid", reason: `commit cursor binding target ${refKey} is not written by this commit` };
    }
    const allowed = allowedFields(record.schemaId);
    if (!Array.isArray(allowed) || !allowed.includes(field)) {
      return { status: "invalid", reason: `record schema ${record.schemaId} does not allow commit cursor field ${field}` };
    }
    const parsed = parseRecordObject(record.json);
    if (parsed.status === "invalid") return parsed;
    if (parsed.value[field] !== null) {
      return { status: "invalid", reason: `record ${refKey} commit cursor field ${field} is not a null placeholder` };
    }
    const fields = fieldsByRefKey.get(refKey) ?? [];
    fields.push(field);
    fieldsByRefKey.set(refKey, fields);
  }

  const bound: EncodedRecord[] = [];
  for (const record of records) {
    const fields = fieldsByRefKey.get(record.refKey);
    if (fields === undefined) {
      bound.push(record);
      continue;
    }
    const parsed = parseRecordObject(record.json);
    if (parsed.status === "invalid") return parsed;
    for (const field of fields) parsed.value[field] = cursor;
    bound.push({ ...record, json: JSON.stringify(parsed.value) });
  }
  return { status: "decoded", value: bound };
}
