/** INT U2 rows (§4.6): `goals/list` derives a new Goal's source; `goals/create` and ordinary requests have none. */
import { afterEach, expect, it } from 'vitest';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type { GoalListRowV1 } from '../../src/core/work-graph/model/decision-contracts.js';
import { plain } from '../helpers/AG2b-collaboration-fixture.js';
import { s6aCardsWorkspace } from '../helpers/S6A-cards-fixture.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import { ready } from '../helpers/S7A-fixture.js';
import {
  callS6B3LateRoute, holdS6B3DraftAnswer, openS6B3World, releaseS6B3DraftAnswer,
} from '../helpers/S6B3-fixture.js';
import { intOpenCompletedGoal, intStartNewGoalFromLine } from '../helpers/INT-world.js';

type IntGoalRow = GoalListRowV1 & { followsCompletedGoal: GoalRef | null };
const closers: Array<() => Promise<void>> = [];
afterEach(async () => { await Promise.allSettled(closers.splice(0).map(close => close())); });

it('INT-G1 the Goal added from a completed Goal\'s line names that Goal, and no one else does', async () => {
  const { world, goal, secretary, workedLine } = await intOpenCompletedGoal('int-g1');
  closers.push(world.close);
  const { newGoal } = await intStartNewGoalFromLine(world, { id: 'int-g1', line: workedLine,
    goal, secretary, label: 'int-g1', taskId: 'int-g1-task' });
  const created = (await s6aCardsWorkspace(world, S6A_SCOPE).createGoal('int-g1-created', 'INT G1 created')).ref;
  const rows = ready<{ goals: IntGoalRow[] }>(await world.post('goals/list',
    plain(S6A_SCOPE, { workspace: S6A_SCOPE })), 'goals/list').goals;
  expect(rows.find(row => row.ref.goalId === newGoal.goalId)?.followsCompletedGoal, 'the new Goal follows goal 1')
    .toEqual(goal);
  expect(rows.find(row => row.ref.goalId === goal.goalId)?.followsCompletedGoal, 'the completed Goal has no source')
    .toBeNull();
  const createdRow = rows.find(row => row.ref.goalId === created.goalId) as IntGoalRow;
  expect(createdRow.ref.goalId).toBe(created.goalId);
  expect(createdRow.followsCompletedGoal, 'goals/create has none').toBeNull();
}, 180_000);

it('INT-G3 a Goal confirmed from an ordinary request has no source', async () => {
  const world = await openS6B3World({ backend: 'memory' });
  closers.push(world.close);
  const held = await holdS6B3DraftAnswer(world, { scope: world.mainScope, label: 'int-g3', drafts: 2 });
  const answer = await releaseS6B3DraftAnswer(world, held);
  expect(answer.drafts).toHaveLength(2);
  const confirmed = await callS6B3LateRoute(world, 'goals/confirm-draft', '6b3-w3',
    plain(world.mainScope, { commandId: 'int-g3-confirm', round: held.round, index: 0 })) as
    { status: string; value: { goal: { ref: GoalRef } } };
  expect(confirmed.status).toBe('committed');
  const rows = ready<{ goals: IntGoalRow[] }>(await world.host.post('goals/list',
    plain(world.mainScope, { workspace: world.mainScope })), 'goals/list').goals;
  expect(rows.find(row => row.ref.goalId === confirmed.value.goal.ref.goalId)?.followsCompletedGoal).toBeNull();
}, 120_000);
