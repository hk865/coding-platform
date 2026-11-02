/**
 * PL-49: an already-refined Task A whose Run has ended and that is not yet
 * `satisfied` is replaced in the automatic band by a disposition-only change:
 * A keeps its execution definition and becomes `superseded` with
 * `replacedByTaskId: pl-a2`; A′ is added as another carrier of the same
 * obligation and starts a Run (spec §15 PL-49, DR-P4-19, §7.4, §6.4.3).
 *
 * The candidate is submitted through the real advisory form: the adviser's
 * planning Query calls `submit_plan_round` with the plan-level
 * `inputRequirements`, the replacement and the root
 * `reason.affectedTaskIds: ['A']`; then the reviewer's real Query passes, the
 * Goal loop adopts it automatically, and `main/read` carries the "请知悉"
 * notice with what changed and the declared impact list.
 * The omitted-`affectedTaskIds` refusal is the existing server-level guard
 * (`tests/work-graph/A2-disposition-change.test.ts:523`), not a second row here.
 */
import { afterEach, expect, it } from 'vitest';
import type { PlanProposal } from '../../src/core/work-graph/model/plan-contracts.js';
import type { RuntimeTask } from '../../src/contracts/plan.js';
import { deviationsOfGoal } from '../../src/contracts/plan-deviation.js';
import { advanceUntil, controlGoal, driveWorkflow, post, readExecution } from '../helpers/A2-restart-fixture.js';
import { graphWrite, plain } from '../helpers/AG2b-collaboration-fixture.js';
import { createS6BLine } from '../helpers/S6B1-fixture.js';
import { createPLAdviserLine } from '../helpers/PL-consumption-fixture.js';
import { deviationFactsOf } from '../helpers/PL-deviation-fixture.js';
import { awaitCandidate, readProposal, waitForResponse } from '../helpers/IV-host-fixture.js';
import { usage } from '../helpers/PL-readings-fixture.js';
import { checkConfiguration, ready, sessionOf, setS7AAutonomy } from '../helpers/S7A-fixture.js';
import { OPERATOR, S6A_SCOPE, S6A_WORK_ROLE } from '../helpers/S6A-request-fixture.js';
import {
  adoptPLTwoStageSkeleton, createPLReviewerLine, holdPLTaskRequest, openPLWorkflowWorld, plPlanChangeDraft,
  performOne, plSystemRoundRef, plToolPlanOf, PL_PROPOSE_FUTURE_TOOLS, satisfyPLTask, satisfyPLTaskWithPropose,
  type PLWorkflowWorld,
} from '../helpers/PL-workflow-fixture.js';

let opened: PLWorkflowWorld | null = null;
afterEach(async () => { await opened?.close(); opened = null; });

function replacementDraft(workflow: PLWorkflowWorld, skeleton: Awaited<ReturnType<typeof adoptPLTwoStageSkeleton>>,
  planId: string) {
  const a2: RuntimeTask = {
    taskId: 'pl-a2', stageId: 'pl-stage-1', title: 'PL-49 replacement A2', requirementLevel: 'required',
    taskKind: 'work', disposition: 'active', phase: 'pending',
    scope: { kind: 'stage', stageId: 'pl-stage-1' }, executionIntent: 'request_execution', sizeClass: 'small',
  };
  return plPlanChangeDraft(skeleton.plan, workflow.goal, {
    planId,
    tasks: [...skeleton.plan.tasks.map(task => task.taskId === 'pl-a'
      ? { ...task, disposition: 'superseded' as const, replacedByTaskId: 'pl-a2' } : task), a2],
    assignments: [...(skeleton.plan.assignments ?? []),
      { taskId: 'pl-a2', role: S6A_WORK_ROLE.templateId, instruction: 'PL-49 replacement A2 instruction' }],
    obligations: skeleton.plan.obligations.map(obligation => obligation.obligationId === 'pl-obligation-stage-1'
      ? { ...obligation, taskIds: [...obligation.taskIds, 'pl-a2'] } : obligation),
  });
}

it('PL-49: the loop adopts a disposition-only replacement and A2 starts its Run', async () => {
  const workflow = opened = await openPLWorkflowWorld({ label: 'pl-49',
    extraHostOptions: { checks: checkConfiguration({ kind: 'human', id: OPERATOR.id }) } });
  const skeleton = await adoptPLTwoStageSkeleton(workflow.main, workflow.goal, {
    label: 'pl-49', stageOneTaskIds: ['pl-a', 'pl-b'],
  });
  await setS7AAutonomy(workflow.world, workflow.goal, 'after_plan_confirmation');
  const line = await sessionOf(workflow.world, await createS6BLine(workflow.main, {
    label: 'pl-49-line', role: S6A_WORK_ROLE,
    tasks: [{ projectId: workflow.goal.projectId, goalId: workflow.goal.goalId, taskId: 'pl-a' }],
  }));
  // A's Run is entered; release it at `open_checks`, so the Run is ended and A has no reduction.
  const held = await holdPLTaskRequest(workflow.world, workflow.goal, 'pl-a', line, 'pl49',
    { stopBefore: 'open_checks' });
  try {
    expect(held.execution.run.status).toBe('running');
  } finally {
    await held.release();
  }
  expect((await readExecution(workflow.world.ag2b, held.run)).run.status).toBe('ended');
  const before = ready<{ tasks: Array<{ ref: { taskId: string }; effectivePhase: string }> }>(
    await workflow.main.route('tasks/query', { goalRef: workflow.goal }), 'tasks/query');
  expect(before.tasks.find(task => task.ref.taskId === 'pl-a')?.effectivePhase).not.toBe('satisfied');

  // The real advisory form carries the impact list and the plan-level inputRequirements.
  const requirement = {
    requirementId: 'pl-49-input-requirement', consumerTaskId: 'pl-a2', kind: 'artifact' as const,
    artifactRef: { kind: 'artifact' as const, contentType: 'text/plain', digest: 'a'.repeat(64), sizeBytes: 1,
      source: { kind: 'artifact' as const, refId: 'pl-49-source', revision: '1' } },
  };
  const draft = { ...replacementDraft(workflow, skeleton, 'pl-plan-pl-49-v2'),
    inputRequirements: [requirement] };
  const adviser = await createPLAdviserLine(workflow.world, 'pl-49-adviser');
  await workflow.world.scripted.script(adviser, [{ kind: 'calls', calls: [{
    callId: 'pl-49-plan-form', name: 'submit_plan_round', args: {
      answerKind: 'plan', summary: 'PL-49 supersede A with A2', plan: plToolPlanOf(draft),
      reason: { text: 'PL-49 supersede A with A2', affectedTaskIds: ['pl-a'] },
    } }] }]);
  // The Goal loop's one `refine:` to this real adviser line is served by the
  // Host, and the adviser's answer goes through the real `submit_plan_round`.
  await performOne(workflow, 'pl-49-refine', 'send_system_round');
  const refineRef = await plSystemRoundRef(workflow, adviser, `refine:${workflow.goal.goalId}:pl-stage-2:`);
  await waitForResponse(workflow.world, refineRef);
  const found = await awaitCandidate(workflow.world, refineRef, workflow.goal);
  const candidate = found.proposal;
  const read = await readProposal(workflow.world, candidate.ref);
  expect(read.reason.affectedTaskIds).toEqual(['pl-a']);
  expect(read.draft.inputRequirements).toEqual([requirement]);
  expect(read.draft.tasks.find(task => task.taskId === 'pl-a')?.replacedByTaskId).toBe('pl-a2');
  expect(read.draft.tasks.find(task => task.taskId === 'pl-a')?.disposition).toBe('superseded');

  // The reviewer's real Query passes; the Goal loop adopts automatically.
  const reviewer = await createPLReviewerLine(workflow.world, workflow.main, 'pl-49-reviewer');
  await workflow.world.scripted.script(reviewer,
    [{ kind: 'text', text: '{"schemaVersion":1,"kind":"plan_review","verdict":"pass","findings":[]}' }]);
  await driveWorkflow(workflow.world.ag2b, { schemaVersion: 1, goalRef: workflow.goal,
    flowId: 'pl-49-review', sessionHint: null, kind: 'select_work' });
  const reviewRef = await plSystemRoundRef(workflow, reviewer, `planreview:${candidate.ref.proposalId}:1`);
  await waitForResponse(workflow.world, reviewRef);
  await workflow.world.settleDetached();

  const select: import('../../src/business/workflow/contracts.js').WorkflowAdvanceInput = {
    schemaVersion: 1, goalRef: workflow.goal, flowId: 'pl-49-adopt', sessionHint: null, kind: 'select_work' };
  const adoptStep = await advanceUntil(workflow.world.ag2b, select, 'adopt_plan');
  const adoptResult = await post<import('../../src/business/workflow/contracts.js').WorkflowAdvanceResult>(
    workflow.world.ag2b, 'workflow/advance', plain(S6A_SCOPE, adoptStep));
  const adopted = adoptResult.status === 'ready' ? adoptResult.value.receipt : null;
  if (adopted === null || adopted.kind !== 'adopt_plan' || adopted.result.status !== 'committed') {
    throw new Error(`PL-49: the loop did not adopt the candidate: ${JSON.stringify(adoptResult)}`);
  }
  const v2 = await workflow.main.activePlan(workflow.goal);
  if (v2 === null) throw new Error('PL-49: v2 is not the active Plan');
  // The form's own plan identity (the round normalizes the draft's identity).
  expect(v2.ref.planId).toBe(read.draft.planId);
  expect(v2.planRevision).toBe(skeleton.plan.planRevision + 1);

  // A keeps the old definition; only disposition/replacement moved. A2 is new.
  const aOld = skeleton.plan.tasks.find(task => task.taskId === 'pl-a');
  const aRow = v2.tasks.find(task => task.taskId === 'pl-a');
  expect(aRow).toMatchObject({ disposition: 'superseded', replacedByTaskId: 'pl-a2', title: aOld?.title,
    scope: aOld?.scope, executionIntent: aOld?.executionIntent, taskKind: aOld?.taskKind });
  expect(v2.assignments?.find(assignment => assignment.taskId === 'pl-a'))
    .toEqual(skeleton.plan.assignments?.find(assignment => assignment.taskId === 'pl-a'));
  expect(v2.obligations.find(entry => entry.obligationId === 'pl-obligation-stage-1')?.taskIds)
    .toEqual(expect.arrayContaining(['pl-a', 'pl-a2']));
  expect(v2.tasks.some(task => task.taskId === 'pl-a2' && task.disposition === 'active')).toBe(true);

  // A2 starts through the same loop's real Run on v2.
  const a2Line = await sessionOf(workflow.world, await createS6BLine(workflow.main, {
    label: 'pl-49-a2-line', role: S6A_WORK_ROLE,
    tasks: [{ projectId: workflow.goal.projectId, goalId: workflow.goal.goalId, taskId: 'pl-a2' }],
  }));
  const a2Run = await satisfyPLTask(workflow.world, workflow.goal, 'pl-a2', a2Line, 'pl49a2');
  const a2Execution = await readExecution(workflow.world.ag2b, a2Run);
  expect(a2Execution.outbox.claim.planRef).toEqual(v2.ref);
  expect(a2Execution.plan.ref).toEqual(v2.ref);

  // The adoption notice says what changed and which Task the candidate declared.
  const main = ready<{ notices: Array<{ category?: string; summary?: string }> }>(
    await workflow.world.post('main/read', {
      scope: { ...S6A_SCOPE }, input: { goalId: workflow.goal.goalId, cursor: null },
    }), 'main/read');
  const adoption = main.notices.find(notice => notice.category === 'plan_adoption'
    && notice.summary?.includes('计划 v2'));
  expect(adoption?.summary).toContain('已采用');
  expect(adoption?.summary).toContain('审阅 pass');
  expect(adoption?.summary).toContain('影响 pl-a');
  expect(adoption?.summary).toContain('改 ');
  // Hand-computed from the replacement: A2 is added, A changes its disposition only.
  expect(adoption?.summary).toContain('改 2 个任务（pl-a2、pl-a）');

  // The automatic adoption does not hold a person back: their own plan change
  // is adopted on top of it, then `goals/control` still pauses the Goal.
  const personal = plPlanChangeDraft(v2, workflow.goal, {
    planId: 'pl-plan-pl-49-v3',
    tasks: v2.tasks.map(task => task.taskId === 'pl-b' ? { ...task, disposition: 'deferred' as const } : task),
    assignments: v2.assignments ?? [],
    obligations: v2.obligations,
  });
  const proposed = await workflow.main.post('plans/propose', graphWrite(S6A_SCOPE, {
    goalRef: workflow.goal, basedOn: v2.ref, draft: personal,
    reason: { text: 'PL-49 a person defers B', sources: [], affectedTaskIds: ['pl-b'] },
  }, 'pl-49-person-propose')) as { status: string; value?: { ref: unknown; revision: number } };
  expect(proposed.status, JSON.stringify(proposed)).toBe('committed');
  const applied = await workflow.main.post('plans/apply', graphWrite(S6A_SCOPE, {
    proposalRef: proposed.value?.ref, expectedProposalRevision: proposed.value?.revision, decisionRefs: [],
  }, 'pl-49-person-apply')) as { status: string };
  expect(applied.status, JSON.stringify(applied)).toBe('committed');
  expect((await workflow.main.activePlan(workflow.goal))?.planRevision).toBe(v2.planRevision + 1);

  const paused = await controlGoal(workflow.world.ag2b, 'pause', 'pl-49-pause');
  expect(paused.status, JSON.stringify(paused)).toBe('committed');
  const display = ready<{ display: { phase: string } }>(await workflow.world.post('goals/display', {
    scope: { ...S6A_SCOPE }, input: { goalRef: workflow.goal },
  }), 'goals/display');
  expect(display.display.phase).toBe('PAUSED');

  // PL-41: the notice does not say who adopted: the loop's and the person's have the same shape and no actor.
  const adoptions = ready<{ notices: Array<Record<string, unknown>> }>(await workflow.world.post('main/read', {
    scope: { ...S6A_SCOPE }, input: { goalId: workflow.goal.goalId, cursor: null },
  }), 'main/read').notices.filter(notice => notice['category'] === 'plan_adoption');
  const byLoop = adoptions.find(notice => String(notice['summary']).includes('计划 v2'));
  const byPerson = adoptions.find(notice => String(notice['summary']).includes('计划 v3'));
  expect(Object.keys(byPerson ?? {}).sort()).toEqual(Object.keys(byLoop ?? {}).sort());
  expect(String(byLoop?.['summary']).startsWith('已采用 · 计划 v2')).toBe(true);
  expect(String(byPerson?.['summary']).startsWith('已采用 · 计划 v3')).toBe(true);
  for (const notice of [byLoop, byPerson]) expect(JSON.stringify(notice)).not.toContain(OPERATOR.id);
  // Both sit at their own adoption commit.
  expect(byLoop?.['position']).toMatchObject({ kind: 'commit', cursor: adopted.result.cursor });
  expect(byPerson?.['position']).toMatchObject({ kind: 'commit', cursor: (applied as { cursor?: string }).cursor });
});

it('PL-49: a waiting candidate does not starve a budget deviation behind an unsent placeholder refine', async () => {
  const workflow = opened = await openPLWorkflowWorld({ label: 'pl-49-starve',
    extraBindings: [PL_PROPOSE_FUTURE_TOOLS],
    extraHostOptions: { checks: checkConfiguration({ kind: 'human', id: OPERATOR.id }) } });
  const skeleton = await adoptPLTwoStageSkeleton(workflow.main, workflow.goal, {
    label: 'pl-49-starve', stageOneTaskIds: ['pl-a', 'pl-b'],
  });
  await setS7AAutonomy(workflow.world, workflow.goal, 'after_plan_confirmation');
  const line = await sessionOf(workflow.world, await createS6BLine(workflow.main, {
    label: 'pl-49-starve-line', role: S6A_WORK_ROLE,
    tasks: skeleton.tasks.filter(task => task.taskId === 'pl-a' || task.taskId === 'pl-b'),
  }));
  const adviser = await createPLAdviserLine(workflow.world, 'pl-49-starve-adviser');
  const reviewer = await createPLReviewerLine(workflow.world, workflow.main, 'pl-49-starve-reviewer');
  await workflow.world.scripted.script(adviser, [{ kind: 'text', text: 'PL-49 starvation adviser idle' }]);
  const placeholder = skeleton.plan.tasks.find(task => task.taskId === 'pl-placeholder-pl-stage-2');
  if (placeholder === undefined) throw new Error('PL-49 starvation: the stage-2 placeholder is missing');
  // A's Work Run proposes the future revision through the real tool; the current
  // plan keeps the stage-2 placeholder, whose refine round is still unsent.
  const future = plPlanChangeDraft(skeleton.plan, workflow.goal, {
    planId: 'pl-plan-pl-49-starve-future',
    tasks: skeleton.plan.tasks.map(task => task.taskId === placeholder.taskId
      ? { ...task, executionIntent: 'request_execution' as const, estimatedLines: 20, sizeClass: 'small' as const }
      : task),
    assignments: [...(skeleton.plan.assignments ?? []), { taskId: placeholder.taskId,
      role: S6A_WORK_ROLE.templateId, instruction: 'PL-49 starvation stage 2' }],
    obligations: skeleton.plan.obligations,
  });
  await satisfyPLTaskWithPropose(workflow.world, workflow.goal, 'pl-a', line, 'pl49starve', {
    basedOn: skeleton.plan.ref, draft: future, reasonText: 'PL-49 starvation future revision',
  });
  // The loop sends the one `planreview:` and leaves it unanswered, so the
  // candidate wait carries `inFlight` and suppresses the placeholder refine.
  const reviewSend = await performOne(workflow, 'pl-49-starve-review', 'send_system_round');
  expect(reviewSend).toMatchObject({ status: 'ready', value: { receipt: { kind: 'send_system_round',
    result: { status: 'committed' } } } });
  // B's real Run exhausts its budget: the hard budget fact the deviation needs.
  expect(await workflow.world.settings('run-budget/save', { workRunTokenBudget: 100_000 }))
    .toMatchObject({ status: 'ready' });
  await workflow.world.scripted.script(line, [{ kind: 'text', text: 'PL-49 starvation b', usage: usage(150_000, 0) }]);
  const held = await holdPLTaskRequest(workflow.world, workflow.goal, 'pl-b', line, 'pl49starve',
    { stopBefore: 'open_checks' });
  await held.release();
  expect((await readExecution(workflow.world.ag2b, held.run)).run.outcome).toBe('budget_exhausted');
  const facts = await deviationFactsOf({ world: workflow.world }).read(workflow.main.humanContext(), workflow.goal);
  expect(deviationsOfGoal(facts)).toContainEqual(expect.objectContaining({
    kind: 'budget', taskRef: expect.objectContaining({ taskId: 'pl-b' }),
  }));
  // The next Goal pass has a waiting candidate, an unsent placeholder refine and
  // no covered Gate: the deviation round must still be the selected send.
  const steps = await driveWorkflow(workflow.world.ag2b, { schemaVersion: 1, goalRef: workflow.goal,
    flowId: 'pl-49-starve-select', sessionHint: null, kind: 'select_work' });
  const deviationSend = steps.find(step => {
    const next = step.next;
    return next !== null && next.kind === 'perform' && next.operation.kind === 'send_system_round'
      && next.operation.request.round.kind === 'deviation';
  });
  expect(deviationSend, JSON.stringify(steps.at(-1))).toBeDefined();
  expect(deviationSend?.waitBasis?.reasons).toEqual(expect.arrayContaining(['plan_review_pending']));
  const sent = steps.find(step => {
    const receipt = step.receipt;
    return receipt !== null && receipt.kind === 'send_system_round' && receipt.result.status === 'committed';
  });
  expect(sent, JSON.stringify(steps.at(-1))).toBeDefined();
});
