/** X-references (§3.1 item 5, §3.2): the reference checks and the view reads' one derivation, keys and zero writes. */
import { afterEach, describe, expect, it } from 'vitest';
import type { SessionRef } from '../../src/contracts/core/identity.js';
import type { SessionMessageRef } from '../../src/contracts/core/session-message.js';
import { plainSessionRefToAggregate } from '../../src/core/work-graph/sessions/session-record-codecs.js';
import { createC1Harness, type C1Harness } from '../helpers/C1-mailbox-fixture.js';
import type { ClaimFixtureKind } from '../helpers/task-claim-fixture.js';
const harnesses: C1Harness[] = [];
afterEach(async () => { for (const h of harnesses.splice(0)) await h.close(); });
async function openC1World(kind: ClaimFixtureKind = 'memory'): Promise<C1Harness> {
  const h = await createC1Harness(kind); harnesses.push(h); return h;
}
type Send = Parameters<C1Harness['mailbox']['sendMessage']>[1]['input'];
const send = (h: C1Harness, input: Send, requestId: string, ctx = h.ctxWork) =>
  h.mailbox.sendMessage(ctx, { input, meta: { requestId, expected: [] } });
function sent(result: Awaited<ReturnType<C1Harness['mailbox']['sendMessage']>>) {
  expect(result).toMatchObject({ status: 'committed' });
  if (result.status !== 'committed') throw new Error(`X-references: the send did not commit: ${JSON.stringify(result)}`);
  return result.value;
}
/** A records port that counts what a read writes; every call delegates to the real one unchanged (A3). */
function counted(h: C1Harness) {
  const writes = { commits: 0, events: 0 };
  const records = { ...h.backend.records, async commit(batch: Parameters<C1Harness['backend']['records']['commit']>[0]) {
    writes.commits += 1; writes.events += batch.events.length; return h.backend.records.commit(batch);
  } };
  return { mailbox: h.makeMailbox(records), writes };
}
const refOf = (h: C1Harness, messageId: string): SessionMessageRef => ({ aggregateType: 'SessionMessage',
  projectId: h.ctxHost.projectId, workspaceId: h.ctxHost.workspaceId as string, messageId });
describe('X-references', () => {
  it('accepts a Task of the message Goal and a followup between the same two Sessions', async () => {
    const h = await openC1World();
    const first = sent(await send(h, { recipient: h.idleSession, text: 'the first', taskRef: h.claim.task }, 'xr-legal-task'));
    expect(first).toMatchObject({ taskRef: h.claim.task, followupOf: null, revision: 1 });
    const second = sent(await send(h, { recipient: h.idleSession, text: 'the follow-up', followupOf: first.ref }, 'xr-legal-followup'));
    expect(second).toMatchObject({ followupOf: first.ref, taskRef: null });
    expect(await h.mailbox.readMessageView(h.ctxHost, second.ref)).toMatchObject({ status: 'ready',
      value: { message: { ref: second.ref, followupOf: first.ref },
        delivery: { delivery: 'queued', evidence: null }, disposition: { kind: 'offerable' } } });
  });
  type Refusal = { name: string; code: 'invalid' | 'not_found'; run(h: C1Harness):
    Promise<{ recipient: SessionRef; result: Awaited<ReturnType<C1Harness['mailbox']['sendMessage']>> }> };
  const refusals: Refusal[] = [
    { name: 'a Task outside the message Goal', code: 'invalid', run: async h => ({ recipient: h.idleSession,
      result: await send(h, { recipient: h.idleSession, text: 'outside', taskRef: { ...h.claim.task, goalId: 'other-goal' } }, 'xr-outside') }) },
    { name: 'a missing followup', code: 'invalid', run: async h => ({ recipient: h.idleSession,
      result: await send(h, { recipient: h.idleSession, text: 'missing', followupOf: refOf(h, 'absent') }, 'xr-missing') }) },
    { name: 'a followup between other Sessions', code: 'invalid', run: async h => {
      const first = sent(await send(h, { recipient: h.idleSession, text: 'the first' }, 'xr-other-first'));
      return { recipient: h.busySession,
        result: await send(h, { recipient: h.busySession, text: 'other', followupOf: first.ref }, 'xr-other') };
    } },
  ];
  describe.each(['memory', 'sqlite'] as const)('the refusals (%s)', kind => {
    it.each(refusals)('$name is one $code and writes no message', async ({ code, run }) => {
      const h = await openC1World(kind);
      const { recipient, result } = await run(h);
      expect(result).toMatchObject({ status: 'rejected', code });
      expect(await h.mailbox.readInboxView(h.ctxHost, { recipient, page: { limit: 10 } }))
        .toMatchObject({ status: 'ready', value: { items: [] } });
      expect(await h.mailbox.readInbox(h.ctxHost, { recipient, page: { limit: 10 } }))
        .toMatchObject({ status: 'ready', value: { items: [] } });
    });
  });
  it('reads one message with the derived fields, the same right and no write', async () => {
    const h = await openC1World();
    const message = sent(await send(h, { recipient: h.busySession, text: 'for the busy line' }, 'xr-view'));
    const foreign = sent(await send(h, { recipient: h.idleSession, text: 'for the idle line' }, 'xr-foreign', h.ctxHost));
    const { mailbox, writes } = counted(h);
    expect(await mailbox.readMessageView(h.ctxHost, message.ref)).toMatchObject({ status: 'ready',
      value: { message: { ref: message.ref, revision: 1, status: 'pending', delivery: 'queued' },
        delivery: { delivery: 'queued', deliveredTo: null, evidence: null, undeliveredReason: null },
        disposition: { kind: 'offerable' } } });
    expect(await mailbox.readMessageView(h.ctxWork, message.ref)).toMatchObject({ status: 'ready' });
    expect(await mailbox.readMessageView(h.ctxHost, refOf(h, 'absent'))).toMatchObject({ status: 'not_found' });
    expect(await mailbox.readMessageView(h.ctxWork, foreign.ref)).toMatchObject({ status: 'rejected', code: 'forbidden' });
    expect(await h.mailbox.ackMessage(h.ctxWork, { input: { messageRef: message.ref },
      meta: { requestId: 'xr-view-ack', expected: [{ ref: message.ref, revision: message.revision }] } }))
      .toMatchObject({ status: 'committed' });
    // The record still stores `queued`; the read derives delivered from the read mark, never that field.
    expect(await mailbox.readMessageView(h.ctxHost, message.ref)).toMatchObject({ status: 'ready',
      value: { message: { ref: message.ref, status: 'read', delivery: 'queued' },
        delivery: { delivery: 'delivered', deliveredTo: null, evidence: 'legacy_unknown', undeliveredReason: null },
        disposition: { kind: 'delivered', evidence: 'legacy_unknown' } } });
    expect(writes).toEqual({ commits: 0, events: 0 });
  });
  it('maps the inbox through the one derivation and keeps the keyset fields, writing nothing', async () => {
    const h = await openC1World();
    const firstPending = sent(await send(h, { recipient: h.idleSession, text: 'pending one' }, 'xr-page-one'));
    const secondPending = sent(await send(h, { recipient: h.idleSession, text: 'pending two' }, 'xr-page-two'));
    const card = await h.sessions.readSession(h.ctxHost, h.idleSession);
    if (card.status !== 'ready') throw new Error('the idle Session is not readable');
    expect(await h.lifecycle.archiveSession(h.ctxHost, { input: { sessionRef: h.idleSession, reason: 'X-references view read' },
      meta: { requestId: 'xr-page-archive',
        expected: [{ ref: plainSessionRefToAggregate(h.idleSession), revision: card.value.record.revision }] } }))
      .toMatchObject({ status: 'committed' });
    const { mailbox, writes } = counted(h);
    const first = await mailbox.readInboxView(h.ctxHost, { recipient: h.idleSession, page: { limit: 1 } });
    expect(first).toMatchObject({ status: 'ready' });
    if (first.status !== 'ready') return;
    if (first.value.nextCursor === null) throw new Error('the first page has no continuation');
    const second = await mailbox.readInboxView(h.ctxHost,
      { recipient: h.idleSession, page: { limit: 1, cursor: first.value.nextCursor } });
    expect(second).toMatchObject({ status: 'ready' });
    if (second.status !== 'ready') return;
    expect(first.value.items).toHaveLength(1);
    expect(second.value.nextCursor).toBeNull();
    expect(second.value.sourceCursor).toEqual(first.value.sourceCursor);
    const items = [...first.value.items, ...second.value.items];
    expect(items.map(item => item.message.ref.messageId).sort())
      .toEqual([firstPending.ref.messageId, secondPending.ref.messageId].sort());
    // Both records still store `queued`; the archived recipient line makes the read `undelivered`.
    expect(items.every(item => item.message.delivery === 'queued'
      && item.delivery.delivery === 'undelivered' && item.delivery.undeliveredReason === 'recipient_archived'
      && item.disposition.kind === 'undelivered' && item.disposition.reason === 'recipient_archived')).toBe(true);
    expect(writes).toEqual({ commits: 0, events: 0 });
    expect(await mailbox.readInboxView(h.ctxWork, { recipient: h.idleSession, page: { limit: 10 } }))
      .toMatchObject({ status: 'rejected', code: 'forbidden' });
  });
});
