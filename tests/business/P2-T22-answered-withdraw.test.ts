/**
 * P2 T22 (frozen `p2-frozen.md` line 336): a message that has a formal response but no accepted input
 * is no longer delivered, carries no `legacy_unknown`, and cannot be withdrawn; the refusal literal
 * is the frozen `only an unread, unanswered, undelivered message can be withdrawn`.
 *
 * Public entry: the P1 world's real Host, the person's `messages/send`, a real Query round's
 * `respond_session_message` (the round's own trusted context), `messages/view` and `messages/withdraw`.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { SessionMessageReadV1 } from '../../src/contracts/mailbox.js';
import { graphWrite, plain } from '../helpers/AG2b-collaboration-fixture.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import { messageOf, p1Worlds, personSends, replyAs } from '../helpers/P1-reads.js';
import { ready } from '../helpers/S7A-fixture.js';

const WITHDRAW = 'only an unread, unanswered, undelivered message can be withdrawn';
const worlds = p1Worlds();
afterEach(async () => { await worlds.closeAll(); });

describe('P2 T22: an answered message that was not accepted', () => {
  it('keeps no legacy_unknown, is not offered again, and cannot be withdrawn', async () => {
    const p1 = await worlds.open();
    const round = await p1.hold(p1.lines.A, 'p2-t22');
    try {
      const asked = await personSends(p1.world, p1.lines.A, 'P2 T22 question', 'p2-t22-ask');
      const replied = await replyAs(p1.world, round.ctx, asked, 'P2 T22 answer', 'p2-t22-reply');
      expect(replied, 'T22: the round has answered').toMatchObject({ status: 'committed' });
      const message = await messageOf(p1.world, asked);
      expect(message.status, 'T22: the message is responded').toBe('responded');
      expect(message.response, 'T22: the reply is recorded').not.toBeNull();
      expect((message.acceptedInputs ?? []).some(input => input.part === 'response'),
        'T22: the reply was never accepted').toBe(false);

      const view = ready<SessionMessageReadV1>(await p1.world.post('messages/view',
        plain(S6A_SCOPE, asked)), 'the answered T22 message');
      // First P2 assertion: answered and unaccepted, the message carries no legacy delivery evidence.
      expect(JSON.stringify(view), 'T22: an answered message carries no legacy_unknown delivery')
        .not.toContain('legacy_unknown');
      expect(view.disposition, 'T22: the answered message is not offered again').not.toEqual({ kind: 'offerable' });

      const withdrawn = await p1.world.post('messages/withdraw', graphWrite(S6A_SCOPE, {
        messageRef: asked,
      }, 'p2-t22-withdraw', []));
      expect(withdrawn.body, 'T22: the answered message cannot be withdrawn').toMatchObject({
        status: 'rejected', code: 'invalid', reason: WITHDRAW,
      });
      const after = ready<SessionMessageReadV1>(await p1.world.post('messages/view',
        plain(S6A_SCOPE, asked)), 'the T22 message after the refused withdraw');
      expect(after.message.withdrawnAt, 'T22: the refused withdraw wrote nothing').toBeNull();
    } finally {
      await round.end();
    }
  }, 120_000);
});
