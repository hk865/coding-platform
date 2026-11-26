/** INT-O1 (§4.3): the completed Goal's line gets the new Goal's first Task, not the later idle line.
 *  Mutation: drop R3's `originLineOf` preference -> the claim lands on the idle line. */
import { afterEach, expect, it } from 'vitest';
import { driverRead, runsOf } from '../helpers/DRV-fixture.js';
import { plain } from '../helpers/AG2b-collaboration-fixture.js';
import { s6aCardsWorkspace } from '../helpers/S6A-cards-fixture.js';
import { S6A_SCOPE, S6A_WORK_ROLE } from '../helpers/S6A-request-fixture.js';
import { createS6BLine } from '../helpers/S6B1-fixture.js';
import { sessionOf } from '../helpers/S7A-fixture.js';
import { waitFor } from './harness.js';
import { intOpenCompletedGoal, intStartNewGoalFromLine } from '../helpers/INT-world.js';

const closers: Array<() => Promise<void>> = [];
afterEach(async () => { await Promise.allSettled(closers.splice(0).map(close => close())); });

it('INT-O1 the new Goal\'s first Task is claimed by the line the person spoke on', async () => {
  const { world, goal, secretary, workedLine } = await intOpenCompletedGoal('int-o1');
  closers.push(world.close);
  world.clock.advance(60_000);
  const idle = await sessionOf(world, await createS6BLine(s6aCardsWorkspace(world, S6A_SCOPE),
    { label: 'int-o1-idle', role: S6A_WORK_ROLE }));
  const { newGoal, firstTaskId } = await intStartNewGoalFromLine(world, { id: 'int-o1', line: workedLine,
    goal, secretary, label: 'int-o1', taskId: 'int-o1-task' });
  // R3 is the row: R4 may already have started the driver; only when it has not, start it once here.
  const driver = await driverRead(world, newGoal);
  if (driver.status === 'not_found') {
    const started = (await world.post('workflow/driver-start', plain(S6A_SCOPE, { advance: { schemaVersion: 1,
      goalRef: newGoal, flowId: 'int-o1', sessionHint: null, kind: 'select_work' }, queryProfileIds: [] }))).body as
      { status?: string };
    expect(started.status, 'the explicit driver start').toBe('ready');
  }

  const runs = await waitFor(() => runsOf(world, newGoal, firstTaskId), items => items.length > 0,
    'the new Goal\'s first claim');
  expect(runs[0]!.outbox.claim.sessionRef, 'the claim is on the line the person spoke on').toEqual(workedLine);
  expect(runs[0]!.outbox.claim.sessionRef, 'not the later idle line').not.toEqual(idle.ref);
  expect(newGoal.goalId).not.toBe(goal.goalId);
}, 180_000);
