/**
 * R-startup (`book-7a.md:724`; M-04). P2 §6 (S7A2-R-startup:52): after a restart a dispatch request is claimed
 * exactly once and the Goal's dispatch sequence moves by exactly one. The old message-release backlog is gone:
 * the row never reads or waits for a message release; the request and the counter are the public facts.
 */
import { afterEach, expect, it } from 'vitest';
import { s6aCardsWorkspace } from '../helpers/S6A-cards-fixture.js';
import { openS6AHostWorld, type S6AHostWorld } from '../helpers/S6A-host-fixture.js';
import { S6A_SCOPE, S6A_WORK_ROLE } from '../helpers/S6A-request-fixture.js';
import { createS6BLine } from '../helpers/S6B1-fixture.js';
import {
  holdS7AQueryRound, seedS7AGoalPlan, setS7AAutonomy,
} from '../helpers/S7A-fixture.js';
import { readS7A2DispatchBasis } from '../helpers/S7A2-fixture.js';
import { waitFor } from './harness.js';

const worlds: S6AHostWorld[] = [];
afterEach(async () => { for (const world of worlds.splice(0)) await world.close().catch(() => undefined); });

it('M-04: after a restart a dispatch request is claimed once and the sequence moves by one (SQLite)', async () => {
  const world = await openS6AHostWorld({ backend: 'sqlite' });
  worlds.push(world);
  const { goal, plan } = await seedS7AGoalPlan(world, { pointer: 'startup' });
  // `after_plan_confirmation` opens an agent's dispatch request directly (no person's card), so the target loop can
  // claim it after the restart.
  await setS7AAutonomy(world, goal, 'after_plan_confirmation');
  const task = plan.tasks.find(candidate => candidate.taskKind === 'work');
  if (task === undefined) throw new Error('S7A2: the seeded plan has no work task');
  // The Goal loop serves a request only through a line that can claim the Task (设计 3.2 第 4 步: with no line it
  // goes B19 and waits); the Task's responsible Work line is that line.
  await createS6BLine(s6aCardsWorkspace(world, S6A_SCOPE), { label: 's7a2-startup-line', role: S6A_WORK_ROLE,
    tasks: [{ projectId: goal.projectId, goalId: goal.goalId, taskId: task.taskId }] });
  // 1. the secretary's request round asks to dispatch the Task; one open ActionRequest, the counter is 0.
  const requested = await holdS7AQueryRound(world, { label: 'startup-dispatch', goalId: goal.goalId },
    async context => world.platform.actionRequests.requestDispatch(context, {
      input: { taskRef: { projectId: goal.projectId, goalId: goal.goalId, taskId: task.taskId },
        reason: 'the restart must claim this once' },
      meta: { requestId: 'startup-dispatch', expected: [] },
    }));
  expect(requested).toMatchObject({ status: 'requested' });
  const requestRef = 'actionRef' in requested ? requested.actionRef : undefined;
  if (requestRef === undefined) throw new Error(`the dispatch was not accepted: ${JSON.stringify(requested)}`);
  expect((await readS7A2DispatchBasis(world, goal)).dispatchSequence).toBe(0);
  // 2. the same-store restart with the driver on and start-up recovery on. P2 §2.5 (`p2-frozen.md:186`): the open
  // request is rebuilt by the existing restart rule and handed to the Goal loop; with recovery off nothing starts on
  // its own after a restart (`host.ts`'s start-up re-drive), and the old message-release pass that ran anyway is gone.
  await world.setResumeOnStartup(true);
  await world.crash({ extraHostOptions: { requestDriver: 'on' } });
  // 3. the saved request is claimed exactly once by the re-driven Goal loop: it is `applied` and the counter is 1,
  // never 0 or 2.
  const claimed = await waitFor(
    () => world.platform.actionRequests.readRequest(world.humanContext(), { ref: requestRef }),
    read => read.status !== 'ready' || read.value.state !== 'open', 'the restart claim of the open request');
  expect(claimed).toMatchObject({ status: 'ready', value: { state: 'applied' } });
  expect((await readS7A2DispatchBasis(world, goal)).dispatchSequence).toBe(1);
  // A second read of the same facts does not re-claim or re-count.
  expect((await readS7A2DispatchBasis(world, goal)).dispatchSequence).toBe(1);
});
