/**
 * The ONE guard merge every WorkGraph owner commit uses.
 *
 * Duplicate guards for the same key must agree; a conflict is a real
 * `revision_conflict` and is never silently reduced to the larger/first/last
 * version. Callers rebuild the whole read window instead of inventing a winner.
 */
import type { CoreRejection } from '../../../contracts/core/results.js';
import { rejectedWithCurrent as reject } from '../../../contracts/core/rejections.js';
import type { RecordGuard } from '../../record-store/ports.js';

export function mergeGuards(guards: readonly RecordGuard[]):
  { ok: true; guards: RecordGuard[] } | { ok: false; rejection: CoreRejection } {
  const byKey = new Map<string, number | null>();
  for (const guard of guards) {
    if (guard.refKey === '') {
      return { ok: false, rejection: reject('invalid', 'a record guard has an empty refKey') };
    }
    const existing = byKey.get(guard.refKey);
    if (existing === undefined) { byKey.set(guard.refKey, guard.expectedRevision); continue; }
    if (existing !== guard.expectedRevision) {
      return { ok: false, rejection: reject('revision_conflict', `conflicting guards for ${guard.refKey}`) };
    }
  }
  return { ok: true, guards: [...byKey].map(([refKey, expectedRevision]) => ({ refKey, expectedRevision })) };
}
