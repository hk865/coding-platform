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
  /**
   * Slice 4B L10: present only on a full-text index. `paths` are the record
   * fields whose comparison text is searched (`topic`, `conclusion`, `body`).
   * The index's own `paths` remain the equality prefix (the project id).
   */
  readonly text?: { readonly paths: readonly string[] };
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

/**
 * Slice 2C L3 count port (separate, so doubles that implement only `lookup` keep
 * type-checking). Without `distinctPath`, validation is exactly `lookup` without
 * `limit`/`after` and the matching row count is returned. With `distinctPath`
 * (which must be the index's last path, and is not supported on an ordered
 * index) `values` names only the preceding paths and the number of distinct
 * scalar values is returned (text / number / true / false are four classes,
 * numbers compare by value, null/missing/composite are not candidates).
 * An ordered index requires non-empty text equality values and counts only rows
 * whose order value is a candidate (non-empty text, or a safe JSON integer).
 */
export type RecordCountRequest = {
  index: string;
  values: readonly LookupValue[];
  distinctPath?: string;
};
export type RecordCountResult = { count: number; readThrough: CommitCursor | null };
export interface RecordCountPort {
  countLookup(request: RecordCountRequest): Promise<StoreResult<RecordCountResult>>;
}

// --------------------------------------------------------------------------
// Full-text port (Slice 4B L10)
// --------------------------------------------------------------------------

/**
 * Slice 4B L10 full-text port bounds. RecordStore owns these because the port
 * lives here and RecordStore imports nothing from WorkGraph (lead P14); the
 * read model's own ranking constants live in WorkGraph's `note-contracts.ts`.
 */
export const TEXT_SEARCH_PAGE_MAX = 100;
export const TEXT_SEARCH_CANDIDATE_MAX = 1000;
export const TEXT_SEARCH_MAX_TERMS = 8;
export const TEXT_SEARCH_TERM_MIN = 2;
export const TEXT_SEARCH_TERM_MAX = 64;

/**
 * Slice 4B L10. `values` are the registered equality prefix values (the project
 * id); `terms` are 1..8 normalized terms of 2..64 code points without
 * whitespace. The port answers the records whose comparison text contains every
 * term as a substring (the AND rule), in refKey byte order.
 */
export type TextSearchRequest = {
  index: string;
  values: readonly string[];
  terms: readonly string[];
  limit: number;
  after?: string;
};

export type TextSearchPage = {
  records: EncodedRecord[];
  next: string | null;
  complete: boolean;
  readThrough: CommitCursor | null;
};

export interface RecordTextSearchPort {
  searchText(request: TextSearchRequest): Promise<StoreResult<TextSearchPage>>;
}
