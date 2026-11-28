/**
 * INT2 L8 and L-5 rows (int2-rulings §I-3, §3.3): the plain `goals/binding` read whose body is the `GoalRef` itself and
 * whose answer is `{ binding: InitializationBindingV1 | null }`; a `goals/create` Goal answers null; a failed binding
 * read stays `unavailable`; and the request that made a Goal reaches `main/read` only, never `goals/read`.
 *
 * State in this tree: `goals/binding` is published, so all four rows are green.
 * - L8-1: the card-confirmed Goal reads one binding naming its request root.
 * - L8-2: a `goals/create` Goal answers `{ binding: null }`.
 * - L8-3: a failed by-Goal lookup answers `rejected/unavailable`; the armed fault's call count proves that lookup ran.
 * - L5-1: `goals/read` keeps the frozen `GoalReadV1` key set; `main/read` carries the creating request.
 *
 * Named mutations (not run: the whitelist is tests-only):
 * - L8-1: `readBindingByGoal` answers the whole array instead of `[0]` (the binding has no `goalRef`).
 * - L8-2: no binding becomes `{ binding: {} }` instead of `null`.
 * - L8-3: a non-ready read becomes `{ binding: null }` instead of the read's `unavailable`.
 * - L5-1: `goals/read`'s value gains `binding` or the creating request field.
 */
import { afterEach, expect, it, vi } from 'vitest';
import { canonicalKey } from '../../src/contracts/fingerprint.js';
import {
  INITIALIZATION_BINDING_BY_GOAL_LOOKUP, type InitializationBindingV1,
} from '../../src/contracts/initialization-binding.js';
import type { GoalReadV1 } from '../../src/core/work-graph/model/plan-contracts.js';
import { plain } from '../helpers/AG2b-collaboration-fixture.js';
import { intOpenCompletedGoal, intStartNewGoalFromLine } from '../helpers/INT-world.js';
import { int2GoalBinding, int2ReadPage } from '../helpers/INT2-world.js';
import { commitBarrier } from '../helpers/S6A-commit-barrier.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import { openS6AHostWorld } from '../helpers/S6A-host-fixture.js';
import { ready } from '../helpers/S7A-fixture.js';

vi.mock('../../src/core/record-store/in-memory-record-store.js', async importOriginal =>
  (await import('../helpers/S6A-commit-barrier.js')).inMemoryLookupBarrierModule(importOriginal));

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  const left = commitBarrier.reset();
  await Promise.allSettled(closers.splice(0).map(close => close()));
  expect(left).toEqual([]);
});

it('INT2-L8-1 a card-confirmed Goal reads its binding by Goal', async () => {
  // Green today: the published route answers the binding. Mutation: return the whole binding array instead of `[0]`.
  const { world, goal, secretary, workedLine } = await intOpenCompletedGoal('int2-l8-1');
  closers.push(world.close);
  const { root, newGoal } = await intStartNewGoalFromLine(world, { id: 'int2-l8-1', line: workedLine,
    goal, secretary, label: 'int2-l8-1', taskId: 'int2-l8-1-task' });
  const value = ready<{ binding: InitializationBindingV1 | null }>(
    (await int2GoalBinding(world, newGoal)).body, 'goals/binding');
  expect(value.binding, 'the card confirmation wrote one binding').not.toBeNull();
  expect(value.binding?.goalRef, 'the binding names the confirmed Goal').toEqual(newGoal);
  expect(value.binding?.requestRef, 'the binding names the request that made it').toEqual(root);
}, 180_000);

it('INT2-L8-2 a goals/create Goal has no initialization binding', async () => {
  // Green today: a `goals/create` Goal answers null; it must not invent one.
  // Mutation: `{ binding: {} }` when the read is empty.
  const world = await openS6AHostWorld({ backend: 'memory' });
  closers.push(world.close);
  const value = ready<{ binding: InitializationBindingV1 | null }>(
    (await int2GoalBinding(world, world.goals.first)).body, 'goals/binding');
  expect(value.binding, 'goals/create wrote no binding, so the route answers null').toBeNull();
}, 120_000);

it('INT2-L8-3 a failed binding read is unavailable, not an empty binding', async () => {
  // Green today: the store's by-Goal lookup fails, so the read is `rejected/unavailable` (never ready + null), and the
  // fault count proves this row exercised that lookup. Mutation: a non-ready read becomes `{ binding: null }`.
  const { world, goal, secretary, workedLine } = await intOpenCompletedGoal('int2-l8-3');
  closers.push(world.close);
  const { newGoal } = await intStartNewGoalFromLine(world, { id: 'int2-l8-3', line: workedLine,
    goal, secretary, label: 'int2-l8-3', taskId: 'int2-l8-3-task' });
  const fault = commitBarrier.failReads(INITIALIZATION_BINDING_BY_GOAL_LOOKUP, 'throw-always');
  try {
    const answer = await int2GoalBinding(world, newGoal);
    expect(answer.httpStatus, 'a plain read answers HTTP 200 with the owner rejection').toBe(200);
    expect(answer.body, 'the failed read is unavailable, not a ready null').toMatchObject({
      status: 'rejected', code: 'unavailable',
    });
    expect(fault.calls(), 'the by-Goal lookup was really read').toBeGreaterThan(0);
  } finally { fault.release(); }
}, 180_000);

it('INT2-L5-1 the creating request reaches main/read, not goals/read', async () => {
  // Green today: `goals/read` answers exactly the frozen GoalReadV1 keys, and `main/read` of the new Goal carries the
  // request that made it. Mutation: add `binding` or the creating request field to the `goals/read` value.
  const { world, goal, secretary, workedLine } = await intOpenCompletedGoal('int2-l5-1');
  closers.push(world.close);
  const { root, newGoal } = await intStartNewGoalFromLine(world, { id: 'int2-l5-1', line: workedLine,
    goal, secretary, label: 'int2-l5-1', taskId: 'int2-l5-1-task' });
  const read = ready<GoalReadV1>(await world.post('goals/read', plain(S6A_SCOPE, newGoal)), 'goals/read');
  expect(Object.keys(read).sort(), 'the frozen GoalReadV1 key set: no binding and no creating-request field')
    .toEqual(['continuedBy', 'goal', 'ordinal', 'pendingPlan']);
  const page = await int2ReadPage(world, { goalId: newGoal.goalId });
  expect(page.requests.some(request => canonicalKey(request.requestRoot) === canonicalKey(root)),
    'main/read carries the request that made the Goal').toBe(true);
}, 180_000);
