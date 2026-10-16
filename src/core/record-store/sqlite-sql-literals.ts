/**
 * Slice 4 speed round 1 (S3.2/S3.3): validated SQL literals for the SQLite
 * RecordStore backend.
 *
 * The registered `aggregateType` never reaches SQL as a bound parameter: a
 * per-type lookup index added after this round makes a bound type query
 * re-plan on every execution (S3.3). The pattern is restrictive enough that
 * the literal needs no escaping: no quote, NUL or non-ASCII character can
 * match. The LIMIT helper rounds up to the next power of two so a small set of
 * literal shapes is reused instead of a bound parameter.
 */
import { AGGREGATE_TYPE_PATTERN } from './lookup-index.js';

/**
 * `json_extract(<alias>ref_key, '$.aggregateType') = '<type>'` for a type that
 * passed the registration pattern. Re-checks the pattern and throws otherwise.
 */
export function aggregateTypeTerm(aggregateType: string): string {
  if (typeof aggregateType !== 'string' || !AGGREGATE_TYPE_PATTERN.test(aggregateType)) {
    throw new Error(`RecordStore SQL literal: aggregateType ${JSON.stringify(aggregateType)} is not safe`);
  }
  return `json_extract(ref_key, '$.aggregateType') = '${aggregateType}'`;
}

/**
 * A literal LIMIT: any safe integer >= 1, rounded up to the next power of two
 * >= `limit + 1` so `hasNext` keeps working. Anything else throws.
 */
export function literalLimit(limit: number): string {
  if (typeof limit !== 'number' || !Number.isSafeInteger(limit) || limit < 1) {
    throw new Error(`RecordStore SQL literal: limit ${String(limit)} must be a positive safe integer`);
  }
  let rounded = 1;
  const target = limit + 1;
  while (rounded < target) rounded *= 2;
  return String(rounded);
}
