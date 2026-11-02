/**
 * The one contention bound for the allocation and limits CASes.
 *
 * Every owner that CASes `RoleLineAllocation` or `ProjectRoleLimits` runs read
 * → decide → commit at most four times (the first attempt plus three). Only a
 * conflict whose every observed version is one of those two records is re-read,
 * so a caller-pinned conflict returns at once. The last allocation-only loss is
 * `busy`, never `revision_conflict`: the Runtime keeps a registration's `busy`
 * accepted so the reservation survives and the same registration can run again.
 */
import type { WriteResult } from '../../../contracts/core/results.js';
import { rejected } from '../../../contracts/core/rejections.js';
import type { StoreFailure } from '../../record-store/ports.js';
import { sessionStoreFailureToRejection } from '../persistence/read-result-failures.js';

export const ALLOCATION_ATTEMPTS = 4;

/** `true` only for a revision conflict whose every observed version is one of `internal`. */
export function allocationOnlyConflict(failure: StoreFailure, internal: readonly string[]): boolean {
  if (failure.code !== 'revision_conflict') return false;
  if (failure.current.length === 0) return false;
  // A `revision: null` entry is an observed absence, and still one of the two internal versions.
  return failure.current.every((entry) => internal.includes(entry.refKey));
}

/** First attempt plus three; a store failure `mayRetry` returns rejects is mapped once, after the decision;
 *  a business rejection returns unchanged; the last allocation-only loss is `busy`. */
export async function retryAllocationCommit<T>(
  attempt: (index: number) => Promise<WriteResult<T> | { storeFailure: StoreFailure }>,
  mayRetry: (failure: StoreFailure) => boolean,
): Promise<WriteResult<T>> {
  let last: StoreFailure | null = null;
  for (let index = 0; index < ALLOCATION_ATTEMPTS; index += 1) {
    const result = await attempt(index);
    if (!('storeFailure' in result)) return result;
    if (!mayRetry(result.storeFailure)) return sessionStoreFailureToRejection(result.storeFailure);
    last = result.storeFailure;
  }
  return rejected('busy', `the allocation write lost ${ALLOCATION_ATTEMPTS} allocation-only conflicts`
    + (last === null ? '' : `: ${last.reason}`));
}
