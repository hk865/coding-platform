/**
 * RSR R3 (`rsr-draft.md` 测试行 R3; RSR-2; frozen `p2-frozen.md:186`: a persistent `open` dispatch request's Goal is
 * registered by the existing restart-wait rule and handed to the goal loop; T14 M-03 "启动重建仍领一次、同请求仍只一次、
 * 序号只 +1"). A Goal whose adopted Plan has optional work only (no required work, so no Goal-gate template; lead
 * ruling 3, decision 121-128) is never held by a restart interruption (B10, `startup-reconcile.ts:795`). Its agent's
 * dispatch request is `open` when the Host restarts with `resumeOnStartup` `ask`: the start-up wait rebuild alone
 * must claim it, once, with no command from anyone. The S7A2-R-startup world (SQLite: the Host restarts on the same
 * directory); only the Plan (`plans/propose` + `plans/apply`) and the `ask` setting (`automation/save`) differ.
 *
 * - Red today at the claim wait: `ask` never runs the start-up re-drive (`host.ts:3006`), the rebuild reads no
 *   `open` request (`goal-wait-wakes.ts:255-289`), and no interruption holds the Goal for a person, so the request
 *   stays `open` and the dispatch sequence stays 0.
 * - Green with RSR-2: the rebuild registers the Goal for its `open` request; the `ask` start drains it and the goal
 *   loop claims the request (`open -> applied`, sequence 0 -> 1).
 * - Mutation guarded: drop RSR-2's open-dispatch branch → the request stays `open`, the wait times out.
 */
import { afterEach, expect, it } from 'vitest';
import type { GoalDisplayHostReadV1 } from '../../src/app/goal-fan-out-driver.js';
import type { PlanRevisionDraft } from '../../src/contracts/plan.js';
import { graphWrite, plain } from '../helpers/AG2b-collaboration-fixture.js';
import { s6aCardsWorkspace } from '../helpers/S6A-cards-fixture.js';
import { openS6AHostWorld, type S6AHostWorld } from '../helpers/S6A-host-fixture.js';
import { S6A_SCOPE, S6A_WORK_ROLE } from '../helpers/S6A-request-fixture.js';
import { createS6BLine, governS6B } from '../helpers/S6B1-fixture.js';
import { committed, holdS7AQueryRound, ready, setS7AAutonomy } from '../helpers/S7A-fixture.js';
import { readS7A2DispatchBasis } from '../helpers/S7A2-fixture.js';
import { waitFor } from './harness.js';

const worlds: S6AHostWorld[] = [];
afterEach(async () => { for (const world of worlds.splice(0)) await world.close().catch(() => undefined); });

it('R3: an optional-only Goal\'s open dispatch request is claimed once by the ask restart itself (SQLite)', async () => {
  const world = await openS6AHostWorld({ backend: 'sqlite' });
  worlds.push(world);
  const main = s6aCardsWorkspace(world, S6A_SCOPE);
  await governS6B(world, main, world.goals);
  const goal = (await main.createGoal('rsr-r3-goal', 'RSR R3: optional work only')).ref;
  const task = { projectId: goal.projectId, goalId: goal.goalId, taskId: 'rsr-r3-optional' };
  // One optional `request_execution` work with its one assignment; no gate, no obligation (plan-validation.ts:70-91).
  const draft: PlanRevisionDraft = { schemaVersion: 2, planId: 'rsr-r3-plan', planRevision: 1, goalId: goal.goalId,
    stages: [], tasks: [{ taskId: task.taskId, title: 'RSR R3 optional work', requirementLevel: 'optional',
      taskKind: 'work', disposition: 'active', phase: 'pending', scope: { kind: 'goal' },
      executionIntent: 'request_execution' }],
    assignments: [{ taskId: task.taskId, role: S6A_WORK_ROLE.templateId, instruction: 'RSR R3: the optional work' }],
    obligations: [], taskHierarchy: { parentOf: [] }, executionDag: { dependsOn: [] }, taskRelations: [],
    inputRequirements: [] };
  const proposed = committed<{ ref: unknown; revision: number }>(await main.post('plans/propose', graphWrite(S6A_SCOPE, {
    goalRef: goal, basedOn: null, draft, reason: { text: 'RSR R3 plan', sources: [] } }, 'rsr-r3-propose', [])), 'the Plan');
  committed(await main.post('plans/apply', graphWrite(S6A_SCOPE, { proposalRef: proposed.ref,
    expectedProposalRevision: proposed.revision, decisionRefs: [] }, 'rsr-r3-apply', [])), 'the adoption');
  await setS7AAutonomy(world, goal, 'after_plan_confirmation');
  await createS6BLine(main, { label: 'rsr-r3-line', role: S6A_WORK_ROLE, tasks: [task] });
  const requested = await holdS7AQueryRound(world, { label: 'rsr-r3-dispatch', goalId: goal.goalId },
    async context => world.platform.actionRequests.requestDispatch(context, {
      input: { taskRef: task, reason: 'RSR R3: the restart claims this once' },
      meta: { requestId: 'rsr-r3-dispatch', expected: [] } }));
  const requestRef = 'actionRef' in requested ? requested.actionRef : undefined;
  if (requestRef === undefined) throw new Error(`the dispatch was not accepted: ${JSON.stringify(requested)}`);
  const readRequest = () => world.platform.actionRequests.readRequest(world.humanContext(), { ref: requestRef });
  expect(await readRequest()).toMatchObject({ status: 'ready', value: { state: 'open' } });
  expect((await readS7A2DispatchBasis(world, goal)).dispatchSequence).toBe(0);

  const settings = await world.settings('snapshot', {});
  if (settings.status !== 'ready') throw new Error(`the settings read is ${settings.status}`);
  await world.settings('automation/save', { autoReworkLimit: settings.value.automation.autoReworkLimit,
    resumeOnStartup: 'ask' });
  await world.crash({ extraHostOptions: { requestDriver: 'on' } });
  const display = ready<GoalDisplayHostReadV1>(await world.post('goals/display', plain(S6A_SCOPE, { goalRef: goal })),
    'the Goal display');
  expect(display.display.causes.filter(cause => cause.code === 'interrupted_pending_resume'), 'not held').toEqual([]);
  const claimed = await waitFor(readRequest, read => read.status !== 'ready' || read.value.state !== 'open',
    'the start-up claim of the open request');
  expect(claimed).toMatchObject({ status: 'ready', value: { state: 'applied' } });
  expect((await readS7A2DispatchBasis(world, goal)).dispatchSequence).toBe(1);
}, 240_000);
