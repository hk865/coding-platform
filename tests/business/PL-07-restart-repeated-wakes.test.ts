/**
 * PL-07: one `refine:` survives repeated wakes and a Host restart (spec §15 PL-07, decision 97-9). On SQLite with the
 * default `resumeOnStartup: 'ask'`, the same gap is driven twice, then the Host restarts with the round unanswered. Until
 * the person starts the Goal nothing opens; after the start the one committed round is the one the adviser answers and
 * no second `refine:` is sent.
 *
 * Named mutation: drop the restart hold in `handleIntervention`; the round then opens before the person starts.
 */
import { afterEach, expect, it } from 'vitest';
import type { GoalRef } from '../../src/contracts/ledger.js';
import { driveWorkflow } from '../helpers/A2-restart-fixture.js';
import { plain } from '../helpers/AG2b-collaboration-fixture.js';
import { checkConfiguration, ready, sessionOf } from '../helpers/S7A-fixture.js';
import { OPERATOR, S6A_SCOPE, S6A_WORK_ROLE } from '../helpers/S6A-request-fixture.js';
import { createS6BLine } from '../helpers/S6B1-fixture.js';
import { awaitProposal, heartbeat, proposalRefOf, sessionQueries } from '../helpers/IV-host-fixture.js';
import {
  adoptPLTwoStageSkeleton, openPLWorkflowWorld, plStageTwoDraft, plSystemRoundRef, plToolPlanOf, requestHeads,
  satisfyPLTask, type PLWorkflowWorld,
} from '../helpers/PL-workflow-fixture.js';
import { createPLAdviserLine } from '../helpers/PL-consumption-fixture.js';
import { startGoalDriver } from '../helpers/DRV-fixture.js';

let opened: PLWorkflowWorld | null = null;
afterEach(async () => { await opened?.close(); opened = null; });

it('PL-07: the same gap sends one refine, a restart opens nothing until the person starts, and none is re-sent', async () => {
  const workflow = opened = await openPLWorkflowWorld({ backend: 'sqlite', label: 'pl-07',
    extraHostOptions: { checks: checkConfiguration({ kind: 'human', id: OPERATOR.id }) } });
  const { world, goal } = workflow;
  await world.settings('automation/save', { autoReworkLimit: 3, resumeOnStartup: 'ask' });
  const skeleton = await adoptPLTwoStageSkeleton(workflow.main, goal, {
    label: 'pl-07', stageOneTaskIds: ['pl-a', 'pl-b'],
  });
  const line = await sessionOf(world, await createS6BLine(workflow.main, {
    label: 'pl-07-line', role: S6A_WORK_ROLE, tasks: skeleton.tasks.filter(task =>
      ['pl-a', 'pl-b'].includes(task.taskId)),
  }));
  const adviser = await createPLAdviserLine(world, 'pl-07-adviser');
  await satisfyPLTask(world, goal, 'pl-a', line, 'pl07');
  await satisfyPLTask(world, goal, 'pl-b', line, 'pl07');
  await world.scripted.script(adviser, [{ kind: 'calls', calls: [{
    callId: 'pl-07-refine', name: 'submit_plan_round', args: {
      answerKind: 'plan', summary: 'PL-07 stage 2',
      plan: plToolPlanOf(plStageTwoDraft(skeleton.plan, goal, 'pl-07')),
      reason: { text: 'PL-07 stage 2', affectedTaskIds: ['pl-placeholder-pl-stage-2'] },
    },
  }] }]);

  const refines = async (): Promise<string[]> => (await requestHeads(workflow, adviser))
    .filter(text => text.startsWith(`refine:${goal.goalId}:`));
  for (const flowId of ['pl-07-first', 'pl-07-second']) {
    await driveWorkflow(world.ag2b, { schemaVersion: 1, goalRef: goal, flowId, sessionHint: null, kind: 'select_work' });
  }
  expect(await refines(), 'two passes over the same gap send one round').toHaveLength(1);
  const queriesBefore = (await sessionQueries(world, adviser)).length;
  const requestsBefore = (await world.scripted.requests(adviser)).length;

  // A normal restart, as the row says: this Host's 25 ms consume loop would outlive a crash and race the new Host for the round.
  await world.reopen();
  const report = ready<{ report: { interruptedGoals: { goalRef: GoalRef }[] } }>(await world.post(
    'host/reconcile-report', plain(S6A_SCOPE, {})), 'the reconcile report');
  expect(report.report.interruptedGoals.map(entry => entry.goalRef.goalId)).toContain(goal.goalId);
  await heartbeat(world);
  await heartbeat(world);
  expect(await sessionQueries(world, adviser), 'no round opens before the person starts').toHaveLength(queriesBefore);
  expect((await world.scripted.requests(adviser)).length, 'no model call before the person starts').toBe(requestsBefore);
  expect((await workflow.main.activePlan(goal))?.ref, 'nothing is adopted').toEqual(skeleton.plan.ref);

  await startGoalDriver(world, goal, 'pl-07-goal');
  const refineRef = await plSystemRoundRef(workflow, adviser, `refine:${goal.goalId}:pl-stage-2:`);
  const candidate = await awaitProposal(world, proposalRefOf(refineRef, goal));
  expect(candidate.status, 'the one committed round is the one answered').toBe('ready');
  expect(await refines(), 'the start re-sends nothing').toHaveLength(1);
  expect(await sessionQueries(world, adviser), 'one planning Query').toHaveLength(1);
}, 120_000);
