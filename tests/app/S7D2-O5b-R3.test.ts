/**
 * O5b-R3 (`7d2-start-rulings.v4.md:6755`; O5b start rulings 22, 41; write-tests brief `tests-7d2-o5b1.txt`
 * "O5b-R3"): the lifecycle wake list carries `GoalPhase` and `ProjectRoleLimits`, so a cap raise and a goal
 * completion each wake the lifecycle drain, which assigns the goal waiting in the adviser queue. The two wake strings
 * and the drain landed with O4a (M16, M17), the application row with O3b (M9): the row is expected green on the start
 * point and its named mutations are what turn it red. Only these cells (ruling 22, v4 `:6798` "no other row is
 * re-proved"): the restart's start-up assignment is RL-12 F's, the one receipt of the application row RL-11's four
 * answers and RL-12 A's replay.
 *
 * R3-0 reads the wake list itself (ruling 41): `LIFECYCLE_WAKE_AGGREGATE_TYPES` is the object under test, not a
 * constant an expectation is computed from (rule sheet F8). The two world cells check only the final assignment, by
 * bounded polls of public reads (F9); no `idle()` barrier stands for the drain (O4a ruling 40,
 * `tests/helpers/S7D2-queue-world.ts:101`).
 *
 * World (each cell a new one, memory): `openS7D2QueueWorld` (tests/helpers/S7D2-queue-world.ts) with advisers A and B,
 * each holding three in-progress `small` goals and one unaccepted person inquiry (not idle), and the draft g7
 * (after-plan, `small`). Prior: the open adviser cap set to the holders `role-lines/allocation` lists (A and B: 2),
 * then g7 confirmed: G7 waits in the queue with no adviser link.
 *
 * Expected (by hand): R3-a — at cap 3 the drain finds no candidate among A and B (three counted goals each, v4
 * `:4804–:4805`), opens one new line and assigns G7 to it: the queue empty, G7 on exactly one line that is neither A
 * nor B. R3-b — completing A's first goal (`complete_goal` writes `GoalPhase`, `src/core/work-graph/tasks/
 * completion.ts:603–:604`) leaves A two in-progress small goals, so A is the one candidate for the small G7 (B still
 * holds three; `adviser-slots.ts:29`): the queue empty, G7 on `[A]`.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { LIFECYCLE_WAKE_AGGREGATE_TYPES } from '../../src/app/wake-loop.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import { openS7D2QueueWorld, type S7D2QueueWorld } from '../helpers/S7D2-queue-world.js';
import { waitFor } from '../scenarios/harness.js';

const worlds: S7D2QueueWorld[] = [];
afterEach(async () => { await Promise.allSettled(worlds.splice(0).map(world => world.close())); });

/** The prior of both cells (see the header); answers the world, G7 and the cap it set. */
async function queuedG7(label: string): Promise<{ q: S7D2QueueWorld; g7: GoalRef; cap: number }> {
  const q = await openS7D2QueueWorld({ backend: 'memory', advisers: true,
    drafts: [{ name: 'g7', autonomy: 'after_plan_confirmation' }] });
  worlds.push(q);
  const cap = (await q.allocation()).duties.adviser.holders.length;
  await q.setOpen('adviser', cap, `${label}-cap`);
  expect(await q.confirm('g7')).toMatchObject({ status: 'committed' });
  const g7 = q.goalOf('g7');
  const queued = await waitFor(() => q.queueIds(), ids => ids.length > 0, 'G7 in the adviser queue');
  expect(queued).toEqual([g7.goalId]);
  expect(await q.linesOf(g7)).toEqual([]);
  return { q, g7, cap };
}

/** Polls the queue and G7's lines until the queue is empty and `done` holds for the lines. */
async function drained(q: S7D2QueueWorld, g7: GoalRef, done: (lines: string[]) => boolean, what: string) {
  return await waitFor(async () => ({ queue: await q.queueIds(), lines: await q.linesOf(g7) }),
    read => read.queue.length === 0 && done(read.lines), what);
}

describe('O5b-R3: a cap raise and a goal completion each wake the lifecycle drain', () => {
  /*
   * Named mutation (X-20; v4 :6760): drop `'ProjectRoleLimits'` from `LIFECYCLE_WAKE_AGGREGATE_TYPES`
   * (`src/app/wake-loop.ts:66–:69`) -> the second `toContain` is red (R3-a's bounded poll may also time out; the row
   * does not rely on it). Drop `'GoalPhase'` -> the first `toContain` is red (the completion commit writes only
   * `GoalPhase`; the `'Goal'` string already in the list does not stand for it).
   */
  it('R3-0: the lifecycle wake list carries GoalPhase and ProjectRoleLimits', () => {
    expect(LIFECYCLE_WAKE_AGGREGATE_TYPES).toContain('GoalPhase');
    expect(LIFECYCLE_WAKE_AGGREGATE_TYPES).toContain('ProjectRoleLimits');
  });

  it('R3-a (memory): raising the open cap assigns the queued G7 to one new line', async () => {
    const { q, g7, cap } = await queuedG7('r3-a');
    const { a, b } = q.advisers!;
    await q.setOpen('adviser', cap + 1, 'r3-raise');
    const end = await drained(q, g7, lines => lines.length === 1, 'the queue to drain after the cap raise');
    expect(end.lines).toHaveLength(1);
    expect([a.ref.sessionId, b.ref.sessionId]).not.toContain(end.lines[0]);
  }, 300_000);

  it('R3-b (memory): completing one of A\'s goals assigns the queued G7 to A', async () => {
    const { q, g7 } = await queuedG7('r3-b');
    const { a } = q.advisers!;
    const first = q.advisers!.goals.a[0]!;
    await q.plan(first, 'r3');
    await q.complete(first, 'r3');
    const end = await drained(q, g7, lines => lines.length > 0, 'the queue to drain after the completion');
    expect(end.lines).toEqual([a.ref.sessionId]);
  }, 300_000);
});
