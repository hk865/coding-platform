/** INT D rows (§4.4): a card-confirmed Goal's first plan starts its driver; a `goals/create` Goal does not.
 *  D1 is red on the base (no driver, no claim); mutation: remove R4's wrapper. D2 guards L4's binding. */
import { afterEach, expect, it } from 'vitest';
import { graphWrite, plain } from '../helpers/AG2b-collaboration-fixture.js';
import { driverRead, runsOf } from '../helpers/DRV-fixture.js';
import { s6aCardsWorkspace } from '../helpers/S6A-cards-fixture.js';
import { S6A_SCOPE, S6A_WORK_ROLE } from '../helpers/S6A-request-fixture.js';
import { createS6BLine } from '../helpers/S6B1-fixture.js';
import { sessionOf } from '../helpers/S7A-fixture.js';
import { S6A_POLICY_CONTENT, s6aInitialCatalog } from '../helpers/S6A-memory-fixture.js';
import { activatePolicy } from '../helpers/S8B-catalog-steps.js';
import { postValue } from '../helpers/S6B3-fixture.js';
import {
  callS6B3LateRoute, holdS6B3DraftAnswer, openS6B3World, releaseS6B3DraftAnswer,
} from '../helpers/S6B3-fixture.js';
import { openPLWorkflowWorld } from '../helpers/PL-workflow-fixture.js';
import { intAdoptFirstPlan } from '../helpers/INT-world.js';
import { waitFor } from './harness.js';

const closers: Array<() => Promise<void>> = [];
afterEach(async () => { await Promise.allSettled(closers.splice(0).map(close => close())); });

it('INT-D1 adopting a card-confirmed Goal\'s first plan starts its driver and claims its first Task', async () => {
  const world = await openS6B3World({ backend: 'memory' });
  closers.push(world.close);
  const held = await holdS6B3DraftAnswer(world, { scope: world.mainScope, label: 'int-d1', drafts: 2 });
  await releaseS6B3DraftAnswer(world, held);
  const confirmed = await callS6B3LateRoute(world, 'goals/confirm-draft', '6b3-w3',
    plain(world.mainScope, { commandId: 'int-d1-confirm', round: held.round, index: 0 })) as
    { status: string; value: { goal: { ref: { aggregateType: 'Goal'; projectId: string; goalId: string } } } };
  expect(confirmed.status).toBe('committed');
  const goal = confirmed.value.goal.ref;
  const workspace = s6aCardsWorkspace(world.host, S6A_SCOPE);
  const registration = await postValue<{ project: { revision: number }; workspace: { revision: number } }>(world,
    'workspaces/registration', plain(S6A_SCOPE, S6A_SCOPE), 'ready', 'the D1 registration');
  const adopted = await workspace.post('architecture/adopt-initial', graphWrite(S6A_SCOPE, {
    baselineId: 'int-d1-baseline', description: 'INT D1', constraints: [],
    catalog: s6aInitialCatalog(S6A_SCOPE.projectId) }, 'int-d1-architecture', [
    { ref: { aggregateType: 'Project', projectId: S6A_SCOPE.projectId }, revision: registration.project.revision },
    { ref: { aggregateType: 'Workspace', ...S6A_SCOPE }, revision: registration.workspace.revision },
  ])) as { status?: string };
  expect(adopted.status).toBe('committed');
  await world.host.settleDetached();
  await activatePolicy(world.host.platform, workspace.humanContext(), S6A_POLICY_CONTENT, 'int-d1-policy');
  const line = await sessionOf(world.host, await createS6BLine(s6aCardsWorkspace(world.host, S6A_SCOPE),
    { label: 'int-d1-line', role: S6A_WORK_ROLE }));
  await intAdoptFirstPlan(world.host, goal, { label: 'int-d1', taskId: 'int-d1-task' });
  // R4 starts the driver; the row calls no `workflow/driver-start`.
  const driver = await waitFor(() => driverRead(world.host, goal), read => read.status === 'ready',
    'the card-confirmed Goal driver');
  expect(driver.status === 'ready' && driver.value.flowId).toBe(`plan-adopted:${goal.goalId}:int-d1-plan`);
  const runs = await waitFor(() => runsOf(world.host, goal, 'int-d1-task'), items => items.length > 0,
    'the first claim');
  expect(runs[0]!.outbox.claim.sessionRef).toEqual(line.ref);
}, 180_000);

it('INT-D2 a goals/create Goal\'s first plan starts no driver', async () => {
  const opened = await openPLWorkflowWorld({ label: 'int-d2' });
  closers.push(opened.close);
  const goal = (await opened.main.createGoal('int-d2-goal', 'INT D2 created Goal')).ref;
  await createS6BLine(opened.main, { label: 'int-d2-line', role: S6A_WORK_ROLE });
  await intAdoptFirstPlan(opened.world, goal, { label: 'int-d2', taskId: 'int-d2-task' });
  const driver = await driverRead(opened.world, goal);
  expect(driver.status, 'no driver for a Goal without a binding').toBe('not_found');
  expect(await runsOf(opened.world, goal, 'int-d2-task'), 'no claim without a driver').toEqual([]);
}, 120_000);
