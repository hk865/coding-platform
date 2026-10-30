/**
 * B-continuation (SR8 §8.4; book-7b.md:1206; R4-16): the answered wait wakes the same handle and the continuation claim
 * creates a successor Run on the original Task/Session, read through the public execution read; the consultation entry
 * runs the one delivery rule on the message's real facts.
 *
 * R4-16's four expiry behaviours need a real `expiredAt`, produced through the published
 * `platform.messageExpiry.recordExpiry`: `wait_reply` wins over an expired deadline, the expiry continuation claims on
 * the original Task/Session, a late reply is ordinary input, and the driver's `awaitWake` wakes on `expired` into the
 * same expiry continuation. Every fact comes from the public Workflow, the published owner and the public reads; the
 * default 24 h inquiry deadline (`create-platform.ts:1075`) is passed by the fixture clock.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { WorkflowStepReceipt } from '../../src/business/workflow/contracts.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type { RunRef, TaskTriple } from '../../src/contracts/dispatch.js';
import type { TaskExecutionRecord } from '../../src/core/work-graph/model/execution-read-contracts.js';
import type { SessionMessage } from '../../src/core/work-graph/model/communication-contracts.js';
import {
  AG2B_CONSUMER_ID, AG2B_QUERY_BUDGET, AG2B_RUNTIME_BUDGET, plain,
} from '../helpers/AG2b-collaboration-fixture.js';
import { driveWorkflow } from '../helpers/A2-restart-fixture.js';
import { s6aCardsWorkspace } from '../helpers/S6A-cards-fixture.js';
import { callPublishedOwnerAsHost, type S6AHostWorld } from '../helpers/S6A-host-fixture.js';
import {
  S6A_SCOPE, S6A_WORK_ROLE, S6A_WORK_ROLE_BINDING, type S6ASession,
} from '../helpers/S6A-request-fixture.js';
import { adoptS6BPlan, createS6BLine } from '../helpers/S6B1-fixture.js';
import { claimedRunOf, ready, sessionOf } from '../helpers/S7A-fixture.js';
import { acceptS7BReply, answerS7BWait, openS7BWorld, runS7BWait } from '../helpers/S7B-fixture.js';
import { waitFor } from '../scenarios/harness.js';

const worlds: S6AHostWorld[] = [];
afterEach(async () => { for (const world of worlds.splice(0)) await world.close().catch(() => undefined); });

/**
 * The expiry arm of the same continuation path `acceptS7BReply` drives for a reply: one ordinary `select_work` on the
 * yielded Task, stopped before its safe point, so the successor Run is the only claim. No fixture step has an expiry
 * arm (`acceptS7BReply` requires a response), so this composes the existing `driveWorkflow` and `claimedRunOf`.
 */
async function continueS7BExpiry(world: S6AHostWorld, input: {
  goal: GoalRef; sender: S6ASession; task: TaskTriple; label: string;
}): Promise<{ run: RunRef }> {
  const receipts: WorkflowStepReceipt[] = [];
  await driveWorkflow(world.ag2b, { schemaVersion: 1, goalRef: input.goal,
    flowId: `s7b-${input.label}-expiry-claim`, sessionHint: input.sender.ref, kind: 'select_work',
    taskId: input.task.taskId }, { stopBefore: 'open_checks', receipts });
  return claimedRunOf(receipts, `the ${input.label} expiry continuation`);
}

describe('B-continuation (memory)', () => {
  it('the answered wait wakes the same handle; its continuation claims a successor Run on the original Task/Session', async () => {
    const { world } = await openS7BWorld({ backend: 'memory' });
    worlds.push(world);
    const main = s6aCardsWorkspace(world, S6A_SCOPE);
    const goal = (await main.createGoal('s7b-b-continuation-wake', 'S7B wake goal')).ref;
    const { tasks } = await adoptS6BPlan(main, goal, { label: 's7b-b-continuation-wake',
      taskIds: ['s7b-b-wake-send', 's7b-b-wake-reply'], role: S6A_WORK_ROLE.templateId });
    const sender = await sessionOf(world,
      await createS6BLine(main, { label: 's7b-b-wake-sender', role: S6A_WORK_ROLE, tasks: [tasks[0]!] }));
    const recipient = await sessionOf(world,
      await createS6BLine(main, { label: 's7b-b-wake-recipient', role: S6A_WORK_ROLE }));
    await world.scripted.script(sender, [
      { kind: 'calls', calls: [{ callId: 's7b-b-wake-send', name: 'send_session_message',
        args: { recipient: recipient.ref, text: 'S7B wake question', intent: 'inquiry',
          needsReply: true, waitAfterSend: true } }] },
      { kind: 'text', text: 'S7B wake first turn' },
      { kind: 'text', text: 'S7B wake after the reply' },
    ]);
    const started = ready<{ state: string }>(await world.post('workflow/driver-start', plain(S6A_SCOPE, {
      advance: { schemaVersion: 1, goalRef: goal, flowId: 's7b-b-continuation-wake',
        sessionHint: sender.ref, kind: 'select_work', taskId: tasks[0]!.taskId },
      queryProfileIds: [],
    })), 'the wake handle');
    expect(started.state).toBe('running');
    // The driver's own Run yields on its saved reply, so the same handle is the one that waits.
    const waiting = await waitFor(async () => ready<{ state: string; messages: SessionMessage[] }>(
      await world.post('workflow/driver-read', plain(S6A_SCOPE, { goalRef: goal, taskId: tasks[0]!.taskId })),
      'the wake handle'), value => value.state === 'waiting_for_reply'
      && value.messages.some(message => message.waitAfterSend === true), 'the handle to wait on its saved reply');
    const question = waiting.messages.find(message => message.waitAfterSend === true)!;
    if (question.sender.kind !== 'work_run') throw new Error('S7B: the wake question is not the handle Run');

    // The original yielded Run is the wait's `originalRun`, not the continuation.
    const yielded = ready<TaskExecutionRecord>(
      await world.post('executions/read', plain(S6A_SCOPE, question.sender.runRef)), 'the yielded wake Run');
    expect(yielded.run).toMatchObject({ status: 'ended', outcome: 'yielded',
      continuation: { kind: 'wait_reply', messageRef: question.ref } });

    // The recipient's real reply wakes the waiting handle.
    await answerS7BWait(world, { goal, recipient, message: question.ref, task: tasks[1]!, label: 's7b-b-wake' });
    const saved = await waitFor(async () => ready<SessionMessage>(
      await world.post('messages/read', plain(S6A_SCOPE, question.ref)), 'the woken wait'),
    message => (message.acceptedInputs ?? []).some(entry => entry.part === 'response'),
    'the woken continuation to accept the reply');
    const accepted = (saved.acceptedInputs ?? []).find(entry => entry.part === 'response')!;
    expect(accepted.executionRef.aggregateType).toBe('Run');

    const successor = ready<TaskExecutionRecord>(
      await world.post('executions/read', plain(S6A_SCOPE, accepted.executionRef)), 'the continuation successor Run');
    expect(accepted.executionRef).not.toEqual(question.sender.runRef);
    expect(successor.run.previousRun).toEqual(question.sender.runRef);
    expect(successor.run.task).toEqual(tasks[0]);
    expect(successor.run.consumedWait).toMatchObject({ kind: 'wait_reply',
      originalRun: question.sender.runRef, messageRef: question.ref });
    expect(successor.session.ref).toMatchObject({ projectId: sender.ref.projectId, sessionId: sender.ref.sessionId });
    await world.post('workflow/driver-stop', plain(S6A_SCOPE, { goalRef: goal, taskId: tasks[0]!.taskId }));
  }, 120_000);

  it('the consultation entry runs the one delivery rule on the accepted response and refuses it as delivered', async () => {
    const { world } = await openS7BWorld({ backend: 'memory' });
    worlds.push(world);
    const wait = await runS7BWait(world, { label: 'b-continuation-consultation' });
    await answerS7BWait(world, { goal: wait.goal, recipient: wait.recipient, message: wait.message,
      task: wait.tasks[1]!, label: 'b-continuation-consultation-reply' });
    await acceptS7BReply(world, { goal: wait.goal, sender: wait.sender, task: wait.tasks[0]!,
      run: wait.run, message: wait.message, label: 'b-continuation-consultation-accept' });
    const answer = await world.post('workflow/consultation', plain(S6A_SCOPE, {
      schemaVersion: 1, messageRef: wait.message, part: 'response', goalRef: wait.goal,
      roleBinding: S6A_WORK_ROLE_BINDING, runtimeBudget: AG2B_RUNTIME_BUDGET,
      budget: AG2B_QUERY_BUDGET, consumerId: AG2B_CONSUMER_ID,
    }));
    expect(answer.body).toMatchObject({ status: 'rejected', code: 'invalid', reason: 'delivery_delivered' });
  }, 120_000);

  it('chooses wait_reply over expiry when the saved reply and the passed deadline both exist', async () => {
    const { world, clock } = await openS7BWorld({ backend: 'memory' });
    worlds.push(world);
    const wait = await runS7BWait(world, { label: 'b-wait-reply-over-expiry' });
    // The default inquiry deadline is 24 h; the controlled clock passes it before the reply lands, so the saved
    // reply and the recorded expiry both exist when the continuation chooses its arm.
    clock.advance(86_400_000);
    expect(await callPublishedOwnerAsHost(world, 'S7B', {
      owner: 'messageExpiry.recordExpiry', wave: '7B-1 L',
      scope: { projectId: world.scope.projectId, workspaceId: world.scope.workspaceId },
    }, { messageRef: wait.message })).toMatchObject({ status: 'committed' });
    const replied = await answerS7BWait(world, { goal: wait.goal, recipient: wait.recipient,
      message: wait.message, task: wait.tasks[1]!, label: 'b-wait-reply-over-expiry' });
    expect(replied.response).not.toBeNull();
    const saved = ready<SessionMessage>(await world.post('messages/read', plain(S6A_SCOPE, wait.message)),
      'the replied wait at its recorded expiry');
    expect(saved.expiredAt).not.toBeNull();
    expect(saved.status).toBe('responded');

    const continued = await acceptS7BReply(world, { goal: wait.goal, sender: wait.sender,
      task: wait.tasks[0]!, run: wait.run, message: wait.message, label: 'b-wait-reply-over-expiry' });
    expect(continued.run).not.toEqual(wait.run);
    const successor = ready<TaskExecutionRecord>(
      await world.post('executions/read', plain(S6A_SCOPE, continued.run)), 'the reply continuation Run');
    expect(successor.run.consumedWait).toMatchObject({ kind: 'wait_reply',
      originalRun: wait.run, messageRef: wait.message, responseRef: replied.response!.bodyRef });
  }, 120_000);

  it('the expiry continuation claims on the original Task and Session and consumes the wait with the expiry arm', async () => {
    const { world, clock } = await openS7BWorld({ backend: 'memory' });
    worlds.push(world);
    const wait = await runS7BWait(world, { label: 'b-expiry-continuation' });
    const at = clock.advance(86_400_000);
    const written = await callPublishedOwnerAsHost(world, 'S7B', {
      owner: 'messageExpiry.recordExpiry', wave: '7B-1 L',
      scope: { projectId: world.scope.projectId, workspaceId: world.scope.workspaceId },
    }, { messageRef: wait.message }) as { status: string; value: SessionMessage };
    expect(written).toMatchObject({ status: 'committed' });
    if (written.status !== 'committed') throw new Error('S7B: the expiry did not commit');
    expect(written.value.expiredAt).toBe(at);
    const expired = ready<SessionMessage>(await world.post('messages/read', plain(S6A_SCOPE, wait.message)),
      'the expired wait');
    expect(expired.expiredAt).toBe(at);
    expect(expired.acceptedInputs ?? []).toEqual([]);

    const successor = await continueS7BExpiry(world, { goal: wait.goal, sender: wait.sender,
      task: wait.tasks[0]!, label: 'b-expiry-continuation' });
    expect(successor.run).not.toEqual(wait.run);
    const record = ready<TaskExecutionRecord>(
      await world.post('executions/read', plain(S6A_SCOPE, successor.run)), 'the expiry continuation Run');
    expect(record.run.previousRun).toEqual(wait.run);
    expect(record.run.task).toEqual(wait.tasks[0]);
    expect(record.run.consumedWait).toMatchObject({ kind: 'expiry', originalRun: wait.run,
      messageRef: wait.message, expiryInputId: 'expiry:' + JSON.stringify({ aggregateType: 'SessionMessage',
        messageId: wait.message.messageId, projectId: wait.message.projectId,
        workspaceId: wait.message.workspaceId }) });
    expect(record.session.ref).toMatchObject({ projectId: wait.sender.ref.projectId,
      sessionId: wait.sender.ref.sessionId });
    const accepted = ready<SessionMessage>(await world.post('messages/read', plain(S6A_SCOPE, wait.message)),
      'the accepted expiry input');
    const expiryInput = (accepted.acceptedInputs ?? []).find(entry => entry.part === 'expiry');
    expect(expiryInput).toMatchObject({
      inputId: 'expiry:' + JSON.stringify({ aggregateType: 'SessionMessage',
        messageId: wait.message.messageId, projectId: wait.message.projectId,
        workspaceId: wait.message.workspaceId }),
      consumesWait: true, executionRef: successor.run,
    });
  }, 120_000);

  it('saves a late reply after the expiry continuation as ordinary input, not a second continuation claim', async () => {
    const { world, clock } = await openS7BWorld({ backend: 'memory' });
    worlds.push(world);
    const wait = await runS7BWait(world, { label: 'b-late-reply' });
    clock.advance(86_400_000);
    expect(await callPublishedOwnerAsHost(world, 'S7B', {
      owner: 'messageExpiry.recordExpiry', wave: '7B-1 L',
      scope: { projectId: world.scope.projectId, workspaceId: world.scope.workspaceId },
    }, { messageRef: wait.message })).toMatchObject({ status: 'committed' });
    const expiryRun = await continueS7BExpiry(world, { goal: wait.goal, sender: wait.sender,
      task: wait.tasks[0]!, label: 'b-late-reply' });

    const replied = await answerS7BWait(world, { goal: wait.goal, recipient: wait.recipient,
      message: wait.message, task: wait.tasks[1]!, label: 'b-late-reply' });
    expect(replied.response).not.toBeNull();
    const saved = ready<SessionMessage>(await world.post('messages/read', plain(S6A_SCOPE, wait.message)),
      'the late reply on the expired wait');
    expect(saved.expiredAt).not.toBeNull();
    expect(saved.status).toBe('responded');
    // The saved late reply is ordinary input: the consultation consumes it, not the already-consumed wait.
    await world.post('workflow/consultation', plain(S6A_SCOPE, {
      schemaVersion: 1, messageRef: wait.message, part: 'response', goalRef: wait.goal,
      roleBinding: S6A_WORK_ROLE_BINDING, runtimeBudget: AG2B_RUNTIME_BUDGET,
      budget: AG2B_QUERY_BUDGET, consumerId: AG2B_CONSUMER_ID,
    }));
    const offered = ready<SessionMessage>(await world.post('messages/read', plain(S6A_SCOPE, wait.message)),
      'the late reply offered as ordinary input');
    const inputs = offered.acceptedInputs ?? [];
    // The expiry claim is the wait's one consumer; the late reply is ordinary input, not a second claim.
    expect(inputs.filter(entry => entry.part === 'expiry')).toHaveLength(1);
    const response = inputs.find(entry => entry.part === 'response');
    expect(response).toMatchObject({ consumesWait: false });
    expect(inputs.filter(entry => entry.consumesWait)).toHaveLength(1);
    expect(inputs.find(entry => entry.consumesWait)).toMatchObject({ part: 'expiry' });
    expect(inputs.some(entry => entry.part === 'response' && entry.executionRef.aggregateType === 'Run'
      && entry.executionRef.runId === expiryRun.run.runId)).toBe(false);
    const record = ready<TaskExecutionRecord>(
      await world.post('executions/read', plain(S6A_SCOPE, expiryRun.run)), 'the expiry Run after the late reply');
    expect(record.run.consumedWait).toMatchObject({ kind: 'expiry', messageRef: wait.message });
  }, 120_000);

  it('awaitWake wakes the waiting handle on expired into the expiry continuation on the same Task/Session', async () => {
    const { world, clock } = await openS7BWorld({ backend: 'memory' });
    worlds.push(world);
    const main = s6aCardsWorkspace(world, S6A_SCOPE);
    const goal = (await main.createGoal('s7b-b-expired-wake', 'S7B expired wake goal')).ref;
    const { tasks } = await adoptS6BPlan(main, goal, { label: 's7b-b-expired-wake',
      taskIds: ['s7b-b-expired-wake-send', 's7b-b-expired-wake-reply'], role: S6A_WORK_ROLE.templateId });
    const sender = await sessionOf(world, await createS6BLine(main,
      { label: 's7b-b-expired-wake-sender', role: S6A_WORK_ROLE, tasks: [tasks[0]!] }));
    const recipient = await sessionOf(world, await createS6BLine(main,
      { label: 's7b-b-expired-wake-recipient', role: S6A_WORK_ROLE }));
    await world.scripted.script(sender, [
      { kind: 'calls', calls: [{ callId: 's7b-b-expired-wake-send', name: 'send_session_message',
        args: { recipient: recipient.ref, text: 'S7B expired wake question', intent: 'inquiry',
          needsReply: true, waitAfterSend: true } }] },
      { kind: 'text', text: 'S7B expired wake first turn' },
      { kind: 'text', text: 'S7B expired wake expiry turn' },
    ]);
    const started = ready<{ state: string }>(await world.post('workflow/driver-start', plain(S6A_SCOPE, {
      advance: { schemaVersion: 1, goalRef: goal, flowId: 's7b-b-expired-wake',
        sessionHint: sender.ref, kind: 'select_work', taskId: tasks[0]!.taskId },
      queryProfileIds: [],
    })), 'the expired wake handle');
    expect(started.state).toBe('running');
    const waiting = await waitFor(async () => ready<{ state: string; messages: SessionMessage[] }>(
      await world.post('workflow/driver-read', plain(S6A_SCOPE, { goalRef: goal, taskId: tasks[0]!.taskId })),
      'the expired wake handle'), value => value.state === 'waiting_for_reply'
      && value.messages.some(message => message.waitAfterSend === true), 'the handle to wait on its saved reply');
    const question = waiting.messages.find(message => message.waitAfterSend === true)!;
    if (question.sender.kind !== 'work_run') throw new Error('S7B: the expired wake question is not the handle Run');

    clock.advance(86_400_000);
    expect(await callPublishedOwnerAsHost(world, 'S7B', {
      owner: 'messageExpiry.recordExpiry', wave: '7B-1 L',
      scope: { projectId: world.scope.projectId, workspaceId: world.scope.workspaceId },
    }, { messageRef: question.ref })).toMatchObject({ status: 'committed' });
    const saved = await waitFor(async () => ready<SessionMessage>(
      await world.post('messages/read', plain(S6A_SCOPE, question.ref)), 'the woken expiry wait'),
    message => (message.acceptedInputs ?? []).some(entry => entry.part === 'expiry'),
    'the expired handle to accept the expiry continuation');
    const accepted = (saved.acceptedInputs ?? []).find(entry => entry.part === 'expiry')!;
    expect(accepted.executionRef).not.toEqual(question.sender.runRef);
    const successor = ready<TaskExecutionRecord>(
      await world.post('executions/read', plain(S6A_SCOPE, accepted.executionRef)), 'the expiry successor Run');
    expect(successor.run.previousRun).toEqual(question.sender.runRef);
    expect(successor.run.task).toEqual(tasks[0]);
    expect(successor.run.consumedWait).toMatchObject({ kind: 'expiry', originalRun: question.sender.runRef,
      messageRef: question.ref, expiryInputId: 'expiry:' + JSON.stringify({ aggregateType: 'SessionMessage',
        messageId: question.ref.messageId, projectId: question.ref.projectId,
        workspaceId: question.ref.workspaceId }) });
    expect(successor.session.ref).toMatchObject({ projectId: sender.ref.projectId, sessionId: sender.ref.sessionId });
    await world.post('workflow/driver-stop', plain(S6A_SCOPE, { goalRef: goal, taskId: tasks[0]!.taskId }));
  }, 120_000);
});
