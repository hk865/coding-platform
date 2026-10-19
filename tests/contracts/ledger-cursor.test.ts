/** D85-5b: `makeCommitCursor` only makes ten-digit cursors that parse back. */
import { describe, expect, it } from 'vitest';
import { makeCommitCursor, seqOfCommitCursor } from '../../src/contracts/ledger.js';

describe('D85-5b ledger cursor range', () => {
  it('D85-5b refuses a sequence above ten digits', () => {
    expect(() => makeCommitCursor(10_000_000_000)).toThrow('invalid cursor sequence: 10000000000');
  });

  it('D85-5b the largest ten-digit sequence is a readable cursor', () => {
    const cursor = makeCommitCursor(9_999_999_999);
    expect(cursor).toBe('c9999999999');
    expect(seqOfCommitCursor(cursor)).toBe(9_999_999_999);
  });

  it('D85-5b pads a one-digit sequence to ten digits', () => {
    expect(makeCommitCursor(1)).toBe('c0000000001');
  });
});
