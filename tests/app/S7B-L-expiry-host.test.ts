/**
 * L-expiry-host (book-7b.md:1207; SR9 §9.3; TE5): the real Host's heartbeat records expiry on the injected clock with
 * no configured consumer; the first real expiry and a real follow-up expiry give the visible "第 2 次" prompt through
 * X's `readExpiryCount`; the due pass records the earliest deadline first (R4-14 item 3); a same-millisecond rescan
 * writes nothing; and a same-directory SQLite reopen keeps the expired fact, the wait and the Host pass.
 *
 * SQLite only: the row restarts the Host (tests/RULES.md S3). Every state comes from a public step: the real Host,
 * `workflow/advance`, the scripted model's real `send_session_message`, `messages/read`, `sessions/facts` and
 * `executions/read`. A3 wraps the published expiry owner in front of its real body to record the pass's order only.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MessageExpiryPort } from '../../src/core/work-graph/communication/message-expiry.js';
import type { SessionMessage } from '../../src/core/work-graph/model/communication-contracts.js';
import type { SessionFactsV1 } from '../../src/core/work-graph/model/session-facts-contracts.js';
import type { WorkflowStepReceipt } from '../../src/business/workflow/contracts.js';
import { advanceUntil, driveWorkflow } from '../helpers/A2-restart-fixture.js';
import { plain } from '../helpers/AG2b-collaboration-fixture.js';
import { commitBarrier } from '../helpers/S6A-commit-barrier.js';
import { s6aCardsWorkspace } from '../helpers/S6A-cards-fixture.js';
import { callPublishedOwnerAsHost, type S6AHostWorld } from '../helpers/S6A-host-fixture.js';
import { S6A_SCOPE, S6A_WORK_ROLE, type S6AClock } from '../helpers/S6A-request-fixture.js';
import { adoptS6BPlan, createS6BLine } from '../helpers/S6B1-fixture.js';
import { claimedRunOf, ready, sessionOf } from '../helpers/S7A-fixture.js';
import { waitExpiryDeliveryText } from '../helpers/S7B-delivery-samples.js';
import { openS7BWorld, readS7BMessage, readS7BWaits, reopenS7BHost, sendS7BWaitingInquiry } from '../helpers/S7B-fixture.js';
import { waitFor } from '../scenarios/harness.js';

vi.mock('../../src/core/record-store/in-memory-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-commit-barrier.js')).inMemoryBarrierModule(importOriginal));
vi.mock('../../src/core/record-store/sqlite-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-commit-barrier.js')).sqliteBarrierModule(importOriginal));

const waitForExpiry = (world: S6AHostWorld, ref: SessionMessage['ref']): Promise<SessionMessage> =>
  waitFor(() => readS7BMessage(world, ref), message => message.expiredAt !== null, `the expiry of ${ref.messageId}`);

const worlds: S6AHostWorld[] = [];
afterEach(async () => {
  const left = commitBarrier.reset();
  for (const world of worlds.splice(0)) await world.close().catch(() => undefined);
  expect(left).toEqual([]);
});

describe('L-expiry-host (SQLite only: the Host restart)', () => {
  it('the heartbeat records the earliest deadline first, the second expiry renders 第 2 次, a same-ms rescan writes nothing and a reopen keeps the wiring', async () => {
    const { world, clock }: { world: S6AHostWorld; clock: S6AClock } = await openS7BWorld({
      backend: 'sqlite', extraHostOptions: { scribeReminderPeriodMs: 40 } });
    worlds.push(world);
    const main = s6aCardsWorkspace(world, S6A_SCOPE);
    const goal = (await main.createGoal('s7b-expiry-host', 'S7B expiry host goal')).ref;
    const { tasks } = await adoptS6BPlan(main, goal, { label: 'expiry-host',
      taskIds: ['s7b-eh-first', 's7b-eh-second', 's7b-eh-after'], role: S6A_WORK_ROLE.templateId });
    const sender = await sessionOf(world, await createS6BLine(main, { label: 's7b-eh-sender',
      role: S6A_WORK_ROLE, tasks: [tasks[0]!] }));
    const follower = await sessionOf(world, await createS6BLine(main, { label: 's7b-eh-follower',
      role: S6A_WORK_ROLE, tasks: [tasks[1]!] }));

    // Two real waits on the injected clock: 60 s and a follow-up of it at 120 s.
    const first = await sendS7BWaitingInquiry(world, { goal, session: sender, taskId: tasks[0]!.taskId,
      label: 'first', body: { recipient: follower.ref, text: 'S7B first expiry question', intent: 'inquiry',
        needsReply: true, waitAfterSend: true, deadlineMs: 60_000 } });
    const second = await sendS7BWaitingInquiry(world, { goal, session: follower, taskId: tasks[1]!.taskId,
      label: 'second', body: { recipient: sender.ref, text: 'S7B second expiry question', intent: 'inquiry',
        needsReply: true, waitAfterSend: true, deadlineMs: 120_000, followupOf: first.ref } });
    expect(first.expiredAt).toBeNull();
    expect(second.followupOf).toEqual(first.ref);
    expect(Date.parse(second.deadline!)).toBeGreaterThan(Date.parse(first.deadline!));

    // A3: record the order of the expiries the published owner writes; every result is the real one. A heartbeat
    // before the clock moves meets the first wait not yet due (`skipped`), so only a committed expiry counts.
    const owner = (world.platform as unknown as { messageExpiry: Pick<MessageExpiryPort, 'recordExpiry'> }).messageExpiry;
    const realRecord = owner.recordExpiry;
    const order: string[] = [];
    owner.recordExpiry = async (ctx, input) => {
      const written = await realRecord.call(owner, ctx, input);
      if (written.status === 'committed') order.push(input.messageRef.messageId);
      return written;
    };
    const callsBefore = (await world.scripted.requests(sender)).length
      + (await world.scripted.requests(follower)).length;

    // No input consumer is configured; the lease-owning Host's heartbeat still records both due waits.
    clock.advance(120_000);
    const [expiredFirst, expiredSecond] = await Promise.all(
      [waitForExpiry(world, first.ref), waitForExpiry(world, second.ref)]);
    expect(order, 'the earliest deadline first (R4-14 item 3)').toEqual([first.ref.messageId, second.ref.messageId]);
    expect(expiredFirst.expiredAt).toBe(clock.now());
    expect(expiredSecond.expiredAt).toBe(clock.now());
    expect((await world.scripted.requests(sender)).length
      + (await world.scripted.requests(follower)).length, 'the expiry pass wakes nothing').toBe(callsBefore);

    // The same-millisecond rescan: the owner skips and the record does not move.
    // The same-millisecond rescan writes nothing: no new revision and no accepted input. (Its status is the owner
    // row's, X-expiry; this row proves the outcome the L row names.)
    const revisions = expiredFirst.revision;
    await callPublishedOwnerAsHost(world, 'S7B', { owner: 'messageExpiry.recordExpiry', wave: '7B-1 L',
      scope: { projectId: world.scope.projectId, workspaceId: world.scope.workspaceId } }, { messageRef: first.ref });
    const rescan = await readS7BMessage(world, first.ref);
    expect(rescan.revision).toBe(revisions);
    expect(rescan.acceptedInputs ?? []).toEqual([]);

    // The wait read on the injected clock.
    const facts = ready<SessionFactsV1>(await world.post('sessions/facts', plain(S6A_SCOPE, sender.ref)),
      'the expired wait of the sender');
    expect(facts.wait).toMatchObject({ messageRef: first.ref,
      runRef: first.sender.kind === 'work_run' ? first.sender.runRef : undefined });
    expect((await readS7BWaits(world, { session: sender, messageRef: first.ref })).waitByRef.state.state).toBe('expired');

    // The second real expiry: the visible prompt through X's count, rendered at 2.
    const receipts: WorkflowStepReceipt[] = [];
    await driveWorkflow(world.ag2b, { schemaVersion: 1, goalRef: goal, flowId: 's7b-eh-second-continuation',
      sessionHint: follower.ref, kind: 'select_work', taskId: tasks[1]!.taskId },
    { stopBefore: 'open_checks', receipts });
    const successor = claimedRunOf(receipts, 'the second expiry continuation');
    const continued = ready<{ run: { consumedWait?: { kind: string; originalRun?: unknown } } }>(
      await world.post('executions/read', plain(S6A_SCOPE, successor.run)), 'the second expiry successor Run');
    expect(continued.run.consumedWait).toMatchObject({ kind: 'expiry',
      originalRun: second.sender.kind === 'work_run' ? second.sender.runRef : undefined });
    const expected = waitExpiryDeliveryText({ messageId: second.ref.messageId,
      question: 'S7B second expiry question', deadline: second.deadline!, expiryCount: 2 });
    const requests = await world.scripted.requests(follower);
    expect(requests.map(request => request.messages.map(message => typeof (message as { content?: unknown }).content === 'string' ? String((message as { content: string }).content) : '').join('\n')).join('\n'))
      .toContain(expected);

    // A fresh wait due after the reopen: the new Host's first heartbeat pass records it on the same directory.
    const after = await sessionOf(world, await createS6BLine(main, { label: 's7b-eh-after',
      role: S6A_WORK_ROLE, tasks: [tasks[2]!] }));
    const later = await sendS7BWaitingInquiry(world, { goal, session: after, taskId: tasks[2]!.taskId,
      label: 'after', body: { recipient: sender.ref, text: 'S7B after the reopen', intent: 'inquiry',
        needsReply: true, waitAfterSend: true, deadlineMs: 60_000 } });

    // Window A: the claim's commit is held, the Host is crashed and reopened on the same directory. The read after the
    // restart still shows the expired fact and the wait; the held claim had not landed.
    const select = { schemaVersion: 1 as const, goalRef: goal, flowId: 's7b-eh-reopen',
      sessionHint: sender.ref, kind: 'select_work' as const, taskId: tasks[0]!.taskId };
    const reopened = await reopenS7BHost(world, {
      advance: await advanceUntil(world.ag2b, select, 'claim_task'), messageRef: first.ref, session: sender });
    expect(reopened.message).toMatchObject({ ref: first.ref, expiredAt: clock.now() });
    expect(reopened.message.acceptedInputs ?? []).toEqual([]);
    expect(reopened.wait).toMatchObject({ messageRef: first.ref,
      runRef: first.sender.kind === 'work_run' ? first.sender.runRef : undefined });
    // Re-driving the same continuation writes no second claim: the one claim committed under the hold, and the drive
    // continues on its expiry arm from the Task's successor Run.
    const again: WorkflowStepReceipt[] = [];
    await driveWorkflow(world.ag2b, { schemaVersion: 1, goalRef: goal, flowId: 's7b-eh-reopen',
      sessionHint: sender.ref, kind: 'select_work', taskId: tasks[0]!.taskId },
    { stopBefore: 'open_checks', receipts: again });
    expect(again.filter(receipt => receipt.kind === 'claim_task')).toHaveLength(0);
    const replay = ready<{ latestWork: { runRef: { runId: string } } | null }>(
      await world.post('sessions/facts', plain(S6A_SCOPE, sender.ref)), 'the reopened sender facts').latestWork;
    if (replay === null) throw new Error('S7B: the reopened continuation has no claim');
    expect(ready<{ run: { consumedWait?: { kind: string; originalRun?: unknown } } }>(
      await world.post('executions/read', plain(S6A_SCOPE, replay.runRef)), 'the reopened successor Run').run.consumedWait)
      .toMatchObject({ kind: 'expiry',
        originalRun: first.sender.kind === 'work_run' ? first.sender.runRef : undefined });
    const accepted = (await readS7BMessage(world, first.ref)).acceptedInputs?.filter(input => input.part === 'expiry') ?? [];
    expect(accepted).toHaveLength(1);
    clock.advance(60_000);
    expect((await waitForExpiry(world, later.ref)).expiredAt).toBe(clock.now());
  }, 120_000);
});
