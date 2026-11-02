/**
 * PL-35: the adviser answers a real Work Run's `action_request` with questions
 * (spec §15 PL-35). The Host consumes the request, opens the planning Query, the
 * adviser's saved `needs_decision` answer becomes one `planning_question` card,
 * and the executor M (the Work Run that let go) keeps its open wait with no
 * response while B really advances. After the person answers the card the goal
 * loop sends the deterministic `planresume:`; the adviser's final answer is the
 * one and only reply on M, and a second read shows the same single reply.
 *
 * Literal expectations: one waiting `planning_question` card; M's `response` is
 * null before the final terminal (at the card and after B's Run); the final
 * response body is the adviser's final answer exactly once.
 */
import { afterEach, expect, it } from 'vitest';
import { interventionPlanningQueryRefs } from '../../src/contracts/query-job.js';
import { driveWorkflow, readExecution } from '../helpers/A2-restart-fixture.js';
import { S7A_REPLY_TOOLS, checkConfiguration, ready, sessionOf } from '../helpers/S7A-fixture.js';
import { sendS7A2PersonMessage } from '../helpers/S7A2-fixture.js';
import { OPERATOR, S6A_SCOPE, S6A_WORK_ROLE } from '../helpers/S6A-request-fixture.js';
import { createS6BLine } from '../helpers/S6B1-fixture.js';
import { listed, readS7BMessage, readS7BWaits } from '../helpers/S7B-fixture.js';
import {
  answerCard, consumeView, heartbeat, heartbeatUntil, questionCards, readBody, sessionQueries, waitForResponse,
} from '../helpers/IV-host-fixture.js';
import {
  adoptPLTwoStageSkeleton, openPLWorkflowWorld, satisfyPLTask, type PLWorkflowWorld,
} from '../helpers/PL-workflow-fixture.js';
import { createPLAdviserLine, sendPLActionWait } from '../helpers/PL-consumption-fixture.js';

let opened: PLWorkflowWorld | null = null;
afterEach(async () => { await opened?.close(); opened = null; });

const FINAL = 'PL-35 final answer: option A';

it('PL-35: the adviser asks the person; M waits and is replied exactly once at the end', async () => {
  const workflow = opened = await openPLWorkflowWorld({ label: 'pl-35',
    extraBindings: [{ ...S7A_REPLY_TOOLS, mergeTools: ['send_session_message'] }],
    extraHostOptions: { checks: checkConfiguration({ kind: 'human', id: OPERATOR.id }) } });
  const skeleton = await adoptPLTwoStageSkeleton(workflow.main, workflow.goal, {
    label: 'pl-35', stageOneTaskIds: ['pl-a', 'pl-b'],
  });
  const aLine = await sessionOf(workflow.world, await createS6BLine(workflow.main, {
    label: 'pl-35-a', role: S6A_WORK_ROLE, tasks: skeleton.tasks.filter(task => task.taskId === 'pl-a'),
  }));
  const bLine = await sessionOf(workflow.world, await createS6BLine(workflow.main, {
    label: 'pl-35-b', role: S6A_WORK_ROLE, tasks: skeleton.tasks.filter(task => task.taskId === 'pl-b'),
  }));
  const adviser = await createPLAdviserLine(workflow.world, 'pl-35-adviser');
  await workflow.world.scripted.script(bLine, [{ kind: 'text', text: 'PL-35 B done' }]);
  await workflow.world.scripted.script(adviser, [
    { kind: 'calls', calls: [{
      callId: 'pl-35-questions', name: 'submit_plan_round', args: {
        answerKind: 'questions', summary: 'PL-35 which option should A take?',
        questions: ['PL-35 choose option A or option B'], reason: { text: 'PL-35 ask the person' },
      },
    }] },
    { kind: 'text', text: FINAL },
  ]);

  const aTask = skeleton.tasks.find(task => task.taskId === 'pl-a');
  if (aTask === undefined) throw new Error('PL-35: the pl-a Task is missing');
  // A real Work Run sends the action request and lets go; M's wait starts open.
  const sent = await sendPLActionWait(workflow.world, {
    goal: workflow.goal, session: aLine, sessionTaskId: 'pl-a', recipient: adviser.ref,
    text: 'PL-35 decide the next step for A', taskRef: aTask, label: 'pl-35-a-send',
  });
  expect((await readS7BMessage(workflow.world, sent.message.ref)).response).toBeNull();

  // The Host consumes the request and the adviser's questions answer becomes one waiting card.
  const cards = await heartbeatUntil(workflow.world, () => questionCards(workflow.world, workflow.goal),
    items => items.length > 0, 24);
  expect(cards).toHaveLength(1);
  expect(cards[0]?.source.kind).toBe('planning_question');
  expect(cards[0]?.state).toBe('waiting_answer');
  expect((await readS7BMessage(workflow.world, sent.message.ref)).response, 'the Host closing at src/app/host.ts:1919 calls associate_answer without replyToOriginal; '
    + 'src/business/workflow/intervention.ts:184 then replies the executor M at questions. ').toBeNull();
  // The card's source and pins name this round's own Query and its saved answer.
  const planning = interventionPlanningQueryRefs(sent.message.ref);
  expect(cards[0]?.source.pins.map(pin => pin.ref)).toContainEqual(planning.queryJobRef);
  const answerPin = cards[0]?.source.pins.find(pin => pin.ref.aggregateType === 'QueryJobAnswer');
  expect(answerPin?.ref).toMatchObject({ queryJobId: planning.queryJobRef.queryJobId });
  expect(cards[0]?.source.key).toContain(planning.queryJobRef.queryJobId);
  // A's Run is still the one that let go and M's wait is open.
  const openWait = async (): Promise<void> => {
    const execution = await readExecution(workflow.world.ag2b, sent.run);
    expect(execution.run).toMatchObject({ status: 'ended', outcome: 'yielded', continuation: { kind: 'wait_reply' } });
    const { waitByRef } = await readS7BWaits(workflow.world, { session: aLine, messageRef: sent.message.ref });
    expect(waitByRef.state.state).toBe('open');
  };
  await openWait();

  // B really advances while A's executor wait stays open (the sender drive may already have run it).
  const beforeB = ready<{ tasks: Array<{ ref: { taskId: string }; effectivePhase: string }> }>(
    await workflow.main.route('tasks/query', { goalRef: workflow.goal }), 'tasks/query');
  if (beforeB.tasks.find(task => task.ref.taskId === 'pl-b')?.effectivePhase !== 'satisfied') {
    await satisfyPLTask(workflow.world, workflow.goal, 'pl-b', bLine, 'pl-35-b');
  }
  const graph = ready<{ tasks: Array<{ ref: { taskId: string }; effectivePhase: string }> }>(
    await workflow.main.route('tasks/query', { goalRef: workflow.goal }), 'tasks/query');
  expect(graph.tasks.find(task => task.ref.taskId === 'pl-b')?.effectivePhase).toBe('satisfied');
  expect((await readS7BMessage(workflow.world, sent.message.ref)).response, 'the Host closing at src/app/host.ts:1919 calls associate_answer without replyToOriginal; '
    + 'src/business/workflow/intervention.ts:184 then replies the executor M at questions. ').toBeNull();
  await openWait();

  // The person answers the card; the goal loop sends the one `planresume:` and the adviser's
  // final answer is associated with M.
  const card = cards[0];
  if (card === undefined) throw new Error('PL-35: the question card disappeared');
  await answerCard(workflow.world, card, 'pl-35-card-answer', 'PL-35: use option A');
  await driveWorkflow(workflow.world.ag2b, { schemaVersion: 1, goalRef: workflow.goal,
    flowId: 'pl-35-resume', sessionHint: null, kind: 'select_work' });
  const resume = (await listed(workflow.world, 'inbox', adviser)).filter(message =>
    message.sender.kind === 'host' && message.sender.actor.kind === 'system');
  const resumeHeads = await Promise.all(resume.map(async message =>
    (await readBody(workflow.world, message.ref, 'message')).split('\n')[0] ?? ''));
  expect(resumeHeads.filter(head => head.startsWith('planresume:'))).toHaveLength(1);

  const replied = await waitForResponse(workflow.world, sent.message.ref, 32);
  expect(replied.response).not.toBeNull();
  const firstBody = await readBody(workflow.world, sent.message.ref, 'response');
  expect(firstBody).toBe(FINAL);

  // The one reply slot is re-read after a heartbeat: the same reply, never a second one.
  await heartbeat(workflow.world);
  const again = await readS7BMessage(workflow.world, sent.message.ref);
  expect(again.response?.bodyRef).toEqual(replied.response?.bodyRef);
  expect(await readBody(workflow.world, sent.message.ref, 'response')).toBe(firstBody);
  expect((await listed(workflow.world, 'inbox', adviser)).filter(message =>
    message.sender.kind === 'host' && message.sender.actor.kind === 'system').length)
    .toBe(resume.length);
  // The goal loop did not adopt anything on this branch.
  const proposalRead = ready<{ goal: { activePlanRevision: { planId: string } | null } }>(
    await workflow.world.post('goals/read', { scope: { ...S6A_SCOPE }, input: workflow.goal }), 'goals/read');
  expect(proposalRead.goal.activePlanRevision).toEqual(skeleton.plan.ref);
});

it('PL-35: a person\'s plain message ends when the card appears; it holds no wait and is not offered again', async () => {
  const workflow = opened = await openPLWorkflowWorld({ label: 'pl-35-person' });
  await adoptPLTwoStageSkeleton(workflow.main, workflow.goal, { label: 'pl-35-person', stageOneTaskIds: ['pl-a'] });
  const adviser = await createPLAdviserLine(workflow.world, 'pl-35-person-adviser');
  await workflow.world.scripted.script(adviser, [{ kind: 'calls', calls: [{
    callId: 'pl-35-person-questions', name: 'submit_plan_round', args: {
      answerKind: 'questions', summary: 'PL-35 the person is asked', questions: ['PL-35 which option?'],
      reason: { text: 'PL-35 ask the person' },
    } }] }]);
  const person = await sendS7A2PersonMessage(workflow.world, { label: 'pl-35-person', recipient: adviser.ref,
    goal: workflow.goal });

  const cards = await heartbeatUntil(workflow.world, () => questionCards(workflow.world, workflow.goal),
    items => items.length > 0, 24);
  expect(cards).toHaveLength(1);
  const closed = await heartbeatUntil(workflow.world, () => readS7BMessage(workflow.world, person.ref),
    message => message.response !== null, 24);
  expect(closed.status).toBe('responded');
  expect(closed.response?.sender.kind).toBe('query_run');
  // Nothing is left to feed the adviser: the line goes idle and no second round starts on this message.
  const queries = (await sessionQueries(workflow.world, adviser)).length;
  const view = await heartbeatUntil(workflow.world, () => consumeView(workflow.world, adviser),
    item => item?.availability === 'idle', 24);
  expect(view).toMatchObject({ availability: 'idle', busy: null, kinds: [], nextMessage: null });
  await heartbeat(workflow.world);
  await heartbeat(workflow.world);
  expect(await sessionQueries(workflow.world, adviser)).toHaveLength(queries);
  expect((await readS7BMessage(workflow.world, person.ref)).response?.bodyRef).toEqual(closed.response?.bodyRef);
  expect(await questionCards(workflow.world, workflow.goal)).toHaveLength(1);
});
