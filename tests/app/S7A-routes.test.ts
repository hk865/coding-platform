/**
 * L-routes-1: the person's routes over the REAL Host, route table and composition root —
 * `tasks/hold/release` (a task hold) and `decisions/answer` (an `action_release` card) replace the old message
 * release; `messages/withdraw` and the two derived view reads stay.
 *
 * Every prior state comes from the frozen 7A-1 fixture's public steps; every check reads a route or the public owner.
 * No store read, no hand-written fact, no model call. Expected values are hand-computed: a decision pins
 * `approvalRevision = revision + 1`, and `deriveMessageDelivery` gives an awaiting inquiry to an idle line `queued`
 * with `{kind: 'not_released', release: 'awaiting'}`.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { CORE_ROUTE_SPECS } from '../../src/app/core-routes.js';
import type {
  SessionMessage, SessionMessagePage, SessionMessageReadPageV1, SessionMessageReadV1,
} from '../../src/core/work-graph/model/communication-contracts.js';
import { graphWrite, plain } from '../helpers/AG2b-collaboration-fixture.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import type { S6AHostWorld } from '../helpers/S6A-host-fixture.js';
import {
  committed, holdS7AQueryRound, openS7AQueryWorld, ready, sendS7ASecretaryMessage, setS7AAutonomy,
} from '../helpers/S7A-fixture.js';

const worlds: S6AHostWorld[] = [];
afterEach(async () => { for (const world of worlds.splice(0)) await world.close().catch(() => undefined); });

/** The read-only copy line as the idle recipient; `every_step` makes an agent's inquiry wait for the person. */
async function openInquiryWorld(label: string) {
  const opened = await openS7AQueryWorld({ backend: 'memory' });
  worlds.push(opened.world);
  await setS7AAutonomy(opened.world, opened.goal, 'every_step');
  const sent = await sendS7ASecretaryMessage(opened.world, { label, goalId: opened.goal.goalId },
    opened.session, `S7A ${label} inquiry`);
  return { ...opened, sent };
}

describe('L-routes-1: hold release and card answer over HTTP', () => {
  it('publishes the person routes for a hold release and an action-card answer', async () => {
    // P2 moves the person's release from a message to a task hold and an
    // `action_release` card: `tasks/hold/release` releases a hold, and the
    // card answer stays `decisions/answer`. RED until the hold route exists.
    const holdRoute = Object.entries(CORE_ROUTE_SPECS)
      .find(([suffix]) => suffix === 'tasks/hold/release')?.[1];
    expect(holdRoute).toMatchObject({ kind: 'graph_write' });
    expect(CORE_ROUTE_SPECS['decisions/answer']).toMatchObject({ kind: 'graph_write' });
  });
});

describe('L-routes-1: withdraw over HTTP', () => {
  it('the person withdraws its own message and a system actor\'s attempt writes nothing', async () => {
    const opened = await openS7AQueryWorld({ backend: 'memory' });
    worlds.push(opened.world);
    const send = (requestId: string, text: string) => opened.world.dispatch('messages/send',
      opened.world.humanContext(), graphWrite(S6A_SCOPE,
        { recipient: opened.session.ref, text, needsReply: true }, requestId));
    const first = committed<SessionMessage>(await send('l-withdraw-first', 'S7A withdraw me'), 'the first send');
    const second = committed<SessionMessage>(await send('l-withdraw-second', 'S7A not yours'), 'the second send');
    const secondBefore = ready<SessionMessage>(await opened.world.post('messages/read', plain(S6A_SCOPE, second.ref)),
      'the second message before the refused attempt');

    const withdrawn = committed<SessionMessage>(await opened.world.post('messages/withdraw',
      graphWrite(S6A_SCOPE, { messageRef: first.ref }, 'l-withdraw-first-cancel')), 'the withdrawal');
    expect(withdrawn).toMatchObject({ revision: 2, status: 'pending', withdrawnAt: expect.any(String) });
    expect(ready<SessionMessage>(await opened.world.post('messages/read', plain(S6A_SCOPE, first.ref)),
      'the withdrawn message')).toEqual(withdrawn);

    expect(await opened.world.dispatch('messages/withdraw', opened.world.systemContext(),
      graphWrite(S6A_SCOPE, { messageRef: second.ref }, 'l-withdraw-system')))
      .toMatchObject({ status: 'rejected', code: 'forbidden' });
    expect(ready<SessionMessage>(await opened.world.post('messages/read', plain(S6A_SCOPE, second.ref)),
      'the untouched message')).toEqual(secondBefore);
  });

  it('the original sender withdraws its own round\'s message through the Runtime context it was given', async () => {
    const opened = await openS7AQueryWorld({ backend: 'memory' });
    worlds.push(opened.world);
    await setS7AAutonomy(opened.world, opened.goal, 'every_step');
    // Both commands run inside the round the Runtime gave us: the owner admits a sender only while its round is entered.
    const withdrawn = await holdS7AQueryRound(opened.world, { label: 'l-withdraw-own', goalId: opened.goal.goalId },
      async context => {
        const saved = committed<SessionMessage>(await opened.world.dispatch('messages/send', context,
          graphWrite(S6A_SCOPE, { recipient: opened.session.ref, text: 'S7A own round',
            needsReply: true }, 'l-withdraw-own-send')), 'the round send');
        return committed<SessionMessage>(await opened.world.dispatch('messages/withdraw', context,
          graphWrite(S6A_SCOPE, { messageRef: saved.ref }, 'l-withdraw-own')), 'the sender\'s withdrawal');
      });
    expect(withdrawn).toMatchObject({ revision: 2, status: 'pending', withdrawnAt: expect.any(String) });
    expect(ready<SessionMessage>(await opened.world.post('messages/read', plain(S6A_SCOPE, withdrawn.ref)),
      'the withdrawn message')).toEqual(withdrawn);
  });
});

describe('L-routes-1: the two view reads', () => {
  it('derives delivery and disposition while the record reads keep their old shape', async () => {
    const opened = await openInquiryWorld('l-view');
    const ref = opened.sent.message.ref;
    const view = ready<SessionMessageReadV1>(await opened.world.post('messages/view',
      plain(S6A_SCOPE, ref)), 'the message view');
    expect(view.message).toEqual(opened.sent.message);
    expect(view.delivery).toEqual({ delivery: 'queued', deliveredTo: null, evidence: null, undeliveredReason: null });
    // P2 §2.2: the release gate is gone; an unwithdrawn, unresponded message is offerable.
    expect(view.disposition).toEqual({ kind: 'offerable' });

    const page = ready<SessionMessageReadPageV1>(await opened.world.post('messages/inbox-view',
      plain(S6A_SCOPE, { recipient: opened.session.ref, page: { limit: 20 } })), 'the inbox view');
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toEqual(view);

    // The record read still answers the record itself, and the old inbox keeps its page shape.
    const record = ready<SessionMessage>(await opened.world.post('messages/read', plain(S6A_SCOPE, ref)),
      'the record read');
    expect(record).toEqual(opened.sent.message);
    expect(Object.keys(record)).not.toContain('disposition');
    const inbox = ready<SessionMessagePage>(await opened.world.post('messages/inbox',
      plain(S6A_SCOPE, { recipient: opened.session.ref, page: { limit: 20 } })), 'the old inbox page');
    expect(Object.keys(inbox)).toEqual(['items', 'cursors', 'nextCursor', 'sourceCursor']);
    expect(inbox.items).toHaveLength(1);
    expect(inbox.items[0]).toEqual(opened.sent.message);
  });
});
