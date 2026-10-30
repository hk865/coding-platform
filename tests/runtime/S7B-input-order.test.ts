/**
 * I-order (SR7 §7.5; book-7b.md:1201; SR11 §11.5's `I-order`, L's merge): the person's message first (the frozen `host`
 * sender with a human actor) while the wait is `answered`; then the reply as the continuation, accepted once; a response
 * sorts by `responseSince`, not the question's `since`; agent messages by commit order; an intervention execution gets
 * no bound reply and no agent `action_request`.
 *
 * The accepted sequence is read from the real `executions/history` with the canonical `decodeKernelEntry`; the commits
 * are arranged so the async question's `since` is earlier than the agent letters while its reply's `responseSince` is
 * later. The intervention entry is `platform.workflow.handleIntervention` (L publishes B's port).
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { WorkflowStepReceipt } from '../../src/business/workflow/contracts.js';
import type { HandleInterventionResultV1 } from '../../src/business/workflow/ports.js';
import { decodeKernelEntry } from '../../src/core/agent-runtime/kernel-turn-facts.js';
import type { SessionHistoryEntry } from '../../src/core/agent-runtime/session-operations.js';
import {
  deriveSessionInputId, type SessionMessage,
} from '../../src/core/work-graph/model/communication-contracts.js';
import type { TaskExecutionRecord } from '../../src/core/work-graph/model/execution-read-contracts.js';
import type { SessionWaitV1 } from '../../src/core/work-graph/model/session-facts-contracts.js';
import { driveWorkflow, readExecution } from '../helpers/A2-restart-fixture.js';
import { graphWrite, plain } from '../helpers/AG2b-collaboration-fixture.js';
import { s6aCardsWorkspace } from '../helpers/S6A-cards-fixture.js';
import { callPublishedOwnerAsHost, type S6AHostWorld } from '../helpers/S6A-host-fixture.js';
import { S6A_SCOPE, S6A_WORK_ROLE } from '../helpers/S6A-request-fixture.js';
import { adoptS6BPlan, createS6BLine } from '../helpers/S6B1-fixture.js';
import { claimedRunOf, committed, ready, replyS7AMessage, sessionOf } from '../helpers/S7A-fixture.js';
import { acceptS7BReply, openS7BWorld } from '../helpers/S7B-fixture.js';

const worlds: S6AHostWorld[] = [];
afterEach(async () => { for (const world of worlds.splice(0)) await world.close().catch(() => undefined); });

/** The Host's claimed → prepare/start dispatch: drive the bare claim on the claimed Session/Task. */
async function startIntervention(world: S6AHostWorld, claim: {
  runRef: { runId: string }; sessionRef: { projectId: string; sessionId: string };
  task: { projectId: string; goalId: string; taskId: string };
}): Promise<void> {
  await driveWorkflow(world.ag2b, { schemaVersion: 1,
    goalRef: { aggregateType: 'Goal', projectId: claim.task.projectId, goalId: claim.task.goalId },
    flowId: `intervention:${claim.runRef.runId}`, sessionHint: claim.sessionRef,
    kind: 'select_work', taskId: claim.task.taskId });
}

describe('the mailbox input order around an answered wait', () => {
  it('proves person first, the continuation reply once, responseSince and agent commit order from the Kernel history', async () => {
    const { world } = await openS7BWorld({ backend: 'memory' });
    worlds.push(world);
    const main = s6aCardsWorkspace(world, S6A_SCOPE);
    const goal = (await main.createGoal('s7b-order-goal', 'S7B order goal')).ref;
    const { tasks } = await adoptS6BPlan(main, goal, { label: 's7b-order',
      taskIds: ['s7b-order-async', 's7b-order-wait', 's7b-order-async-reply', 's7b-order-reply'],
      role: S6A_WORK_ROLE.templateId });
    const sender = await sessionOf(world, await createS6BLine(main, { label: 's7b-order-sender',
      role: S6A_WORK_ROLE, tasks: [tasks[0]!, tasks[1]!] }));
    const recipient = await sessionOf(world, await createS6BLine(main, { label: 's7b-order-recipient',
      role: S6A_WORK_ROLE }));

    // One real Run sends an asynchronous question (no wait); the next Task's Run sends the waiting one and yields.
    const asyncQuestion = 'S7B order async question';
    await world.scripted.script(sender, [
      { kind: 'calls', calls: [{ callId: 's7b-order-async', name: 'send_session_message',
        args: { recipient: recipient.ref, text: asyncQuestion, intent: 'inquiry', needsReply: true } }] },
      { kind: 'text', text: 'S7B order async sent' },
      { kind: 'calls', calls: [{ callId: 's7b-order-wait', name: 'send_session_message',
        args: { recipient: recipient.ref, text: 'S7B order wait question', intent: 'inquiry',
          needsReply: true, waitAfterSend: true } }] },
      { kind: 'text', text: 'S7B order wait answered' },
    ]);
    await driveWorkflow(world.ag2b, { schemaVersion: 1, goalRef: goal, flowId: 's7b-order-async',
      sessionHint: sender.ref, kind: 'select_work', taskId: tasks[0]!.taskId });
    const receipts: WorkflowStepReceipt[] = [];
    await driveWorkflow(world.ag2b, { schemaVersion: 1, goalRef: goal, flowId: 's7b-order-wait',
      sessionHint: sender.ref, kind: 'select_work', taskId: tasks[1]!.taskId }, { receipts });
    const { run } = claimedRunOf(receipts, 'the order sender');
    const outbox = ready<{ items: SessionMessage[] }>(await world.post('messages/outbox',
      plain(S6A_SCOPE, { senderSession: sender.ref, page: { limit: 20 } })), 'the order sender outbox');
    const asyncMessage = outbox.items.find(message => message.waitAfterSend !== true);
    const waiting = outbox.items.find(message => message.waitAfterSend === true);
    if (asyncMessage === undefined || waiting === undefined)
      throw new Error('S7B: the order sender outbox lacks its questions');

    // Person, then the two agent letters in commit order; the async question came first but its reply comes last.
    const person = committed<SessionMessage>(await world.post('messages/send', graphWrite(S6A_SCOPE, {
      recipient: sender.ref, text: 'S7B order person body', intent: 'action_request', needsReply: true,
    }, 's7b-order-person')), 'the person message');
    const firstAgent = committed<SessionMessage>(await world.dispatch('messages/send', world.systemContext(),
      graphWrite(S6A_SCOPE, {
        recipient: sender.ref, text: 'S7B order first agent body', intent: 'action_request', needsReply: true,
      }, 's7b-order-agent-first')), 'the first agent message');
    const secondAgent = committed<SessionMessage>(await world.dispatch('messages/send', world.systemContext(),
      graphWrite(S6A_SCOPE, {
        recipient: sender.ref, text: 'S7B order second agent body', intent: 'action_request', needsReply: true,
      }, 's7b-order-agent-second')), 'the second agent message');
    await replyS7AMessage(world, { goal, recipient, messageRef: asyncMessage.ref,
      taskId: tasks[2]!.taskId, label: 's7b-order-async', text: 'S7B order async reply' });
    await replyS7AMessage(world, { goal, recipient, messageRef: waiting.ref,
      taskId: tasks[3]!.taskId, label: 's7b-order-wait', text: 'S7B order wait reply' });

    // The frozen premise: the saved reply answered the wait before the continuation claims it.
    const answeredWait = ready<SessionWaitV1>(await world.platform.sessionFacts.readWait(world.humanContext(),
      { messageRef: waiting.ref }), 'the answered order wait');
    expect(answeredWait.state.state).toBe('answered');
    const replied = ready<SessionMessage>(await world.post('messages/read', plain(S6A_SCOPE, waiting.ref)),
      'the answered order message');
    expect(replied.response).not.toBeNull();

    const accepted = await acceptS7BReply(world, { goal, sender, task: tasks[1]!, run,
      message: waiting.ref, label: 'order' });
    const saved = ready<SessionMessage>(await world.post('messages/read', plain(S6A_SCOPE, waiting.ref)),
      'the accepted reply');
    const responses = (saved.acceptedInputs ?? []).filter(entry => entry.part === 'response');
    expect(responses.map(entry => ({ inputId: entry.inputId, executionRef: entry.executionRef })))
      .toEqual([{ inputId: deriveSessionInputId(waiting.ref, 'response'), executionRef: accepted.run }]);

    // The accepting Run's own Kernel history is the frozen order: person, continuation reply, then commit order.
    const history = ready<{ items: SessionHistoryEntry[] }>(await world.post('executions/history',
      plain(S6A_SCOPE, { runRef: accepted.run, limit: 200 })), 'the order execution history');
    const sequence: { part: string; messageId: string; position: number }[] = [];
    for (const entry of history.items) {
      const decoded = decodeKernelEntry(entry);
      if (decoded === null) throw new Error('S7B: the order Kernel history did not decode');
      const record = decoded.record;
      if (record.recordType !== 'agent.event') continue;
      const event = record.payload.event;
      if (event.type !== 'run.input_accepted') continue;
      const source = event.payload.input.sourceRef as
        { kind?: string; messageRef?: SessionMessage['ref']; part?: string } | null;
      if (source?.kind !== 'SessionMessage' || source.messageRef === undefined || source.part === undefined) continue;
      sequence.push({ part: source.part, messageId: source.messageRef.messageId,
        position: entry.source.position });
    }
    sequence.sort((left, right) => left.position - right.position);
    expect(sequence.map(entry => `${entry.part}:${entry.messageId}`)).toEqual([
      `message:${person.ref.messageId}`,
      `response:${waiting.ref.messageId}`,
      `message:${firstAgent.ref.messageId}`,
      `message:${secondAgent.ref.messageId}`,
      `response:${asyncMessage.ref.messageId}`,
    ]);
  });

  it('gives an intervention execution the person message and never the saved reply or an agent action_request', async () => {
    const { world } = await openS7BWorld({ backend: 'memory' });
    worlds.push(world);
    const main = s6aCardsWorkspace(world, S6A_SCOPE);
    const goal = (await main.createGoal('s7b-intervention-goal', 'S7B intervention goal')).ref;
    const { tasks } = await adoptS6BPlan(main, goal, { label: 's7b-intervention',
      taskIds: ['s7b-intervention-send', 's7b-intervention-reply'], role: S6A_WORK_ROLE.templateId });
    const sender = await sessionOf(world,
      await createS6BLine(main, { label: 's7b-intervention-sender', role: S6A_WORK_ROLE, tasks: [tasks[0]!] }));
    const recipient = await sessionOf(world,
      await createS6BLine(main, { label: 's7b-intervention-recipient', role: S6A_WORK_ROLE }));
    const asyncQuestion = 'S7B intervention async question';
    const asyncAnswer = 'S7B intervention async reply';
    // One real Run sends an asynchronous question (no wait) and then yields on a
    // separate wait, so the line has the open wait an intervention runs beside.
    await world.scripted.script(sender, [
      { kind: 'calls', calls: [
        { callId: 's7b-intervention-async', name: 'send_session_message',
          args: { recipient: recipient.ref, text: asyncQuestion, intent: 'inquiry', needsReply: true } },
        { callId: 's7b-intervention-wait', name: 'send_session_message',
          args: { recipient: recipient.ref, text: 'S7B intervention wait', intent: 'inquiry',
            needsReply: true, waitAfterSend: true } },
      ] },
      { kind: 'text', text: 'S7B intervention sent' },
    ]);
    const receipts: WorkflowStepReceipt[] = [];
    await driveWorkflow(world.ag2b, { schemaVersion: 1, goalRef: goal, flowId: 's7b-intervention',
      sessionHint: sender.ref, kind: 'select_work', taskId: tasks[0]!.taskId }, { receipts });
    const { run } = claimedRunOf(receipts, 'the intervention sender');
    const execution = await readExecution(world.ag2b, run);
    expect(execution.run).toMatchObject({ status: 'ended', outcome: 'yielded', continuation: { kind: 'wait_reply' } });
    const outbox = ready<{ items: SessionMessage[] }>(await world.post('messages/outbox',
      plain(S6A_SCOPE, { senderRun: run, page: { limit: 20 } })), 'the intervention outbox');
    const asyncMessage = outbox.items.find(message => message.waitAfterSend !== true);
    if (asyncMessage === undefined) throw new Error('S7B: the asynchronous question is not in its Run outbox');
    // The recipient's own real Run saves the reply; no wait is bound to it.
    await replyS7AMessage(world, { goal, recipient, messageRef: asyncMessage.ref,
      taskId: tasks[1]!.taskId, label: 's7b-intervention-async', text: asyncAnswer });
    // A person's message is the intervention beside the still-open wait; an agent action_request is queued behind it.
    const person = committed<SessionMessage>(await world.post('messages/send', graphWrite(S6A_SCOPE, {
      recipient: sender.ref, text: 'S7B intervention person body', intent: 'action_request', needsReply: true,
    }, 's7b-intervention-person')), 'the intervention person message');
    const agent = committed<SessionMessage>(await world.dispatch('messages/send', world.systemContext(),
      graphWrite(S6A_SCOPE, {
        recipient: sender.ref, text: 'S7B intervention agent body', intent: 'action_request', needsReply: true,
      }, 's7b-intervention-agent')), 'the intervention agent message');

    const result = await callPublishedOwnerAsHost(world, 'S7B', {
      owner: 'workflow.handleIntervention', wave: '7B-1 L',
      scope: { projectId: world.scope.projectId, workspaceId: world.scope.workspaceId },
    }, { messageRef: person.ref }) as HandleInterventionResultV1;
    expect(result).toMatchObject({ status: 'claimed', branch: 'existing_task' });
    if (result.status !== 'claimed') throw new Error('S7B: the intervention did not claim');
    expect(result.claim.task).toEqual(tasks[0]);
    await startIntervention(world, result.claim);

    // The intervention execution accepted the person's message and nothing else.
    const personRead = ready<SessionMessage>(await world.post('messages/read', plain(S6A_SCOPE, person.ref)),
      'the delivered intervention person message');
    expect(personRead.acceptedInputs ?? []).toContainEqual(expect.objectContaining({ part: 'message',
      executionRef: result.claim.runRef }));
    const agentRead = ready<SessionMessage>(await world.post('messages/read', plain(S6A_SCOPE, agent.ref)),
      'the queued intervention agent message');
    expect((agentRead.acceptedInputs ?? []).some(entry => entry.executionRef.runId === result.claim.runRef.runId))
      .toBe(false);
    const asyncRead = ready<SessionMessage>(await world.post('messages/read', plain(S6A_SCOPE, asyncMessage.ref)),
      'the asynchronous question beside the intervention');
    expect((asyncRead.acceptedInputs ?? []).some(entry => entry.part === 'response'
      && entry.executionRef.runId === result.claim.runRef.runId)).toBe(false);
    const interventionRun = ready<TaskExecutionRecord>(
      await world.post('executions/read', plain(S6A_SCOPE, result.claim.runRef)), 'the intervention execution');
    expect(interventionRun.run.consumedWait).toMatchObject({ kind: 'intervention', messageRef: person.ref });
  });
});
