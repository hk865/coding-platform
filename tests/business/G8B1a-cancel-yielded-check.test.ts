/**
 * G8B-1a 施工方补测（lead 11-17 18:2x 裁定 2；照 PL-34 的世界）：参谋的候选替代执行者正在 `yielded / wait_reply` 等它回复的
 * 任务 A，同时带一条新检查。审阅者先过计划审阅，再批这条检查。批准以后，PL 先立采用前的取消围栏（`cancel_yielded_wait`，
 * 复用 `cancelBeforeAdoption`），批准轮的收尾再采用，计划到 v2，A 是 superseded。
 * 改前红在：收尾的采用一直被 owner 的 `busy`（A 的 Run 还在等回复）挡回，PL 只等收尾，走不到取消那一步。
 */
import { afterEach, expect, it } from 'vitest';
import type { PlanProposal } from '../../src/core/work-graph/model/plan-contracts.js';
import { advanceUntil, post, readExecution } from '../helpers/A2-restart-fixture.js';
import { plain } from '../helpers/AG2b-collaboration-fixture.js';
import { g8Check } from '../helpers/G8-world.js';
import { createS6BLine } from '../helpers/S6B1-fixture.js';
import { OPERATOR, S6A_SCOPE, S6A_WORK_ROLE, type S6AExtraBinding } from '../helpers/S6A-request-fixture.js';
import { bindingOf, checkConfiguration, ready, sessionOf, setS7AAutonomy } from '../helpers/S7A-fixture.js';
import {
  awaitPlanningAnswer, heartbeatUntilModel, proposalRefOf, readProposal, settleHost,
} from '../helpers/IV-host-fixture.js';
import { createPLAdviserLine, sendPLActionWait } from '../helpers/PL-consumption-fixture.js';
import {
  adoptPLTwoStageSkeleton, createPLReviewerLine, openPLWorkflowWorld, plSupersedeDraft, plSystemRoundRef, plToolPlanOf,
  type PLWorkflowWorld,
} from '../helpers/PL-workflow-fixture.js';

const SEND_TOOLS: S6AExtraBinding = {
  binding: bindingOf('s6a-work-binding', S6A_WORK_ROLE, 'G8B1a trusted work guidance', ['read']),
  mergeTools: ['send_session_message'],
};

let opened: PLWorkflowWorld | null = null;
afterEach(async () => { await opened?.close().catch(() => undefined); opened = null; });

it('G8B1a-Y: a candidate that replaces a yielded wait_reply Task and brings a check is adopted after approval', async () => {
  const workflow = opened = await openPLWorkflowWorld({ backend: 'memory', label: 'g8b1a-y', extraBindings: [SEND_TOOLS],
    // 改动前的事实只在有命令授权的工作区跑。
    workspaceGrants: { writePrefixes: ['.'], allowCommands: true },
    extraHostOptions: { checks: checkConfiguration({ kind: 'human', id: OPERATOR.id }) } });
  const { world, main, goal } = workflow;
  await settleHost(world);
  const skeleton = await adoptPLTwoStageSkeleton(main, goal, { label: 'g8b1a-y', stageOneTaskIds: ['pl-a', 'pl-b'] });
  await setS7AAutonomy(world, goal, 'after_plan_confirmation');
  const line = await sessionOf(world, await createS6BLine(main, { label: 'g8b1a-y-line',
    role: S6A_WORK_ROLE, tasks: skeleton.tasks.filter(task => ['pl-a', 'pl-b'].includes(task.taskId)) }));
  const adviser = await createPLAdviserLine(world, 'g8b1a-y-adviser');
  const reviewer = await createPLReviewerLine(world, main, 'g8b1a-y-reviewer');
  const check = g8Check('g8b1a-y-check', ['pl-a2'], 'test -f g8b1a-y.txt');
  await world.scripted.script(reviewer, [
    { kind: 'calls', calls: [{ callId: 'g8b1a-y-review', name: 'submit_plan_review', args: { verdict: 'pass', findings: [] } }] },
    { kind: 'calls', calls: [{ callId: 'g8b1a-y-approve', name: 'submit_check_review', args: { verdicts: [
      { checkId: check.checkId, decision: 'approve', reason: '改动前确实失败，查的正是新任务' }] } }] },
  ]);

  const gate = await world.gates.modelRequest(adviser);
  const sent = await sendPLActionWait(world, { goal, session: line, sessionTaskId: 'pl-a',
    recipient: adviser.ref, text: 'G8B1a-Y: A cannot continue on this premise', label: 'g8b1a-y' });
  const held = await heartbeatUntilModel(world, gate);
  const draft = plSupersedeDraft(skeleton.plan, goal, 'g8b1a-y');
  await world.scripted.script(adviser, [{ kind: 'calls', calls: [{ callId: 'g8b1a-y-plan',
    name: 'submit_plan_round', args: {
      answerKind: 'plan', summary: 'G8B1a-Y replace A with A2 and check A2',
      plan: plToolPlanOf(draft), checks: [check],
      reason: { text: 'G8B1a-Y A is replaced by A2', affectedTaskIds: ['pl-a'] },
    } }] }]);
  gate.release();
  await held.settled;

  const proposalRef = proposalRefOf(sent.message.ref, goal);
  let candidate: PlanProposal | null = null;
  for (let pass = 0; pass < 16 && candidate === null; pass += 1) {
    const read = (await world.post('plans/proposal', plain(S6A_SCOPE, proposalRef))).body as
      { status?: string; value?: PlanProposal };
    if (read.status === 'ready' && read.value?.status === 'candidate') candidate = read.value;
    else await settleHost(world);
  }
  if (candidate === null) throw new Error('G8B1a-Y: the candidate was not written');
  expect(candidate.checks?.map(item => item.checkId)).toEqual([check.checkId]);

  // 计划审阅过了，再把新检查送去批。
  const flow = (flowId: string) => ({ schemaVersion: 1 as const, goalRef: goal, flowId, sessionHint: null,
    kind: 'select_work' as const });
  ready(await post(world.ag2b, 'workflow/advance', plain(S6A_SCOPE,
    await advanceUntil(world.ag2b, flow('g8b1a-y-review'), 'send_system_round'))), 'the planreview send');
  await awaitPlanningAnswer(world, await plSystemRoundRef(workflow, reviewer, `planreview:${candidate.ref.proposalId}:`));
  ready(await post(world.ag2b, 'workflow/advance', plain(S6A_SCOPE,
    await advanceUntil(world.ag2b, flow('g8b1a-y-check'), 'send_system_round'))), 'the checkreview send');
  await awaitPlanningAnswer(world, await plSystemRoundRef(workflow, reviewer, `checkreview:${candidate.ref.proposalId}:`));
  // 收尾先试一次采用：A 的 Run 还在等回复，owner 回 busy。
  await settleHost(world);
  expect((await readProposal(world, proposalRef)).status, 'adopted before the cancel fence').toBe('candidate');

  // 批了以后 PL 立采用前的取消围栏，收尾再采用上。
  ready(await post(world.ag2b, 'workflow/advance', plain(S6A_SCOPE,
    await advanceUntil(world.ag2b, flow('g8b1a-y-cancel'), 'cancel_yielded_wait'))), 'the yielded cancel');
  expect((await readExecution(world.ag2b, sent.run)).run.controlState?.desiredState).toBe('cancelled');
  for (let pass = 0; pass < 16 && (await readProposal(world, proposalRef)).status === 'candidate'; pass += 1) {
    await settleHost(world);
  }
  expect((await readProposal(world, proposalRef)).status).toBe('accepted');
  const v2 = await main.activePlan(goal);
  expect(v2?.planRevision).toBe(skeleton.plan.planRevision + 1);
  expect(v2?.tasks.find(task => task.taskId === 'pl-a')).toMatchObject({ disposition: 'superseded', replacedByTaskId: 'pl-a2' });
}, 240_000);
