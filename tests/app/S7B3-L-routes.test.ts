/** The two person commands over the real Host: forward, dispose, and the guard/destination cases. */
import { afterEach, describe, expect, it } from 'vitest';
import type { ArchiveLineResultV1 } from '../../src/business/workflow/session-archive.js';
import type { WorkflowStepReceipt } from '../../src/business/workflow/contracts.js';
import type {
  ForwardMessageResultV1, SessionMessage,
} from '../../src/core/work-graph/model/communication-contracts.js';
import type { SessionFactsV1 } from '../../src/core/work-graph/model/session-facts-contracts.js';
import { driveWorkflow } from '../helpers/A2-restart-fixture.js';
import { graphWrite, plain } from '../helpers/AG2b-collaboration-fixture.js';
import { s6aCardsWorkspace } from '../helpers/S6A-cards-fixture.js';
import type { S6AHostWorld } from '../helpers/S6A-host-fixture.js';
import {
  openS6ATwoWorkspaceWorld, S6A_AT, S6A_SCOPE, S6A_WORK_ROLE, type S6ARequestWorld,
} from '../helpers/S6A-request-fixture.js';
import { adoptS6BPlan, createS6BLine, governS6B } from '../helpers/S6B1-fixture.js';
import { sendS7A2PersonMessage } from '../helpers/S7A2-fixture.js';
import { inboxOf } from '../helpers/S7B-F-support.js';
import { claimedRunOf, committed, ready, S7A_REPLY_TOOLS, sessionOf } from '../helpers/S7A-fixture.js';
import { readS7BMessage } from '../helpers/S7B-fixture.js';

const worlds: S6ARequestWorld[] = [];
afterEach(async () => { for (const world of worlds.splice(0)) await world.close().catch(() => undefined); });

describe('L-routes: messages/forward and waits/dispose over the real Host', () => {
  it('forwards an undelivered message, disposes a transferred wait, and refuses a non-person, a foreign workspace and a gone destination', async () => {
    const opened = await openS6ATwoWorkspaceWorld({ backend: 'memory',
      extraBindings: [S7A_REPLY_TOOLS, { ...S7A_REPLY_TOOLS, mergeTools: ['send_session_message'] }] });
    const world = opened.world as S6AHostWorld;
    const { second } = opened;
    worlds.push(world);
    world.clock.set(S6A_AT);
    const inboxWorld = world as Parameters<typeof inboxOf>[0];
    const main = s6aCardsWorkspace(world, S6A_SCOPE);
    await governS6B(world, main, world.goals);
    const secondLine = await second.createSecretary('l-routes-second');

    // ---- messages/forward: the recipient is archived, so the message is undelivered.
    const archivedRecipient = await sessionOf(world,
      await createS6BLine(main, { label: 'l-routes-archived-recipient', role: S6A_WORK_ROLE }));
    const live = await sessionOf(world, await createS6BLine(main, { label: 'l-routes-live', role: S6A_WORK_ROLE }));
    const original = await sendS7A2PersonMessage(world, { label: 'forward', recipient: archivedRecipient.ref });
    await world.archive(archivedRecipient);
    expect((await readS7BMessage(world, original.ref)).transferredTo).toBeNull();
    const forwarded = (await world.post('messages/forward', plain(S6A_SCOPE, {
      commandId: 'l-routes-forward', messageRef: original.ref, to: live.ref,
    }))).body as ForwardMessageResultV1;
    expect(forwarded).toMatchObject({ status: 'forwarded', replayed: false });
    if (forwarded.status !== 'forwarded') throw new Error(`L-routes: ${JSON.stringify(forwarded)}`);
    expect(forwarded.message).toMatchObject({ recipient: live.ref, originalRef: original.ref });
    const beforeForward = await readS7BMessage(world, original.ref);
    expect(beforeForward.transferredTo).toEqual(forwarded.message.ref);
    expect((await inboxOf(inboxWorld, live.ref)).map(item => item.ref)).toEqual([forwarded.message.ref]);

    // ---- the same forward to an archived destination: F's destination_gone, before any write.
    const gone = await sessionOf(world, await createS6BLine(main, { label: 'l-routes-gone', role: S6A_WORK_ROLE }));
    const toGone = await sendS7A2PersonMessage(world, { label: 'gone', recipient: gone.ref });
    await world.archive(gone);
    const goneBefore = await readS7BMessage(world, toGone.ref);
    expect((await world.post('messages/forward', plain(S6A_SCOPE, {
      commandId: 'l-routes-gone-forward', messageRef: toGone.ref, to: gone.ref,
    }))).body).toEqual({ status: 'rejected', code: 'invalid', reason: 'destination_gone' });
    expect(await readS7BMessage(world, toGone.ref)).toEqual(goneBefore);

    // ---- a real Session in the second workspace: cross_workspace_forward, not not_found.
    const crossRecipient = await sessionOf(world,
      await createS6BLine(main, { label: 'l-routes-cross-recipient', role: S6A_WORK_ROLE }));
    const cross = await sendS7A2PersonMessage(world, { label: 'cross', recipient: crossRecipient.ref });
    await world.archive(crossRecipient);
    const crossBefore = await readS7BMessage(world, cross.ref);
    expect((await world.post('messages/forward', plain(S6A_SCOPE, {
      commandId: 'l-routes-cross-forward', messageRef: cross.ref, to: secondLine.ref,
    }))).body).toEqual({ status: 'rejected', code: 'invalid', reason: 'cross_workspace_forward' });
    expect(await readS7BMessage(world, cross.ref)).toEqual(crossBefore);

    // ---- a non-person caller: the route's person guard answers before the owner, so nothing is written.
    const liveBefore = await inboxOf(inboxWorld, live.ref);
    expect(await world.dispatch('messages/forward', world.systemContext(), plain(S6A_SCOPE, {
      commandId: 'l-routes-system-forward', messageRef: toGone.ref, to: live.ref,
    }))).toEqual({ status: 'rejected', code: 'forbidden', reason: 'only the person may call this route' });
    expect(await readS7BMessage(world, toGone.ref)).toEqual(goneBefore);
    expect(await inboxOf(inboxWorld, live.ref)).toEqual(liveBefore);

    // ---- waits/dispose: a real line's wait, its line archived (transfer), then the person's transfer to another line.
    const { tasks } = await adoptS6BPlan(main, world.goals.first, { label: 'l-routes-wait',
      taskIds: ['l-routes-wait-send', 'l-routes-wait-reply'], role: S6A_WORK_ROLE.templateId });
    const sender = await sessionOf(world,
      await createS6BLine(main, { label: 'l-routes-wait-sender', role: S6A_WORK_ROLE, tasks: [tasks[0]!] }));
    const waitRecipient = await sessionOf(world,
      await createS6BLine(main, { label: 'l-routes-wait-recipient', role: S6A_WORK_ROLE }));
    const handler = await sessionOf(world,
      await createS6BLine(main, { label: 'l-routes-wait-handler', role: S6A_WORK_ROLE }));
    const disposedTo = await sessionOf(world,
      await createS6BLine(main, { label: 'l-routes-wait-disposed', role: S6A_WORK_ROLE }));
    world.scriptReplies([{ kind: 'calls', calls: [{ callId: 'l-routes-wait-send', name: 'send_session_message',
      args: { recipient: waitRecipient.ref, text: 'L-routes wait question', intent: 'inquiry',
        needsReply: true, waitAfterSend: true } }] }, { kind: 'text', text: 'L-routes wait answered' }]);
    const receipts: WorkflowStepReceipt[] = [];
    await driveWorkflow(world.ag2b, { schemaVersion: 1, goalRef: world.goals.first, flowId: 'l-routes-wait',
      sessionHint: sender.ref, kind: 'select_work', taskId: tasks[0]!.taskId }, { receipts });
    const { run } = claimedRunOf(receipts, 'the L-routes wait sender');
    const wait = ready<{ items: SessionMessage[] }>(await world.post('messages/outbox',
      plain(S6A_SCOPE, { senderRun: run, page: { limit: 20 } })), 'the wait outbox').items[0];
    if (wait === undefined) throw new Error('L-routes: the wait message is not in its outbox');
    const card = await world.readSession(sender.ref);
    expect(ready<ArchiveLineResultV1>(await world.post('sessions/archive-line', graphWrite(S6A_SCOPE, {
      sessionRef: sender.ref, reason: 'L-routes wait transfer',
      tasks: [{ target: { kind: 'task', ref: tasks[0]! }, disposition: { kind: 'transfer', to: handler.ref } }],
      wait: { kind: 'transfer', runRef: run, messageRef: wait.ref, to: handler.ref },
    }, 'l-routes-archive-wait', [{ ref: card.record.ref, revision: card.record.revision }])), 'the archive').state)
      .toBe('archived');
    const transferred = await readS7BMessage(world, wait.ref);
    expect({ handler: transferred.replyHandler?.sessionRef, cancelled: transferred.waitCancelledAt })
      .toEqual({ handler: handler.ref, cancelled: null });
    const disposed = committed<SessionMessage>(await world.post('waits/dispose', plain(S6A_SCOPE, {
      commandId: 'l-routes-dispose', messageRef: wait.ref, mode: 'transfer', to: disposedTo.ref,
    })), 'the wait disposal');
    expect(disposed.replyHandler?.sessionRef).toEqual(disposedTo.ref);
    expect({ ...disposed, revision: transferred.revision, replyHandler: transferred.replyHandler })
      .toEqual(transferred);
    expect(await inboxOf(inboxWorld, disposedTo.ref)).toEqual([]);
    expect(ready<SessionFactsV1>(await world.post('sessions/facts', plain(S6A_SCOPE, sender.ref)),
      'the disposed wait facts').waits).toMatchObject([{ messageRef: wait.ref, rootRef: wait.ref,
      state: { state: 'open', reason: null } }]);
  });
});
