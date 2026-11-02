/**
 * PL-44: the Goal driver's adoption answers `busy` (spec §15 PL-44). The candidate passed its review and A's Run is
 * entered, so the real driver's `adopt_plan` is refused: the candidate stays a candidate, no card opens and the driver
 * parks. PL-37 retries by hand; here nothing does: A's Run ending is the commit that wakes the driver through
 * `goal_waits`, and the same candidate is adopted once. The accepted-unreplied recovery half is PL-41's.
 *
 * Named mutation: drop `Run` from the candidate wait's kinds; the driver then stays parked after the Run ends.
 */
import { afterEach, expect, it } from 'vitest';
import type { WorkflowAdvanceInput } from '../../src/business/workflow/contracts.js';
import type { PlanProposal } from '../../src/core/work-graph/model/plan-contracts.js';
import { driveWorkflow } from '../helpers/A2-restart-fixture.js';
import { graphWrite } from '../helpers/AG2b-collaboration-fixture.js';
import { heartbeatUntil, heartbeatUntilModel, readProposal } from '../helpers/IV-host-fixture.js';
import { checkConfiguration, ready, sessionOf, setS7AAutonomy } from '../helpers/S7A-fixture.js';
import { OPERATOR, S6A_SCOPE, S6A_WORK_ROLE } from '../helpers/S6A-request-fixture.js';
import { createS6BLine } from '../helpers/S6B1-fixture.js';
import {
  adoptPLTwoStageSkeleton, createPLReviewerLine, holdPLTaskRequest, openPLWorkflowWorld, performOne, plSupersedeDraft,
  plSystemRoundRef, satisfyPLTask, verdictOf, type PLWorkflowWorld,
} from '../helpers/PL-workflow-fixture.js';
import { startGoalDriver, waitDriver } from '../helpers/DRV-fixture.js';

let opened: PLWorkflowWorld | null = null;
afterEach(async () => { await opened?.close(); opened = null; });

it('PL-44: busy keeps the candidate, and the Run ending wakes the driver to adopt it once', async () => {
  const workflow = opened = await openPLWorkflowWorld({ label: 'pl-44',
    extraHostOptions: { checks: checkConfiguration({ kind: 'human', id: OPERATOR.id }) } });
  const skeleton = await adoptPLTwoStageSkeleton(workflow.main, workflow.goal, {
    label: 'pl-44', stageOneTaskIds: ['pl-a', 'pl-b'],
  });
  await setS7AAutonomy(workflow.world, workflow.goal, 'after_plan_confirmation');
  const line = await sessionOf(workflow.world, await createS6BLine(workflow.main, {
    label: 'pl-44-line', role: S6A_WORK_ROLE, tasks: skeleton.tasks.filter(task =>
      ['pl-a', 'pl-b'].includes(task.taskId)),
  }));
  await satisfyPLTask(workflow.world, workflow.goal, 'pl-b', line, 'pl44-b');
  const held = await holdPLTaskRequest(workflow.world, workflow.goal, 'pl-a', line, 'pl44',
    { stopBefore: 'open_checks' });
  let candidate: PlanProposal;
  try {
    const proposed = (await workflow.main.post('plans/propose', graphWrite(S6A_SCOPE, {
      goalRef: workflow.goal, basedOn: skeleton.plan.ref, draft: plSupersedeDraft(skeleton.plan, workflow.goal, 'pl-44'),
      reason: { text: 'PL-44 supersede A with A2', sources: [], affectedTaskIds: ['pl-a'] },
    }, 'pl-44-propose'))) as { status: string; value: PlanProposal };
    expect(proposed.status, JSON.stringify(proposed)).toBe('committed');
    candidate = proposed.value;

    const reviewer = await createPLReviewerLine(workflow.world, workflow.main, 'pl-44-reviewer');
    await workflow.world.scripted.script(reviewer,
      [{ kind: 'text', text: '{"schemaVersion":1,"kind":"plan_review","verdict":"pass","findings":[]}' }]);
    const reviewGate = await workflow.world.gates.modelRequest(reviewer);
    await driveWorkflow(workflow.world.ag2b, { schemaVersion: 1, goalRef: workflow.goal,
      flowId: 'pl-44-review', sessionHint: null, kind: 'select_work' });
    await heartbeatUntilModel(workflow.world, reviewGate);
    reviewGate.release();
    const review = await plSystemRoundRef(workflow, reviewer, `planreview:${candidate.ref.proposalId}:1`);
    expect(await verdictOf(workflow, review)).toBe('pass');

    await startGoalDriver(workflow.world, workflow.goal, 'pl-44-goal');
    const parked = await waitDriver(workflow.world, workflow.goal, undefined, snapshot =>
      snapshot.last?.status === 'ready' && (snapshot.last.value.waitBasis?.reasons ?? [])
        .includes('plan_adoption_busy'), 'PL-44: the driver\'s adoption answers busy');
    expect(parked.last?.status === 'ready' ? parked.last.value.source : null, 'busy opens no card').toBeUndefined();
    expect((await workflow.main.activePlan(workflow.goal))?.ref).toEqual(skeleton.plan.ref);
    expect((await readProposal(workflow.world, candidate.ref)).status).toBe('candidate');
  } finally {
    await held.release();
  }

  await heartbeatUntil(workflow.world, () => readProposal(workflow.world, candidate.ref),
    proposal => proposal.status === 'accepted', 24);
  const active = await workflow.main.activePlan(workflow.goal);
  expect(active?.ref.planId, 'the same candidate became the active Plan').toBe(candidate.draft.planId);
  expect(active?.planRevision, 'one adoption, one revision').toBe(skeleton.plan.planRevision + 1);
});

it('PL-44: busy does not hold other work: B runs first, and the wait carries busy only when nothing is left', async () => {
  const workflow = opened = await openPLWorkflowWorld({ label: 'pl-44-other',
    extraHostOptions: { checks: checkConfiguration({ kind: 'human', id: OPERATOR.id }) } });
  const skeleton = await adoptPLTwoStageSkeleton(workflow.main, workflow.goal, {
    label: 'pl-44-other', stageOneTaskIds: ['pl-a', 'pl-b'],
  });
  await setS7AAutonomy(workflow.world, workflow.goal, 'after_plan_confirmation');
  const lineA = await sessionOf(workflow.world, await createS6BLine(workflow.main, {
    label: 'pl-44-other-a', role: S6A_WORK_ROLE, tasks: skeleton.tasks.filter(task => task.taskId === 'pl-a'),
  }));
  const lineB = await sessionOf(workflow.world, await createS6BLine(workflow.main, {
    label: 'pl-44-other-b', role: S6A_WORK_ROLE, tasks: skeleton.tasks.filter(task => task.taskId === 'pl-b'),
  }));
  await workflow.world.scripted.script(lineB, [{ kind: 'text', text: 'PL-44 B done' }]);
  const held = await holdPLTaskRequest(workflow.world, workflow.goal, 'pl-a', lineA, 'pl44o',
    { stopBefore: 'open_checks' });
  try {
    const proposed = (await workflow.main.post('plans/propose', graphWrite(S6A_SCOPE, {
      goalRef: workflow.goal, basedOn: skeleton.plan.ref,
      draft: plSupersedeDraft(skeleton.plan, workflow.goal, 'pl-44-other'),
      reason: { text: 'PL-44 supersede A with A2', sources: [], affectedTaskIds: ['pl-a'] },
    }, 'pl-44-other-propose'))) as { status: string; value: PlanProposal };
    expect(proposed.status, JSON.stringify(proposed)).toBe('committed');
    const reviewer = await createPLReviewerLine(workflow.world, workflow.main, 'pl-44-other-reviewer');
    await workflow.world.scripted.script(reviewer,
      [{ kind: 'text', text: '{"schemaVersion":1,"kind":"plan_review","verdict":"pass","findings":[]}' }]);
    await performOne(workflow, 'pl-44-other-review', 'send_system_round');
    const review = await plSystemRoundRef(workflow, reviewer, `planreview:${proposed.value.ref.proposalId}:1`);
    expect(await verdictOf(workflow, review)).toBe('pass');

    // The adoption answers busy, and the same step goes on to B instead of waiting.
    const adopted = await performOne(workflow, 'pl-44-other-adopt', 'adopt_plan') as {
      value: { state: string; next: WorkflowAdvanceInput | null; receipt: unknown } };
    expect(adopted.value.next?.kind === 'perform' ? adopted.value.next.operation.kind : null).toBe('claim_task');
    expect((await readProposal(workflow.world, proposed.value.ref)).status).toBe('candidate');
    const steps = await driveWorkflow(workflow.world.ag2b, adopted.value.next!);
    const graph = ready<{ tasks: Array<{ ref: { taskId: string }; effectivePhase: string }> }>(
      await workflow.main.route('tasks/query', { goalRef: workflow.goal }), 'tasks/query');
    expect(graph.tasks.find(task => task.ref.taskId === 'pl-b')?.effectivePhase).toBe('satisfied');
    // B is done and A still runs: only now the wait stands, on the merged basis.
    expect(steps.at(-1)).toMatchObject({ state: 'waiting', next: null, waitBasis: {
      reasons: expect.arrayContaining(['plan_adoption_busy']),
      recordKinds: expect.arrayContaining(['Run', 'TaskLease', 'SessionMessage', 'PlanProposal']) } });
    expect((await workflow.main.activePlan(workflow.goal))?.ref).toEqual(skeleton.plan.ref);
  } finally {
    await held.release();
  }
});
