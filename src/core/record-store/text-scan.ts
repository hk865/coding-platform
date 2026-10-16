/**
 * Slice 4 speed round 1 (decision 66): the one substring scan shared by the
 * in-memory and SQLite RecordStore backends.
 *
 * Route two replaces the 4B bigram-window candidate table with a compact table
 * holding each head record's comparison text. Both backends derive the same
 * `{ prefixKey, text }` row from a record body and run the same substring scan
 * over rows kept in refKey byte order. `lookup-index.ts` keeps the request
 * shape checks; this module owns the per-term rule (S1.10) and the in-memory
 * per-prefix index (S1.7).
 *
 * This module performs no I/O, opens no database and imports no WorkGraph
 * module.
 */
import { lookupIndexKeyOf, searchTextFrom, type RegisteredLookupIndex } from './lookup-index.js';

/** S1.10's shared per-term rule, used by the port decode and the scoped paths. */
export { decodeTextTerms, type TextTermDecode } from './lookup-index.js';

/** One derived row before it is placed under a refKey (S1.1/S1.2). */
export type TextScanSourceRow = { readonly prefixKey: string; readonly text: string };

/** One indexed row: a refKey and its comparison text. */
export type TextScanEntry = { readonly refKey: string; readonly text: string };

/**
 * S1.2/S1.4: derive one row from a record body. A composite at any registered
 * equality-prefix path yields `null`: exactly like the lookup buckets, such a
 * record is never a candidate under any prefix and no row is written.
 */
export function textScanRowOf(
  definition: RegisteredLookupIndex,
  body: Record<string, unknown>,
): TextScanSourceRow | null {
  const prefixKey = lookupIndexKeyOf(definition, body);
  if (prefixKey === null) return null;
  return { prefixKey, text: searchTextFrom(body, definition.text!.paths) };
}

/**
 * S1.7 ordering: an allocation-free code-point comparator. Well-formed strings
 * sort by code point exactly as SQLite's BINARY collation sorts their UTF-8
 * bytes (canonical refKeys are well-formed JSON, so this is the normal path);
 * an ill-formed pair falls back to the shared Buffer comparison.
 */
export function compareRefKeysFast(left: string, right: string): number {
  if (!left.isWellFormed() || !right.isWellFormed()) {
    return Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'));
  }
  const leftLength = left.length;
  const rightLength = right.length;
  let i = 0;
  let j = 0;
  while (i < leftLength && j < rightLength) {
    const leftPoint = left.codePointAt(i)!;
    const rightPoint = right.codePointAt(j)!;
    if (leftPoint !== rightPoint) return leftPoint < rightPoint ? -1 : 1;
    i += leftPoint > 0xffff ? 2 : 1;
    j += rightPoint > 0xffff ? 2 : 1;
  }
  if (i < leftLength) return 1;
  if (j < rightLength) return -1;
  return 0;
}

/** S1.8: the substring rule, shared by the scan and the scoped read model. */
export function textMatches(comparisonText: string, terms: readonly string[], match: 'all' | 'any'): boolean {
  if (match === 'any') return terms.some((term) => comparisonText.includes(term));
  return terms.every((term) => comparisonText.includes(term));
}

/**
 * S1.8: scan one sorted entry list from the first refKey after `after`. The
 * look-ahead hit decides `next`; running out of entries is `complete`. S1.11:
 * the last non-empty page therefore says `complete: true`; the 4B FTS window
 * false positives that used to produce one extra empty page no longer exist.
 */
export function scanEntries(
  entries: readonly TextScanEntry[],
  terms: readonly string[],
  match: 'all' | 'any',
  after: string | null,
  limit: number,
): { refKeys: string[]; next: string | null; complete: boolean } {
  let position = 0;
  if (after !== null) {
    let low = 0;
    let high = entries.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      const comparison = compareRefKeysFast(entries[middle]!.refKey, after);
      if (comparison > 0) high = middle;
      else low = middle + 1;
    }
    position = low;
  }
  const refKeys: string[] = [];
  for (; position < entries.length; position += 1) {
    const entry = entries[position]!;
    if (!textMatches(entry.text, terms, match)) continue;
    if (refKeys.length >= limit) {
      return { refKeys, next: refKeys[refKeys.length - 1]!, complete: false };
    }
    refKeys.push(entry.refKey);
  }
  return { refKeys, next: null, complete: true };
}

// --------------------------------------------------------------------------
// The shared in-memory index (S1.7)
// --------------------------------------------------------------------------

export type TextScanBucket = {
  entries: TextScanEntry[];
  indexByRef: Map<string, number>;
  /** New refKeys merged (sorted) before the next scan. */
  pending: Map<string, string>;
  loaded: boolean;
};

export type TextScanIndex = {
  readonly buckets: Map<string, TextScanBucket>;
  /** refKey -> the prefix bucket that currently caches it. */
  readonly prefixByRef: Map<string, string>;
};

export function createTextScanIndex(): TextScanIndex {
  return { buckets: new Map(), prefixByRef: new Map() };
}

/** The bucket for `prefixKey`, created unloaded when absent. */
export function bucketOf(index: TextScanIndex, prefixKey: string): TextScanBucket {
  let bucket = index.buckets.get(prefixKey);
  if (bucket === undefined) {
    bucket = { entries: [], indexByRef: new Map(), pending: new Map(), loaded: false };
    index.buckets.set(prefixKey, bucket);
  }
  return bucket;
}

/** Mark a bucket loaded from an already refKey-ordered row list. */
export function loadBucket(index: TextScanIndex, prefixKey: string, rows: readonly TextScanEntry[]): void {
  const bucket = bucketOf(index, prefixKey);
  bucket.entries = [...rows];
  bucket.indexByRef = new Map(bucket.entries.map((row, position) => [row.refKey, position]));
  bucket.pending.clear();
  bucket.loaded = true;
  for (const row of bucket.entries) index.prefixByRef.set(row.refKey, prefixKey);
}

/** Drop every cached bucket and reverse mapping. */
export function clearTextScanIndex(index: TextScanIndex): void {
  index.buckets.clear();
  index.prefixByRef.clear();
}

/** Remove `refKey` from one bucket only, leaving `prefixByRef` to the caller. */
function removeFromBucket(index: TextScanIndex, prefixKey: string, refKey: string): void {
  const bucket = index.buckets.get(prefixKey);
  if (bucket === undefined) return;
  bucket.pending.delete(refKey);
  const position = bucket.indexByRef.get(refKey);
  if (position === undefined) return;
  bucket.entries.splice(position, 1);
  bucket.indexByRef.delete(refKey);
  for (let shift = position; shift < bucket.entries.length; shift += 1) {
    bucket.indexByRef.set(bucket.entries[shift]!.refKey, shift);
  }
}

/** S1.7: put a row into a bucket that is known loaded. */
export function putLoadedRow(index: TextScanIndex, refKey: string, prefixKey: string, text: string): void {
  const bucket = bucketOf(index, prefixKey);
  bucket.loaded = true;
  const position = bucket.indexByRef.get(refKey);
  if (position !== undefined) {
    bucket.entries[position] = { refKey, text };
    bucket.pending.delete(refKey);
  } else {
    bucket.pending.set(refKey, text);
  }
  index.prefixByRef.set(refKey, prefixKey);
}

/**
 * S1.6/S1.7: apply one changed row during catch-up. The old prefixed bucket is
 * cleaned first; the row joins its new bucket only when that bucket is loaded
 * (an unloaded bucket reads the row when it loads).
 */
export function moveCatchUpRow(index: TextScanIndex, refKey: string, prefixKey: string, text: string): void {
  const previous = index.prefixByRef.get(refKey);
  if (previous !== undefined && previous !== prefixKey) {
    removeFromBucket(index, previous, refKey);
    index.prefixByRef.delete(refKey);
  }
  const bucket = index.buckets.get(prefixKey);
  if (bucket !== undefined && bucket.loaded) putLoadedRow(index, refKey, prefixKey, text);
}

/**
 * S1.7: the memory backend's commit-time put. The old prefixed bucket is
 * cleaned first, then the row joins a loaded bucket (memory buckets are always
 * loaded).
 */
export function putIndexRow(index: TextScanIndex, refKey: string, prefixKey: string, text: string): void {
  const previous = index.prefixByRef.get(refKey);
  if (previous !== undefined && previous !== prefixKey) removeTextScanRow(index, refKey);
  putLoadedRow(index, refKey, prefixKey, text);
}

/**
 * S1.7: remove `refKey` from whatever bucket caches it. Used by the memory
 * backend when a row's prefix key becomes `null` and by failed-commit undo.
 */
export function removeTextScanRow(index: TextScanIndex, refKey: string): void {
  const previous = index.prefixByRef.get(refKey);
  if (previous === undefined) return;
  removeFromBucket(index, previous, refKey);
  index.prefixByRef.delete(refKey);
}

/** Undo record for the memory backend's in-place commit rollback. */
export type TextScanUndo =
  | { readonly refKey: string; readonly kind: 'none' }
  | { readonly refKey: string; readonly kind: 'pending'; readonly prefixKey: string; readonly text: string }
  | { readonly refKey: string; readonly kind: 'entry'; readonly prefixKey: string; readonly text: string };

export function captureTextScanRow(index: TextScanIndex, refKey: string): TextScanUndo {
  const prefixKey = index.prefixByRef.get(refKey);
  if (prefixKey === undefined) return { refKey, kind: 'none' };
  const bucket = index.buckets.get(prefixKey);
  if (bucket !== undefined) {
    const position = bucket.indexByRef.get(refKey);
    if (position !== undefined) return { refKey, kind: 'entry', prefixKey, text: bucket.entries[position]!.text };
    const pending = bucket.pending.get(refKey);
    if (pending !== undefined) return { refKey, kind: 'pending', prefixKey, text: pending };
  }
  return { refKey, kind: 'none' };
}

export function restoreTextScanRow(index: TextScanIndex, undo: TextScanUndo): void {
  if (undo.kind === 'none') {
    removeTextScanRow(index, undo.refKey);
    return;
  }
  // F5 (review item 12a): a move A -> B that is rolled back must first drop the
  // row the move left in B, or B keeps a ghost entry after the restore.
  const current = index.prefixByRef.get(undo.refKey);
  if (current !== undefined && current !== undo.prefixKey) removeTextScanRow(index, undo.refKey);
  const bucket = bucketOf(index, undo.prefixKey);
  bucket.loaded = true;
  if (undo.kind === 'entry') {
    const position = bucket.indexByRef.get(undo.refKey);
    if (position !== undefined) bucket.entries[position] = { refKey: undo.refKey, text: undo.text };
    else bucket.pending.set(undo.refKey, undo.text);
  } else {
    bucket.pending.set(undo.refKey, undo.text);
  }
  index.prefixByRef.set(undo.refKey, undo.prefixKey);
}

/** S1.7: merge a bucket's pending rows, keeping refKey byte order. */
export function mergePending(index: TextScanIndex, prefixKey: string): TextScanBucket | undefined {
  const bucket = index.buckets.get(prefixKey);
  if (bucket === undefined || bucket.pending.size === 0) return bucket;
  const additions = [...bucket.pending.entries()]
    .map(([refKey, text]) => ({ refKey, text }))
    .sort((left, right) => compareRefKeysFast(left.refKey, right.refKey));
  bucket.pending.clear();
  if (bucket.entries.length === 0) {
    bucket.entries = additions;
  } else {
    const merged: TextScanEntry[] = [];
    let left = 0;
    let right = 0;
    while (left < bucket.entries.length && right < additions.length) {
      if (compareRefKeysFast(bucket.entries[left]!.refKey, additions[right]!.refKey) <= 0) {
        merged.push(bucket.entries[left]!);
        left += 1;
      } else {
        merged.push(additions[right]!);
        right += 1;
      }
    }
    while (left < bucket.entries.length) merged.push(bucket.entries[left++]!);
    while (right < additions.length) merged.push(additions[right++]!);
    bucket.entries = merged;
  }
  bucket.indexByRef = new Map(bucket.entries.map((row, position) => [row.refKey, position]));
  return bucket;
}
