/**
 * PL-50: a person pauses one Task three ways (spec §15 PL-50, DR-P4-13).
 * (a) A's Run is running: `controls/submit` records the pause intent and
 * `controls/read` carries it while B still runs. (b) A's Run has ended and the
 * next has not started: a plan v2 sets A `deferred`, the Task graph reads it,
 * B continues, and restoring A lets its next Run connect. (c) A is the sole
 * required carrier of an obligation: the same deferral is refused by the
 * existing carrier check with `invalid`, the active Plan stays v1, and
 * `goals/control` still pauses the whole Goal.
 *
 * The named mutation is deleting the required-carrier check in
 * `plan-validation.ts`; that file is not P4's and the mutation is not runnable
 * here. This row is its regression acceptance.
 */
import { afterEach, expect, it } from 'vitest';
import type { PlanRevisionDraft } from '../../src/contracts/plan.js';
import { advanceUntil, controlGoal, driveWorkflow, readControl, readExecution, submitControl } from '../helpers/A2-restart-fixture.js';
import { graphWrite } from '../helpers/AG2b-collaboration-fixture.js';
import { createS6BLine } from '../helpers/S6B1-fixture.js';
import { checkConfiguration, claimedRunOf, ready, sessionOf } from '../helpers/S7A-fixture.js';
import { OPERATOR, S6A_SCOPE, S6A_WORK_ROLE } from '../helpers/S6A-request-fixture.js';
import {
  adoptPLPlanDraft, adoptPLTwoStageSkeleton, advancePLGoal, holdPLTaskRequest, openPLWorkflowWorld,
  plPlanChangeDraft, plSingleStageDraft, satisfyPLTask, type PLWorkflowWorld,
} from '../helpers/PL-workflow-fixture.js';

let opened: PLWorkflowWorld | null = null;
afterEach(async () => { await opened?.close().catch(() => undefined); opened = null; });

async function applyChange(workflow: PLWorkflowWorld, draft: PlanRevisionDraft, label: string,
  basedOn: unknown, affectedTaskIds: string[]): Promise<{ status: string; value?: { ref: unknown; revision: number } }> {
  const proposed = (await workflow.main.post('plans/propose', graphWrite(S6A_SCOPE, {
    goalRef: workflow.goal, basedOn, draft,
    reason: { text: `PL-50 ${label}`, sources: [], affectedTaskIds },
  }, `pl-50-${label}-propose`))) as { status: string; value?: { ref: unknown; revision: number } };
  expect(proposed.status, JSON.stringify(proposed)).toBe('committed');
  if (proposed.value === undefined) throw new Error(`PL-50: the ${label} candidate was not written`);
  return await workflow.main.post('plans/apply', graphWrite(S6A_SCOPE, {
    proposalRef: proposed.value.ref, expectedProposalRevision: proposed.value.revision, decisionRefs: [],
  }, `pl-50-${label}-apply`)) as { status: string; value?: { ref: unknown; revision: number } };
}

it('PL-50: pause a running Run; defer an ended Run; the sole required carrier is refused', async () => {
  // (a) A's Run is running, its model request held: pause is accepted for A only.
  const workflow = opened = await openPLWorkflowWorld({ label: 'pl-50a',
    extraHostOptions: { checks: checkConfiguration({ kind: 'human', id: OPERATOR.id }) } });
  const skeleton = await adoptPLTwoStageSkeleton(workflow.main, workflow.goal, {
    label: 'pl-50a', stageOneTaskIds: ['pl-a', 'pl-b'],
  });
  const lineA = await sessionOf(workflow.world, await createS6BLine(workflow.main, {
    label: 'pl-50a-a', role: S6A_WORK_ROLE,
    tasks: [{ projectId: workflow.goal.projectId, goalId: workflow.goal.goalId, taskId: 'pl-a' }],
  }));
  const lineB = await sessionOf(workflow.world, await createS6BLine(workflow.main, {
    label: 'pl-50a-b', role: S6A_WORK_ROLE,
    tasks: [{ projectId: workflow.goal.projectId, goalId: workflow.goal.goalId, taskId: 'pl-b' }],
  }));
  // A's model answers with one tool group: the pause lands at the safe point after it.
  await workflow.world.scripted.script(lineA, [
    { kind: 'calls', calls: [{ callId: 'pl-50-read', name: 'read', args: { path: 'src/module.ts' } }] },
    { kind: 'text', text: 'PL-50 never sent' },
  ]);
  const held = await holdPLTaskRequest(workflow.world, workflow.goal, 'pl-a', lineA, 'pl50a');
  let pauseRef: Awaited<ReturnType<typeof submitControl>>['intent']['ref'] | undefined;
  try {
    const submitted = await submitControl(workflow.world.ag2b, held.run, 'pause',
      'PL-50 pause the running A', 'pl-50-a-pause');
    pauseRef = submitted.intent.ref;
    expect(submitted.intent).toMatchObject({ kind: 'pause', desiredState: 'paused', runRef: held.run,
      reason: 'PL-50 pause the running A' });
    const intent = await readControl(workflow.world.ag2b, submitted.intent.ref);
    expect(intent).toMatchObject({ kind: 'pause', desiredState: 'paused', runRef: held.run, revision: 1 });
    expect(intent.status).toBe('queued');
    const paused = await readExecution(workflow.world.ag2b, held.run);
    expect(paused.run.status).toBe('running');
    expect(paused.run.controlState).toEqual({ intentRef: submitted.intent.ref, desiredState: 'paused' });

    // B continues on its own line while A is paused.
    await satisfyPLTask(workflow.world, workflow.goal, 'pl-b', lineB, 'pl50a-b');
    const graph = ready<{ tasks: Array<{ ref: { taskId: string }; effectivePhase: string }> }>(
      await workflow.main.route('tasks/query', { goalRef: workflow.goal }), 'tasks/query');
    expect(graph.tasks.find(task => task.ref.taskId === 'pl-b')?.effectivePhase).toBe('satisfied');
  } finally {
    await held.release();
  }
  // The pause is applied, and A's Run makes no second model request.
  if (pauseRef === undefined) throw new Error('PL-50: the pause was not submitted');
  expect(await readControl(workflow.world.ag2b, pauseRef))
    .toMatchObject({ kind: 'pause', status: 'applied', revision: 2, observation: { kind: 'paused' } });
  expect((await readExecution(workflow.world.ag2b, held.run)).run)
    .toMatchObject({ status: 'running', controlState: { intentRef: pauseRef, desiredState: 'paused' } });
  expect(await workflow.world.scripted.requests(lineA)).toHaveLength(1);
  expect(await workflow.world.scripted.pending(lineA)).toBe(1);
  await workflow.close();
  opened = null;

  // (b) A's Run has ended and no next Run has started: its real model round
  // fails (the existing `S6AReply` step), the loop produces the requeue, then v2
  // defers A, B continues, v3 restores A and the requeued successor Run connects.
  const bWorld = opened = await openPLWorkflowWorld({ label: 'pl-50b',
    extraHostOptions: { checks: checkConfiguration({ kind: 'human', id: OPERATOR.id }) } });
  const bSkeleton = await adoptPLTwoStageSkeleton(bWorld.main, bWorld.goal, {
    label: 'pl-50b', stageOneTaskIds: ['pl-a', 'pl-b'],
  });
  const bLine = await sessionOf(bWorld.world, await createS6BLine(bWorld.main, {
    label: 'pl-50b-line', role: S6A_WORK_ROLE, tasks: bSkeleton.tasks.filter(task =>
      ['pl-a', 'pl-b'].includes(task.taskId)),
  }));
  // A's first round ends with the real provider failure, which produces the
  // automatic requeue; the next Run is not started yet. B and the recovered
  // successors keep their successful replies.
  await bWorld.world.scripted.script(bLine, [{ kind: 'fail', message: 'PL-50: the provider fails A first round' }]);
  const firstReceipts: import('../../src/business/workflow/contracts.js').WorkflowStepReceipt[] = [];
  const firstClaim = await advanceUntil(bWorld.world.ag2b, { schemaVersion: 1, goalRef: bWorld.goal,
    flowId: 'pl-50b-run-a', sessionHint: bLine.ref, kind: 'select_work', taskId: 'pl-a' }, 'claim_task');
  await driveWorkflow(bWorld.world.ag2b, firstClaim, { stopBefore: 'claim_task', receipts: firstReceipts });
  const endedRun = claimedRunOf(firstReceipts, 'pl-a').run;
  expect((await readExecution(bWorld.world.ag2b, endedRun)).run.status).toBe('ended');
  const before = ready<{ tasks: Array<{ ref: { taskId: string }; effectivePhase: string;
    requeueRef?: unknown; execution: unknown }> }>(
    await bWorld.main.route('tasks/query', { goalRef: bWorld.goal }), 'tasks/query');
  const aBefore = before.tasks.find(task => task.ref.taskId === 'pl-a');
  expect(aBefore?.effectivePhase).toBe('pending');
  expect(aBefore?.requeueRef).toBeDefined();
  expect(aBefore?.execution).toEqual(endedRun);

  const deferDraft = plPlanChangeDraft(bSkeleton.plan, bWorld.goal, {
    planId: 'pl-plan-pl-50b-defer',
    tasks: bSkeleton.plan.tasks.map(task => task.taskId === 'pl-a' ? { ...task, disposition: 'deferred' } : task),
    assignments: bSkeleton.plan.assignments ?? [],
    obligations: bSkeleton.plan.obligations,
  });
  const deferred = await applyChange(bWorld, deferDraft, 'b-defer', bSkeleton.plan.ref, ['pl-a']);
  expect(deferred.status, JSON.stringify(deferred)).toBe('committed');
  const deferredGraph = ready<{ tasks: Array<{ ref: { taskId: string }; disposition: string; effectivePhase: string }> }>(
    await bWorld.main.route('tasks/query', { goalRef: bWorld.goal }), 'tasks/query');
  expect(deferredGraph.tasks.find(task => task.ref.taskId === 'pl-a')?.disposition).toBe('deferred');

  // B continues on its own line while A is deferred; the Host finishes its check round.
  await satisfyPLTask(bWorld.world, bWorld.goal, 'pl-b', bLine, 'pl50b-b');
  await bWorld.world.settleDetached();
  await driveWorkflow(bWorld.world.ag2b, { schemaVersion: 1, goalRef: bWorld.goal,
    flowId: 'pl-50b-b-finish', sessionHint: bLine.ref, kind: 'select_work', taskId: 'pl-b' });
  await bWorld.world.settleDetached();
  const answeredGraph = ready<{ tasks: Array<{ ref: { taskId: string }; effectivePhase: string }> }>(
    await bWorld.main.route('tasks/query', { goalRef: bWorld.goal }), 'tasks/query');
  expect(answeredGraph.tasks.find(task => task.ref.taskId === 'pl-b')?.effectivePhase).toBe('satisfied');

  const v2 = await bWorld.main.activePlan(bWorld.goal);
  if (v2 === null) throw new Error('PL-50: the deferred Plan is not active');
  const restoreDraft = plPlanChangeDraft(v2, bWorld.goal, {
    planId: 'pl-plan-pl-50b-restore',
    tasks: v2.tasks.map(task => task.taskId === 'pl-a' ? { ...task, disposition: 'active' } : task),
    assignments: v2.assignments ?? [],
    obligations: v2.obligations,
  });
  const restored = await applyChange(bWorld, restoreDraft, 'b-restore', v2.ref, ['pl-a']);
  expect(restored.status, JSON.stringify(restored)).toBe('committed');
  const restoredGraph = ready<{ tasks: Array<{ ref: { taskId: string }; disposition: string; effectivePhase: string;
    requeueRef?: unknown; execution: unknown }> }>(
    await bWorld.main.route('tasks/query', { goalRef: bWorld.goal }), 'tasks/query');
  const aRow = restoredGraph.tasks.find(task => task.ref.taskId === 'pl-a');
  expect(aRow?.disposition).toBe('active');
  expect(aRow?.effectivePhase).toBe('pending');
  expect(aRow?.requeueRef).toBeDefined();
  expect(aRow?.execution).toEqual(endedRun);

  // The public Workflow now claims A's requeued successor Run under the restored Plan.
  const v3 = await bWorld.main.activePlan(bWorld.goal);
  if (v3 === null) throw new Error('PL-50: the restored Plan is not active');
  await bWorld.world.scripted.script(bLine, [{ kind: 'text', text: 'PL-50 A resumed' }]);
  const successorReceipts: import('../../src/business/workflow/contracts.js').WorkflowStepReceipt[] = [];
  await driveWorkflow(bWorld.world.ag2b, { schemaVersion: 1, goalRef: bWorld.goal,
    flowId: 'pl-50b-continue-a', sessionHint: bLine.ref, kind: 'select_work', taskId: 'pl-a' },
  { stopBefore: 'open_checks', receipts: successorReceipts });
  const successor = claimedRunOf(successorReceipts, 'pl-a').run;
  expect(successor.runId).not.toBe(endedRun.runId);
  const successorExecution = await readExecution(bWorld.world.ag2b, successor);
  expect(successorExecution.outbox.claim.planRef).toEqual(v3.ref);
  expect(successorExecution.plan.ref).toEqual(v3.ref);
  await bWorld.close();
  opened = null;

  // (c) A is the sole required carrier: deferring it is refused; the Goal still pauses.
  opened = await openPLWorkflowWorld({ label: 'pl-50c',
    extraHostOptions: { checks: checkConfiguration({ kind: 'human', id: OPERATOR.id }) } });
  const cWorld = opened;
  const single = plSingleStageDraft(cWorld.goal, { label: 'pl-50c', taskIds: ['pl-a', 'pl-b'],
    carrierTaskIds: ['pl-a'] });
  const adopted = await adoptPLPlanDraft(cWorld.main, cWorld.goal, single, 'pl-50c');
  const refuseDraft = plPlanChangeDraft(adopted, cWorld.goal, {
    planId: 'pl-plan-pl-50c-defer',
    tasks: adopted.tasks.map(task => task.taskId === 'pl-a' ? { ...task, disposition: 'deferred' } : task),
    assignments: adopted.assignments ?? [],
    obligations: adopted.obligations,
  });
  const refused = await applyChange(cWorld, refuseDraft, 'c-defer', adopted.ref, ['pl-a']);
  expect(refused.status, JSON.stringify(refused)).toBe('rejected');
  expect((refused as { code?: string }).code).toBe('invalid');
  expect((refused as { reason?: string }).reason ?? '').toContain('no longer has a valid active required carrier');
  const unchanged = ready<{ goal: { activePlanRevision: { planId: string } | null } }>(
    await cWorld.world.post('goals/read', { scope: { ...S6A_SCOPE }, input: cWorld.goal }), 'goals/read');
  expect(unchanged.goal.activePlanRevision).toEqual(adopted.ref);
  const beforePause = ready<{ tasks: Array<Record<string, unknown>> }>(
    await cWorld.main.route('tasks/query', { goalRef: cWorld.goal }), 'tasks/query');
  expect(beforePause.tasks).toHaveLength(adopted.tasks.length);
  const pausedGoal = await controlGoal(cWorld.world.ag2b, 'pause', 'pl-50-c-goal-pause');
  expect(pausedGoal.status, JSON.stringify(pausedGoal)).toBe('committed');
  const display = ready<{ display: { phase: string } }>(await cWorld.world.post('goals/display', {
    scope: { ...S6A_SCOPE }, input: { goalRef: cWorld.goal },
  }), 'goals/display');
  expect(display.display.phase).toBe('PAUSED');

  await cWorld.close();
  opened = null;
});
