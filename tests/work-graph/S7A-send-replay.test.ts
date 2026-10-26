/** X-send-replay (§3.13, §5.4): the RECEIPT decides a replay; the same command restores the original
 * event's result after the message moved, a changed field conflicts, and one message exists. */
import { afterEach, describe, expect, it } from 'vitest';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { VersionPin } from '../../src/contracts/core/identity.js';
import type { ClaimFixtureKind } from '../helpers/task-claim-fixture.js';
import { createC1Harness, type C1Harness } from '../helpers/C1-mailbox-fixture.js';

const KINDS = ['memory', 'sqlite'] as const;
const harnesses: C1Harness[] = [];
async function openC1World(kind: ClaimFixtureKind): Promise<C1Harness> {
  const harness = await createC1Harness(kind);
  harnesses.push(harness);
  return harness;
}
afterEach(async () => {
  for (const harness of harnesses.splice(0)) await harness.close();
});

type SendInput = Parameters<C1Harness['mailbox']['sendMessage']>[1]['input'];
function send(h: C1Harness, ctx: CoreCallContext, input: SendInput, requestId: string) {
  return h.mailbox.sendMessage(ctx, { input, meta: { requestId, expected: [] } });
}
function messagePin(ref: unknown, revision: number): VersionPin {
  return { ref: ref as never, revision };
}

describe.each(KINDS)('X-send-replay: the receipt is the replay (%s)', kind => {
  it('restores the original result after the message moved, with waitAfterSend kept', async () => {
    const h = await openC1World(kind);
    // A3: count the real admission; a replay must never reach it.
    let admissions = 0;
    const admission = { bodies: h.rawBodies(), async authorizeConfiguration(
      ...args: Parameters<C1Harness['authorizeConfiguration']>) {
      admissions += 1;
      return h.authorizeConfiguration(...args);
    } };
    const mailbox = h.makeMailbox(h.backend.records, h.materials, admission);
    const input = { recipient: h.busySession, text: 'please look at the plan',
      needsReply: true, waitAfterSend: true };
    const first = await mailbox.sendMessage(h.ctxWork, { input, meta: { requestId: 'x-send-replay-1', expected: [] } });
    if (first.status !== 'committed') throw new Error(`the first send did not commit: ${JSON.stringify(first)}`);
    expect(first.sendStatus).toBe('sent');
    expect(first.replayed).toBe(false);
    expect(first.value).toMatchObject({ revision: 1, status: 'pending', waitAfterSend: true,
      recipient: h.busySession });
    expect(admissions).toBe(1);

    // Everything moves: the recipient acknowledges it, so the record is revision 2, not pending.
    const acked = await h.mailbox.ackMessage(h.ctxWork, {
      input: { messageRef: first.value.ref },
      meta: { requestId: 'x-send-replay-ack', expected: [messagePin(first.value.ref, first.value.revision)] },
    });
    expect(acked).toMatchObject({ status: 'committed', value: { revision: 2, status: 'read' } });

    // The same command id and input: the original event's result at its cursor, no new admission.
    const replayed = await mailbox.sendMessage(h.ctxWork,
      { input, meta: { requestId: 'x-send-replay-1', expected: [] } });
    expect(replayed).toMatchObject({ status: 'committed', replayed: true, cursor: first.cursor,
      sendStatus: 'sent', value: { revision: 1, status: 'pending', waitAfterSend: true } });
    if (replayed.status !== 'committed') throw new Error(`the replay did not commit: ${JSON.stringify(replayed)}`);
    expect(replayed.value).toEqual(first.value);
    // The replay's admission count is zero: the counter stayed at the first send's one.
    expect(admissions).toBe(1);

    // One message only.
    const inbox = await h.mailbox.readInbox(h.ctxHost, { recipient: h.busySession, page: { limit: 10 } });
    expect(inbox).toMatchObject({ status: 'ready' });
    if (inbox.status !== 'ready') return;
    expect(inbox.value.items.map(item => item.ref.messageId)).toEqual([first.value.ref.messageId]);
  });

  it('refuses a changed field under the same command id instead of re-sending', async () => {
    const h = await openC1World(kind);
    const first = await send(h, h.ctxWork, { recipient: h.busySession, text: 'original text' }, 'x-send-replay-2');
    expect(first).toMatchObject({ status: 'committed' });
    if (first.status !== 'committed') return;

    const changedText = await send(h, h.ctxWork, { recipient: h.busySession, text: 'changed text' }, 'x-send-replay-2');
    expect(changedText).toMatchObject({ status: 'rejected', code: 'idempotency_conflict' });

    // The whole normalized payload is part of the identity: a late field under the same id conflicts.
    const withTask = await send(h, h.ctxWork, {
      recipient: h.busySession, text: 'original text',
      taskRef: { projectId: h.claim.task.projectId, goalId: h.claim.task.goalId, taskId: h.claim.task.taskId },
    }, 'x-send-replay-2');
    expect(withTask).toMatchObject({ status: 'rejected', code: 'idempotency_conflict' });

    const inbox = await h.mailbox.readInbox(h.ctxHost, { recipient: h.busySession, page: { limit: 10 } });
    expect(inbox).toMatchObject({ status: 'ready' });
    if (inbox.status !== 'ready') return;
    expect(inbox.value.items).toHaveLength(1);
    expect(inbox.value.items[0]?.ref).toEqual(first.value.ref);
  });

  it('replays a different command id as a second message', async () => {
    const h = await openC1World(kind);
    const first = await send(h, h.ctxWork, { recipient: h.busySession, text: 'first' }, 'x-send-replay-3a');
    const second = await send(h, h.ctxWork, { recipient: h.busySession, text: 'first' }, 'x-send-replay-3b');
    expect(first).toMatchObject({ status: 'committed', replayed: false });
    expect(second).toMatchObject({ status: 'committed', replayed: false });
    if (first.status !== 'committed' || second.status !== 'committed') return;
    expect(second.value.ref.messageId).not.toBe(first.value.ref.messageId);
    expect(second.cursor).not.toBe(first.cursor);
  });
});

// The send's companion `events` is fixed empty and the counter/activity companions only join records; L's
// action_request route adds no companion event either. A real caller must wire a non-empty companion event,
// then replay the same `commandId` and assert the original result at the receipt cursor with the message
// version from `receipt.versions`, although `eventIds[0]` is not it. (deferred: 7a2)
