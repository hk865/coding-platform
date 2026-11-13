/**
 * PL slice P1: the send contract over the real C1 command mailbox (§5.2.5).
 *
 * C1 has no commit-identity reader, so `lookupHostSendCommit` answers
 * `undetermined` there; the wrapper must still send. The `skipped` branch is
 * connected only through the closed-loop Host replay and is not claimed here.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { sendSystemRound } from '../../src/app/system-round.js';
import {
  systemRoundContext, type SystemRoundV1,
} from '../../src/contracts/plan-round.js';
import { systemRoundMessageRef } from '../helpers/system-round-ref.js';
import { createC1Harness, type C1Harness } from '../helpers/C1-mailbox-fixture.js';

const harnesses: C1Harness[] = [];

async function openHarness(kind: 'memory' | 'sqlite'): Promise<C1Harness> {
  const harness = await createC1Harness(kind);
  harnesses.push(harness);
  return harness;
}

afterEach(async () => {
  for (const harness of harnesses.splice(0)) await harness.close();
});

function reviewRound(harness: C1Harness): SystemRoundV1 {
  return {
    kind: 'planreview',
    goalRef: { ...harness.fixture.goalRef },
    proposalId: 'prop-pl-1',
    proposalRevision: 2,
  };
}

describe.each(['memory', 'sqlite'] as const)('sendSystemRound over the real %s command mailbox', kind => {
  it('sends exactly one real message whose first line is the request id', async () => {
    const h = await openHarness(kind);
    const scope = {
      projectId: h.busySession.projectId,
      workspaceId: h.currentRun.workspaceSnapshot.workspaceId,
    };
    const ctx = systemRoundContext(scope, new AbortController().signal);
    const round = reviewRound(h);
    const text = 'planreview:prop-pl-1:2\n请审阅这一版候选。';

    // The real C1 mailbox has no commit-identity reader: this exact send has
    // not been committed yet, and the lookup says so.
    const lookup = await h.mailbox.lookupHostSendCommit!(ctx, {
      requestId: 'planreview:prop-pl-1:2',
      scope,
      toolName: 'send_session_message',
      arguments: {
        recipient: h.idleSession,
        text,
        intent: 'action_request',
        needsReply: true,
        goalRef: round.goalRef,
      },
    });
    expect(lookup.status).toBe('undetermined');

    const result = await sendSystemRound(ctx, { messages: h.mailbox }, {
      round, recipient: h.idleSession, text,
    });

    expect(result.status).toBe('committed');
    if (result.status !== 'committed') return;
    expect(result.sendStatus).toBe('sent');

    const ref = systemRoundMessageRef(scope, 'planreview:prop-pl-1:2');
    expect(ref.status).toBe('ready');
    if (ref.status !== 'ready') return;
    const message = await h.mailbox.readMessage(ctx, ref.value);
    expect(message.status).toBe('ready');
    if (message.status !== 'ready') return;
    expect(message.value).toMatchObject({
      ref: ref.value,
      recipient: h.idleSession,
      intent: 'action_request',
      needsReply: true,
      goalRef: round.goalRef,
      sender: { kind: 'host', actor: { kind: 'system', id: 'host:plan-round' } },
    });

    const body = await h.mailbox.readMessageBody(ctx, { messageRef: ref.value, part: 'message' });
    expect(body.status).toBe('ready');
    if (body.status !== 'ready') return;
    expect(body.value.text.split('\n')[0]).toBe('planreview:prop-pl-1:2');

    const inbox = await h.mailbox.readInbox(ctx, { recipient: h.idleSession, page: { limit: 10 } });
    expect(inbox.status).toBe('ready');
    if (inbox.status !== 'ready') return;
    expect(inbox.value.items).toHaveLength(1);
    expect(inbox.value.items[0]!.ref).toEqual(ref.value);
  });
});
