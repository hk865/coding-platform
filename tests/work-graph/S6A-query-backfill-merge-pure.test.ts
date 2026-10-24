/**
 * L16: the merged backfill list's one order and the cursor step, as pure
 * functions over hand-written positions. The order is `endedAt` (newest first,
 * as the 2B scan reads), then the kind rank (a Work Run before a Query at one
 * instant), then the record key ascending. The cursor resumes strictly after
 * the entry it names: an older instant always, and at the same instant the next
 * kind or the next key.
 */
import { describe, expect, it } from 'vitest';
import type { RunRef } from '../../src/contracts/dispatch.js';
import type { QueryRunRef } from '../../src/contracts/query-job.js';
import {
  activityBackfillCandidateAfter, activityBackfillCursorOf, orderActivityBackfillCandidates,
  type ActivityBackfillCandidate, type ActivityBackfillPosition,
} from '../../src/core/work-graph/tasks/run-activity-service.js';

type PositionedCandidate = ActivityBackfillCandidate & ActivityBackfillPosition;

const AT_10 = '2026-10-20T10:00:00.000Z';
const AT_11 = '2026-10-20T11:00:00.000Z';

function runPosition(runId: string, endedAt: string): PositionedCandidate {
  const runRef: RunRef = { aggregateType: 'Run', projectId: 'p1', goalId: 'g1', runId };
  return { kind: 'run', runRef, activityRevision: null, endedAt,
    refKey: `{"aggregateType":"Run","goalId":"g1","projectId":"p1","runId":"${runId}"}` };
}

function queryPosition(queryJobId: string, endedAt: string): PositionedCandidate {
  const queryRunRef: QueryRunRef = { aggregateType: 'QueryRun', projectId: 'p1', workspaceId: 'w1',
    queryJobId, runId: 'qr-1' };
  return { kind: 'query', queryRunRef, activityRevision: null, endedAt,
    refKey: `{"aggregateType":"QueryRun","projectId":"p1","queryJobId":"${queryJobId}","runId":"qr-1","workspaceId":"w1"}` };
}

describe('the merged backfill order', () => {
  it('puts a Work Run before a Query at the same end instant, and the newest instant first', () => {
    const query = queryPosition('qj-1', AT_10);
    const run = runPosition('r-1', AT_10);
    const newer = runPosition('r-2', AT_11);
    const ordered = orderActivityBackfillCandidates([query, newer, run]);
    expect(ordered.map(item => item.kind === 'run' ? `run:${item.runRef.runId}` : `query:${item.queryRunRef.queryJobId}`))
      .toEqual(['run:r-2', 'run:r-1', 'query:qj-1']);
  });

  it('orders another Run and another Query at the same instant by the record key ascending', () => {
    const runs = [runPosition('r-b', AT_10), runPosition('r-a', AT_10)];
    const queries = [queryPosition('qj-b', AT_10), queryPosition('qj-a', AT_10)];
    expect(orderActivityBackfillCandidates([...queries, ...runs])
      .map(item => item.kind === 'run' ? `run:${item.runRef.runId}` : `query:${item.queryRunRef.queryJobId}`))
      .toEqual(['run:r-a', 'run:r-b', 'query:qj-a', 'query:qj-b']);
  });
});

describe('the merged cursor step', () => {
  it('includes the next key of the same kind and every Query after a Run, never the named entry', () => {
    // In list order: the newer instant first, then one instant's Run keys and
    // Query keys ascending.
    const ordered: ActivityBackfillPosition[] = [
      { endedAt: AT_11, kind: 'run', refKey: 'a' },
      { endedAt: AT_10, kind: 'run', refKey: 'a' },
      { endedAt: AT_10, kind: 'run', refKey: 'b' },
      { endedAt: AT_10, kind: 'query', refKey: 'a' },
      { endedAt: AT_10, kind: 'query', refKey: 'b' },
    ];
    const label = (position: ActivityBackfillPosition): string =>
      `${position.endedAt === AT_10 ? 't10' : 't11'}:${position.kind}:${position.refKey}`;
    const after = ordered.map(cursor => ordered
      .filter(position => activityBackfillCandidateAfter(position, activityBackfillCursorOf(cursor))).map(label));
    expect(after).toEqual([
      ['t10:run:a', 't10:run:b', 't10:query:a', 't10:query:b'],
      ['t10:run:b', 't10:query:a', 't10:query:b'],
      ['t10:query:a', 't10:query:b'],
      ['t10:query:b'],
      [],
    ]);
  });

  it('starts a page after an entry with the next one in the list order', () => {
    const ordered = orderActivityBackfillCandidates([runPosition('r-1', AT_10), queryPosition('qj-1', AT_10)]);
    const cursor = activityBackfillCursorOf(ordered[0]!);
    expect(ordered.filter(item => activityBackfillCandidateAfter(item, cursor))
      .map(item => item.kind)).toEqual(['query']);
  });
});
