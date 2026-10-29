/**
 * SMK3B-4 (§2) and SMK3B-7 (§4): a Work Run or a secretary round whose model
 * service fails waits for the person and shows the Kernel's reason.
 *
 * SMK3B-4: the Kernel ends the Run `failed` with `{ category: 'model', code:
 * 'provider_unavailable' }`; TD-8 FC-7m makes it an interruption (not counted,
 * no automatic rework) and AV-5m stops the Task with `interrupted_pending_resume`
 * and the code/time. The Goal lists the cause and a card; a person's
 * `tasks/requeue` then a driver start continues the work.
 * SMK3B-7: the same failure in a secretary round closes it `failed`; the
 * request read shows `<code>: <message>` in `closeMessage`.
 *
 * Memory Host world (the S6A world), public routes and reads only; scripted
 * model replies only, no real model is called and nothing is read from a store.
 */
import { afterEach, expect, it } from 'vitest';
import type { TaskExecutionPage, TaskRow } from '../../src/app/core-http-types.js';
import type { ReadResult } from '../../src/contracts/core/results.js';
import type { RunRef } from '../../src/contracts/dispatch.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import { graphWrite, plain } from '../helpers/AG2b-collaboration-fixture.js';
import { adoptS6BPlan, createS6BLine, governS6B } from '../helpers/S6B1-fixture.js';
import { s6aCardsWorkspace } from '../helpers/S6A-cards-fixture.js';
import { openS6AHostWorld, type S6AHostWorld } from '../helpers/S6A-host-fixture.js';
import { initializeProject, submitRound, waitForRound } from '../helpers/S6A-history-fixture.js';
import { S6A_SCOPE, S6A_WORK_ROLE } from '../helpers/S6A-request-fixture.js';
import { readReady } from '../helpers/S6B3-fixture.js';
import { pauseS7AGoal, setS7AAutonomy } from '../helpers/S7A-fixture.js';
import { taskRowOf, waitFor } from './harness.js';

const worlds: S6AHostWorld[] = [];
afterEach(async () => {
  for (const world of worlds.splice(0)) await world.close();
});

const TASK = 'smk3b-model-service-work';
const GOAL_ID = 'smk3b-model-service-goal';

/** The driver handles this Goal once: the read answers a snapshot whose state is no longer `running`. */
const driverSettled = async (world: S6AHostWorld, goal: GoalRef): Promise<boolean> => {
  const snapshot = readReady<{ state?: string }>(
    (await world.post('workflow/driver-read', plain(S6A_SCOPE, { goalRef: goal }))).body as
      ReadResult<{ state?: string }>, 'workflow/driver-read');
  return snapshot.state !== 'running';
};

it('SMK3B-4: a model-service failure interrupts the work (one Run, a stopped Task with the code, a card), and a person continues it', async () => {
  const world = await openS6AHostWorld({ backend: 'memory', extraHostOptions: { requestDriver: 'on' } });
  worlds.push(world);
  const main = s6aCardsWorkspace(world, S6A_SCOPE);
  await governS6B(world, main, world.goals);
  const goal = (await main.createGoal(GOAL_ID, 'SMK3B model service goal')).ref;
  const { tasks } = await adoptS6BPlan(main, goal, { label: 'smk3b-model-service', taskIds: [TASK], role: S6A_WORK_ROLE.templateId });
  // No Session script on this line: the world's scripted model serves the run.
  await createS6BLine(main, { label: 'smk3b-model-service-line', role: S6A_WORK_ROLE, tasks });

  const runs = async (): Promise<TaskExecutionPage['items']> =>
    readReady<TaskExecutionPage>((await world.post('executions/list', plain(S6A_SCOPE,
      { goalRef: goal, taskId: TASK, page: { afterCursor: null, limit: 10 } }))).body as ReadResult<TaskExecutionPage>,
      'executions/list').items;
  const taskRow = async (): Promise<TaskRow> => taskRowOf((await world.post('tasks/query', plain(S6A_SCOPE,
    { goalRef: goal }))).body as ReadResult<{ tasks: TaskRow[] }>, TASK);

  world.scriptReplies([{ kind: 'error', code: 'provider_unavailable' }]);
  expect((await world.post('workflow/driver-start', plain(S6A_SCOPE, { advance: {
    schemaVersion: 1, goalRef: goal, flowId: 'smk3b-model-service', sessionHint: null, kind: 'select_work', taskId: TASK,
  }, queryProfileIds: [] }))).body).toMatchObject({ status: 'ready' });
  await waitFor(() => driverSettled(world, goal), settled => settled, 'the interrupted driver to settle');

  const listed = await runs();
  expect(listed, 'no automatic rework starts a second Run').toHaveLength(1);
  const failedRun: RunRef = listed[0]!.run.ref;
  const after = await taskRow();
  expect(after.failure?.failureClass).toBe('interrupted');
  expect(after.failure?.automation.verdict).toMatchObject({ kind: 'stopped', reason: 'interrupted_pending_resume',
    detail: { source: 'model_service', code: 'provider_unavailable', afterRunRef: failedRun,
      detectedAt: listed[0]!.run.endedAt } });
  expect(after.failure?.automation.requeueAutoCount, 'an interrupted Run is not counted').toBe(0);

  const display = readReady<{ display: { phase: string; causes: Array<{ code: string; taskId?: string }> } }>(
    (await world.post('goals/display', plain(S6A_SCOPE, { goalRef: goal }))).body as
      ReadResult<{ display: { phase: string; causes: Array<{ code: string; taskId?: string }> } }>, 'goals/display').display;
  expect(display.phase).toBe('NEEDS_DECISION');
  expect(display.causes).toContainEqual(expect.objectContaining({ code: 'interrupted_pending_resume', taskId: TASK }));
  const cards = await main.readCards(goal);
  expect(cards.some(card => card.source.kind === 'goal_cause'
    && card.source.key.includes('interrupted_pending_resume'))).toBe(true);

  // The person continues: a human requeue (admitted), then a driver start.
  const goalRead = readReady<{ goal: { revision: number } }>(
    (await world.post('goals/read', plain(S6A_SCOPE, goal))).body as
      ReadResult<{ goal: { revision: number } }>, 'goals/read');
  const runRead = readReady<{ run: { revision: number } }>(
    (await world.post('executions/read', plain(S6A_SCOPE, failedRun))).body as
      ReadResult<{ run: { revision: number } }>, 'executions/read');
  expect((await world.post('tasks/requeue', graphWrite(S6A_SCOPE, {
    taskRef: tasks[0], afterRunRef: failedRun,
    reason: 'the operator continues after the model-service interruption',
  }, 'smk3b-model-service-requeue', [
    { ref: goal, revision: goalRead.goal.revision }, { ref: failedRun, revision: runRead.run.revision },
  ]))).body).toMatchObject({ status: 'committed' });
  world.scriptReplies([{ kind: 'text', text: 'SMK3B-4: continued after the operator requeue' }]);
  expect((await world.post('workflow/driver-start', plain(S6A_SCOPE, { advance: {
    schemaVersion: 1, goalRef: goal, flowId: 'smk3b-model-service-continue', sessionHint: null,
    kind: 'select_work', taskId: TASK,
  }, queryProfileIds: [] }))).body).toMatchObject({ status: 'ready' });
  await waitFor(runs, items => items.length === 2, 'the continued Run');
}, 240_000);

it('R2-01: a paused every_step Goal shows no automation-confirmation card for a model-service interruption', async () => {
  const world = await openS6AHostWorld({ backend: 'memory', extraHostOptions: { requestDriver: 'on' } });
  worlds.push(world);
  const main = s6aCardsWorkspace(world, S6A_SCOPE);
  await governS6B(world, main, world.goals);
  const goal = (await main.createGoal(`${GOAL_ID}-paused`, 'SMK3B paused model service goal')).ref;
  const { tasks } = await adoptS6BPlan(main, goal, { label: 'smk3b-model-service-paused', taskIds: [TASK], role: S6A_WORK_ROLE.templateId });
  await createS6BLine(main, { label: 'smk3b-model-service-paused-line', role: S6A_WORK_ROLE, tasks });
  await setS7AAutonomy(world, goal, 'every_step');

  world.scriptReplies([{ kind: 'error', code: 'provider_unavailable' }]);
  expect((await world.post('workflow/driver-start', plain(S6A_SCOPE, { advance: {
    schemaVersion: 1, goalRef: goal, flowId: 'smk3b-model-service-paused', sessionHint: null, kind: 'select_work', taskId: TASK,
  }, queryProfileIds: [] }))).body).toMatchObject({ status: 'ready' });
  await waitFor(() => driverSettled(world, goal), settled => settled, 'the interrupted driver to settle');
  const failed = await taskRowOf((await world.post('tasks/query', plain(S6A_SCOPE, {
    goalRef: goal }))).body as ReadResult<{ tasks: TaskRow[] }>, TASK);
  expect(failed.failure).toMatchObject({ failureClass: 'interrupted', automation: { verdict: {
    kind: 'stopped', reason: 'interrupted_pending_resume',
    detail: { source: 'model_service', code: 'provider_unavailable' } } } });

  await pauseS7AGoal(world, goal);
  const cards = await main.readCards(goal);
  expect(cards.filter(card => card.source.kind === 'goal_cause'
    && card.source.key.includes('automation_confirmation_required'))).toEqual([]);
}, 240_000);

it('SMK3B-7: a secretary round on a Session with no script closes failed and its request read shows the Kernel reason', async () => {
  const world = await openS6AHostWorld({ backend: 'memory', extraHostOptions: { requestDriver: 'on' } });
  worlds.push(world);
  await initializeProject(world);
  world.scriptReplies([{ kind: 'error', code: 'provider_unavailable' }]);
  const round = await submitRound(world, {
    commandId: 'smk3b-model-service-secretary', goalId: null, text: 'SMK3B secretary round fails on the model service',
  });
  const view = await waitForRound(world, round.requestRoot, round.round, 'ended');
  const ended = view.rounds.find(entry => entry.ref.queryJobId === round.round.queryJobId);
  if (ended === undefined) throw new Error('the request read must list the ended round');
  expect(ended.status).toBe('ended');
  expect(ended.closeCode).toBe('failed');
  expect(ended.closeMessage?.startsWith('provider_unavailable')).toBe(true);
}, 240_000);
