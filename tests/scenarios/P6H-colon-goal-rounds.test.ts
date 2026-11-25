/**
 * P6H (lead 11-25): a Goal id carries colons (`goal-confirm:goal.confirmDraft:<hash>`), and every
 * platform system round names it in its first line. The reader must find the round by the stored
 * receipt, not by a fixed segment count; the input supply must not swallow the letter as ordinary mail.
 *
 * Public steps only: the real Host world, `goals/create` (a literal colon id), `plans/propose`/`plans/apply`,
 * `role-lines/open` + `goals/adviser-queue/assign`, the Goal driver, the real Host consume loop, and the
 * `messages/*`, `queries/read` and `plans/proposal` reads.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type { PlanRevisionDraft, PlanRevisionSnapshot } from '../../src/contracts/plan.js';
import { interventionPlanningQueryRefs } from '../../src/contracts/query-job.js';
import { systemRoundMessageRef } from '../helpers/system-round-ref.js';
import type { RunRef } from '../../src/contracts/dispatch.js';
import type { ForwardMessageResultV1 } from '../../src/core/work-graph/model/communication-contracts.js';
import { advanceUntil, driveWorkflow } from '../helpers/A2-restart-fixture.js';
import { graphWrite, plain } from '../helpers/AG2b-collaboration-fixture.js';
import { startGoalDriver } from '../helpers/DRV-fixture.js';
import { sendS7A2PersonMessage } from '../helpers/S7A2-fixture.js';
import {
  answerCard, consumeView, heartbeatUntil, proposalRefOf, questionCards, readBody, readPlanningQuery,
  settleHost,
} from '../helpers/IV-host-fixture.js';
import {
  createPLLine, openPLConsumptionWorld, seedPLSenderPlan, sendPLActionWait, sendPLRefine,
} from '../helpers/PL-consumption-fixture.js';
import { usage } from '../helpers/PL-readings-fixture.js';
import { adoptPLPlanDraft, plToolPlanOf } from '../helpers/PL-workflow-fixture.js';
import { s6aCardsWorkspace } from '../helpers/S6A-cards-fixture.js';
import type { S6AHostWorld } from '../helpers/S6A-host-fixture.js';
import { S6A_SCOPE, S6A_WORK_ROLE } from '../helpers/S6A-request-fixture.js';
import { assignGoalAdviserLine } from '../helpers/S7C-handoff-fixture.js';
import { committed, ready } from '../helpers/S7A-fixture.js';
import { listed, readS7BMessage } from '../helpers/S7B-fixture.js';

const COLON_GOAL_ID = 'goal-confirm:goal.confirmDraft:a1';

const worlds: S6AHostWorld[] = [];
afterEach(async () => {
  for (const world of worlds.splice(0)) await world.close().catch(() => undefined);
});

/** One required active `plan_only` placeholder under stage `s2`, so the Goal driver reaches the refine gap. */
function s2PlaceholderDraft(goal: GoalRef): PlanRevisionDraft {
  return {
    schemaVersion: 2, planId: 'p6h-plan', planRevision: 1, goalId: goal.goalId,
    stages: [{ stageId: 's2', title: 'P6H stage s2' }],
    tasks: [{
      taskId: 's2-placeholder', stageId: 's2', title: 'P6H s2 placeholder',
      requirementLevel: 'required', taskKind: 'work', disposition: 'active', phase: 'pending',
      scope: { kind: 'stage', stageId: 's2' }, executionIntent: 'plan_only',
    }],
    assignments: [], obligations: [], taskHierarchy: { parentOf: [] },
    executionDag: { dependsOn: [] }, taskRelations: [], inputRequirements: [],
  };
}

/** The colon Goal through `goals/create`, optionally its first s2 placeholder Plan, and the adviser assignment. */
async function openColonGoalWorld(label: string, withS2Placeholder = true): Promise<{
  world: S6AHostWorld; goal: GoalRef; adviser: Awaited<ReturnType<typeof assignGoalAdviserLine>>;
}> {
  const world = await openPLConsumptionWorld({ label });
  worlds.push(world);
  await settleHost(world);
  const main = s6aCardsWorkspace(world, S6A_SCOPE);
  const goal = (await main.createGoal(COLON_GOAL_ID, `P6H ${label}: the colon Goal`)).ref;
  if (withS2Placeholder) {
    const draft = s2PlaceholderDraft(goal);
    const proposed = committed<{ ref: unknown; revision: number }>(await main.post('plans/propose',
      graphWrite(S6A_SCOPE, { goalRef: goal, basedOn: null, draft,
        reason: { text: `P6H ${label} plan`, sources: [] } }, `p6h-${label}-propose`)),
    `the P6H ${label} plan`);
    committed(await main.post('plans/apply', graphWrite(S6A_SCOPE, {
      proposalRef: proposed.ref, expectedProposalRevision: proposed.revision, decisionRefs: [],
    }, `p6h-${label}-apply`)), `the adoption of ${label}`);
  }
  const adviser = await assignGoalAdviserLine(world, { goal, label: `p6h-${label}-adviser`,
    requestId: `p6h-${label}-adviser` });
  return { world, goal, adviser };
}


/** The adopted Plan one revision on, with the s2 placeholder made executable. */
function s2ExecutableDraft(plan: PlanRevisionSnapshot): PlanRevisionDraft {
  const placeholder = plan.tasks.find(task => task.taskId === 's2-placeholder');
  if (placeholder === undefined) throw new Error('P6H r4: the s2 placeholder is missing');
  return {
    schemaVersion: 2, planId: plan.planId, planRevision: plan.planRevision + 1, goalId: plan.goalRef.goalId,
    stages: structuredClone(plan.stages),
    tasks: plan.tasks.map(task => task.taskId === placeholder.taskId
      ? { ...structuredClone(task), executionIntent: 'request_execution' as const, estimatedLines: 10,
        sizeClass: 'small' as const }
      : structuredClone(task)),
    assignments: [...(plan.assignments ?? []), { taskId: placeholder.taskId, role: S6A_WORK_ROLE.templateId,
      instruction: 'P6H r4 the refined s2 work' }],
    obligations: structuredClone(plan.obligations), taskHierarchy: structuredClone(plan.taskHierarchy),
    executionDag: structuredClone(plan.executionDag),
    ...(plan.taskRelations === undefined ? {} : { taskRelations: structuredClone(plan.taskRelations) }),
    ...(plan.inputRequirements === undefined ? {} : { inputRequirements: structuredClone(plan.inputRequirements) }),
  };
}

describe('P6H: system rounds of a Goal whose id carries colons', () => {
  it('row 1: the Goal driver sends refine:<colon-goal>:s2:1 and its source opens one planning Query',
    async () => {
      const { world, goal, adviser } = await openColonGoalWorld('r1');
      await startGoalDriver(world, goal, 'p6h-r1');
      const view = await consumeView(world, adviser);
      expect(view?.nextMessage?.kind, 'the Host offers the letter as a trusted system round')
        .toBe('system_round');
      const requestId = `refine:${goal.goalId}:s2:1`;
      const expected = systemRoundMessageRef(S6A_SCOPE, requestId);
      if (expected.status !== 'ready') throw new Error('P6H: the refine has no message ref');
      const inbox = await heartbeatUntil(world, () => listed(world, 'inbox', adviser),
        items => items.some(message => message.ref.messageId === expected.value.messageId), 16);
      expect(inbox.some(message => message.ref.messageId === expected.value.messageId),
        'the Goal driver sent the refine to the adviser line').toBe(true);
      const message = await readS7BMessage(world, expected.value);
      const body = ready<{ text: string }>(await world.post('messages/body',
        plain(S6A_SCOPE, { messageRef: message.ref, part: 'message' })), 'the refine body');
      expect(body.text.split('\n')[0]).toBe(`refine:${goal.goalId}:s2:1`);
      const query = await heartbeatUntil(world, () => readPlanningQuery(world, message.ref),
        value => value !== null, 16);
      expect(query, 'one planning Query takes the refine as its source').not.toBeNull();
      expect((message.acceptedInputs ?? []).filter(entry => entry.part === 'message'),
        'no other Query took the refine as ordinary mail').toEqual([]);
    }, 120_000);

  it('row 2: a colon Goal and a colon Task make deviation:<goal>:t:2:budget:1 with taskRef t:2', async () => {
    const { world, goal, adviser } = await openColonGoalWorld('r2', false);
    const seeded = await seedPLSenderPlan(world, { goal, label: 'r2', taskIds: ['t:2'] });
    expect(await world.settings('run-budget/save', { workRunTokenBudget: 100_000 }))
      .toMatchObject({ status: 'ready' });
    await world.scripted.script(seeded.line, [
      { kind: 'text', text: 'P6H r2 the Run overruns its budget', usage: usage(150_000, 0) },
    ]);
    await driveWorkflow(world.ag2b, { schemaVersion: 1, goalRef: goal, flowId: 'p6h-r2-work',
      sessionHint: seeded.line.ref, kind: 'select_work', taskId: 't:2' }, { stopBefore: 'open_checks' });
    const send = await advanceUntil(world.ag2b, { schemaVersion: 1, goalRef: goal,
      flowId: 'p6h-r2-deviation', sessionHint: null, kind: 'select_work' }, 'send_system_round');
    await world.post('workflow/advance', plain(S6A_SCOPE, send));
    const requestId = `deviation:${goal.goalId}:t:2:budget:1`;
    const expected = systemRoundMessageRef(S6A_SCOPE, requestId);
    if (expected.status !== 'ready') throw new Error('P6H: the deviation has no message ref');
    const view = await consumeView(world, adviser);
    expect(view?.nextMessage?.kind, 'the Host offers the deviation as a trusted system round')
      .toBe('system_round');
    const message = await readS7BMessage(world, expected.value);
    const body = ready<{ text: string }>(await world.post('messages/body',
      plain(S6A_SCOPE, { messageRef: message.ref, part: 'message' })), 'the deviation body');
    expect(body.text.split('\n')[0]).toBe(`deviation:${goal.goalId}:t:2:budget:1`);
    expect(message.taskRef?.taskId, 'the Task keeps its colon id').toBe('t:2');
    const query = await heartbeatUntil(world, () => readPlanningQuery(world, message.ref),
      value => value !== null, 16);
    expect(query, 'one planning Query takes the deviation as its source').not.toBeNull();
    expect((message.acceptedInputs ?? []).filter(entry => entry.part === 'message'),
      'no other Query took the deviation as ordinary mail').toEqual([]);
  }, 120_000);

  it('row 3: planresume carries the colon Goal and the original question and answer', async () => {
    const { world, goal, adviser } = await openColonGoalWorld('r3', false);
    const seeded = await seedPLSenderPlan(world, { goal, label: 'r3', taskIds: ['r3-work'] });
    const task = seeded.tasks[0];
    if (task === undefined) throw new Error('P6H r3: the Plan has no Task');
    await world.scripted.script(adviser, [
      { kind: 'calls', calls: [{ callId: 'p6h-r3-questions', name: 'submit_plan_round', args: {
        answerKind: 'questions', summary: 'P6H r3 the person is asked',
        questions: ['验收用什么？'], reason: { text: 'P6H r3 ask the person' },
      } }] },
      { kind: 'text', text: 'P6H r3 final answer' },
    ]);
    const m = await sendPLActionWait(world, { goal, session: seeded.line, sessionTaskId: task.taskId,
      recipient: adviser.ref, text: 'P6H r3 decide the next step', taskRef: task, label: 'r3' });
    const cards = await heartbeatUntil(world, () => questionCards(world, goal),
      items => items.length > 0, 24);
    expect(cards, 'the adviser asks one question').toHaveLength(1);
    const card = cards[0];
    if (card === undefined) throw new Error('P6H r3: the question card is missing');
    await answerCard(world, card, 'p6h-r3-card', '运行 node --test');
    await driveWorkflow(world.ag2b, { schemaVersion: 1, goalRef: goal, flowId: 'p6h-r3-resume',
      sessionHint: null, kind: 'select_work' });
    const original = interventionPlanningQueryRefs(m.message.ref);
    const requestId = `planresume:${goal.goalId}:${original.queryJobRef.queryJobId}`;
    const expected = systemRoundMessageRef(S6A_SCOPE, requestId);
    if (expected.status !== 'ready') throw new Error('P6H r3: the planresume has no message ref');
    const inbox = await heartbeatUntil(world, () => listed(world, 'inbox', adviser),
      items => items.some(message => message.ref.messageId === expected.value.messageId), 24);
    const resumes = inbox.filter(message => message.ref.messageId === expected.value.messageId);
    expect(resumes, 'one new continuation round').toHaveLength(1);
    const resume = await readS7BMessage(world, expected.value);
    const body = await readBody(world, resume.ref, 'message');
    expect(body.split('\n')[1]?.startsWith('originalQueryRef: '),
      'the second line is the original Query reference').toBe(true);
    const query = await heartbeatUntil(world, () => readPlanningQuery(world, resume.ref),
      value => value !== null, 24);
    expect(query, 'the continuation opened its planning Query').not.toBeNull();
    const requests = await heartbeatUntil(world, () => world.scripted.requests(adviser),
      items => items.some(request => JSON.stringify(request).includes(requestId)), 24);
    const continuation = requests.find(request => JSON.stringify(request).includes(requestId));
    expect(continuation, 'the continuation made its model request').toBeDefined();
    if (continuation === undefined) return;
    const modelInput = JSON.stringify(continuation);
    expect(modelInput, 'the original question is assembled into the input').toContain('验收用什么？');
    expect(modelInput, 'the saved answer is assembled into the input').toContain('运行 node --test');
  }, 120_000);

  it('row 4: an earlier Query on the line does not take the colon-Goal refine as ordinary input', async () => {
    const { world, goal, adviser } = await openColonGoalWorld('r4', false);
    const main = s6aCardsWorkspace(world, S6A_SCOPE);
    const plan = await adoptPLPlanDraft(main, goal, s2PlaceholderDraft(goal), 'p6h-r4');
    const candidate = s2ExecutableDraft(plan);
    // The earlier ordinary member-planning Query asks for an executor and runs two model requests.
    await world.scripted.script(adviser, [
      { kind: 'calls', calls: [{ callId: 'p6h-r4-member', name: 'create_member', args: {
        duty: 'executor', scope: { kind: 'task', task: { projectId: goal.projectId, goalId: goal.goalId,
          taskId: 's2-placeholder' } }, reason: 'P6H r4 member planning' } }] },
      { kind: 'text', text: 'P6H r4 the member planning round is done' },
      { kind: 'calls', calls: [{ callId: 'p6h-r4-submit', name: 'submit_plan_round', args: {
        answerKind: 'plan', summary: 'P6H r4 the refine candidate',
        plan: plToolPlanOf(candidate), reason: { text: 'P6H r4 refine s2', affectedTaskIds: [] },
      } }] },
    ]);
    const member = await sendS7A2PersonMessage(world, { label: 'p6h-r4-member', recipient: adviser.ref,
      goal });
    // The member letter is queued first; the Goal driver sends the refine, then the Host opens the member Query.
    const refineRequestId = `refine:${goal.goalId}:s2:1`;
    const refineRef = systemRoundMessageRef(S6A_SCOPE, refineRequestId);
    if (refineRef.status !== 'ready') throw new Error('P6H r4: the refine has no message ref');
    await startGoalDriver(world, goal, 'p6h-r4');
    const memberAnswered = await heartbeatUntil(world, () => readS7BMessage(world, member.ref),
      message => message.response !== null, 32);
    expect(memberAnswered.response, 'the earlier member planning round ended').not.toBeNull();
    await heartbeatUntil(world, () => listed(world, 'inbox', adviser),
      items => items.some(message => message.ref.messageId === refineRef.value.messageId), 32);
    const refine = await readS7BMessage(world, refineRef.value);
    expect((refine.acceptedInputs ?? []).filter(entry => entry.part === 'message'),
      'the earlier Query did not take the refine as ordinary input').toEqual([]);
    const query = await heartbeatUntil(world, () => readPlanningQuery(world, refine.ref),
      value => value !== null, 32);
    expect(query, 'the refine opened its own planning Query').not.toBeNull();
    const proposal = await heartbeatUntil(world, async () => (await world.post('plans/proposal',
      plain(S6A_SCOPE, proposalRefOf(refine.ref, goal)))).body as { status: string;
        value?: { sourceMessageRef?: { messageId?: string } } }, read => read.status === 'ready', 32);
    expect(proposal.status, 'the refine Query wrote its candidate').toBe('ready');
    expect(proposal.value?.sourceMessageRef?.messageId,
      'the candidate source is the refine, not the member letter').toBe(refine.ref.messageId);
    expect(proposal.value?.sourceMessageRef?.messageId === member.ref.messageId,
      'the candidate is not sourced from the member letter').toBe(false);
  }, 120_000);

  it('row 5: a forwarded refine copy is ordinary mail, not the original trusted system round', async () => {
    const { world, goal } = await openColonGoalWorld('r5', false);
    const seeded = await seedPLSenderPlan(world, { goal, label: 'r5', taskIds: ['r5-work'] });
    const x = await createPLLine(world, { label: 'r5-x', role: S6A_WORK_ROLE });
    const y = seeded.line;
    const z = await createPLLine(world, { label: 'r5-z', role: S6A_WORK_ROLE });
    const refine = await sendPLRefine(world, { goal, line: x, taskId: 'r5-work',
      planRevision: seeded.plan.planRevision });
    await world.archive(x);
    // Y is working: its Run's first model request is held while the person forwards the refine to Y.
    await world.scripted.script(y, [{ kind: 'calls', calls: [{ callId: 'r5-busy', name: 'send_session_message',
      args: { recipient: z.ref, text: 'r5: Y is working' } }] }]);
    const held = await world.gates.modelRequest(y);
    const driving = driveWorkflow(world.ag2b, { schemaVersion: 1, goalRef: goal, flowId: 'r5-y',
      sessionHint: y.ref, kind: 'select_work', taskId: 'r5-work' }, { stopBefore: 'open_checks' });
    await held.reached;
    const forwarded = (await world.post('messages/forward', plain(S6A_SCOPE, {
      commandId: 'r5-forward', messageRef: refine.messageRef, to: y.ref,
    }))).body as ForwardMessageResultV1;
    if (forwarded.status !== 'forwarded') {
      throw new Error(`P6H r5: the forward did not commit: ${JSON.stringify(forwarded)}`);
    }
    const copy = forwarded.message;
    await world.scripted.script(y, [
      { kind: 'calls', calls: [{ callId: 'r5-reply', name: 'respond_session_message',
        args: { messageRef: copy.ref, expectedRevision: copy.revision, text: 'r5: Y answers the forward' } }] },
      { kind: 'text', text: 'r5: Y done' },
    ]);
    held.release();
    await driving;
    const facts = ready<{ latestWork: { runRef: RunRef } | null }>(await world.post('sessions/facts',
      plain(S6A_SCOPE, y.ref)), 'the Y facts');
    const run = facts.latestWork?.runRef;
    const answered = await readS7BMessage(world, copy.ref);
    expect((answered.acceptedInputs ?? []).filter(entry => entry.part === 'message')
      .map(entry => entry.executionRef), 'the working line takes the copy at a safe point').toEqual([run]);
    expect(answered.response?.sender, 'the copy is answered by the Work Run').toMatchObject({
      kind: 'work_run', runRef: run,
    });
    const original = await readS7BMessage(world, refine.messageRef);
    expect({ accepted: original.acceptedInputs ?? [], response: original.response,
      transferredTo: original.transferredTo },
    'the original is not taken and points at the copy').toEqual({
      accepted: [], response: null, transferredTo: copy.ref,
    });
    expect(await readPlanningQuery(world, copy.ref),
      'the copy is not treated as the original trusted system round').toBeNull();
  }, 120_000);
});
