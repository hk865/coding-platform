/**
 * F-027 (F8): fixed, independent command hashes.
 *
 * The old rows in `command-normalization.test.ts` built both sides with the
 * production `commandSha256` (`commandSha256('tool\ta')` against
 * `commandSha256('  tool a  ')`). Here the expected values are fixed SHA-256
 * literals of the hand-written texts, computed outside the product (sha256sum
 * over UTF-8): a change to the production normalisation or hash fails.
 */
import { describe, expect, it } from 'vitest';
import { commandSha256 } from '../../src/core/work-graph/state/command-normalization.js';

describe('B2-10 commandSha256 (F-027): fixed independent digests', () => {
  it('folds whitespace-only differences to the fixed digest of "tool a"', () => {
    expect(commandSha256('tool\ta')).toBe('2404bf27ae42f50d7bd6d70fc32a560ef7c3811859a224dbb16bd19623d1d1b8');
    expect(commandSha256('  tool a  ')).toBe('2404bf27ae42f50d7bd6d70fc32a560ef7c3811859a224dbb16bd19623d1d1b8');
  });

  it('gives different normalised text the fixed digests of "tool a" and "tool b"', () => {
    expect(commandSha256('tool a')).toBe('2404bf27ae42f50d7bd6d70fc32a560ef7c3811859a224dbb16bd19623d1d1b8');
    expect(commandSha256('tool b')).toBe('db83560cf2b28c735e37c1bce7b0e6e505873e26cc282743667cdd65acb8bd99');
  });
});
