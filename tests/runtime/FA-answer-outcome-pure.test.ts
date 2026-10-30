/**
 * FA-11 (decision 97-3 §2): the pure `mapOutcome` table, moved unchanged from
 * `FA-answer-tool.test.ts`. No Host, store mock, fixture or world.
 */
import { describe, expect, it } from 'vitest';
import { mapOutcome } from '../../src/core/agent-runtime/query-observation.js';

describe('mapOutcome: the accepted submit decides the answer for each Kernel terminal', () => {
  const cases: readonly {
    status: string; submitted: 'answered' | 'failed' | 'cancelled' | 'timeout' | null; without: 'answered' | 'failed' | 'cancelled' | 'timeout' | null;
  }[] = [
    { status: 'completed', submitted: 'answered', without: 'answered' },
    { status: 'failed', submitted: 'answered', without: 'failed' },
    { status: 'limit_exceeded', submitted: 'answered', without: 'timeout' },
    { status: 'cancelled', submitted: 'cancelled', without: 'cancelled' },
    { status: 'yielded', submitted: 'answered', without: 'failed' },
    { status: 'interrupted', submitted: null, without: null },
  ];
  it.each(cases)('$status → $submitted with an accepted submit, $without without', ({ status, submitted, without }) => {
    expect(mapOutcome(status, true)).toBe(submitted);
    expect(mapOutcome(status, false)).toBe(without);
  });
});
