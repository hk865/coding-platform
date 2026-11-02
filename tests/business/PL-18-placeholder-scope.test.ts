/**
 * PL-18: (a) a deferred placeholder never triggers `refine:` and the Goal waits
 * with the existing `required_task_deferred:` reason; (b) a goal-level placeholder
 * with no `stageId` waits with `plan_only_task:<taskId>` and its request id names
 * the Task, never an empty stage (spec §5.1.4).
 *
 * On this tree both target-level passes stop at the documented closure seam
 * (`planCandidates is not wired`, workflow.ts:1581, DR-P4-06).
 */
import { afterEach, expect, it } from 'vitest';
import { checkConfiguration, ready } from '../helpers/S7A-fixture.js';
import { OPERATOR, S6A_SCOPE, S6A_WORK_ROLE } from '../helpers/S6A-request-fixture.js';
import { createS6BLine } from '../helpers/S6B1-fixture.js';
import { listed } from '../helpers/S7B-fixture.js';
import { awaitProposal, proposalRefOf, readBody } from '../helpers/IV-host-fixture.js';
import { sessionOf } from '../helpers/S7A-fixture.js';
import {
  adoptPLTwoStageSkeleton, settlePLGoal, openPLWorkflowWorld, plPlanChangeDraft, plSystemRoundRef, plToolPlanOf,
  satisfyPLTask, type PLSkeletonInput, type PLWorkflowWorld,
} from '../helpers/PL-workflow-fixture.js';
import { createPLAdviserLine } from '../helpers/PL-consumption-fixture.js';

let opened: PLWorkflowWorld | null = null;
afterEach(async () => { await opened?.close(); opened = null; });

type Cell = { readonly name: string; readonly skeleton: PLSkeletonInput;
  readonly waitReason: (goalId: string, revision: number) => string;
  readonly refineId: ((goalId: string, revision: number) => string) | null };

const cells: readonly Cell[] = [
  { name: 'deferred placeholder', skeleton: { placeholderDisposition: 'deferred' },
    waitReason: () => 'required_task_deferred:', refineId: null },
  { name: 'goal-level placeholder', skeleton: { omitStagePlaceholder: true,
    goalPlaceholderTaskId: 'pl-goal-placeholder' },
  waitReason: () => 'plan_only_task:pl-goal-placeholder',
  refineId: (goalId, revision) => `refine:${goalId}:pl-goal-placeholder:${revision}` },
];

it.each(cells)('PL-18: $name', async cell => {
  const workflow = opened = await openPLWorkflowWorld({ label: 'pl-18',
    extraHostOptions: { checks: checkConfiguration({ kind: 'human', id: OPERATOR.id }) } });
  const skeleton = await adoptPLTwoStageSkeleton(workflow.main, workflow.goal, {
    label: 'pl-18', stageOneTaskIds: ['pl-a'], ...cell.skeleton,
  });
  const line = await sessionOf(workflow.world, await createS6BLine(workflow.main, {
    label: 'pl-18-line', role: S6A_WORK_ROLE, tasks: skeleton.tasks.filter(task => task.taskId === 'pl-a'),
  }));
  await satisfyPLTask(workflow.world, workflow.goal, 'pl-a', line, 'pl18');
  const adviser = await createPLAdviserLine(workflow.world, 'pl-18-adviser');
  // The goal-level refinement answers for that one Task; the deferred cell must never reach the line.
  await workflow.world.scripted.script(adviser, cell.refineId === null
    ? [{ kind: 'text', text: 'PL-18 refinement round answer' }]
    : [{ kind: 'calls', calls: [{ callId: 'pl-18-refine', name: 'submit_plan_round', args: {
      answerKind: 'plan', summary: 'PL-18 the goal-level task', reason: { text: 'PL-18 the goal-level task',
        affectedTaskIds: ['pl-goal-placeholder'] },
      plan: plToolPlanOf(plPlanChangeDraft(skeleton.plan, workflow.goal, {
        planId: skeleton.plan.planId, obligations: skeleton.plan.obligations,
        tasks: skeleton.plan.tasks.map(task => task.taskId === 'pl-goal-placeholder'
          ? { ...task, executionIntent: 'request_execution' as const, estimatedLines: 10, sizeClass: 'small' as const }
          : task),
        assignments: [...(skeleton.plan.assignments ?? []), { taskId: 'pl-goal-placeholder',
          role: S6A_WORK_ROLE.templateId, instruction: 'PL-18 refined goal-level work' }],
      })),
    } }] }]);

  const body = await settlePLGoal(workflow.world, workflow.goal, 'pl-18-pass') as {
    status: string; value?: { state: string; reason: string | null; waitBasis?: { reasons: string[] } };
  };
  expect(body.status, JSON.stringify(body)).toBe('ready');
  expect(body.value?.state).toBe('waiting');
  const expected = cell.waitReason(workflow.goal.goalId, skeleton.plan.planRevision);
  const waits = [body.value?.reason ?? '', ...(body.value?.waitBasis?.reasons ?? [])];
  expect(waits.some(reason => reason.startsWith(expected)), JSON.stringify(waits)).toBe(true);

  const lineRounds = (await listed(workflow.world, 'inbox', adviser)).filter(message =>
    message.sender.kind === 'host' && message.sender.actor.kind === 'system');
  const lineTexts = await Promise.all(lineRounds.map(async message =>
    (await readBody(workflow.world, message.ref, 'message')).split('\n')[0] ?? ''));
  const refine = (text: string) => text.startsWith(`refine:${workflow.goal.goalId}:`);
  if (cell.refineId === null) {
    expect(lineTexts.filter(refine)).toHaveLength(0);
  } else {
    const requestId = cell.refineId(workflow.goal.goalId, skeleton.plan.planRevision);
    expect(lineTexts).toContain(requestId);
    expect(requestId).not.toContain(`refine:${workflow.goal.goalId}::`);

    // The round reaches that Task: the adviser's request names it and its candidate refines exactly it.
    const round = await plSystemRoundRef(workflow, adviser, requestId);
    expect(await readBody(workflow.world, round, 'message')).toContain('目标级占位任务 pl-goal-placeholder');
    const candidate = await awaitProposal(workflow.world, proposalRefOf(round, workflow.goal));
    expect(candidate.status, JSON.stringify(candidate)).toBe('ready');
    if (candidate.status !== 'ready') return;
    expect(candidate.value.draft.tasks.find(task => task.taskId === 'pl-goal-placeholder'))
      .toMatchObject({ executionIntent: 'request_execution', estimatedLines: 10 });
    expect(candidate.value.draft.assignments).toContainEqual(expect.objectContaining({
      taskId: 'pl-goal-placeholder', instruction: 'PL-18 refined goal-level work' }));
  }
});
