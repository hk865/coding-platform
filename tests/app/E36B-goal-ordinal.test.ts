/**
 * E3-6B B2-1: "目标 n" is the Goal's place in its project's creation order, read at `goals/read` and never
 * stored or put into the internal `queryGoal`. Public Host routes over one memory world; the number is
 * hand-counted from the creation order (a cancelled Goal keeps its own).
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import type { ReadResult } from '../../src/contracts/core/results.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import { ready } from '../helpers/S5-application-support.js';
import { graphWrite } from '../helpers/AG2b-collaboration-fixture.js';
import { s6aCardsWorkspace } from '../helpers/S6A-cards-fixture.js';
import { openS6ATwoWorkspaceWorld, S6A_SCOPE, type S6ARequestWorld } from '../helpers/S6A-request-fixture.js';
import { settingsPost } from './support/S8A-L8-host.js';

const worlds: S6ARequestWorld[] = [];
const roots: string[] = [];
afterEach(async () => {
  for (const world of worlds.splice(0)) await world.close();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

type GoalRead = ReadResult<{ goal: { revision: number }; ordinal: number | null }>;

it('E36B B2-1: goals/read numbers a project’s Goals by creation order; a cancelled Goal keeps its number', async () => {
  const settingsRoot = await mkdtemp(join(tmpdir(), 'e36b-b2-1-settings-'));
  roots.push(settingsRoot);
  const { world, second: secondWorkspaceWorld } = await openS6ATwoWorkspaceWorld({ backend: 'memory', defaultGoals: false,
    extraHostOptions: { settings: { settingsDirectory: settingsRoot } } });
  worlds.push(world);
  const workspace = s6aCardsWorkspace(world, S6A_SCOPE);
  const secondWorkspace = s6aCardsWorkspace(world, secondWorkspaceWorld.scope);
  const goals: GoalRef[] = [];
  for (const goalId of ['e36b-goal-1', 'e36b-goal-2']) goals.push((await workspace.createGoal(goalId)).ref);
  // The same project's second workspace: the number is the project's creation order, not the workspace's.
  goals.push((await secondWorkspace.createGoal('e36b-goal-3')).ref);

  // Cancel the second Goal: its desired state changes, its number does not.
  const second = goals[1]!;
  const goalRead = ready(await workspace.route('goals/read', second) as GoalRead);
  // The Goal has no Plan, so its GoalPhase has no record; the control pins revision 0.
  const cancelled = await workspace.post('goals/control', graphWrite(S6A_SCOPE,
    { goalRef: second, control: 'cancel', reason: 'E36B B2-1 operator cancel' }, 'e36b-cancel-second', [
      { ref: second, revision: goalRead.goal.revision },
      { ref: { aggregateType: 'GoalPhase', projectId: second.projectId, goalId: second.goalId }, revision: 0 },
    ]));
  expect(cancelled).toMatchObject({ status: 'committed' });
  goals.push((await workspace.createGoal('e36b-goal-4')).ref);

  const ordinals = await Promise.all(goals.map(async (goal, index) =>
    ready(await (index === 2 ? secondWorkspace : workspace).route('goals/read', goal) as GoalRead).ordinal));
  expect(ordinals).toEqual([1, 2, 3, 4]);

  // A second project's first Goal is 目标 1.
  const root = await mkdtemp(join(tmpdir(), 'e36b-b2-1-'));
  roots.push(root);
  const response = await settingsPost(world.base, 'workspaces/open', world.token,
    { path: root, writeAllowed: false, commandsAllowed: false });
  const opened = await response.json() as
    { status: 'ready'; value: { scope: { projectId: string; workspaceId: string } } } | { status: 'rejected' };
  if (opened.status !== 'ready') throw new Error(`workspaces/open was refused: ${JSON.stringify(opened)}`);
  const other = s6aCardsWorkspace(world, opened.value.scope);
  const otherGoal = (await other.createGoal('e36b-other-goal')).ref;
  expect(ready(await other.route('goals/read', otherGoal) as GoalRead).ordinal).toBe(1);

  // The internal read stays `GoalDetail`: the number is only a person-facing `goals/read` value.
  expect(ready(await world.platform.plans.queryGoal(workspace.humanContext(), goals[0]!))).not.toHaveProperty('ordinal');
}, 60_000);
