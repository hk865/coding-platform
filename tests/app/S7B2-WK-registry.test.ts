/**
 * WK's registry rules (the wake loop's goal-wait rows): merges, the per-(project, kind) high-water,
 * the mark-at-once rule, bounded goal-key drain order, leaving and the start-up queue.
 *
 * The registry is a pure in-memory object: every input is built here from the frozen shapes and the
 * expectations are the spec's literals (kind sets, goal ids, `more`). No store, loop or world is used.
 */
import { describe, expect, it } from 'vitest';
import type { RecordCommitNotice } from '../../src/composition/commit-observer.js';
import { makeCommitCursor as cursor, type GoalRef } from '../../src/contracts/ledger.js';
import { createGoalWaitQueue, createGoalWaitWakes, type GoalWaitWakes } from '../../src/app/goal-wait-wakes.js';
import { basisOf } from '../helpers/S7B2-WK-basis.js';

const goalOf = (goalId: string): GoalRef => ({ aggregateType: 'Goal', projectId: 'p1', goalId });
const noticeOf = (
  sequence: number, ...aggregates: { aggregateType: string; projectId: string | null }[]
): RecordCommitNotice => ({ cursor: cursor(sequence), aggregates });
const idsOf = (waits: GoalWaitWakes, limit: number) =>
  waits.nextDrainBatch(limit).goals.map(goal => goal.goalId);

describe('register', () => {
  it.each([
    {
      label: 'the earlier cursor is kept when the second read is later',
      first: { kind: 'SessionMessage', readAt: 8 },
      second: { kind: 'Run', readAt: 10 },
      observed: { kind: 'Run', at: 9 },
    },
    {
      label: 'the second kind joins the first registration',
      first: { kind: 'SessionMessage', readAt: 10 },
      second: { kind: 'Run', readAt: 10 },
      observed: { kind: 'SessionMessage', at: 15 },
    },
  ] as const)('merges a second registration: $label', ({ first, second, observed }) => {
    const waits = createGoalWaitWakes();
    const goal = goalOf('G01');
    waits.register(basisOf(goal.projectId, goal.goalId, [first.kind]), cursor(first.readAt));
    waits.register(basisOf(goal.projectId, goal.goalId, [second.kind]), cursor(second.readAt));
    waits.onCommitted(noticeOf(observed.at, { aggregateType: observed.kind, projectId: 'p1' }));
    expect(idsOf(waits, 10)).toEqual(['G01']);
  });
});

describe('markIfPast', () => {
  it.each([
    { registered: 10, seen: 10, drained: [] as string[] },
    { registered: 10, seen: 9, drained: [] as string[] },
    { registered: 9, seen: 10, drained: ['G01'] },
  ])('marks only when a seen cursor is past the registration read ($registered / $seen)',
    ({ registered, seen, drained }) => {
      const waits = createGoalWaitWakes();
      waits.onCommitted(noticeOf(seen, { aggregateType: 'SessionMessage', projectId: 'p1' }));
      waits.register(basisOf('p1', 'G01', ['SessionMessage']), cursor(registered));
      expect(idsOf(waits, 10)).toEqual(drained);
    });
});

describe('onCommitted', () => {
  it('marks only same-project registrations of a matching kind whose cursor is older', () => {
    const waits = createGoalWaitWakes();
    waits.register(basisOf('p1', 'G01', ['SessionMessage']), cursor(5));
    waits.register(basisOf('p2', 'G02', ['SessionMessage']), cursor(5));
    waits.register(basisOf('p1', 'G03', ['Run']), cursor(5));
    waits.register(basisOf('p1', 'G04', ['SessionMessage']), cursor(10));
    waits.onCommitted(noticeOf(10, { aggregateType: 'SessionMessage', projectId: 'p1' }));
    expect(idsOf(waits, 10)).toEqual(['G01']);
  });

  it('raises the high-water and an older later notice does not lower it', () => {
    const waits = createGoalWaitWakes();
    waits.onCommitted(noticeOf(10, { aggregateType: 'SessionMessage', projectId: 'p1' }));
    waits.onCommitted(noticeOf(8, { aggregateType: 'SessionMessage', projectId: 'p1' }));
    waits.register(basisOf('p1', 'G01', ['SessionMessage']), cursor(9));
    expect(idsOf(waits, 10)).toEqual(['G01']);
  });
});

describe('leave', () => {
  it('removes only the named goal, waking the other', () => {
    const waits = createGoalWaitWakes();
    const first = goalOf('G01');
    const second = goalOf('G02');
    waits.register(basisOf(first.projectId, first.goalId, ['SessionMessage']), cursor(5));
    waits.register(basisOf(second.projectId, second.goalId, ['SessionMessage']), cursor(5));
    waits.leave(first);
    waits.onCommitted(noticeOf(10, { aggregateType: 'SessionMessage', projectId: 'p1' }));
    expect(idsOf(waits, 10)).toEqual(['G02']);
  });
});

describe('queueAll', () => {
  it('queues every registration that no commit has marked yet', () => {
    const waits = createGoalWaitWakes();
    waits.register(basisOf('p1', 'G02', ['SessionMessage']), cursor(5));
    waits.register(basisOf('p1', 'G01', ['SessionMessage']), cursor(5));
    waits.queueAll();
    expect(idsOf(waits, 10)).toEqual(['G01', 'G02']);
  });
});

describe('drain after a failed rebuild', () => {
  it('re-runs the unfinished rebuild before draining, so its Goal is woken', async () => {
    const waits = createGoalWaitWakes();
    const scope = { projectId: 'p1', workspaceId: 'w1' };
    const wakes: string[] = [];
    let attempts = 0;
    const queue = createGoalWaitQueue({
      wake: async (_scope, goal) => { wakes.push(goal.goalId); },
      registries: { all: () => [{ scope, waits }] },
      rebuild: async (_scope, registry) => {
        if (attempts++ === 0) throw new Error('the first rebuild read failed');
        registry.register(basisOf('p1', 'G01', ['SessionMessage']), cursor(5));
      },
    });
    await expect(queue.rebuild(scope)).rejects.toThrow('the first rebuild read failed');
    const drained = await queue.drain(scope, { maxItems: 10, continuation: null, signal: new AbortController().signal });
    expect(wakes).toEqual(['G01']);
    expect(drained).toMatchObject({ progressed: 1, more: false });
  });
});
