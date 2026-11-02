/**
 * PL-15: one complete single-stage plan, written in full with no later
 * `plan_only` placeholder, on the automatic band. The person applies it and
 * starts the Goal driver; the driver's own work completes the tasks and the
 * Goal by the existing rules, with no `refine:` and no wait caused by a missing
 * skeleton. A stage line over 2_000 is only a prompt (spec §15 PL-15, DR-P4-13).
 *
 * The named mutation is "send refine even when there is no plan_only"; it is
 * not runnable here because the target-level rule lives in `workflow.ts` and is
 * after this tree's closure seam. On this tree the first Goal-driver pass stops
 * at `workflow.ts:1581` with `rejected('unsupported','planCandidates is not
 * wired')`, so the assertions after the driver's last result are the row's
 * literals and are not yet reachable.
 */
import { afterEach, expect, it } from 'vitest';
import { createS6BLine } from '../helpers/S6B1-fixture.js';
import { startGoalDriver, waitDriver } from '../helpers/DRV-fixture.js';
import { createPLAdviserLine } from '../helpers/PL-consumption-fixture.js';
import { usageOf } from '../helpers/S6A-host-fixture.js';
import { satisfyPLTask } from '../helpers/PL-workflow-fixture.js';
import { checkConfiguration, ready, sessionOf, setS7AAutonomy } from '../helpers/S7A-fixture.js';
import { OPERATOR, S6A_SCOPE, S6A_WORK_ROLE } from '../helpers/S6A-request-fixture.js';
import {
  adoptPLPlanDraft, openPLWorkflowWorld, plSingleStageDraft, type PLWorkflowWorld,
  requestHeads,
} from '../helpers/PL-workflow-fixture.js';

let opened: PLWorkflowWorld | null = null;
afterEach(async () => { await opened?.close(); opened = null; });

it('PL-15: a complete single-stage plan completes through the Goal driver with no refine', async () => {
  const workflow = opened = await openPLWorkflowWorld({ label: 'pl-15',
    extraHostOptions: { checks: checkConfiguration({ kind: 'human', id: OPERATOR.id }) } });
  // Written in full: A and B total 2_400 estimated lines (> 2_000), one gate,
  // no stage-2 placeholder and no later plan_only task.
  const plan = await adoptPLPlanDraft(workflow.main, workflow.goal,
    plSingleStageDraft(workflow.goal, { label: 'pl-15', taskIds: ['pl-a', 'pl-b'], estimatedLines: 1_200, goalGate: true }),
    'pl-15');
  expect(plan.stages).toHaveLength(1);
  expect(plan.tasks.some(task => task.executionIntent === 'plan_only')).toBe(false);
  await setS7AAutonomy(workflow.world, workflow.goal, 'after_plan_confirmation');
  // Both written Tasks run through their real claim/check rounds; the Goal driver
  // then opens the stage gate and completes the Goal.
  const line = await sessionOf(workflow.world, await createS6BLine(workflow.main, {
    label: 'pl-15-line', role: S6A_WORK_ROLE,
    tasks: ['pl-a', 'pl-b'].map(taskId => ({ projectId: workflow.goal.projectId,
      goalId: workflow.goal.goalId, taskId })),
  }));
  // A real adviser line: a refine sent without a plan_only placeholder would land here.
  const adviser = await createPLAdviserLine(workflow.world, 'pl-15-adviser');
  await satisfyPLTask(workflow.world, workflow.goal, 'pl-a', line, 'pl-15-a', { usage: usageOf(100) });
  await satisfyPLTask(workflow.world, workflow.goal, 'pl-b', line, 'pl-15-b', { usage: usageOf(100) });
  await startGoalDriver(workflow.world, workflow.goal, 'pl-15-goal');
  const snapshot = await waitDriver(workflow.world, workflow.goal, undefined,
    value => value.state === 'completed', 'PL-15: the Goal driver completes the Goal');
  const last = snapshot.last!;
  expect(last.status, JSON.stringify(last)).toBe('ready');
  if (last.status !== 'ready') return;
  expect(last.value.state).toBe('completed');

  // No wait caused by the missing skeleton, and no round on the real adviser line.
  expect(last.value.waitBasis?.reasons ?? []).not.toContain('plan_only');
  expect(last.value.next).toBeNull();
  expect((await requestHeads(workflow, line)).filter(text => text.startsWith(`refine:${workflow.goal.goalId}:`)))
    .toHaveLength(0);
  expect(await requestHeads(workflow, adviser)).toEqual([]);

  // The real tasks and the stage gate reduce, and the Goal completes.
  const graph = ready<{ completion?: { status: string; snapshot?: { phase: string } };
    tasks: Array<{ ref: { taskId: string }; effectivePhase: string }> }>(
    await workflow.main.route('tasks/query', { goalRef: workflow.goal }), 'tasks/query');
  for (const taskId of ['pl-a', 'pl-b', 'pl-gate-pl-stage-1']) {
    expect(graph.tasks.find(task => task.ref.taskId === taskId)?.effectivePhase).toBe('satisfied');
  }
  expect(graph.completion).toMatchObject({ status: 'recorded', snapshot: { phase: 'COMPLETED' } });

  // The 2_400-line stage is only a prompt: the stage-end notice says so, the Goal still completed.
  const main = ready<{ notices: Array<{ itemKey?: string; summary?: string }> }>(await workflow.world.post('main/read', {
    scope: { ...S6A_SCOPE }, input: { goalId: workflow.goal.goalId, cursor: null },
  }), 'main/read');
  const stageEnd = main.notices.find(notice =>
    notice.itemKey === `stage-end:${plan.planId}:${String(plan.planRevision)}:pl-stage-1`);
  expect(stageEnd?.summary).toContain('阶段线超线：预估 2400 行 > 2000');
});
