/**
 * X-expiry (SR5 §5.5, SR11 §11.5, SR13 row 5; fixture spec v3 §4.1). Both backends. The owner's public entry is
 * `platform.messageExpiry.recordExpiry` (L's publish); the reads are `messages/read`, `executions/read`,
 * `sessions/facts` and `platform.sessionFacts.readWait`, never a store.
 *
 * Covered here: the `expiredAt`-only commit with no claim and no accepted input; the same-millisecond rescan that adds
 * nothing; the retired sender recorded without a wake; the saved reply winning over the passed deadline; and
 * the reply committed between the owner's read and its CAS, which retries and re-reads as `answered`. The expiry
 * chain count is this owner row's (SR5 5.5): two real expiries on a `followupOf` chain render `第 2 次`. The ready
 * `'incomplete'` arm needs the count's bounded 100-link walk and is not built here; reported, not weakened.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WorkflowStepReceipt } from '../../src/business/workflow/contracts.js';
import type { RunSnapshot } from '../../src/contracts/dispatch.js';
import type { SessionMessage } from '../../src/core/work-graph/model/communication-contracts.js';
import type { SessionFactsV1, SessionWaitV1 } from '../../src/core/work-graph/model/session-facts-contracts.js';
import { driveWorkflow } from '../helpers/A2-restart-fixture.js';
import { plain } from '../helpers/AG2b-collaboration-fixture.js';
import { s6aCardsWorkspace } from '../helpers/S6A-cards-fixture.js';
import { commitBarrier, byIdentityPrefix } from '../helpers/S6A-commit-barrier.js';
import { callPublishedOwnerAsHost, type S6AHostWorld } from '../helpers/S6A-host-fixture.js';
import { S6A_SCOPE, S6A_WORK_ROLE } from '../helpers/S6A-request-fixture.js';
import { adoptS6BPlan, createS6BLine } from '../helpers/S6B1-fixture.js';
import { claimedRunOf, ready, sessionOf } from '../helpers/S7A-fixture.js';
import { waitExpiryDeliveryText } from '../helpers/S7B-delivery-samples.js';
import {
  answerS7BWait, openS7BWorld, readS7BMessage, retireS7BSender, runS7BWait, sendS7BWaitingInquiry,
} from '../helpers/S7B-fixture.js';
import { waitFor } from '../scenarios/harness.js';

vi.mock('../../src/core/record-store/in-memory-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-commit-barrier.js')).inMemoryBarrierModule(importOriginal));
vi.mock('../../src/core/record-store/sqlite-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-commit-barrier.js')).sqliteBarrierModule(importOriginal));

const worlds: S6AHostWorld[] = [];
afterEach(async () => {
  const left = commitBarrier.reset();
  for (const world of worlds.splice(0)) await world.close().catch(() => undefined);
  expect(left).toEqual([]);
});

describe.each(['memory', 'sqlite'] as const)('X-expiry (%s)', backend => {
  it('records expiredAt only, consumes nothing, wakes the yielded sender for nothing, and a same-ms rescan adds no event', async () => {
    const { world, clock } = await openS7BWorld({ backend });
    worlds.push(world);
    const wait = await runS7BWait(world, { label: 'x-expiry' });
    const before = await readS7BMessage(world, wait.message);
    const at = clock.advance(86_400_000);
    const requestsBefore = (await world.scripted.requests(wait.sender)).length;

    const written = await callPublishedOwnerAsHost(world, 'S7B', {
      owner: 'messageExpiry.recordExpiry', wave: '7B-1 L',
      scope: { projectId: world.scope.projectId, workspaceId: world.scope.workspaceId },
    }, { messageRef: wait.message }) as { status: string; value: SessionMessage };
    expect(written).toMatchObject({ status: 'committed' });
    if (written.status !== 'committed') throw new Error('S7B: the expiry did not commit');
    expect(written.value).toMatchObject({ ref: wait.message, expiredAt: at, status: before.status, response: null });

    const expired = await readS7BMessage(world, wait.message);
    expect(expired).toMatchObject({ ref: wait.message, expiredAt: at, status: before.status, response: null });
    expect(expired.acceptedInputs ?? []).toEqual([]);
    expect(expired.revision).toBe(before.revision + 1);

    // The yielded Run is still the one execution: no claim, no continuation, and no model turn is woken.
    const execution = ready<{ run: RunSnapshot }>(
      await world.post('executions/read', plain(S6A_SCOPE, wait.run)), 'the yielded sender Run');
    expect(execution.run).toMatchObject({ status: 'ended', outcome: 'yielded',
      continuation: { kind: 'wait_reply', messageRef: wait.message } });
    expect((await world.scripted.requests(wait.sender)).length).toBe(requestsBefore);

    const facts = ready<SessionFactsV1>(
      await world.post('sessions/facts', plain(S6A_SCOPE, wait.sender.ref)), 'the expired wait facts');
    expect(facts.wait).toMatchObject({ messageRef: wait.message, runRef: wait.run });
    const waitRead = ready<SessionWaitV1>(await world.platform.sessionFacts.readWait(world.humanContext(),
      { messageRef: wait.message }), 'the expired wait read');
    expect(waitRead).toMatchObject({ messageRef: wait.message, originalRun: wait.run,
      expiredAt: at, state: { state: 'expired', reason: null } });

    // The same-millisecond rescan adds no event: the same identity replays or the owner skips, but the record,
    // its accepted inputs and the session read watermark do not move (SR5 §5.5 `:2017`).
    await callPublishedOwnerAsHost(world, 'S7B', {
      owner: 'messageExpiry.recordExpiry', wave: '7B-1 L',
      scope: { projectId: world.scope.projectId, workspaceId: world.scope.workspaceId },
    }, { messageRef: wait.message });
    const rescanned = await readS7BMessage(world, wait.message);
    expect(rescanned.revision).toBe(expired.revision);
    expect(rescanned.expiredAt).toBe(at);
    expect(rescanned.acceptedInputs ?? []).toEqual(expired.acceptedInputs ?? []);
    const factsAfter = ready<SessionFactsV1>(
      await world.post('sessions/facts', plain(S6A_SCOPE, wait.sender.ref)), 'the rescan wait facts');
    expect(factsAfter.sourceCursor).toEqual(facts.sourceCursor);
  });

  it('skips the expiry when the wait was answered before the check', async () => {
    const { world, clock } = await openS7BWorld({ backend });
    worlds.push(world);
    const wait = await runS7BWait(world, { label: 'x-expiry-answered' });
    clock.advance(86_400_000);
    const replied = await answerS7BWait(world, { goal: wait.goal, recipient: wait.recipient,
      message: wait.message, task: wait.tasks[1]!, label: 'x-expiry-answered' });
    expect(replied.response).not.toBeNull();

    expect(await callPublishedOwnerAsHost(world, 'S7B', {
      owner: 'messageExpiry.recordExpiry', wave: '7B-1 L',
      scope: { projectId: world.scope.projectId, workspaceId: world.scope.workspaceId },
    }, { messageRef: wait.message }))
      .toMatchObject({ status: 'skipped', reason: 'not_open' });
    const saved = await readS7BMessage(world, wait.message);
    expect(saved).toMatchObject({ status: 'responded', expiredAt: null });
    expect(saved.response).not.toBeNull();
    const waitRead = ready<SessionWaitV1>(await world.platform.sessionFacts.readWait(world.humanContext(),
      { messageRef: wait.message }), 'the answered wait read');
    expect(waitRead.state.state).toBe('answered');
  });

  it('retries the CAS and re-reads a reply that lands between the owner read and its commit', async () => {
    const { world, clock } = await openS7BWorld({ backend });
    worlds.push(world);
    const wait = await runS7BWait(world, { label: 'x-expiry-cas' });
    clock.advance(86_400_000);
    const hold = commitBarrier.hold(byIdentityPrefix('message.recordExpiry:'), 'the expiry commit');
    const pending = callPublishedOwnerAsHost(world, 'S7B', {
      owner: 'messageExpiry.recordExpiry', wave: '7B-1 L',
      scope: { projectId: world.scope.projectId, workspaceId: world.scope.workspaceId },
    }, { messageRef: wait.message });
    await hold.reached;
    // The reply commits after the owner's read and before its CAS; answerS7BWait's own commits pass this hold.
    await answerS7BWait(world, { goal: wait.goal, recipient: wait.recipient, message: wait.message,
      task: wait.tasks[1]!, label: 'x-expiry-cas' });
    hold.release();
    expect(await pending).toMatchObject({ status: 'skipped', reason: 'not_open' });
    const saved = await readS7BMessage(world, wait.message);
    expect(saved).toMatchObject({ status: 'responded', expiredAt: null });
    expect(saved.response).not.toBeNull();
  });

  it('walks two real expiries to the count 2 in the expiry continuation prompt', async () => {
    const { world, clock } = await openS7BWorld({ backend });
    worlds.push(world);
    const main = s6aCardsWorkspace(world, S6A_SCOPE);
    const goal = (await main.createGoal(`s7b-x-count-${backend}`, 'S7B expiry count goal')).ref;
    const { tasks } = await adoptS6BPlan(main, goal, { label: 'x-expiry-count',
      taskIds: ['s7b-x-count-first', 's7b-x-count-second'], role: S6A_WORK_ROLE.templateId });
    const sender = await sessionOf(world, await createS6BLine(main,
      { label: 's7b-x-count-sender', role: S6A_WORK_ROLE, tasks: [tasks[0]!] }));
    const follower = await sessionOf(world, await createS6BLine(main,
      { label: 's7b-x-count-follower', role: S6A_WORK_ROLE, tasks: [tasks[1]!] }));
    const first = await sendS7BWaitingInquiry(world, { goal, session: sender, taskId: tasks[0]!.taskId,
      label: 'first', body: { recipient: follower.ref, text: 'S7B count first question', intent: 'inquiry',
        needsReply: true, waitAfterSend: true } });
    const second = await sendS7BWaitingInquiry(world, { goal, session: follower, taskId: tasks[1]!.taskId,
      label: 'second', body: { recipient: sender.ref, text: 'S7B count second question', intent: 'inquiry',
        needsReply: true, waitAfterSend: true, followupOf: first.ref } });
    expect(second.followupOf).toEqual(first.ref);

    clock.advance(86_400_000);
    expect(await callPublishedOwnerAsHost(world, 'S7B', {
      owner: 'messageExpiry.recordExpiry', wave: '7B-1 L',
      scope: { projectId: world.scope.projectId, workspaceId: world.scope.workspaceId },
    }, { messageRef: first.ref }))
      .toMatchObject({ status: 'committed' });
    expect(await callPublishedOwnerAsHost(world, 'S7B', {
      owner: 'messageExpiry.recordExpiry', wave: '7B-1 L',
      scope: { projectId: world.scope.projectId, workspaceId: world.scope.workspaceId },
    }, { messageRef: second.ref }))
      .toMatchObject({ status: 'committed' });
    const receipts: WorkflowStepReceipt[] = [];
    await driveWorkflow(world.ag2b, { schemaVersion: 1, goalRef: goal, flowId: 's7b-x-count-continuation',
      sessionHint: follower.ref, kind: 'select_work', taskId: tasks[1]!.taskId },
    { stopBefore: 'open_checks', receipts });
    const successor = claimedRunOf(receipts, 'the second expiry continuation');
    const record = ready<{ run: RunSnapshot }>(await world.post('executions/read',
      plain(S6A_SCOPE, successor.run)), 'the second expiry Run');
    expect(record.run.consumedWait).toMatchObject({ kind: 'expiry', messageRef: second.ref,
      originalRun: second.sender.kind === 'work_run' ? second.sender.runRef : undefined });
    const expected = waitExpiryDeliveryText({ messageId: second.ref.messageId,
      question: 'S7B count second question', deadline: second.deadline!, expiryCount: 2 });
    await waitFor(async () => (await world.scripted.requests(follower)).map(request => request.messages
      .map(message => typeof (message as { content?: unknown }).content === 'string'
        ? String((message as { content: string }).content) : '').join('\n')).join('\n'),
    text => text.includes(expected), 'the second expiry prompt to render 第 2 次');
  });
});

describe('X-expiry retired sender (SQLite only: the Host restart)', () => {
  it('records the expiry of a really retired sender and wakes nothing', async () => {
    const { world, clock } = await openS7BWorld({ backend: 'sqlite' });
    worlds.push(world);
    const main = s6aCardsWorkspace(world, S6A_SCOPE);
    const goal = (await main.createGoal('s7b-x-retired', 'S7B retired goal')).ref;
    const { tasks } = await adoptS6BPlan(main, goal, { label: 'x-expiry-retired',
      taskIds: ['s7b-x-retired-send', 's7b-x-retired-reply'], role: S6A_WORK_ROLE.templateId });
    const sender = await sessionOf(world, await createS6BLine(main,
      { label: 's7b-x-retired-sender', role: S6A_WORK_ROLE, tasks: [tasks[0]!] }));
    const recipient = await sessionOf(world, await createS6BLine(main,
      { label: 's7b-x-retired-recipient', role: S6A_WORK_ROLE }));
    const message = await sendS7BWaitingInquiry(world, { goal, session: sender, taskId: tasks[0]!.taskId,
      label: 'x-expiry-retired', trailingText: false,
      body: { recipient: recipient.ref, text: 'S7B retired question',
        intent: 'inquiry', needsReply: true, waitAfterSend: true } });
    await retireS7BSender(world, { goal, sender, task: tasks[0]!, label: 'x-expiry-retired' });
    const card = ready<{ record: { lifecycle: string; health: string; healthConclusion: string | null } }>(
      await world.post('sessions/read', plain(S6A_SCOPE, sender.ref)), 'the retired sender');
    expect(card.record).toMatchObject({ lifecycle: 'active', health: 'unavailable',
      healthConclusion: 'missing' });

    const requestsBefore = (await world.scripted.requests(sender)).length;
    const at = clock.advance(86_400_000);
    const written = await callPublishedOwnerAsHost(world, 'S7B', {
      owner: 'messageExpiry.recordExpiry', wave: '7B-1 L',
      scope: { projectId: world.scope.projectId, workspaceId: world.scope.workspaceId },
    }, { messageRef: message.ref }) as { status: string; value: SessionMessage };
    expect(written).toMatchObject({ status: 'committed' });
    if (written.status !== 'committed') throw new Error('S7B: the retired sender expiry did not commit');
    expect(written.value).toMatchObject({ ref: message.ref, expiredAt: at });
    expect(await readS7BMessage(world, message.ref)).toMatchObject({ expiredAt: at });
    expect((await world.scripted.requests(sender)).length).toBe(requestsBefore);
  });
});
