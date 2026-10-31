/**
 * M-reuse (book-7c.md:1352, H-03): a member request returns an existing idle executor line only through P's
 * `createSessionChooser.reusable`, injected by L1. The exact-scope positive half (the idle line is returned as
 * `reused`) needs FX-7C1-02's started executor Run and P's `reusable` instance, so it is the named deferral below
 * (the frozen start ruling `7c1-start-rulings-v2.md:706-707`, `:1019` keeps it with L1).
 *
 * DEFERRED: the exact-scope positive half is the named deferral below — the named mutation (drop the exact
 * `{task}` equality in `findReusable`) is P/L1's, not proved in M; there is no port instance on this tree to carry
 * it, and the no-port "creates a new line" observation was only the implementation gap (M-15), never the rule.
 */
import { describe, it } from 'vitest';

describe('M-reuse: the exact idle executor line', () => {
  it('returns the exact idle executor line as reused', () => {
    throw new Error('S7C1-DEFERRED: the member tool names are not registered (7C-1 L1)');
  });
});
