/**
 * PL-10: a legal stage-2 candidate is reviewed `pass` and auto-adopted even
 * though its stage's estimated lines total 2_400 (> 2_000). The stage over-line
 * is only a prompt: it does not block adoption, open a system round or stop
 * Tasks. When that stage's Tasks and gate complete, the stage-end
 * `plan_notice` from `main/read` carries the exact over-line numbers (spec
 * §15 PL-10, DR-P4-12; the number is the stage-end notice's, not the
 * candidate card's).
 *
 * The named mutation is "stage over-line forces a human card". On this tree the
 * first target-level pass stops at `workflow.ts:1581` with
 * `rejected('unsupported','planCandidates is not wired')`, so adoption and the
 * P6 stage-end notice are after the seam; the literals below are the row.
 */
import { afterEach, expect, it } from 'vitest';
import type { PlanRevisionDraft, RuntimeTask } from '../../src/contracts/plan.js';
import type { PlanProposal } from '../../src/core/work-graph/model/plan-contracts.js';
import type { WorkflowStepReceipt } from '../../src/business/workflow/contracts.js';
import { graphWrite } from '../helpers/AG2b-collaboration-fixture.js';
import { driveWorkflow } from '../helpers/A2-restart-fixture.js';
import { createS6BLine } from '../helpers/S6B1-fixture.js';
import { listed } from '../helpers/S7B-fixture.js';
import { readBody } from '../helpers/IV-host-fixture.js';
import { usageOf } from '../helpers/S6A-host-fixture.js';
import { checkConfiguration, ready, sessionOf, setS7AAutonomy } from '../helpers/S7A-fixture.js';
import { OPERATOR, S6A_SCOPE, S6A_WORK_ROLE } from '../helpers/S6A-request-fixture.js';
import {
  adoptPLTwoStageSkeleton, createPLReviewerLine, openPLWorkflowWorld, plPlanChangeDraft, satisfyPLTask,
  type PLWorkflowWorld,
  performOne, plSystemRoundRef, requestHeads, verdictOf,
} from '../helpers/PL-workflow-fixture.js';
import { createPLAdviserLine } from '../helpers/PL-consumption-fixture.js';

let opened: PLWorkflowWorld | null = null;
afterEach(async () => { await opened?.close(); opened = null; });

const PASS = '{"schemaVersion":1,"kind":"plan_review","verdict":"pass","findings":[]}';

/** Stage 2's two Runs: 1_000 reported tokens each, or one of them reports no usage (spec 13.2.3). */
const rows = [
  { name: 'the stage-end notice carries the numbers', lastRun: { usage: usageOf(1_000) },
    contains: ['token 2000 · 增长 0', '2400', '2000', '超线', '阶段线超线：预估 2400 行 > 2000'], excludes: ['不全'] },
  { name: 'an incomplete stage token reading is marked and the line is not judged', lastRun: {},
    contains: ['token 至少 1000，不全'], excludes: ['超线'] },
];

it.each(rows)('PL-10: a 2_400-line stage still auto-adopts; $name', async row => {
  const workflow = opened = await openPLWorkflowWorld({ label: 'pl-10',
    extraHostOptions: { checks: checkConfiguration({ kind: 'human', id: OPERATOR.id }) } });
  const skeleton = await adoptPLTwoStageSkeleton(workflow.main, workflow.goal, {
    label: 'pl-10', stageOneTaskIds: ['pl-a', 'pl-b'],
  });
  const line = await sessionOf(workflow.world, await createS6BLine(workflow.main, {
    label: 'pl-10-line', role: S6A_WORK_ROLE, tasks: skeleton.tasks.filter(task =>
      ['pl-a', 'pl-b'].includes(task.taskId)),
  }));
  await satisfyPLTask(workflow.world, workflow.goal, 'pl-a', line, 'pl10');
  await satisfyPLTask(workflow.world, workflow.goal, 'pl-b', line, 'pl10');
  const reviewer = await createPLReviewerLine(workflow.world, workflow.main, 'pl-10-reviewer');
  await workflow.world.scripted.script(reviewer, [{ kind: 'text', text: PASS }]);

  // The stage-2 candidate: two real work Tasks at 1_200 lines each, no placeholder.
  const makeTask = (taskId: string): RuntimeTask => ({
    taskId, stageId: 'pl-stage-2', title: `PL-10 stage 2 ${taskId}`, requirementLevel: 'required',
    taskKind: 'work', disposition: 'active', phase: 'pending',
    scope: { kind: 'stage', stageId: 'pl-stage-2' }, executionIntent: 'request_execution',
    estimatedLines: 1_200, sizeClass: 'small',
  });
  const added = ['pl-c', 'pl-d'].map(makeTask);
  const draft: PlanRevisionDraft = plPlanChangeDraft(skeleton.plan, workflow.goal, {
    planId: 'pl-plan-pl-10-v2',
    tasks: [...skeleton.plan.tasks.map(task => task.taskId === 'pl-placeholder-pl-stage-2'
      ? { ...task, disposition: 'superseded' as const } : task), ...added],
    assignments: [...(skeleton.plan.assignments ?? []),
      ...added.map(task => ({ taskId: task.taskId, role: S6A_WORK_ROLE.templateId,
        instruction: `PL-10 ${task.taskId}` }))],
    obligations: skeleton.plan.obligations.map(obligation => obligation.obligationId === 'pl-obligation-stage-2'
      ? { ...obligation, taskIds: ['pl-c', 'pl-d', 'pl-gate-pl-stage-2'] } : obligation),
  });
  const proposed = (await workflow.main.post('plans/propose', graphWrite(S6A_SCOPE, {
    goalRef: workflow.goal, basedOn: skeleton.plan.ref, draft,
    reason: { text: 'PL-10 2400-line stage 2', sources: [], affectedTaskIds: ['pl-c', 'pl-d'] },
  }, 'pl-10-propose'))) as { status: string; value?: PlanProposal };
  expect(proposed.status, JSON.stringify(proposed)).toBe('committed');
  const candidate = proposed.value;
  if (candidate === undefined) throw new Error('PL-10: the candidate was not written');
  // The adviser line is present, so a stage-line system round would have a place to go.
  const adviser = await createPLAdviserLine(workflow.world, 'pl-10-adviser');
  // The first drive sends the review; after its pass the automatic band adopts: the stage line must not force a card.
  await driveWorkflow(workflow.world.ag2b, { schemaVersion: 1, goalRef: workflow.goal,
    flowId: 'pl-10-review', sessionHint: null, kind: 'select_work' });
  const review = await plSystemRoundRef(workflow, reviewer, `planreview:${candidate.ref.proposalId}:1`);
  expect(await verdictOf(workflow, review)).toBe('pass');
  const adopted = await performOne(workflow, 'pl-10-adopt', 'adopt_plan') as { value: { receipt: WorkflowStepReceipt } };
  const adoptReceipt = adopted.value.receipt;
  if (adoptReceipt.kind !== 'adopt_plan' || adoptReceipt.result.status !== 'committed') {
    throw new Error('PL-10: the adopt_plan step did not commit');
  }
  const after = await workflow.main.activePlan(workflow.goal);
  if (after === null) throw new Error('PL-10: the stage-2 Plan is not active');
  expect(after.ref).toEqual(adoptReceipt.result.value.ref);
  expect(after.planRevision).toBe(2);

  const readMain = async () => ready<{ notices: Array<{ itemKey?: string; category?: string; summary?: string }> }>(
    await workflow.world.post('main/read', {
      scope: { ...S6A_SCOPE }, input: { goalId: workflow.goal.goalId, cursor: null },
    }), 'main/read');
  // The adoption moment: no stage-end notice yet, and the adoption notice carries no stage number.
  const atAdoption = await readMain();
  expect(atAdoption.notices.map(entry => entry.itemKey)).not.toContain('stage-end:pl-plan-pl-10-v2:2:pl-stage-2');
  const adoption = atAdoption.notices.find(entry => entry.itemKey === 'plan-adoption:pl-plan-pl-10-v2:2');
  expect(adoption?.summary).toContain('已采用 · 计划 v2');
  expect(adoption?.summary).not.toContain('2400');
  expect(adoption?.summary).not.toContain('超线');

  const reviewRounds = (await listed(workflow.world, 'inbox', reviewer)).filter(message =>
    message.sender.kind === 'host' && message.sender.actor.kind === 'system');
  const reviewTexts = await Promise.all(reviewRounds.map(async message =>
    (await readBody(workflow.world, message.ref, 'message')).split('\n')[0] ?? ''));
  expect(reviewTexts.filter(text => text.startsWith('planreview:'))).toHaveLength(1);

  const line2 = await sessionOf(workflow.world, await createS6BLine(workflow.main, {
    label: 'pl-10-stage2', role: S6A_WORK_ROLE,
    tasks: ['pl-c', 'pl-d'].map(taskId => ({ projectId: workflow.goal.projectId,
      goalId: workflow.goal.goalId, taskId })),
  }));
  await satisfyPLTask(workflow.world, workflow.goal, 'pl-c', line2, 'pl10c', { usage: usageOf(1_000) });
  await satisfyPLTask(workflow.world, workflow.goal, 'pl-d', line2, 'pl10d', row.lastRun);
  await driveWorkflow(workflow.world.ag2b, { schemaVersion: 1, goalRef: workflow.goal,
    flowId: 'pl-10-gate', sessionHint: null, kind: 'select_work' });

  // The stage-end `plan_notice`: stage 2 at 2_400 lines over the 2_000 prompt line.
  const main = await readMain();
  const notice = main.notices.find(entry => entry.category === 'plan_notice'
    && entry.itemKey === 'stage-end:pl-plan-pl-10-v2:2:pl-stage-2');
  expect(notice).toBeDefined();
  for (const text of row.contains) expect(notice?.summary).toContain(text);
  for (const text of row.excludes) expect(notice?.summary).not.toContain(text);

  // The stage line opened no system round and no card: the one round is this candidate's review.
  expect(await requestHeads(workflow, adviser)).toEqual([]);
  expect(await requestHeads(workflow, reviewer)).toEqual([`planreview:${candidate.ref.proposalId}:1`]);
  expect(await requestHeads(workflow, line2)).toEqual([]);
  expect((await workflow.main.readCards(workflow.goal)).filter(card => card.closedReason === null)).toEqual([]);
});
