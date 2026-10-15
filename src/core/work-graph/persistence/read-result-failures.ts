/**
 * Shared RecordStore read-failure mapping (integration fix).
 *
 * `views/goal-conflicts.ts` and `tasks/goal-executed-files-reader.ts` both need
 * to turn a failed Store read into the domain rejection and to compare an
 * observed commit watermark with the caller's `atLeastCursor`. The
 * `tasks -> views` submodule edge is forbidden, so the two pure helpers live
 * here (`persistence`, which both `views` and `tasks` may import) and the views
 * module re-exports them for the existing readers.
 */
import type { CommitCursor } from '../../../contracts/command-event.js';
import type { CoreRejection, ReadResult } from '../../../contracts/core/results.js';

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

/** A Store failure mapped to the domain vocabulary; `views/` never writes. */
export function storeFailureToRejection(failure: { code: string; reason: string }, current?: unknown): CoreRejection {
  const allowed = new Set(['invalid', 'forbidden', 'revision_conflict', 'idempotency_conflict', 'not_found',
    'dependency_blocked', 'cycle', 'busy', 'source_stale', 'incomplete', 'capacity', 'unsupported', 'unavailable', 'cancelled']);
  const code = allowed.has(failure.code) ? failure.code as CoreRejection['code'] : 'unavailable';
  const rejection: CoreRejection = { status: 'rejected', code, reason: failure.reason };
  if (Array.isArray(current)) rejection.current = current as NonNullable<CoreRejection['current']>;
  return rejection;
}
