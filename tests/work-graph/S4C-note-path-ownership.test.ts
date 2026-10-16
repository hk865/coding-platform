/**
 * Slice 4C RW-13 (decision 72 / spec item 13): the one pure path-ownership
 * function. Directory-boundary longest prefix; one trailing `/` stripped from
 * each candidate path; a tie at the longest length is reported, not guessed.
 */
import { describe, expect, it } from 'vitest';
import { pathOwnershipOf } from '../../src/core/work-graph/notes/note-path-ownership.js';

const A = { value: 'A', paths: ['src'] } as const;
const B = { value: 'B', paths: ['src/deep'] } as const;

describe('S4C RW-13 path ownership', () => {
  it('RW-13 longer prefix wins: src/deep beats src on src/deep/x.ts', () => {
    expect(pathOwnershipOf('src/deep/x.ts', [A, B])).toEqual({ status: 'owner', owner: 'B' });
  });

  it('RW-13 two candidates on the same longest prefix → tie', () => {
    const other = { value: 'other', paths: ['src'] } as const;
    expect(pathOwnershipOf('src/x.ts', [A, other])).toEqual({ status: 'tie', owners: ['A', 'other'] });
  });

  it('RW-13 boundary: src owns src/x.ts but not src2/x.ts', () => {
    expect(pathOwnershipOf('src/x.ts', [A])).toEqual({ status: 'owner', owner: 'A' });
    expect(pathOwnershipOf('src2/x.ts', [A])).toEqual({ status: 'none' });
  });

  it('RW-13 one trailing slash is stripped from the candidate path', () => {
    const slashed = { value: 'A', paths: ['src/'] } as const;
    expect(pathOwnershipOf('src/x.ts', [slashed])).toEqual({ status: 'owner', owner: 'A' });
  });

  it('RW-13 no candidate matches → none', () => {
    expect(pathOwnershipOf('other/x.ts', [A])).toEqual({ status: 'none' });
    expect(pathOwnershipOf('src/x.ts', [])).toEqual({ status: 'none' });
  });

  it('RW-13 one candidate with duplicate paths is not a tie', () => {
    const duplicated = { value: 'A', paths: ['src', 'src/'] } as const;
    expect(pathOwnershipOf('src/x.ts', [duplicated])).toEqual({ status: 'owner', owner: 'A' });
  });
});
