/**
 * PL-17: a stage-2 placeholder is refined while the first stage's last Task is
 * still running. Stage 1's earlier Task is satisfied; its last Task has a real
 * entered Run held at its model request; stage 2 has only the required
 * `plan_only` placeholder (spec §5.1.4/§5.5.4).
 *
 * On this tree the target-level pass stops at the documented closure seam
 * (`planCandidates is not wired`, workflow.ts:1581, DR-P4-06), so the `refine:`
 * assertion is after the seam.
 */
import { afterEach, expect, it } from 'vitest';
import type { PlanRevisionRef } from '../../src/contracts/plan.js';
import { graphWrite } from '../helpers/AG2b-collaboration-fixture.js';
import { checkConfiguration, ready } from '../helpers/S7A-fixture.js';
import { OPERATOR, S6A_SCOPE, S6A_WORK_ROLE } from '../helpers/S6A-request-fixture.js';
import { createS6BLine } from '../helpers/S6B1-fixture.js';
import { listed } from '../helpers/S7B-fixture.js';
import { awaitProposal, proposalRefOf, readBody } from '../helpers/IV-host-fixture.js';
import { sessionOf } from '../helpers/S7A-fixture.js';
import {
  adoptPLTwoStageSkeleton, holdPLTaskRequest, openPLWorkflowWorld, plSystemRoundRef,
  plToolPlanOf, plStageTwoDraft, satisfyPLTask, type PLWorkflowWorld,
} from '../helpers/PL-workflow-fixture.js';
import { createPLAdviserLine } from '../helpers/PL-consumption-fixture.js';
import { startGoalDriver, waitDriver } from '../helpers/DRV-fixture.js';

let opened: PLWorkflowWorld | null = null;
afterEach(async () => { await opened?.close(); opened = null; });

it('PL-17: refine is sent while the last first-stage Run is still entered', async () => {
  const workflow = opened = await openPLWorkflowWorld({ label: 'pl-17',
    extraHostOptions: { checks: checkConfiguration({ kind: 'human', id: OPERATOR.id }) } });
  const skeleton = await adoptPLTwoStageSkeleton(workflow.main, workflow.goal, {
    label: 'pl-17', stageOneTaskIds: ['pl-a', 'pl-b'],
  });
  const line = await sessionOf(workflow.world, await createS6BLine(workflow.main, {
    label: 'pl-17-line', role: S6A_WORK_ROLE, tasks: skeleton.tasks.filter(task =>
      ['pl-a', 'pl-b'].includes(task.taskId)),
  }));
  const adviser = await createPLAdviserLine(workflow.world, 'pl-17-adviser');
  await satisfyPLTask(workflow.world, workflow.goal, 'pl-b', line, 'pl17');
  await workflow.world.scripted.script(line, [{ kind: 'text', text: 'PL-17 A done' }]);
  const held = await holdPLTaskRequest(workflow.world, workflow.goal, 'pl-a', line, 'pl17');
  const taskRowOf = async (taskId: string) => ready<{ tasks: Array<{ ref: { taskId: string }; definition: unknown }> }>(
    await workflow.main.route('tasks/query', { goalRef: workflow.goal }), 'tasks/query')
    .tasks.find(task => task.ref.taskId === taskId);
  const definitionBefore = (await taskRowOf('pl-a'))?.definition;

  try {
    // The real Goal driver opens the watch while A's model request is held; the
    // stage-2 placeholder makes it send `refine:` to the adviser line.
    await workflow.world.scripted.script(adviser, [{ kind: 'calls', calls: [{
      callId: 'pl-17-refine', name: 'submit_plan_round', args: {
        answerKind: 'plan', summary: 'PL-17 stage 2',
        plan: plToolPlanOf(plStageTwoDraft(skeleton.plan, workflow.goal, 'pl-17')),
        reason: { text: 'PL-17 stage 2', affectedTaskIds: ['pl-placeholder-pl-stage-2'] },
      },
    }] }]);
    await startGoalDriver(workflow.world, workflow.goal, 'pl-17-goal');
    const parked = await waitDriver(workflow.world, workflow.goal, undefined,
      snapshot => snapshot.state === 'waiting_for_reply' || snapshot.state === 'waiting',
      'PL-17: the Goal driver parks after the refine');
    expect(parked.last).toMatchObject({ status: 'ready', value: { state: 'waiting', next: null,
      waitBasis: { reasons: expect.arrayContaining(['plan_only:pl-stage-2']) } } });

    // `refine:` reaches the real adviser line while A still runs.
    const lineRounds = (await listed(workflow.world, 'inbox', adviser)).filter(message =>
      message.sender.kind === 'host' && message.sender.actor.kind === 'system');
    const lineTexts = await Promise.all(lineRounds.map(async message =>
      (await readBody(workflow.world, message.ref, 'message')).split('\n')[0] ?? ''));
    expect(lineTexts.find(text => text.startsWith(`refine:${workflow.goal.goalId}:pl-stage-2:`))).toBeDefined();

    // A's Run is unchanged: still running, same claim and plan.
    const execution = ready<{ run: { status: string }; outbox: { claim: { planRef: PlanRevisionRef } } }>(
      await workflow.world.post('executions/read', { scope: { ...S6A_SCOPE }, input: held.run }), 'executions/read');
    expect(execution.run.status).toBe('running');
    expect(execution.outbox.claim.planRef).toEqual(skeleton.plan.ref);

    // The refine's candidate is written while A still runs.
    const refine = await plSystemRoundRef(workflow, adviser, `refine:${workflow.goal.goalId}:pl-stage-2:`);
    const written = await awaitProposal(workflow.world, proposalRefOf(refine, workflow.goal));
    expect(written).toMatchObject({ status: 'ready', value: { status: 'candidate', basedOn: skeleton.plan.ref } });
    if (written.status !== 'ready') throw new Error('PL-17: the refine candidate is not readable');

    const refineApply = await workflow.main.post('plans/apply', graphWrite(S6A_SCOPE, {
      proposalRef: written.value.ref, expectedProposalRevision: written.value.revision, decisionRefs: [],
    }, 'pl-17-apply-refine'));
    expect(refineApply, JSON.stringify(refineApply)).toMatchObject({ status: 'committed',
      value: { planRevision: skeleton.plan.planRevision + 1 } });

    // The adoption that left A alone did not touch it: the same Run keeps running on the same claim.
    const after = ready<{ run: { status: string }; outbox: { claim: { planRef: PlanRevisionRef } } }>(
      await workflow.world.post('executions/read', { scope: { ...S6A_SCOPE }, input: held.run }), 'executions/read');
    expect(after.run.status).toBe('running');
    expect(after.outbox.claim.planRef).toEqual(skeleton.plan.ref);
  } finally {
    await held.release();
  }

  // Released, A ends on its own: nobody cancelled or paused it, and its definition is the one it started with.
  const finished = ready<{ run: Record<string, unknown> }>(
    await workflow.world.post('executions/read', { scope: { ...S6A_SCOPE }, input: held.run }), 'executions/read');
  expect(finished.run).toMatchObject({ status: 'ended', outcome: 'completed', exitCode: 0,
    planRef: skeleton.plan.ref });
  expect((await taskRowOf('pl-a'))?.definition).toEqual(definitionBefore);
});
