/** X-reject (the frozen rules: §3.4, §5.5; SR3 7–8): the text reply, the refusal whose reason is the saved
 * body, `rejectedAt`, the one slot, the recipient check and the command id's replay; memory,
 * all prior state through the public owners. The post-application reply is P's row. */
import { afterEach, describe, expect, it } from 'vitest';
import type { SessionMessageRef } from '../../src/contracts/core/session-message.js';
import { AT, createC1Harness, type C1Harness } from '../helpers/C1-mailbox-fixture.js';

const harnesses: C1Harness[] = [];
afterEach(async () => { for (const h of harnesses.splice(0)) await h.close(); });
async function openC1World(): Promise<C1Harness> {
  const h = await createC1Harness('memory');
  harnesses.push(h);
  return h;
}
function reply(h: C1Harness, ref: SessionMessageRef, revision: number,
  body: { text: string } | { reject: true; reason: string }, requestId: string) {
  return h.mailbox.respondMessage(h.ctxWork,
    { input: { messageRef: ref, ...body }, meta: { requestId, expected: [{ ref, revision }] } });
}
async function sent(h: C1Harness, requestId: string, recipient = h.busySession, ctx = h.ctxHost) {
  const result = await h.mailbox.sendMessage(ctx,
    { input: { recipient, text: 'a question', needsReply: true }, meta: { requestId, expected: [] } });
  if (result.status !== 'committed') throw new Error('the send did not commit');
  return result.value;
}
async function read(h: C1Harness, ref: SessionMessageRef) {
  const result = await h.mailbox.readMessage(h.ctxHost, ref);
  if (result.status !== 'ready') throw new Error('the message is not readable');
  return result.value;
}

describe('X-reject', () => {
  it('a text reply keeps the old response keys and binds the first position', async () => {
    const h = await openC1World();
    const message = await sent(h, 'xr-send-text', h.busySession, h.ctxWork);
    const replied = await reply(h, message.ref, 1, { text: 'Approved; I will start.' }, 'xr-text');
    expect(replied).toMatchObject({ status: 'committed' });
    if (replied.status !== 'committed') return;
    expect(replied.value).toMatchObject({ revision: 2, status: 'responded', readAt: AT, rejectedAt: null,
      responseSince: replied.cursor, response: { respondedAt: AT } });
    expect(replied.value.response).not.toHaveProperty('reject');
    expect(replied.value.response).not.toHaveProperty('reason');
    expect(await read(h, message.ref)).toMatchObject({ revision: 2, status: 'responded', rejectedAt: null,
      responseSince: replied.cursor });
  });

  it('a reject stores the reason as the reply body and rejectedAt in the same commit', async () => {
    const h = await openC1World();
    const message = await sent(h, 'xr-send-reject');
    const reason = 'No: the plan lacks a rollback.';
    const replied = await reply(h, message.ref, 1, { reject: true, reason }, 'xr-reject');
    expect(replied).toMatchObject({ status: 'committed' });
    if (replied.status !== 'committed') return;
    expect(replied.value).toMatchObject({ revision: 2, status: 'responded', readAt: AT, rejectedAt: AT,
      response: { reject: true, reason, respondedAt: AT } });
    expect('responseSince' in replied.value).toBe(false);
    expect(await h.mailbox.readMessageBody(h.ctxHost, { messageRef: message.ref, part: 'response' }))
      .toMatchObject({ status: 'ready', value: { text: reason } });
  });

  it('only the recipient replies; a host and a work run on another line are forbidden', async () => {
    const h = await openC1World();
    const foreign = await sent(h, 'xr-send-foreign', h.idleSession);
    expect(await reply(h, foreign.ref, 1, { text: 'mine' }, 'xr-foreign'))
      .toMatchObject({ status: 'rejected', code: 'forbidden' });
    expect(await h.mailbox.respondMessage(h.ctxHost, { input: { messageRef: foreign.ref, text: 'host' },
      meta: { requestId: 'xr-host', expected: [{ ref: foreign.ref, revision: 1 }] } }))
      .toMatchObject({ status: 'rejected', code: 'forbidden' });
    expect(await read(h, foreign.ref)).toMatchObject({ revision: 1, status: 'pending', response: null, rejectedAt: null });
  });

  it('replays the same command id, conflicts on a changed body and refuses a second reply', async () => {
    const h = await openC1World();
    const message = await sent(h, 'xr-send-once');
    const first = await reply(h, message.ref, 1, { reject: true, reason: 'first' }, 'xr-once');
    expect(first).toMatchObject({ status: 'committed', replayed: false });
    if (first.status !== 'committed') return;
    expect(await reply(h, message.ref, 1, { reject: true, reason: 'first' }, 'xr-once'))
      .toMatchObject({ status: 'committed', replayed: true, cursor: first.cursor });
    expect(await reply(h, message.ref, 1, { text: 'changed' }, 'xr-once'))
      .toMatchObject({ status: 'rejected', code: 'idempotency_conflict' });
    expect(await reply(h, message.ref, 2, { text: 'second' }, 'xr-second'))
      .toMatchObject({ status: 'rejected', code: 'invalid' });
    expect(await read(h, message.ref)).toMatchObject({ revision: 2, status: 'responded', response: { reject: true, reason: 'first' } });
    const inbox = await h.mailbox.readInbox(h.ctxHost, { recipient: h.busySession, page: { limit: 10 } });
    expect(inbox).toMatchObject({ status: 'ready' });
    if (inbox.status !== 'ready') return;
    expect(inbox.value.items.map(item => item.ref.messageId)).toEqual([message.ref.messageId]);
  });
});
