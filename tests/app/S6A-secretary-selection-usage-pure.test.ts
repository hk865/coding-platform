/** A5: R-01b's two usage shapes over the basis rule; every expected value is the row's literal. */
import { describe, expect, it } from 'vitest';
import type { CommitCursor } from '../../src/contracts/command-event.js';
import type { QueryRunRef } from '../../src/contracts/query-job.js';
import { secretaryHandoffBasis } from '../../src/core/work-graph/tasks/secretary-handoff-basis.js';

describe('secretaryHandoffBasis (pure)', () => {
  const RUN: QueryRunRef = { aggregateType: 'QueryRun', projectId: 'p1', workspaceId: 'w1',
    queryJobId: 'qj-7', runId: 'qr-7' };
  const READ_THROUGH = 'c0000000412' as CommitCursor;

  it.each([
    { name: '500,000 at a 625,000 window is too long', window: 625_000,
      usage: { inputTokens: 500_000, run: RUN, requestIndex: 1 }, readThrough: READ_THROUGH,
      expected: { tooLong: true, threshold: 500_000, lastInputTokens: 500_000, run: RUN, requestIndex: 1,
        readThrough: READ_THROUGH } },
    { name: '499,999 at the same window is not too long', window: 625_000,
      usage: { inputTokens: 499_999, run: RUN, requestIndex: 1 }, readThrough: READ_THROUGH,
      expected: { tooLong: false, threshold: 500_000, lastInputTokens: 499_999, run: RUN, requestIndex: 1,
        readThrough: READ_THROUGH } },
    { name: 'a larger window still caps the threshold at 500,000', window: 1_000_000,
      usage: { inputTokens: 500_000, run: RUN, requestIndex: 0 }, readThrough: READ_THROUGH,
      expected: { tooLong: true, threshold: 500_000, lastInputTokens: 500_000, run: RUN, requestIndex: 0,
        readThrough: READ_THROUGH } },
    { name: 'no usage is not too long and names no run', window: 625_000,
      usage: null, readThrough: READ_THROUGH,
      expected: { tooLong: false, threshold: 500_000, lastInputTokens: null, run: null, requestIndex: null,
        readThrough: READ_THROUGH } },
    { name: 'no usage on an empty ledger keeps the null watermark', window: 625_000,
      usage: null, readThrough: null,
      expected: { tooLong: false, threshold: 500_000, lastInputTokens: null, run: null, requestIndex: null,
        readThrough: null } },
  ])('$name', ({ window, usage, readThrough, expected }) => {
    expect(secretaryHandoffBasis({ contextWindowTokens: window, usage, readThrough })).toEqual(expected);
  });
});
