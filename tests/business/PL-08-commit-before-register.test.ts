/**
 * PL-08: a commit that lands between the Goal driver's read and its wait registration is not lost (spec §15 PL-08,
 * §5.5.1 steps 5–6). The real Host driver reads with `advanceWork`, gets a `waiting` result, and only then registers;
 * the hook is the one way to land a commit in that window. The real `plans/propose` commits there, so the registry
 * sees a commit newer than the driver's read cursor, the drain right after the registration wakes the driver, and the
 * next pass reads the candidate. Nothing else moves the Goal: A's Run stays held and there is no heartbeat.
 *
 * Named mutation: take the cursor after the read, or drop the drain; the driver then never leaves its first wait.
 */
import { afterEach, expect, it, onTestFinished } from 'vitest';
import { graphWrite } from '../helpers/AG2b-collaboration-fixture.js';
import { checkConfiguration, sessionOf } from '../helpers/S7A-fixture.js';
import { OPERATOR, S6A_SCOPE, S6A_WORK_ROLE } from '../helpers/S6A-request-fixture.js';
import { createS6BLine } from '../helpers/S6B1-fixture.js';
import { readProposal } from '../helpers/IV-host-fixture.js';
import {
  adoptPLTwoStageSkeleton, holdPLTaskRequest, openPLWorkflowWorld, plStageTwoDraft, satisfyPLTask,
  type PLWorkflowWorld,
} from '../helpers/PL-workflow-fixture.js';
import { installPLAdvanceHook } from '../helpers/PL-consumption-fixture.js';
import { startGoalDriver, waitDriver } from '../helpers/DRV-fixture.js';
import type { PlanProposal } from '../../src/core/work-graph/model/plan-contracts.js';

let opened: PLWorkflowWorld | null = null;
afterEach(async () => { await opened?.close(); opened = null; });

it('PL-08: a candidate committed after the read and before the registration wakes the driver', async () => {
  const hook = installPLAdvanceHook();
  onTestFinished(() => hook.restore());
  const workflow = opened = await openPLWorkflowWorld({ label: 'pl-08',
    extraHostOptions: { checks: checkConfiguration({ kind: 'human', id: OPERATOR.id }) } });
  const skeleton = await adoptPLTwoStageSkeleton(workflow.main, workflow.goal, {
    label: 'pl-08', stageOneTaskIds: ['pl-a', 'pl-b'],
  });
  const line = await sessionOf(workflow.world, await createS6BLine(workflow.main, {
    label: 'pl-08-line', role: S6A_WORK_ROLE, tasks: skeleton.tasks.filter(task =>
      ['pl-a', 'pl-b'].includes(task.taskId)),
  }));
  await satisfyPLTask(workflow.world, workflow.goal, 'pl-a', line, 'pl08');
  const held = await holdPLTaskRequest(workflow.world, workflow.goal, 'pl-b', line, 'pl08');

  try {
    let candidate: PlanProposal | undefined;
    hook.after = async (input, result) => {
      if (input.flowId !== 'pl-08-goal' || result.status !== 'ready' || result.value.state !== 'waiting') return;
      hook.after = null;
      const proposed = await workflow.main.post('plans/propose', graphWrite(S6A_SCOPE, {
        goalRef: workflow.goal, basedOn: skeleton.plan.ref, draft: plStageTwoDraft(skeleton.plan, workflow.goal, 'pl-08'),
        reason: { text: 'PL-08 stage 2', sources: [], affectedTaskIds: ['pl-placeholder-pl-stage-2'] },
      }, 'pl-08-propose')) as { status: string; value: PlanProposal };
      expect(proposed.status).toBe('committed');
      candidate = proposed.value;
    };

    await startGoalDriver(workflow.world, workflow.goal, 'pl-08-goal');
    const woken = await waitDriver(workflow.world, workflow.goal, undefined, snapshot =>
      snapshot.last?.status === 'ready' && (snapshot.last.value.waitBasis?.reasons ?? [])
        .includes('plan_candidate_waiting'),
    'PL-08: the driver wakes and reads the candidate committed before its registration');
    if (candidate === undefined) throw new Error('PL-08: the candidate was never committed');
    expect(woken.state, 'the wake leaves a registered driver parked on the new read').toBe('waiting_for_reply');
    expect((await readProposal(workflow.world, candidate.ref)).status).toBe('candidate');
  } finally {
    await held.release();
  }
});
