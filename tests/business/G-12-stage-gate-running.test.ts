/**
 * PL G-12: a second-stage Run already entered does not stop the first-stage gate
 * from being selected. Stage 1 is satisfied by a real Run/check round; stage 2 is
 * refined by hand to one executable Task whose real Run is entered and held at its
 * model request (spec §5.1.3). The gate must not read "any active Run in the Goal".
 *
 * On this tree the driver's first target-level advance stops at the documented
 * closure seam (`planCandidates is not wired`, workflow.ts:1581, DR-P4-06).
 */
import { afterEach, expect, it } from 'vitest';
import type { PlanRevisionRef } from '../../src/contracts/plan.js';
import { driverRead } from '../helpers/DRV-fixture.js';
import { waitFor } from '../scenarios/harness.js';
import { checkConfiguration, ready } from '../helpers/S7A-fixture.js';
import { OPERATOR, S6A_SCOPE, S6A_WORK_ROLE } from '../helpers/S6A-request-fixture.js';
import { createS6BLine } from '../helpers/S6B1-fixture.js';
import { sessionOf } from '../helpers/S7A-fixture.js';
import {
  adoptPLTwoStageSkeleton, holdPLTaskRequest, openPLWorkflowWorld, satisfyPLTask, type PLWorkflowWorld,
} from '../helpers/PL-workflow-fixture.js';

let opened: PLWorkflowWorld | null = null;
afterEach(async () => { await opened?.close(); opened = null; });

it('G-12: the first-stage gate passes while the second-stage Run is entered', async () => {
  const workflow = opened = await openPLWorkflowWorld({ label: 'pl-g12',
    extraHostOptions: { checks: checkConfiguration({ kind: 'human', id: OPERATOR.id }) } });
  const skeleton = await adoptPLTwoStageSkeleton(workflow.main, workflow.goal, {
    label: 'pl-g12', stageOneTaskIds: ['pl-a'], stageTwoTaskIds: ['pl-d'],
  });
  const first = await sessionOf(workflow.world, await createS6BLine(workflow.main, {
    label: 'pl-g12-first', role: S6A_WORK_ROLE, tasks: skeleton.tasks.filter(task => task.taskId === 'pl-a'),
  }));
  await satisfyPLTask(workflow.world, workflow.goal, 'pl-a', first, 'g12');

  // Stage 2's real Run: claimed and entered, held at its model request.
  const second = await sessionOf(workflow.world, await createS6BLine(workflow.main, {
    label: 'pl-g12-second', role: S6A_WORK_ROLE, tasks: skeleton.tasks.filter(task => task.taskId === 'pl-d'),
  }));
  await workflow.world.scripted.script(second, [{ kind: 'text', text: 'PL g12 pl-d done' }]);
  const held = await holdPLTaskRequest(workflow.world, workflow.goal, 'pl-d', second, 'g12');
  const planRef = skeleton.plan.ref as PlanRevisionRef;
  expect(held.execution.run.status).toBe('running');
  expect(held.execution.outbox.claim.planRef).toEqual(planRef);

  const started = await workflow.world.post('workflow/driver-start', {
    scope: { ...S6A_SCOPE }, input: {
      advance: { schemaVersion: 1, goalRef: workflow.goal, flowId: 'pl-g12-driver',
        sessionHint: null, kind: 'select_work' },
      queryProfileIds: [] },
  });
  try {
    expect(started.body, JSON.stringify(started.body)).toMatchObject({ status: 'ready' });
    let read: Awaited<ReturnType<typeof driverRead>> | null = null;
    for (let attempt = 0; attempt < 200; attempt += 1) {
      read = await driverRead(workflow.world, workflow.goal);
      if (read.status === 'ready' && read.value.last !== null) break;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    expect(read?.status).toBe('ready');
    if (read !== null && read.status === 'ready') {
      expect(read.value.last?.status, JSON.stringify(read.value.last)).toBe('ready');
    }

    // The first-stage gate advanced while the second-stage Run stayed entered: wait
    // for its public check round, then read the reduced Task state.
    const timelineOf = async () => ready<{ tasks: Array<{ taskId: string;
      segments: Array<{ point: { kind: string } | null }> }> }>(
      await workflow.world.post('tasks/timeline', { scope: { ...S6A_SCOPE },
        input: { goalRef: workflow.goal, cursor: null, limit: 50 } }), 'tasks/timeline');
    await waitFor(timelineOf, read => read.tasks
      .find(task => task.taskId === 'pl-gate-pl-stage-1')?.segments
      .some(segment => segment.point?.kind === 'check_start') === true,
    'G-12: the first-stage gate opens its public check round');
    const graph = ready<{ tasks: Array<Record<string, unknown>> }>(
      await workflow.main.route('tasks/query', { goalRef: workflow.goal }), 'tasks/query');
    const gate = graph.tasks.find(task => (task['ref'] as { taskId?: string }).taskId === 'pl-gate-pl-stage-1');
    expect(['satisfied', 'verifying']).toContain(gate?.['effectivePhase']);
    expect(gate?.['execution']).toBeNull();
    const after = ready<{ run: { status: string }; outbox: { claim: { planRef: PlanRevisionRef } } }>(
      await workflow.world.post('executions/read', { scope: { ...S6A_SCOPE }, input: held.run }), 'executions/read');
    expect(after.run.status).toBe('running');
    expect(after.outbox.claim.planRef).toEqual(planRef);
  } finally {
    await held.release();
  }

  // Both steps went on: the gate's check and the held Run's own observation and check.
  const graphOf = async () => ready<{ tasks: Array<Record<string, unknown>> }>(
    await workflow.main.route('tasks/query', { goalRef: workflow.goal }), 'tasks/query');
  const phaseOf = (read: { tasks: Array<Record<string, unknown>> }, taskId: string) => read.tasks
    .find(task => (task['ref'] as { taskId?: string }).taskId === taskId)?.['effectivePhase'];
  const finished = await waitFor(graphOf, read => phaseOf(read, 'pl-d') === 'satisfied',
    'G-12: the released second-stage Run is observed and checked');
  expect(phaseOf(finished, 'pl-d')).toBe('satisfied');
  expect(phaseOf(finished, 'pl-gate-pl-stage-1')).toBe('satisfied');
  const ended = ready<{ run: { status: string }; outbox: { claim: { planRef: PlanRevisionRef } } }>(
    await workflow.world.post('executions/read', { scope: { ...S6A_SCOPE }, input: held.run }), 'executions/read');
  expect(ended.run.status).toBe('ended');
  expect(ended.outbox.claim.planRef, 'G-12: the claim plan pin is not rewritten').toEqual(planRef);
});
