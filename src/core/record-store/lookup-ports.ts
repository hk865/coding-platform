import type { EncodedRecord, StoreResult } from './ports.js';
import type { CommitCursor } from '../../contracts/command-event.js';

/** Trusted schema registration. Paths are dotted JSON object keys, never SQL. */
export type RecordLookupIndex = {
  readonly name: string;
  readonly aggregateType: string;
  readonly paths: readonly string[];
  /**
   * Slice 2A L1: an optional ordered column. `valueType` defaults to `'text'`;
   * an `'integer'` index orders by the numeric JSON integer value.
   */
  readonly orderBy?: { readonly path: string; readonly valueType?: 'text' | 'integer' };
};
export type LookupValue = string | number | boolean | null;
export type RecordLookupRequest = {
  index: string;
  values: readonly LookupValue[];
  /** Exclusive full canonical record key; values/index must remain the same. */
  after?: string;
  limit: number;
};
export type RecordLookupPage = {
  records: EncodedRecord[];
  next: string | null;
  readThrough: CommitCursor | null;
};
/** Candidate index only. WorkGraph rechecks canonical records and domain rules. */
export interface RecordLookupPort {
  lookup(request: RecordLookupRequest): Promise<StoreResult<RecordLookupPage>>;
}

/**
 * Slice 2A L1 ordered lookup (separate port, so existing doubles that only
 * implement `lookup` keep type-checking). `text` indexes order by non-empty
 * text and `integer` indexes by a safe JSON integer; the equality `values` are
 * always non-empty text (D3).
 */
export type OrderedLookupValue = string | number;
export type OrderedLookupRequest = {
  index: string;
  values: readonly string[];
  direction: 'asc' | 'desc';
  /** Lower bound for `asc`, upper bound for `desc`, on the order value. */
  bound?: { value: OrderedLookupValue; inclusive: boolean };
  /** Exclusive keyset after the previous page's last `(order, refKey)`. */
  after?: { order: OrderedLookupValue; refKey: string };
  limit: number;
};
export type RecordOrderedLookupPage = {
  records: EncodedRecord[];
  /** `null` when no candidate follows this page (L1). */
  next: { order: OrderedLookupValue; refKey: string } | null;
  readThrough: CommitCursor | null;
};
export interface RecordOrderedLookupPort {
  lookupOrdered(request: OrderedLookupRequest): Promise<StoreResult<RecordOrderedLookupPage>>;
}
