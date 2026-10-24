/**
 * Slice 6A L16, QRR-06: the one recovery write path no public step can reach —
 * the person closes a Query whose Kernel history is missing or damaged, so the
 * closing write records an `unknown` tally (`kernel_unreadable`).
 *
 * A5: the pure write plan and the pure projection, with hand-written inputs
 * only. The plan creates the record with the unknown facts as given and the
 * QueryRun's own times as its span (`run_times`); the record then reads as
 * uncounted with that reason and carries no number, never a zero tally.
 */
import { describe, expect, it } from 'vitest';
import type { QueryRunRef } from '../../src/contracts/query-job.js';
import type { RunActivityFactsV1 } from '../../src/contracts/run-activity.js';
import { planQueryActivityWrite } from '../../src/core/work-graph/model/query-activity-plan.js';
import { queryActivityViewOf } from '../../src/core/work-graph/views/activity-read-helpers.js';

const queryRunRef: QueryRunRef = { aggregateType: 'QueryRun', projectId: 'p1', workspaceId: 'w1',
  queryJobId: 'q1', runId: 'r1' };
const unreadable: RunActivityFactsV1 = {
  status: 'unknown', ruleVersion: 1, reason: 'kernel_unreadable', detail: 'the Kernel store was missing',
};

describe('QRR-06: the closing write of a Query whose Kernel history is unreadable', () => {
  it('creates an unknown record spanning the QueryRun\'s own times, which reads with no numbers', () => {
    const planned = planQueryActivityWrite(null, unreadable, {
      queryRunRef, sessionRef: { projectId: 'p1', sessionId: 's1' }, askedSessionRef: null, goalId: 'goal-1',
      queryStartedAt: '2026-10-23T09:10:00.000Z', queryEndedAt: '2026-10-23T10:00:00.000Z',
      recordedBy: 'query_end', recordedAt: '2026-10-23T10:05:00.000Z', endCommit: true,
    });

    expect(planned.outcome).toBe('created');
    expect(planned.snapshot).toEqual({
      ref: { aggregateType: 'QueryActivity', projectId: 'p1', workspaceId: 'w1', queryJobId: 'q1', runId: 'r1' },
      revision: 1, schemaVersion: 1, queryRunRef,
      sessionRef: { projectId: 'p1', sessionId: 's1' }, askedSessionRef: null, goalId: 'goal-1',
      queryEndedAt: '2026-10-23T10:00:00.000Z', recordedAt: '2026-10-23T10:05:00.000Z', recordedBy: 'query_end',
      facts: { status: 'unknown', ruleVersion: 1, reason: 'kernel_unreadable', detail: 'the Kernel store was missing' },
      span: { firstAt: '2026-10-23T09:10:00.000Z', lastAt: '2026-10-23T10:00:00.000Z', basis: 'run_times' },
    });

    expect(queryActivityViewOf(planned.snapshot, '2026-10-23T09:00:00.000Z')).toEqual({
      queryRunRef,
      status: 'unknown', reason: 'kernel_unreadable', error: false,
      totals: null, changedFiles: null, usage: null,
      recordedBy: 'query_end', recordedAt: '2026-10-23T10:05:00.000Z',
      countedThroughTurnEnd: null, unresolvedCalls: null,
      sessionRef: { projectId: 'p1', sessionId: 's1' }, askedSessionRef: null, goalId: 'goal-1',
    });
  });
});
