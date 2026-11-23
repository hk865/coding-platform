/**
 * X-send-versions (§2.1, §3.3, §5.3): a message carries only `wake`/`needsReply` — the three dispatch versions live
 * on a `dispatch_task` action's `expected`, never on a message — plus the inquiry's frozen duration and the
 * recipient's activity. Real mailbox over one real store, both backends; every state comes from the public owner.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createSessionActivityReader } from '../../src/core/work-graph/sessions/session-activity.js';
import type { SessionRef } from '../../src/contracts/core/identity.js';
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
function send(h: C1Harness, input: SendInput, requestId: string, ctx = h.ctxWork) {
  return h.mailbox.sendMessage(ctx, { input, meta: { requestId, expected: [] } });
}
/** The Session's stored activity revision, read through the production read port. */
async function activityRevision(h: C1Harness, session: SessionRef): Promise<number> {
  const read = await createSessionActivityReader({ records: h.backend.records })
    .readSessionActivity(h.ctxHost, { session });
  expect(read).toMatchObject({ status: 'ready' });
  return read.status === 'ready' ? read.value.revision : -1;
}

describe.each(KINDS)('X-send-versions: the send and its claims (%s)', kind => {
  it('a person\'s send carries wake and needsReply, no message pins and no Session advance', async () => {
    const h = await openC1World(kind);
    const before = await activityRevision(h, h.busySession);
    const sent = await send(h, { recipient: h.busySession, text: 'please review the plan', needsReply: true },
      'x-sv-person-1', h.ctxHost);
    expect(sent).toMatchObject({ status: 'committed', sendStatus: 'sent', replayed: false });
    if (sent.status !== 'committed') return;
    // P2 §6 (S7A-send-versions:47): the message carries only `wake`/`needsReply`; the three versions live on a
    // `dispatch_task` action's `expected`, never on a message.
    expect(sent.value).toMatchObject({ wake: true, needsReply: true, revision: 1 });
    expect(await activityRevision(h, h.busySession)).toBe(before);
  });

  it('an agent\'s notify is released but never advances the recipient Session', async () => {
    const h = await openC1World(kind);
    const before = await activityRevision(h, h.busySession);
    const sent = await send(h, { recipient: h.busySession, text: 'for information', wake: false }, 'x-sv-notify-1');
    expect(sent).toMatchObject({ status: 'committed', sendStatus: 'sent' });
    if (sent.status !== 'committed') return;
    // A notify carries its own wake choice and no reply slot (the record omits `needsReply`/`waitAfterSend`);
    // it still never advances the recipient.
    expect(sent.value).toMatchObject({ wake: false, revision: 1 });
    expect(sent.value).not.toHaveProperty('needsReply');
    expect(sent.value).not.toHaveProperty('waitAfterSend');
    expect(await activityRevision(h, h.busySession)).toBe(before);
  });
});

describe('X-send-versions: the inquiry deadline (memory)', () => {
  it('freezes a fractional duration and refuses an unrepresentable instant', async () => {
    const h = await openC1World('memory');
    expect(await send(h, { recipient: h.idleSession, text: 'fractional', deadlineMs: 1500.5 },
      'x-sv-deadline-fractional')).toMatchObject({ status: 'committed', value: {
      deadlineMs: 1500.5, deadline: '2026-09-26T00:00:01.500Z' } });
    expect(await send(h, { recipient: h.idleSession, text: 'overflow',
      deadlineMs: 8_700_000_000_000_000 }, 'x-sv-deadline-overflow')).toMatchObject({ status: 'rejected', code: 'invalid' });
    const inbox = await h.mailbox.readInbox(h.ctxHost, { recipient: h.idleSession, page: { limit: 10 } });
    expect(inbox).toMatchObject({ status: 'ready', value: { items: [expect.anything()] } });
  });
});
