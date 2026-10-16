/**
 * F5 (review item 12a): the pure `text-scan.ts` undo of a prefix move.
 *
 * This is the unit test the rework allows on the exported functions of the pure
 * module: put a row in A, capture it, move it to B, restore the captured row,
 * merge B's pending list, and assert B no longer holds the row while A does.
 * No database and no backend is involved.
 */
import { expect, it } from 'vitest';
import {
  bucketOf, captureTextScanRow, createTextScanIndex, loadBucket, mergePending, putIndexRow, restoreTextScanRow,
} from '../../src/core/record-store/text-scan.js';

it('SP-08e unit: restoring a moved row removes it from its current bucket first', () => {
  const key = '{"aggregateType":"Widget","projectId":"p1","widgetId":"n1"}';
  const index = createTextScanIndex();
  // Put the row in A and capture it, exactly like the memory commit does.
  loadBucket(index, 'A', [{ refKey: key, text: 'shared' }]);
  const undo = captureTextScanRow(index, key);
  expect(undo).toEqual({ refKey: key, kind: 'entry', prefixKey: 'A', text: 'shared' });
  // The move A -> B leaves B holding a pending row.
  putIndexRow(index, key, 'B', 'shared');
  // Undo restores A; the row must not stay pending in B.
  restoreTextScanRow(index, undo);
  const bucketB = mergePending(index, 'B');
  expect(bucketB?.entries).toEqual([]);
  expect(bucketB?.pending.size).toBe(0);
  // A is restored (it is re-added as a pending row, merged here for the check).
  const bucketA = mergePending(index, 'A');
  expect(bucketA?.entries).toEqual([{ refKey: key, text: 'shared' }]);
  expect(bucketOf(index, 'A').indexByRef.get(key)).toBe(0);
});
