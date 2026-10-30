/**
 * WK-drain (the wake-loop rows): the real wake loop and the goal-wait queue
 * adapter over the real registry and one real observed commit.
 *
 * The world, the registration read and the commit come from `S7B2-WK-wake-world.ts` (W-F1's one world).
 * The observer wrapper records the notice `observeRecordCommits` produced and forwards it unchanged; the
 * drain wrapper records each real drain result. `wake` is the recording dependency the row allows.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RecordCommitNotice } from '../../src/composition/commit-observer.js';
import { createWakeLoop, type QueueHandler, type WakeLoop } from '../../src/app/wake-loop.js';
import {
  createGoalWaitQueue, GOAL_WAITS_QUEUE, GOAL_WAIT_WAKE_AGGREGATE_TYPES, WAKE_LIMIT,
} from '../../src/app/goal-wait-wakes.js';
import {
  commitGoalWait, openS7B2WakeWorld, registerGoalWaits, type S7B2WakeWorld,
} from '../helpers/S7B2-WK-wake-world.js';

type DrainResult = Awaited<ReturnType<QueueHandler['drain']>>;

const observed = vi.hoisted(() => ({ notices: [] as RecordCommitNotice[] }));

vi.mock('../../src/composition/create-platform.js', async (importOriginal) => {
  type Module = typeof import('../../src/composition/create-platform.js');
  const actual = await importOriginal<Module>();
  return {
    ...actual,
    createTargetPlatform: (options: Parameters<Module['createTargetPlatform']>[0]) => {
      const observer = options.commitObserver;
      return actual.createTargetPlatform({
        ...options,
        commitObserver: {
          started: head => observer?.started(head),
          committed: notice => { observed.notices.push(notice); observer?.committed(notice); },
        },
      });
    },
  };
});

const opened: S7B2WakeWorld[] = [];
const loops: WakeLoop[] = [];

afterEach(async () => {
  for (const loop of loops.splice(0)) await loop.close();
  for (const fixture of opened.splice(0)) await fixture.world.close();
});

describe('WK-drain', () => {
  it('drains G01–G16 then G17–G20 at once after one real commit, and a later heartbeat drains none', async () => {
    observed.notices.length = 0;
    const fixture = await openS7B2WakeWorld({ backend: 'memory' });
    opened.push(fixture);
    const wakes: string[] = [];
    const drains: DrainResult[] = [];
    const loop = createWakeLoop({ driving: () => true });
    loops.push(loop);
    const queue = createGoalWaitQueue({
      wake: async (_scope, goal) => { wakes.push(goal.goalId); },
      registries: fixture.registries,
      rebuild: async () => undefined,
    });
    const handler: QueueHandler = {
      rebuild: scope => queue.rebuild(scope),
      async drain(scope, input) {
        const result = await queue.drain(scope, input);
        drains.push(result);
        return result;
      },
      onCommitted: notice => queue.onCommitted?.(notice),
    };
    loop.register(GOAL_WAITS_QUEUE, handler, {
      aggregateTypes: GOAL_WAIT_WAKE_AGGREGATE_TYPES, maxItems: WAKE_LIMIT,
    });
    await loop.start([fixture.scope], { resumeOnStartup: true });
    // The start wake runs one bounded empty pass; the 20 registrations come after it.
    await vi.waitFor(() => expect(drains.length).toBe(1));
    drains.length = 0;

    // The frozen registration cursor 10; the world is already at 14, so the next commit is 15.
    registerGoalWaits(fixture);
    const commit = await commitGoalWait(fixture);
    expect(commit.cursor).toBe('c0000000015');
    loop.committed(observed.notices.find(candidate => candidate.cursor === commit.cursor)!);

    // The loop's `more` starts the next bounded drain with no new commit or heartbeat, so both pages
    // land before a poll can see the first alone; the recorded results keep the page split asserted.
    await vi.waitFor(() => expect(drains.length).toBe(2));
    expect(wakes).toEqual([
      'G01', 'G02', 'G03', 'G04', 'G05', 'G06', 'G07', 'G08',
      'G09', 'G10', 'G11', 'G12', 'G13', 'G14', 'G15', 'G16',
      'G17', 'G18', 'G19', 'G20',
    ]);
    expect(drains[0]).toMatchObject({ progressed: 16, more: true, continuation: null });
    expect(drains[1]).toMatchObject({ progressed: 4, more: false });

    loop.wake(fixture.scope, GOAL_WAITS_QUEUE, 'advance_settled');
    await vi.waitFor(() => expect(drains.length).toBe(3));
    expect(wakes).toHaveLength(20);
    expect(drains[2]).toMatchObject({ progressed: 0, more: false });
  });
});
