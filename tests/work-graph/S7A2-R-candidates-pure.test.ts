/**
 * The frozen candidate order (A5): an open `dispatch_task` request never blocks; a held reason blocks first and a
 * pending stop card next, in that order (T6/T17). The target loop's "this Goal's open dispatch requests first, then
 * today's order" comparator has no pure entry in this tree (`workflow.ts:2113-2116` orders only the Plan; the
 * served-request first segment is G3), so this file pins the G2 blocker order it can reach. Pure input -> output:
 * the hold is built through the real state helpers, the blocker order is read through the owner's one function, no
 * store, clock, platform, Host or Runtime.
 */
import { describe, expect, it } from 'vitest';
import type { ActionRequestRef } from '../../src/contracts/action-request.js';
import type { SessionRef } from '../../src/contracts/core/identity.js';
import type { QueryJobRef, QueryRunRef } from '../../src/contracts/query-job.js';
import {
  holdBlockerOf, nextTaskClaimHold, occupyHoldPointer, placeHoldReason, releaseHoldReason, yieldHoldPointer,
  type PendingTaskClaimHoldV1,
} from '../../src/core/work-graph/state/task-claim-hold.js';

const AT = '2026-10-27T00:00:00.000Z';
const SESSION: SessionRef = { projectId: 'p-1', sessionId: 's-1' };
const REQUEST_ROOT: QueryJobRef = { aggregateType: 'QueryJob', projectId: 'p-1', workspaceId: 'w-1', queryJobId: 'q-1' };
const QUERY_RUN: QueryRunRef = { aggregateType: 'QueryRun', projectId: 'p-1', workspaceId: 'w-1',
  queryJobId: 'q-1', runId: 'r-1' };
const TASK = { projectId: 'p-1', goalId: 'g-1', taskId: 't-1' };
const DISPATCH: ActionRequestRef = { aggregateType: 'ActionRequest', projectId: 'p-1', goalId: 'g-1', requestId: 'a-1', taskId: 't-1' };
const STOP: ActionRequestRef = { aggregateType: 'ActionRequest', projectId: 'p-1', goalId: 'g-1', requestId: 'a-2', taskId: 't-1' };
const BASIS = { kind: 'round' as const, requestRoot: REQUEST_ROOT, sourceMessage: null, round: REQUEST_ROOT };

function emptyHold(): PendingTaskClaimHoldV1 {
  return nextTaskClaimHold(null, { ref: { aggregateType: 'TaskClaimHold', ...TASK }, workspaceId: 'w-1' });
}

function agentReason(id: string, reason: string, round: string, kind: 'agent' | 'scribe_stop' = 'agent') {
  const basis = { ...BASIS, round: { ...REQUEST_ROOT, queryJobId: round } };
  return { id, kind, placedBy: { kind: 'agent' as const, session: SESSION, queryRun: QUERY_RUN,
    duty: 'secretary' as const }, basis, reason, placedAt: AT, since: null };
}

describe('S7A2 candidate order: an open dispatch request never blocks, a hold and a stop card do', () => {
  it('blocks on the first held reason in stored order, then on the pending stop card', () => {
    let hold = emptyHold();
    // Two sources and an open dispatch request: the dispatched Task stays claimable.
    hold = placeHoldReason(hold, agentReason('h-1', 'waiting on the interface', 'q-1')).hold;
    hold = placeHoldReason(hold, agentReason('h-2', 'scribe stop', 'q-2', 'scribe_stop')).hold;
    hold = occupyHoldPointer(hold, 'openDispatch', DISPATCH);
    expect(holdBlockerOf(hold)).toEqual({ kind: 'held',
      reason: { placedBy: { kind: 'agent', session: SESSION, queryRun: QUERY_RUN, duty: 'secretary' },
        reason: 'waiting on the interface' } });
    expect(hold.openDispatch).toEqual(DISPATCH);

    // Withdrawing the first reason moves the order to the second, then the stop card; the dispatch request still
    // never appears as a blocker.
    const afterFirst = releaseHoldReason(hold, 'h-1', { kind: 'person', actor: { kind: 'human', id: 'operator' } }, null);
    if (afterFirst === null) throw new Error('the first held reason must exist');
    expect(holdBlockerOf(afterFirst.hold)).toEqual({ kind: 'held',
      reason: { placedBy: { kind: 'agent', session: SESSION, queryRun: QUERY_RUN, duty: 'secretary' },
        reason: 'scribe stop' } });

    let stopped = occupyHoldPointer(afterFirst.hold, 'pendingStop', STOP);
    // Both an agent-placed held reason and a pending stop exist: the held reason wins (the frozen order in
    // `state/task-claim-hold.ts:204`), and only releasing it exposes the stop card.
    expect(holdBlockerOf(stopped)).toEqual({ kind: 'held',
      reason: { placedBy: { kind: 'agent', session: SESSION, queryRun: QUERY_RUN, duty: 'secretary' },
        reason: 'scribe stop' } });
    const afterSecond = releaseHoldReason(stopped, 'h-2', { kind: 'person', actor: { kind: 'human', id: 'operator' } }, null);
    if (afterSecond === null) throw new Error('the second held reason must exist');
    stopped = afterSecond.hold;
    expect(holdBlockerOf(stopped)).toEqual({ kind: 'stop_pending', actionRef: STOP });

    // The dispatch pointer itself is never a blocker, and yielding it leaves the hold alone.
    expect(holdBlockerOf({ ...emptyHold(), openDispatch: DISPATCH })).toBeNull();
    expect(yieldHoldPointer({ ...emptyHold(), openDispatch: DISPATCH }, 'openDispatch', DISPATCH)).toMatchObject({
      openDispatch: null, lastDispatch: DISPATCH,
    });
  });

  it('yielding the pending stop card keeps its history and removes the last blocker', () => {
    let hold = emptyHold();
    hold = occupyHoldPointer(hold, 'pendingStop', STOP);
    expect(holdBlockerOf(hold)).toEqual({ kind: 'stop_pending', actionRef: STOP });

    const yielded = yieldHoldPointer(hold, 'pendingStop', STOP);
    expect(yielded.pendingStop).toBeNull();
    expect(yielded.lastStop).toEqual(STOP);
    expect(holdBlockerOf(yielded)).toBeNull();
    // An unrelated request never clears the pointer.
    expect(yieldHoldPointer(hold, 'pendingStop', DISPATCH)).toEqual(hold);
  });
});
