/**
 * The canonical overlap basis digest: exactly `planRevision`, `waitingAttempt` and the running entries (each kept as
 * `{ task, run, startCursor }`, null cursors included), sorted by `canonicalJson([task, run])`. Pure A5: expected
 * values are the six hand-computed literals; no store, platform, Host, Workflow or Runtime is imported.
 */
import { describe, expect, it } from 'vitest';
import { makeCommitCursor } from '../../src/contracts/ledger.js';
import type { OverlapBasisV1 } from '../../src/core/work-graph/tasks/overlap-gates.js';
import { overlapBasisDigest } from '../../src/core/work-graph/tasks/overlap-gates.js';
import { S7C_BASIS } from '../helpers/S7C-n-overlap-fixture.js';

const FIRST = S7C_BASIS.running[0]!;
const SECOND = S7C_BASIS.running[1]!;

describe('overlapBasisDigest', () => {
  it.each<[string, OverlapBasisV1, string]>([
    ['the frozen basis', S7C_BASIS,
      'b5fc25c250bfe46f77b1b4ef44802215766910c251030fff1efa3fd8a73f48d0'],
    ['the two entries reversed', { ...S7C_BASIS, running: [SECOND, FIRST] },
      'b5fc25c250bfe46f77b1b4ef44802215766910c251030fff1efa3fd8a73f48d0'],
    ['entry 1 with a null start cursor', { ...S7C_BASIS, running: [{ ...FIRST, startCursor: null }, SECOND] },
      '0c945a36abb64cc7ba5dc3f1dfbc69ced751f6d5dd2958a423a416a114ac30c6'],
    ['entry 1 started at cursor 12', { ...S7C_BASIS, running: [{ ...FIRST, startCursor: makeCommitCursor(12) }, SECOND] },
      '13c7f15db828240bed463e413a5bff5aa1bacff3014c306a6c0a12b1b420fa22'],
    ['planRevision 4', { ...S7C_BASIS, planRevision: 4 },
      'ecf0e787dbe3bb0610fb154c24a71e63f308f9fa09d90344a01f5262db6238ec'],
    ['waitingAttempt a2', { ...S7C_BASIS, waitingAttempt: 'a2' },
      '1d4617af3d612550de6c22c9c29d4ddf1647f2fa2616a1660bbdbf096d5e7076'],
  ])('%s has the frozen digest', (_label, basis, digest) => {
    expect(overlapBasisDigest(basis)).toBe(digest);
  });
});
