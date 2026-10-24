/**
 * Shared result shapes for the plan service: the owned-input wrapper, the service
 * rejection shape, and the translations from read/store failures to that shape.
 */
import { rejected } from '../../../contracts/core/rejections.js';
import type { CoreError, ReadResult } from '../../../contracts/core/results.js';

export type Owned<T> = { status: 'owned'; value: T } | { status: 'invalid'; reason: string };
export type Rejection = { status: 'rejected'; code: CoreError; reason: string };

export function mapStoreReadFailure<T>(failure: { status: 'rejected'; code: string; reason: string }, fallback: string): Rejection {
  if (failure.code === 'not_found') return rejected('not_found', failure.reason);
  if (failure.code === 'invalid') return rejected('invalid', failure.reason);
  if (failure.code === 'unsupported') return rejected('incomplete', failure.reason);
  return rejected('unavailable', `${failure.code}: ${failure.reason}`);
}

/** Translate a non-ready admission read into the one write rejection shape. */
export function asWriteRejection<T>(result: ReadResult<T>, fallback: string): Rejection {
  if (result.status === 'rejected') return rejected(result.code, result.reason);
  if (result.status === 'not_found') return rejected('not_found', fallback);
  return rejected('incomplete', fallback);
}
