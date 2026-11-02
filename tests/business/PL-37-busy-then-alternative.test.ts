/**
 * PL-37: changing the Plan while A's Run is `entered` is `busy`; the candidate
 * stays a candidate and the active Plan does not move (spec §15 PL-37,
 * DR-P4-19). The candidate is disposition-only: A becomes `superseded` with
 * `replacedByTaskId: pl-a2`, A stays in the same obligation as a carrier, and
 * its assignment/execution definition is untouched. Once the real Run ends and
 * the Task is not yet `satisfied` (the model gate is released and the driver
 * stops before `open_checks`), the same `plans/apply` commits, the active
 * Plan advances one revision, A keeps its old definition with only the
 * disposition/replacement changed, and A′ is a new Task whose Run claims v2.
 *
 * The first attempt is the real Goal loop's own `adopt_plan`: the reviewer's
 * real Query passes, the loop adopts while A's Run is held, and the P4 busy arm
 * keeps the candidate (`plan_adoption_busy`). After the Run ends the same loop
 * retries by itself and commits; there is no second manual `plans/apply`. The
 * named mutation ("make applyPlanChange ignore a running Run") is caught by the
 * first busy wait.
 */
import { afterEach, expect, it } from 'vitest';
import type { PlanProposal } from '../../src/core/work-graph/model/plan-contracts.js';
import { advanceUntil, driveWorkflow, post, readExecution } from '../helpers/A2-restart-fixture.js';
import { graphWrite, plain } from '../helpers/AG2b-collaboration-fixture.js';
import { createS6BLine } from '../helpers/S6B1-fixture.js';
import { heartbeatUntilModel, readProposal } from '../helpers/IV-host-fixture.js';
import { checkConfiguration, ready, sessionOf, setS7AAutonomy } from '../helpers/S7A-fixture.js';
import { OPERATOR, S6A_SCOPE, S6A_WORK_ROLE } from '../helpers/S6A-request-fixture.js';
import {
  adoptPLTwoStageSkeleton, createPLReviewerLine, holdPLTaskRequest, openPLWorkflowWorld, plPlanChangeDraft,
  plSupersedeDraft, plSystemRoundRef, satisfyPLTask, verdictOf, type PLWorkflowWorld,
} from '../helpers/PL-workflow-fixture.js';

let opened: PLWorkflowWorld | null = null;
afterEach(async () => { await opened?.close(); opened = null; });

it('PL-37: a running A makes the loop busy; after the Run ends the loop retries and commits', async () => {
  const workflow = opened = await openPLWorkflowWorld({ label: 'pl-37',
    extraHostOptions: { checks: checkConfiguration({ kind: 'human', id: OPERATOR.id }) } });
  const skeleton = await adoptPLTwoStageSkeleton(workflow.main, workflow.goal, {
    label: 'pl-37', stageOneTaskIds: ['pl-a', 'pl-b'],
  });
  await setS7AAutonomy(workflow.world, workflow.goal, 'after_plan_confirmation');
  const line = await sessionOf(workflow.world, await createS6BLine(workflow.main, {
    label: 'pl-37-line', role: S6A_WORK_ROLE, tasks: skeleton.tasks.filter(task =>
      ['pl-a', 'pl-b'].includes(task.taskId)),
  }));
  // B is finished first so the post-adoption pass reaches A′.
  await satisfyPLTask(workflow.world, workflow.goal, 'pl-b', line, 'pl37-b');
  // A's Run is entered and its model request held; the driver stops before
  // `open_checks`, so releasing it leaves the Run ended and no reduction.
  const held = await holdPLTaskRequest(workflow.world, workflow.goal, 'pl-a', line, 'pl37',
    { stopBefore: 'open_checks' });
  let candidate: PlanProposal | undefined;
  try {
    expect(held.execution.run.status).toBe('running');

    // Disposition-only: A superseded -> A′, the same obligation keeps A and adds A′.
    const proposed = (await workflow.main.post('plans/propose', graphWrite(S6A_SCOPE, {
      goalRef: workflow.goal, basedOn: skeleton.plan.ref, draft: plSupersedeDraft(skeleton.plan, workflow.goal, 'pl-37'),
      reason: { text: 'PL-37 supersede A with A2', sources: [], affectedTaskIds: ['pl-a'] },
    }, 'pl-37-propose'))) as { status: string; value?: PlanProposal };
    expect(proposed.status, JSON.stringify(proposed)).toBe('committed');
    candidate = proposed.value;
    if (candidate === undefined) throw new Error('PL-37: the replacement candidate was not written');

    // The reviewer's real Query passes; the Goal loop then adopts the candidate.
    const reviewer = await createPLReviewerLine(workflow.world, workflow.main, 'pl-37-reviewer');
    await workflow.world.scripted.script(reviewer,
      [{ kind: 'text', text: '{"schemaVersion":1,"kind":"plan_review","verdict":"pass","findings":[]}' }]);
    const reviewGate = await workflow.world.gates.modelRequest(reviewer);
    await driveWorkflow(workflow.world.ag2b, { schemaVersion: 1, goalRef: workflow.goal,
      flowId: 'pl-37-review', sessionHint: null, kind: 'select_work' });
    await heartbeatUntilModel(workflow.world, reviewGate);
    reviewGate.release();
    const review = await plSystemRoundRef(workflow, reviewer, `planreview:${candidate.ref.proposalId}:1`);
    expect(await verdictOf(workflow, review)).toBe('pass');

    // First adoption attempt while A runs: the real loop's adopt returns busy;
    // the P4 arm keeps the candidate and v1.
    const select: import('../../src/business/workflow/contracts.js').WorkflowAdvanceInput = {
      schemaVersion: 1, goalRef: workflow.goal, flowId: 'pl-37-adopt-busy', sessionHint: null,
      kind: 'select_work' };
    const busyStep = await advanceUntil(workflow.world.ag2b, select, 'adopt_plan');
    const busyValue = await post<import('../../src/business/workflow/contracts.js').WorkflowAdvanceResult>(
      workflow.world.ag2b, 'workflow/advance', plain(S6A_SCOPE, busyStep));
    expect(busyValue.status, JSON.stringify(busyValue)).toBe('ready');
    expect(busyValue.status === 'ready' ? busyValue.value.waitBasis?.reasons ?? [] : [])
      .toContain('plan_adoption_busy');
    const stillV1 = await workflow.main.activePlan(workflow.goal);
    expect(stillV1?.ref).toEqual(skeleton.plan.ref);
    expect((await readProposal(workflow.world, candidate.ref)).status).toBe('candidate');
  } finally {
    await held.release();
  }

  // The Run has ended; the Task is not satisfied, so the same loop's retry commits.
  const ended = await readExecution(workflow.world.ag2b, held.run);
  expect(ended.run.status).toBe('ended');
  const before = ready<{ tasks: Array<{ ref: { taskId: string }; effectivePhase: string; execution: unknown }> }>(
    await workflow.main.route('tasks/query', { goalRef: workflow.goal }), 'tasks/query');
  const aBefore = before.tasks.find(task => task.ref.taskId === 'pl-a');
  expect(aBefore?.effectivePhase).not.toBe('satisfied');
  expect(aBefore?.execution).not.toBeNull();

  const retrySelect: import('../../src/business/workflow/contracts.js').WorkflowAdvanceInput = {
    schemaVersion: 1, goalRef: workflow.goal, flowId: 'pl-37-adopt-retry', sessionHint: null, kind: 'select_work' };
  const adoptStep = await advanceUntil(workflow.world.ag2b, retrySelect, 'adopt_plan');
  const adoptResult = await post<import('../../src/business/workflow/contracts.js').WorkflowAdvanceResult>(
    workflow.world.ag2b, 'workflow/advance', plain(S6A_SCOPE, adoptStep));
  const adopted = adoptResult.status === 'ready' ? adoptResult.value.receipt : null;
  if (adopted === null || adopted.kind !== 'adopt_plan' || adopted.result.status !== 'committed') {
    throw new Error(`PL-37: the loop did not adopt after the Run ended: ${JSON.stringify(adoptResult)}`);
  }
  const v2 = await workflow.main.activePlan(workflow.goal);
  if (v2 === null) throw new Error('PL-37: v2 is not the active Plan');
  expect(v2.ref.planId).toBe('pl-plan-pl-37-v2');
  expect(v2.planRevision).toBe(skeleton.plan.planRevision + 1);
  expect((await readProposal(workflow.world, candidate.ref)).status).toBe('accepted');

  // A keeps its old execution definition; only disposition/replacement changed.
  const aRow = v2.tasks.find(task => task.taskId === 'pl-a');
  const aOld = skeleton.plan.tasks.find(task => task.taskId === 'pl-a');
  expect(aRow).toMatchObject({ disposition: 'superseded', replacedByTaskId: 'pl-a2' });
  expect(aRow).toMatchObject({
    title: aOld?.title, requirementLevel: aOld?.requirementLevel, taskKind: aOld?.taskKind,
    scope: aOld?.scope, executionIntent: aOld?.executionIntent,
  });
  expect(v2.assignments?.find(assignment => assignment.taskId === 'pl-a'))
    .toEqual(skeleton.plan.assignments?.find(assignment => assignment.taskId === 'pl-a'));
  const obligation = v2.obligations.find(entry => entry.obligationId === 'pl-obligation-stage-1');
  expect(obligation?.taskIds).toEqual(expect.arrayContaining(['pl-a', 'pl-a2']));

  // A′ is a new Task and the same loop's Run claims v2.
  const a2Row = v2.tasks.find(task => task.taskId === 'pl-a2');
  expect(a2Row).toMatchObject({ disposition: 'active', executionIntent: 'request_execution' });
  expect(v2.assignments?.some(assignment => assignment.taskId === 'pl-a2')).toBe(true);
  const a2Line = await sessionOf(workflow.world, await createS6BLine(workflow.main, {
    label: 'pl-37-a2-line', role: S6A_WORK_ROLE,
    tasks: [{ projectId: workflow.goal.projectId, goalId: workflow.goal.goalId, taskId: 'pl-a2' }],
  }));
  const a2Run = await satisfyPLTask(workflow.world, workflow.goal, 'pl-a2', a2Line, 'pl37a2');
  const a2Execution = await readExecution(workflow.world.ag2b, a2Run);
  expect(a2Execution.outbox.claim.planRef).toEqual(v2.ref);
  expect(a2Execution.plan.ref).toEqual(v2.ref);
});

it('PL-37: changing A\'s definition is no busy to outlast: the trace guard refuses it running and after the Run ends', async () => {
  const workflow = opened = await openPLWorkflowWorld({ label: 'pl-37-definition',
    extraHostOptions: { checks: checkConfiguration({ kind: 'human', id: OPERATOR.id }) } });
  const skeleton = await adoptPLTwoStageSkeleton(workflow.main, workflow.goal, {
    label: 'pl-37-definition', stageOneTaskIds: ['pl-a', 'pl-b'],
  });
  const line = await sessionOf(workflow.world, await createS6BLine(workflow.main, {
    label: 'pl-37-definition-line', role: S6A_WORK_ROLE, tasks: skeleton.tasks.filter(task => task.taskId === 'pl-a'),
  }));
  const held = await holdPLTaskRequest(workflow.world, workflow.goal, 'pl-a', line, 'pl37d',
    { stopBefore: 'open_checks' });
  const draft = plPlanChangeDraft(skeleton.plan, workflow.goal, {
    planId: 'pl-plan-pl-37-definition-v2',
    tasks: skeleton.plan.tasks,
    assignments: (skeleton.plan.assignments ?? []).map(assignment => assignment.taskId === 'pl-a'
      ? { ...assignment, instruction: 'PL-37 changed A instruction' } : assignment),
    obligations: skeleton.plan.obligations,
  });
  const proposed = (await workflow.main.post('plans/propose', graphWrite(S6A_SCOPE, {
    goalRef: workflow.goal, basedOn: skeleton.plan.ref, draft,
    reason: { text: 'PL-37 changes the running A', sources: [], affectedTaskIds: ['pl-a'] },
  }, 'pl-37-definition-propose'))) as { status: string; value?: PlanProposal };
  expect(proposed.status, JSON.stringify(proposed)).toBe('committed');
  const candidate = proposed.value;
  if (candidate === undefined) throw new Error('PL-37: the definition candidate was not written');
  const apply = async (requestId: string) => await workflow.main.post('plans/apply', graphWrite(S6A_SCOPE, {
    proposalRef: candidate.ref, expectedProposalRevision: candidate.revision, decisionRefs: [],
  }, requestId)) as { status: string; code?: string; reason?: string };

  let running: Awaited<ReturnType<typeof apply>>;
  try {
    running = await apply('pl-37-definition-apply-running');
  } finally {
    await held.release();
  }
  expect((await readExecution(workflow.world.ag2b, held.run)).run.status).toBe('ended');
  const ended = await apply('pl-37-definition-apply-ended');
  for (const refused of [running, ended]) {
    expect(refused.status, JSON.stringify(refused)).toBe('rejected');
    expect(refused.code).toBe('revision_conflict');
    expect(refused.reason ?? '').toContain('already has a Run');
  }
  expect((await workflow.main.activePlan(workflow.goal))?.ref).toEqual(skeleton.plan.ref);
});
