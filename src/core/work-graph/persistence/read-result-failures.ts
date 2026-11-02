/**
 * Shared RecordStore read-failure mapping.
 *
 * `views/goal-conflicts.ts` and `tasks/goal-executed-files-reader.ts` both need
 * to turn a failed Store read into the domain rejection and to compare an
 * observed commit watermark with the caller's `atLeastCursor`. The
 * `tasks -> views` submodule edge is forbidden, so the two pure helpers live
 * here (`persistence`, which both `views` and `tasks` may import) and the views
 * module re-exports them for the existing readers.
 */
import type { CommitCursor } from '../../../contracts/command-event.js';
import type { VersionPin } from '../../../contracts/core/identity.js';
import { rejected, rejectedWithCurrent, rejectedWithNonEmptyCurrent } from '../../../contracts/core/rejections.js';
import { CORE_ERRORS, type CoreRejection, type ReadResult } from '../../../contracts/core/results.js';
import { messageOf } from '../../../contracts/error-message.js';
import { canonicalKey } from '../../../contracts/fingerprint.js';
import { scopeOwnedDetailOfSlot } from '../../../contracts/role-lines.js';
import { isRecord } from '../../../contracts/validation/common.js';
import type { StoreFailure } from '../../record-store/ports.js';

/**
 * §4.1 line 772: the whole read must have observed at least the caller's
 * `atLeastCursor`, else the real `not_ready` stamp is published instead of an
 * older page masquerading as fresh.
 */
export function atLeastCursorResult<T>(
  observed: CommitCursor | null,
  required: CommitCursor | undefined,
): ReadResult<T> | null {
  if (required === undefined) return null;
  if (observed !== null && String(observed) >= String(required)) return null;
  return { status: 'not_ready', observed: observed === null ? null : { kind: 'platform', cursor: observed },
    required: { kind: 'platform', cursor: required } };
}

const STORE_FAILURE_CODES: ReadonlySet<string> = new Set(CORE_ERRORS);

/** The exact allowed Store failure code set, defaulting to `unavailable`. */
export function storeFailureCode(failure: { code: string }): CoreRejection['code'] {
  return STORE_FAILURE_CODES.has(failure.code) ? failure.code as CoreRejection['code'] : 'unavailable';
}

/**
 * A Store failure mapped to the domain vocabulary; `views/` never writes. A
 * structured rejection keeps its code/reason mapping; any other throw is the
 * same `unavailable` read failure the callers must not swallow.
 */
export function storeFailureToRejection(failure: unknown, current?: unknown): CoreRejection {
  if (isRecord(failure) && typeof failure.code === 'string' && typeof failure.reason === 'string') {
    return rejectedWithCurrent(storeFailureCode({ code: failure.code }), failure.reason,
      Array.isArray(current) ? current as VersionPin[] : undefined);
  }
  return rejected('unavailable', messageOf(failure));
}

/** Decodes the `revision_conflict` pins; only a null revision or an unreadable ref is skipped. */
export function pinsFromStoreCurrent(
  current: readonly { refKey: string; revision: number | null }[],
): VersionPin[] {
  const pins: VersionPin[] = [];
  for (const entry of current) {
    if (entry.revision === null) continue;
    let ref: unknown;
    try {
      ref = JSON.parse(entry.refKey);
    } catch {
      continue;
    }
    if (isRecord(ref)) pins.push({ ref: ref as VersionPin['ref'], revision: entry.revision });
  }
  return pins;
}

/** The claim-slot conflict arm; its `current` is a `{claimKey, owner}` list, not a version pin. */
export type SlotConflictFailure = Extract<StoreFailure, { code: 'unique_conflict' }>;
/** The version-conflict arm; its `current` is the version-pin list. */
export type VersionConflictFailure = Extract<StoreFailure, { code: 'revision_conflict' }>;

/**
 * A claim-slot conflict that names a role-scope slot becomes the structured
 * `scopeOwned` rejection; any other slot conflict stays the generic one.
 */
export function scopeOwnedRejectionOf(failure: SlotConflictFailure): CoreRejection | null {
  for (const slot of failure.current) {
    const detail = scopeOwnedDetailOfSlot(slot);
    if (detail === null) continue;
    return { status: 'rejected', code: 'revision_conflict', scopeOwned: detail,
      reason: `scope_owned: the ${detail.duty} scope ${canonicalKey(detail.target)} is held by ` +
        `${detail.holder === null ? 'an undecodable owner' : detail.holder.sessionId}` };
  }
  return null;
}

/** The Session owner's write-failure mapping. */
export function sessionStoreFailureToRejection(failure: StoreFailure): CoreRejection {
  switch (failure.code) {
    case 'invalid': return rejected('invalid', failure.reason);
    case 'not_found': return rejected('not_found', failure.reason);
    case 'idempotency_conflict': return rejected('idempotency_conflict', failure.reason);
    case 'revision_conflict': {
      const current = pinsFromStoreCurrent(failure.current);
      return rejectedWithNonEmptyCurrent('revision_conflict', failure.reason, current);
    }
    case 'unique_conflict':
      return scopeOwnedRejectionOf(failure)
        ?? rejected('revision_conflict', `${failure.reason} (the unique slot is held by another owner)`);
    case 'unsupported': return rejected('unsupported', failure.reason);
    case 'corrupt': return rejected('unavailable', `the record store reported damage: ${failure.reason}`);
    default: return rejected('unavailable', failure.reason);
  }
}

/** The execution entry/history write-failure mapping. */
export function executionStoreFailureToRejection(failure: {
  code: string;
  reason: string;
  current?: readonly { refKey: string; revision: number | null }[];
}): CoreRejection {
  switch (failure.code) {
    case 'revision_conflict': {
      const current = pinsFromStoreCurrent(failure.current ?? []);
      return rejectedWithNonEmptyCurrent('revision_conflict', failure.reason, current);
    }
    case 'unique_conflict':
      return rejected('busy', `${failure.reason} (the Kernel identity slot is held by another Run)`);
    case 'idempotency_conflict': return rejected('idempotency_conflict', failure.reason);
    case 'not_found': return rejected('not_found', failure.reason);
    case 'invalid': return rejected('invalid', failure.reason);
    case 'unsupported':
    case 'corrupt':
    default: return rejected('unavailable', failure.reason);
  }
}

/** The UCR / CRR / receipt write-failure mapping. */
export function ownerWriteStoreFailureToRejection(failure: { code: string; reason: string }): CoreRejection {
  switch (failure.code) {
    case 'revision_conflict': return rejected('revision_conflict', failure.reason);
    case 'unique_conflict': return rejected('busy', failure.reason);
    case 'idempotency_conflict': return rejected('idempotency_conflict', failure.reason);
    case 'not_found': return rejected('not_found', failure.reason);
    case 'invalid': return rejected('invalid', failure.reason);
    case 'unsupported':
    case 'corrupt':
    default: return rejected('unavailable', failure.reason);
  }
}

/** A read-side store failure: `invalid`/`unsupported` keep their code, everything else is `unavailable`. */
export function ownerReadStoreFailureToRejection(failure: { code: string; reason: string }): CoreRejection {
  const code = failure.code === 'invalid' ? 'invalid' : failure.code === 'unsupported' ? 'unsupported' : 'unavailable';
  return rejected(code, failure.reason);
}
