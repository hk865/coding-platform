/**
 * PL-34 (spec §15.4, v4 §15-34): the adviser replaces the Task a yielded
 * executor is waiting on.
 *
 * A's real Work Run sends M to the adviser and yields. The adviser's real
 * `submit_plan_round` (a `plan` answer) writes the candidate that supersedes A
 * and adds A2; the reviewer's real `submit_plan_review` passes it. The Goal loop
 * then cancels A's yielded Run through the existing control owner, adopts the
 * candidate, and replies M once. A stays `superseded`; A2 carries the
 * replacement. The row reopens the Host after the cancel submit (SQLite) and
 * again after the adoption submit.
 */
import { afterEach, expect, it, vi } from 'vitest';
import type { PlanProposal } from '../../src/core/work-graph/model/plan-contracts.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type { PlanRevisionDraft, PlanRevisionSnapshot } from '../../src/contracts/plan.js';
import { advanceUntil, post, readExecution } from '../helpers/A2-restart-fixture.js';
import { plain } from '../helpers/AG2b-collaboration-fixture.js';
import { createS6BLine } from '../helpers/S6B1-fixture.js';
import type { S6AHostWorld } from '../helpers/S6A-host-fixture.js';
import { OPERATOR, S6A_SCOPE, S6A_WORK_ROLE, type S6AExtraBinding } from '../helpers/S6A-request-fixture.js';
import { bindingOf, checkConfiguration, ready, sessionOf, setS7AAutonomy } from '../helpers/S7A-fixture.js';
import {
  awaitPlanningAnswer, awaitProposal, heartbeatUntilModel, proposalRefOf, readProposal, settleHost,
} from '../helpers/IV-host-fixture.js';
import { readS7BMessage } from '../helpers/S7B-fixture.js';
import { byIdentityPrefix, commitBarrier } from '../helpers/S6A-commit-barrier.js';
import { createPLAdviserLine, sendPLActionWait } from '../helpers/PL-consumption-fixture.js';
import {
  adoptPLTwoStageSkeleton, advancePLGoal, createPLReviewerLine, openPLWorkflowWorld, plPlanChangeDraft,
  plSupersedeDraft, plSystemRoundRef, plToolPlanOf, type PLWorkflowWorld,
} from '../helpers/PL-workflow-fixture.js';

/** The sender's real tool merge: the Work binding may call `send_session_message`. */
const SEND_TOOLS: S6AExtraBinding = {
  binding: bindingOf('s6a-work-binding', S6A_WORK_ROLE, 'PL-34 trusted work guidance', ['read']),
  mergeTools: ['send_session_message'],
};

vi.mock('../../src/core/record-store/in-memory-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-commit-barrier.js')).inMemoryBarrierModule(importOriginal));
vi.mock('../../src/core/record-store/sqlite-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-commit-barrier.js')).sqliteBarrierModule(importOriginal));

let opened: PLWorkflowWorld | null = null;
afterEach(async () => {
  commitBarrier.reset();
  await opened?.close().catch(() => undefined);
  opened = null;
});

it('PL-34: the platform cancels A\'s yielded Run before adopting the replacement candidate', async () => {
  const workflow = opened = await openPLWorkflowWorld({ backend: 'sqlite', label: 'pl-34',
    extraBindings: [SEND_TOOLS],
    extraHostOptions: { checks: checkConfiguration({ kind: 'human', id: OPERATOR.id }) } });
  const { world, main, goal } = workflow;
  await settleHost(world);
  const skeleton = await adoptPLTwoStageSkeleton(main, goal, { label: 'pl-34',
    stageOneTaskIds: ['pl-a', 'pl-b'] });
  await setS7AAutonomy(world, goal, 'after_plan_confirmation');
  const line = await sessionOf(world, await createS6BLine(main, { label: 'pl-34-line',
    role: S6A_WORK_ROLE, tasks: skeleton.tasks.filter(task => ['pl-a', 'pl-b'].includes(task.taskId)) }));
  const adviser = await createPLAdviserLine(world, 'pl-34-adviser');
  const reviewer = await createPLReviewerLine(world, main, 'pl-34-reviewer');
  await world.scripted.script(reviewer, [{ kind: 'calls', calls: [{ callId: 'pl34-review',
    name: 'submit_plan_review', args: { verdict: 'pass', findings: [] } }] }]);

  // A yields on M to the adviser; the Host builds the planning Query and holds it.
  const gate = await world.gates.modelRequest(adviser);
  const sent = await sendPLActionWait(world, { goal, session: line, sessionTaskId: 'pl-a',
    recipient: adviser.ref, text: 'PL34: A cannot continue on this premise', label: 'pl34' });
  const held = await heartbeatUntilModel(world, gate);

  // The adviser's real submit_plan_round form, from the active Plan's replacement draft.
  const draft = plSupersedeDraft(skeleton.plan, goal, 'pl-34');
  await world.scripted.script(adviser, [{ kind: 'calls', calls: [{ callId: 'pl34-plan',
    name: 'submit_plan_round', args: {
      answerKind: 'plan', summary: 'PL-34 replace A with A2',
      plan: plToolPlanOf(draft),
      reason: { text: 'PL-34 A is replaced by A2', affectedTaskIds: ['pl-a'] },
    } }] }]);
  gate.release();
  await held.settled;

  const proposalRef = proposalRefOf(sent.message.ref, goal);
  const candidate = await (async (): Promise<PlanProposal> => {
    for (let pass = 0; pass < 16; pass += 1) {
      const read = (await world.post('plans/proposal', plain(S6A_SCOPE, proposalRef))).body as
        { status?: string; value?: PlanProposal };
      if (read.status === 'ready' && read.value?.status === 'candidate') return read.value;
      await settleHost(world);
    }
    throw new Error('PL-34: the candidate was not written');
  })();
  const replaced = candidate.draft.tasks.find(task => task.taskId === 'pl-a');
  expect(replaced).toMatchObject({ disposition: 'superseded', replacedByTaskId: 'pl-a2' });
  expect(candidate.reason.affectedTaskIds).toEqual(['pl-a']);
  expect(candidate.sourceMessageRef).toEqual(sent.message.ref);

  // The Goal loop sends the review and the reviewer's real tool passes it.
  const reviewSend = await advanceUntil(world.ag2b,
    { schemaVersion: 1, goalRef: goal, flowId: 'pl-34-review', sessionHint: null, kind: 'select_work' },
    'send_system_round');
  ready(await post(world.ag2b, 'workflow/advance', plain(S6A_SCOPE, reviewSend)), 'the planreview send');
  const reviewRef = await plSystemRoundRef(workflow, reviewer, `planreview:${candidate.ref.proposalId}:`);
  await awaitPlanningAnswer(world, reviewRef);

  // The loop's adopt pass selects the platform cancel first.
  const cancelStep = await advanceUntil(world.ag2b,
    { schemaVersion: 1, goalRef: goal, flowId: 'pl-34-cancel', sessionHint: null, kind: 'select_work' },
    'cancel_yielded_wait');
  ready(await post(world.ag2b, 'workflow/advance', plain(S6A_SCOPE, cancelStep)), 'the yielded cancel');
  const cancelled = await readExecution(world.ag2b, sent.run);
  expect(cancelled.run.controlState?.desiredState, 'the queued cancel fences A\'s continuation').toBe('cancelled');
  expect((await readProposal(world, proposalRef)).status, 'the cancel never adopts by itself').toBe('candidate');

  // Restart window 1: the cancel intent is readable; adoption continues on the new Host.
  await world.reopen();
  await settleHost(world);
  const adoptStep = await advanceUntil(world.ag2b,
    { schemaVersion: 1, goalRef: goal, flowId: 'pl-34-adopt', sessionHint: null, kind: 'select_work' },
    'adopt_plan');
  // Restart window 2: fail the reply's real store commit once. The adoption
  // lands, the proposal is accepted and M is still unanswered; the reopened
  // Host's accepted-candidate scan then writes the one reply.
  const replyFault = commitBarrier.failCommitOnce(byIdentityPrefix('session-message-respond_from_query_answer:'));
  const adoption = await post<{ status: string; code?: string }>(
    world.ag2b, 'workflow/advance', plain(S6A_SCOPE, adoptStep));
  expect(adoption.status).toBe('rejected');
  expect(adoption.code).toBe('unavailable');
  replyFault.release();
  expect((await readProposal(world, proposalRef)).status, 'the adoption landed before the reply failed').toBe('accepted');
  expect((await readS7BMessage(world, sent.message.ref)).response, 'M is still unanswered').toBeNull();

  await world.reopen();
  await settleHost(world);
  await advancePLGoal(world, goal, 'pl-34-restart-read');
  const replied = await readS7BMessage(world, sent.message.ref);
  expect(replied.response, 'M got its one reply').not.toBeNull();
  const repliedAgain = await readS7BMessage(world, sent.message.ref);
  expect(repliedAgain.response).toEqual(replied.response);

  const v2 = await main.activePlan(goal);
  if (v2 === null) throw new Error('PL-34: v2 is not active');
  expect(v2.planRevision).toBe(skeleton.plan.planRevision + 1);
  expect((await readProposal(world, proposalRef)).status).toBe('accepted');
  const a = v2.tasks.find(task => task.taskId === 'pl-a');
  expect(a).toMatchObject({ disposition: 'superseded', replacedByTaskId: 'pl-a2' });
  expect(v2.tasks.find(task => task.taskId === 'pl-a2')).toBeDefined();

  // A still has exactly its one yielded Run; the cancel did not start its continuation.
  const aRuns = (await world.post('executions/list', plain(S6A_SCOPE, {
    goalRef: goal, taskId: 'pl-a', page: { afterCursor: null, limit: 50 },
  }))).body as { status?: string; value?: { items?: unknown[] } };
  expect(aRuns.status).toBe('ready');
  expect(aRuns.value?.items ?? []).toHaveLength(1);
}, 240_000);

/** The same candidate replaces B (first, never run) and A (second, the yielded Run's Task). */
function plSupersedeBothDraft(plan: PlanRevisionSnapshot, goal: GoalRef, label: string): PlanRevisionDraft {
  const b = plan.tasks.find(task => task.taskId === 'pl-b');
  const a = plan.tasks.find(task => task.taskId === 'pl-a');
  if (a === undefined || b === undefined) throw new Error('PL-34: the skeleton tasks are missing');
  const replacement = (taskId: string, stageId: string) => ({
    taskId, stageId, title: `${label} replacement ${taskId}`, requirementLevel: 'required' as const,
    taskKind: 'work' as const, disposition: 'active' as const, phase: 'pending' as const,
    scope: { kind: 'stage' as const, stageId }, executionIntent: 'request_execution' as const, sizeClass: 'small' as const,
  });
  return plPlanChangeDraft(plan, goal, {
    planId: `pl-plan-${label}`,
    tasks: [
      { ...b, disposition: 'superseded' as const, replacedByTaskId: 'pl-b2' },
      { ...a, disposition: 'superseded' as const, replacedByTaskId: 'pl-a2' },
      ...plan.tasks.filter(task => task.taskId !== 'pl-a' && task.taskId !== 'pl-b'),
      replacement('pl-a2', 'pl-stage-1'), replacement('pl-b2', 'pl-stage-1'),
    ],
    assignments: [...(plan.assignments ?? []),
      { taskId: 'pl-a2', role: S6A_WORK_ROLE.templateId, instruction: `${label} replacement A2 instruction` },
      { taskId: 'pl-b2', role: S6A_WORK_ROLE.templateId, instruction: `${label} replacement B2 instruction` }],
    obligations: plan.obligations.map(obligation => obligation.obligationId === 'pl-obligation-stage-1'
      ? { ...obligation, taskIds: [...obligation.taskIds, 'pl-a2', 'pl-b2'] } : obligation),
  });
}

it('PL-34: a candidate replacing B (first, never run) and A still cancels A\'s yielded Run and adopts', async () => {
  const workflow = opened = await openPLWorkflowWorld({ backend: 'memory', label: 'pl-34-both',
    extraBindings: [SEND_TOOLS],
    extraHostOptions: { checks: checkConfiguration({ kind: 'human', id: OPERATOR.id }) } });
  const { world, main, goal } = workflow;
  await settleHost(world);
  const skeleton = await adoptPLTwoStageSkeleton(main, goal, { label: 'pl-34-both',
    stageOneTaskIds: ['pl-b', 'pl-a'] });
  await setS7AAutonomy(world, goal, 'after_plan_confirmation');
  const line = await sessionOf(world, await createS6BLine(main, { label: 'pl-34-both-line',
    role: S6A_WORK_ROLE, tasks: skeleton.tasks.filter(task => ['pl-a', 'pl-b'].includes(task.taskId)) }));
  const adviser = await createPLAdviserLine(world, 'pl-34-both-adviser');
  const reviewer = await createPLReviewerLine(world, main, 'pl-34-both-reviewer');
  await world.scripted.script(reviewer, [{ kind: 'calls', calls: [{ callId: 'pl34b-review',
    name: 'submit_plan_review', args: { verdict: 'pass', findings: [] } }] }]);

  const gate = await world.gates.modelRequest(adviser);
  const sent = await sendPLActionWait(world, { goal, session: line, sessionTaskId: 'pl-a',
    recipient: adviser.ref, text: 'PL34b: A cannot continue on this premise', label: 'pl34b' });
  const held = await heartbeatUntilModel(world, gate);
  const draft = plSupersedeBothDraft(skeleton.plan, goal, 'pl-34-both');
  await world.scripted.script(adviser, [{ kind: 'calls', calls: [{ callId: 'pl34b-plan',
    name: 'submit_plan_round', args: { answerKind: 'plan', summary: 'PL-34b replace B and A',
      plan: plToolPlanOf(draft), reason: { text: 'PL-34b replace B then A', affectedTaskIds: ['pl-b', 'pl-a'] } } }] }]);
  gate.release();
  await held.settled;

  const proposalRef = proposalRefOf(sent.message.ref, goal);
  const candidate = ready<PlanProposal>(await awaitProposal(world, proposalRef), 'the both candidate');
  expect(candidate.draft.tasks.filter(task => task.disposition === 'superseded').map(task => task.taskId))
    .toEqual(['pl-b', 'pl-a']);
  expect(candidate.reason.affectedTaskIds).toEqual(['pl-b', 'pl-a']);

  const reviewSend = await advanceUntil(world.ag2b,
    { schemaVersion: 1, goalRef: goal, flowId: 'pl-34-both-review', sessionHint: null, kind: 'select_work' },
    'send_system_round');
  ready(await post(world.ag2b, 'workflow/advance', plain(S6A_SCOPE, reviewSend)), 'the planreview send');
  await awaitPlanningAnswer(world, await plSystemRoundRef(workflow, reviewer, `planreview:${candidate.ref.proposalId}:`));

  const cancelStep = await advanceUntil(world.ag2b,
    { schemaVersion: 1, goalRef: goal, flowId: 'pl-34-both-cancel', sessionHint: null, kind: 'select_work' },
    'cancel_yielded_wait');
  ready(await post(world.ag2b, 'workflow/advance', plain(S6A_SCOPE, cancelStep)), 'the yielded cancel');
  expect((await readExecution(world.ag2b, sent.run)).run.controlState?.desiredState).toBe('cancelled');

  const adoptStep = await advanceUntil(world.ag2b,
    { schemaVersion: 1, goalRef: goal, flowId: 'pl-34-both-adopt', sessionHint: null, kind: 'select_work' },
    'adopt_plan');
  ready(await post(world.ag2b, 'workflow/advance', plain(S6A_SCOPE, adoptStep)), 'the replacement adoption');
  expect((await readProposal(world, proposalRef)).status).toBe('accepted');
  const v2 = await main.activePlan(goal);
  if (v2 === null) throw new Error('PL-34: v2 is not active');
  expect(v2.tasks.find(task => task.taskId === 'pl-a')).toMatchObject({ disposition: 'superseded' });
  expect(v2.tasks.find(task => task.taskId === 'pl-b')).toMatchObject({ disposition: 'superseded' });
}, 240_000);
