/**
 * K3 B3 rework 9, package B runtime fail-closed rows.
 *
 * Entries named here (all module-level, no hand-written stored state):
 *  - F-075/F-071: the exported `readTaskReviews` (the ONE paging read) over its
 *    declared paging port; the port is the fault point (a missing port, a
 *    thrown page, a non-advancing cursor, pages of another Task).
 *  - F-076/F-101: the exported `readKernelCommandFacts` with a CANCELLED signal
 *    (A2 "a cancelled signal": the real owner returns `cancelled` before any
 *    read) and with a throwing Kernel store (A2 "a dependency fails always").
 *    The public prepare and public decision-read guards of the same rows live
 *    in `K3-B3-cancellation-cancelled.test.ts`; F-098's real-owner order row is
 *    in `K3-B3-newest-request-order.test.ts` (the old stub-port row here was
 *    confirmed a fake guard by the lead's mutation and is replaced by those).
 * Expected literals are hand-computed from the ruling, never copied.
 */
import { describe, expect, it } from 'vitest';
import { readTaskReviews } from '../../src/core/work-graph/tasks/task-review-reader.js';
import { readKernelCommandFacts } from '../../src/core/agent-runtime/context-assembler.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { UnknownCallReviewV1 } from '../../src/contracts/unknown-call-review.js';

const CTX = { signal: new AbortController().signal } as unknown as CoreCallContext;
const SCOPE = { projectId: 'p', workspaceId: 'w' };
const GOAL = { aggregateType: 'Goal' as const, projectId: 'p', goalId: 'g' };

describe('F-075/F-071: the ONE Task review paging read fails closed', () => {
  it('a missing review reader is unavailable, never an empty review set', async () => {
    const read = await readTaskReviews(CTX, undefined, { goalRef: GOAL, taskId: 't', workspace: SCOPE });
    expect(read).toEqual({ status: 'rejected', code: 'unavailable', reason: 'the Task review reader is not wired' });
  });

  it('pages across an empty first page to the end and filters another Task', async () => {
    const other = { task: { taskId: 'other' } } as unknown as UnknownCallReviewV1;
    const wanted = { task: { taskId: 't' }, ref: { runId: 'r1' } } as unknown as UnknownCallReviewV1;
    const pages = [
      { items: [other], nextCursor: 'c2', readThrough: null },
      { items: [], nextCursor: 'c3', readThrough: null },
      { items: [wanted], nextCursor: null, readThrough: null },
    ];
    let index = 0;
    const port = { listReviews: async () => ({ status: 'ready' as const, value: pages[index++]! }) };
    const read = await readTaskReviews(CTX, port, { goalRef: GOAL, taskId: 't', workspace: SCOPE });
    expect(read).toEqual({ status: 'ready', value: [wanted] });
    expect(index).toBe(3);
  });

  it('a throw on a page is unavailable (not an empty array), keeping the failure message', async () => {
    const port = { listReviews: async () => { throw new Error('injected page failure'); } };
    const read = await readTaskReviews(CTX, port, { goalRef: GOAL, taskId: 't', workspace: SCOPE });
    expect(read).toEqual({ status: 'rejected', code: 'unavailable',
      reason: 'the Task reviews could not be read: injected page failure' });
  });

  it('a cursor that does not advance is unavailable', async () => {
    const port = { listReviews: async () => ({ status: 'ready' as const,
      value: { items: [], nextCursor: 'same', readThrough: null } }) };
    const read = await readTaskReviews(CTX, port, { goalRef: GOAL, taskId: 't', workspace: SCOPE });
    expect(read).toEqual({ status: 'rejected', code: 'unavailable', reason: 'the Task review pages did not advance' });
  });
});

describe('F-076/F-101: the Kernel command read keeps cancellation and failure', () => {
  const session = { ref: { projectId: 'p', sessionId: 's' },
    kernel: { kernelSessionId: 'k', adapterId: 'a' } } as never;

  it('an aborted signal stays cancelled, not unavailable and not an empty map', async () => {
    const controller = new AbortController();
    controller.abort();
    const read = await readKernelCommandFacts({ kernelStores: {} as never }, { signal: controller.signal },
      { session, calls: [{ callId: 'c1', kernelSessionId: 'k', kernelRunId: 'r', turnId: 't', declaredPosition: 1 }] as never });
    expect(read).toEqual({ status: 'rejected', code: 'cancelled', reason: 'the bounded history window read was cancelled' });
  });

  it('a throwing Kernel store is unavailable with the real message, never empty facts', async () => {
    const kernelStores = { byAdapterId: () => { throw new Error('injected kernel store failure'); } };
    const read = await readKernelCommandFacts({ kernelStores: kernelStores as never }, { signal: new AbortController().signal },
      { session, calls: [{ callId: 'c1', kernelSessionId: 'k', kernelRunId: 'r', turnId: 't', declaredPosition: 1 }] as never });
    expect(read.status).toBe('rejected');
    if (read.status !== 'rejected') return;
    expect(read.code).toBe('unavailable');
    expect(read.reason).toContain('injected kernel store failure');
  });
});
