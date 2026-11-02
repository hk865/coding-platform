/**
 * PL-42: the review ends while the Goal has nothing to dispatch and no Run (spec §15 PL-42). Both stage-1 Tasks are
 * done, the reviewer's Query is open with its model request held, and the real Goal driver parks on the review wait.
 * Only the review's own commits can move the Goal: the answer's `SessionMessage` commit wakes the driver through
 * `goal_waits`, the driver reads the conclusion and adopts.
 *
 * Named mutation: the candidate wait's kinds become `['Goal']`; the driver then never wakes on the review's answer.
 */
import { afterEach, expect, it } from 'vitest';
import type { PlanProposal } from '../../src/core/work-graph/model/plan-contracts.js';
import { driveWorkflow } from '../helpers/A2-restart-fixture.js';
import { graphWrite } from '../helpers/AG2b-collaboration-fixture.js';
import { checkConfiguration, ready, sessionOf, setS7AAutonomy } from '../helpers/S7A-fixture.js';
import { OPERATOR, S6A_SCOPE, S6A_WORK_ROLE } from '../helpers/S6A-request-fixture.js';
import { createS6BLine } from '../helpers/S6B1-fixture.js';
import { createPLAdviserLine } from '../helpers/PL-consumption-fixture.js';
import { heartbeatUntil, heartbeatUntilModel, readProposal, waitForResponse } from '../helpers/IV-host-fixture.js';
import {
  adoptPLTwoStageSkeleton, createPLReviewerLine, openPLWorkflowWorld, performOne, plSupersedeDraft, plSystemRoundRef,
  runPLAutomaticChain, verdictOf, type PLWorkflowWorld,
} from '../helpers/PL-workflow-fixture.js';
import { startGoalDriver, waitDriver } from '../helpers/DRV-fixture.js';

let opened: PLWorkflowWorld | null = null;
afterEach(async () => { await opened?.close(); opened = null; });

it('PL-42: the review answer alone wakes a Goal with no work and no Run, and the driver adopts', async () => {
  const chain = await runPLAutomaticChain('pl-42');
  opened = chain.workflow;
  const { world, goal } = chain.workflow;

  await startGoalDriver(world, goal, 'pl-42-goal');
  const parked = await waitDriver(world, goal, undefined, snapshot => snapshot.state === 'waiting_for_reply',
    'PL-42: the Goal driver parks on the review');
  expect(parked.last).toMatchObject({ status: 'ready', value: { state: 'waiting', next: null, waitBasis: {
    reasons: expect.arrayContaining(['plan_review_pending']),
    recordKinds: expect.arrayContaining(['SessionMessage', 'PlanProposal']) } } });
  const running = ready<{ tasks: Array<{ ref: { taskId: string }; effectivePhase: string }> }>(
    await chain.workflow.main.route('tasks/query', { goalRef: goal }), 'tasks/query');
  expect(running.tasks.filter(task => task.effectivePhase === 'running'), 'the Goal has no Run').toEqual([]);
  expect((await readProposal(world, chain.candidate.ref)).status).toBe('candidate');

  await world.scripted.script(chain.line, [{ kind: 'text', text: 'PL-42 stage 2 done' }]);
  chain.releaseReview();
  await waitForResponse(world, chain.reviewRef);
  await heartbeatUntil(world, () => readProposal(world, chain.candidate.ref),
    proposal => proposal.status === 'accepted', 24);
  const goalRead = ready<{ goal: { activePlanRevision: { planId: string } | null } }>(
    await world.post('goals/read', { scope: { ...S6A_SCOPE }, input: goal }), 'goals/read');
  expect(goalRead.goal.activePlanRevision?.planId).toBe(chain.candidate.draft.planId);
  const moved = await waitDriver(world, goal, undefined, snapshot => snapshot.last !== null
    && !(snapshot.last.status === 'ready' && (snapshot.last.value.waitBasis?.reasons ?? [])
      .includes('plan_review_pending')), 'PL-42: the driver leaves the review wait');
  expect(moved.last).toMatchObject({ status: 'ready' });
});

/** Each cell leaves the candidate in one state and returns what lets its held round go. */
const parked: ReadonlyArray<{ state: string; reason: string;
  prepare(workflow: PLWorkflowWorld, label: string): Promise<() => void> }> = [
  { state: 'on its card', reason: 'plan_candidate_waiting', prepare: async () => () => undefined },
  { state: 'in review', reason: 'plan_review_pending', prepare: async (workflow, label) => {
    const reviewer = await createPLReviewerLine(workflow.world, workflow.main, `${label}-reviewer`);
    await workflow.world.scripted.script(reviewer, [{ kind: 'calls', calls: [{ callId: `${label}-pass`,
      name: 'submit_plan_review', args: { verdict: 'pass', findings: [] } }] }]);
    const held = await workflow.world.gates.modelRequest(reviewer);
    await performOne(workflow, `${label}-review`, 'send_system_round');
    await heartbeatUntilModel(workflow.world, held);
    return () => held.release();
  } },
  { state: 'waiting for its fix', reason: 'plan_fix_sent', prepare: async (workflow, label) => {
    const reviewer = await createPLReviewerLine(workflow.world, workflow.main, `${label}-reviewer`);
    const adviser = await createPLAdviserLine(workflow.world, `${label}-adviser`);
    await workflow.world.scripted.script(reviewer, [{ kind: 'calls', calls: [{ callId: `${label}-fix`,
      name: 'submit_plan_review', args: { verdict: 'fix', findings: [{ taskId: 'pl-a', text: 'PL-42 fix it' }] } }] }]);
    await workflow.world.scripted.script(adviser, [{ kind: 'text', text: 'PL-42 the fix round says nothing' }]);
    await performOne(workflow, `${label}-review`, 'send_system_round');
    expect(await verdictOf(workflow, await plSystemRoundRef(workflow, reviewer, 'planreview:'))).toBe('fix');
    const held = await workflow.world.gates.modelRequest(adviser);
    await performOne(workflow, `${label}-fix`, 'send_system_round');
    await heartbeatUntilModel(workflow.world, held);
    return () => held.release();
  } },
];

it.each(parked)('PL-42: a candidate $state keeps nobody from working; the wait comes only when nothing is left', async cell => {
  const label = `pl-42-${cell.reason.replaceAll('_', '-')}`;
  const workflow = opened = await openPLWorkflowWorld({ label,
    extraHostOptions: { checks: checkConfiguration({ kind: 'human', id: OPERATOR.id }) } });
  const skeleton = await adoptPLTwoStageSkeleton(workflow.main, workflow.goal, { label, stageOneTaskIds: ['pl-a', 'pl-b'] });
  await setS7AAutonomy(workflow.world, workflow.goal, 'after_plan_confirmation');
  const line = await sessionOf(workflow.world, await createS6BLine(workflow.main, { label: `${label}-line`,
    role: S6A_WORK_ROLE, tasks: skeleton.tasks.filter(task => ['pl-a', 'pl-b'].includes(task.taskId)) }));
  await workflow.world.scripted.script(line, [{ kind: 'text', text: 'PL-42 first' }, { kind: 'text', text: 'PL-42 second' }]);
  const proposed = (await workflow.main.post('plans/propose', graphWrite(S6A_SCOPE, {
    goalRef: workflow.goal, basedOn: skeleton.plan.ref, draft: plSupersedeDraft(skeleton.plan, workflow.goal, label),
    reason: { text: 'PL-42 a candidate beside the work', sources: [], affectedTaskIds: ['pl-a'] },
  }, `${label}-propose`))) as { status: string; value: PlanProposal };
  expect(proposed.status, JSON.stringify(proposed)).toBe('committed');
  const release = await cell.prepare(workflow, label);
  try {
    const steps = await driveWorkflow(workflow.world.ag2b, { schemaVersion: 1, goalRef: workflow.goal,
      flowId: `${label}-select`, sessionHint: null, kind: 'select_work' });
    const first = steps[0]?.next;
    expect(first?.kind === 'perform' ? first.operation.kind : null, 'the first pass picks work up').toBe('claim_task');
    const last = steps.at(-1);
    expect(last).toMatchObject({ state: 'waiting', next: null, waitBasis: {
      reasons: expect.arrayContaining([cell.reason]),
      recordKinds: expect.arrayContaining(['SessionMessage', 'PlanProposal']) } });
    const graph = ready<{ tasks: Array<{ ref: { taskId: string }; effectivePhase: string }> }>(
      await workflow.main.route('tasks/query', { goalRef: workflow.goal }), 'tasks/query');
    for (const taskId of ['pl-a', 'pl-b']) {
      expect(graph.tasks.find(task => task.ref.taskId === taskId)?.effectivePhase, taskId).toBe('satisfied');
    }
    expect((await workflow.main.activePlan(workflow.goal))?.ref).toEqual(skeleton.plan.ref);
  } finally {
    release();
  }
});
