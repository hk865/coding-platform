/**
 * PL G-02: the goal-scope gate still waits for every required work Task. The plan
 * has a first-stage stage gate and a required `scope.kind === 'goal'` gate; stage 1
 * is satisfied through a real Run and check round, and the driver itself claims the
 * second-stage executable Task. The observed window is after that claim: the
 * second stage is still incomplete and the goal gate has no check round. Only when
 * the second-stage Task finishes does the goal gate open its public check round.
 */
import { afterEach, expect, it } from 'vitest';
import { waitFor } from '../scenarios/harness.js';
import { checkConfiguration, ready, sessionOf } from '../helpers/S7A-fixture.js';
import { OPERATOR, S6A_SCOPE, S6A_WORK_ROLE } from '../helpers/S6A-request-fixture.js';
import { createS6BLine } from '../helpers/S6B1-fixture.js';
import { waitDriver } from '../helpers/DRV-fixture.js';
import {
  adoptPLTwoStageSkeleton, openPLWorkflowWorld, satisfyPLTask, type PLWorkflowWorld,
} from '../helpers/PL-workflow-fixture.js';

let opened: PLWorkflowWorld | null = null;
afterEach(async () => { await opened?.close(); opened = null; });

it('G-02: the goal gate opens no check round until the second-stage task is finished', async () => {
  const workflow = opened = await openPLWorkflowWorld({ label: 'pl-g02',
    extraHostOptions: { checks: checkConfiguration({ kind: 'human', id: OPERATOR.id }) } });
  const skeleton = await adoptPLTwoStageSkeleton(workflow.main, workflow.goal, {
    label: 'pl-g02', stageOneTaskIds: ['pl-a'], stageTwoTaskIds: ['pl-d'], goalGate: true,
  });
  const line = await sessionOf(workflow.world, await createS6BLine(workflow.main, {
    label: 'pl-g02-line', role: S6A_WORK_ROLE, tasks: skeleton.tasks.filter(task => task.taskId === 'pl-a'),
  }));
  await satisfyPLTask(workflow.world, workflow.goal, 'pl-a', line, 'g02');

  const timelineOf = async () => ready<{ tasks: Array<{ taskId: string;
    segments: Array<{ point: { kind: string } | null }> }> }>(
    await workflow.world.post('tasks/timeline', { scope: { ...S6A_SCOPE },
      input: { goalRef: workflow.goal, cursor: null, limit: 50 } }), 'tasks/timeline');
  const gateGraphOf = async () => ready<{ tasks: Array<Record<string, unknown>>; plan: { planRevision: number } }>(
    await workflow.main.route('tasks/query', { goalRef: workflow.goal }), 'tasks/query');
  const goalGateOpen = async (): Promise<boolean> => (await timelineOf()).tasks
    .find(task => task.taskId === 'pl-gate-goal')?.segments
    .some(segment => segment.point?.kind === 'check_start') === true;

  // Before the driver: pending, no execution and no check round.
  const before = await gateGraphOf();
  const gate = before.tasks.find(task => (task['ref'] as { taskId?: string }).taskId === 'pl-gate-goal');
  expect(gate).toMatchObject({ effectivePhase: 'pending' });
  expect(gate?.['execution']).toBeNull();
  expect(await goalGateOpen()).toBe(false);

  // The driver claims pl-d on its responsible line; the Run stays held at its model request.
  const second = await sessionOf(workflow.world, await createS6BLine(workflow.main, {
    label: 'pl-g02-second', role: S6A_WORK_ROLE, tasks: skeleton.tasks.filter(task => task.taskId === 'pl-d'),
  }));
  await workflow.world.scripted.script(second, [{ kind: 'text', text: 'PL g02 pl-d done' }]);
  const secondHold = await workflow.world.gates.modelRequest(second);
  const started = await workflow.world.post('workflow/driver-start', {
    scope: { ...S6A_SCOPE }, input: {
      advance: { schemaVersion: 1, goalRef: workflow.goal, flowId: 'pl-g02-driver',
        sessionHint: null, kind: 'select_work' },
      queryProfileIds: [] },
  });
  expect(started.body, JSON.stringify(started.body)).toMatchObject({ status: 'ready' });

  // The driver has processed and claimed the second-stage Task; it is still incomplete.
  const running = await waitFor(gateGraphOf, read => read.tasks
    .find(task => (task['ref'] as { taskId?: string }).taskId === 'pl-d')
    ?.effectivePhase === 'running', 'G-02: the driver claims the second-stage Task');
  expect(running.tasks.find(task => (task['ref'] as { taskId?: string }).taskId === 'pl-d'))
    .toMatchObject({ effectivePhase: 'running' });
  await secondHold.reached;
  // The stage gate has passed inside this window and it does not satisfy the goal gate.
  const window = await waitFor(gateGraphOf, read => read.tasks
    .find(task => (task['ref'] as { taskId?: string }).taskId === 'pl-gate-pl-stage-1')
    ?.effectivePhase === 'satisfied', 'G-02: the first-stage gate passes while pl-d runs');
  expect(window.tasks.find(task => (task['ref'] as { taskId?: string }).taskId === 'pl-d'))
    .toMatchObject({ effectivePhase: 'running' });
  expect(await goalGateOpen(), 'the goal gate must not open while stage 2 is incomplete').toBe(false);
  const during = window.tasks.find(task => (task['ref'] as { taskId?: string }).taskId === 'pl-gate-goal');
  expect(during).toMatchObject({ effectivePhase: 'pending' });
  expect(during?.['execution']).toBeNull();
  const parked = await waitDriver(workflow.world, workflow.goal, undefined,
    snapshot => snapshot.reason?.includes('pl-d: running') === true, 'G-02: the driver waits on the second-stage Run');
  expect(parked.last, 'G-02: the driver is on the second-stage wait, not the goal gate')
    .toMatchObject({ status: 'ready', value: { state: 'waiting', next: null, pick: null } });

  // Finish stage 2 through the real Run; only then does the goal gate open.
  secondHold.release();
  await waitFor(gateGraphOf, read => read.tasks
    .find(task => (task['ref'] as { taskId?: string }).taskId === 'pl-d')
    ?.effectivePhase === 'satisfied', 'G-02: the second-stage Task finishes');
  await waitFor(timelineOf, read => read.tasks.find(task => task.taskId === 'pl-gate-goal')?.segments
    .some(segment => segment.point?.kind === 'check_start') === true,
  'G-02: the goal gate opens its public check round after stage 2 finishes');
  const after = await gateGraphOf();
  const openedGate = after.tasks.find(task => (task['ref'] as { taskId?: string }).taskId === 'pl-gate-goal');
  expect(openedGate).not.toMatchObject({ effectivePhase: 'pending' });
  expect(openedGate?.['execution']).toBeNull();
});
