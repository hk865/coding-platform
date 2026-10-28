/**
 * The keyset cursor's round trip (A5): a cursor encoded for a Goal's id, and one encoded for the workspace page
 * (`goalId: null`), each decode under the same `goalId` to the `after` they were encoded with. Every value is written
 * by hand.
 */
import { describe, expect, it } from 'vitest';
import { decodeKeysetCursor, encodeKeysetCursor, type KeysetCursorV1 } from '../../src/contracts/keyset-cursor.js';

describe('S7A2 keyset cursor', () => {
  it.each<[string, string | null, KeysetCursorV1['after']]>([
    ['a Goal page, text order', 'g-1', { order: '2026-10-27T10:00:00.000Z', refKey: 'm-7' }],
    ['the workspace page, integer order', null, { order: 42, refKey: 'm-9' }],
  ])('S7A2 %s: decodes under the same goalId to its after', (_page, goalId, after) => {
    expect(decodeKeysetCursor(encodeKeysetCursor(goalId, after), goalId)).toEqual(after);
  });
});
