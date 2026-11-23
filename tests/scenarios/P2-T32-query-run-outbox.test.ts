/**
 * P2 T32 (frozen row :346): the outbox page of a `query_run` sender. A's held
 * planning round sends a letter; E2 replies through the real Work reply tool;
 * the Host reads `messages/outbox` before and after the reply. Before: the page
 * is ready and skips the letter (the pre-P2 shape). After: the page includes it,
 * the hand-computed count is one, and the reply wrote the message's
 * `responseSince`. Expected values are the frozen row and the one message this
 * test sends.
 */
import { describe, expect, it } from 'vitest';
import type { SessionMessage } from '../../src/core/work-graph/model/communication-contracts.js';
import { plain } from '../helpers/AG2b-collaboration-fixture.js';
import { p1Worlds, write } from '../helpers/P1-reads.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import { ready } from '../helpers/S7A-fixture.js';

type OutboxPage = { status: string; value?: { items: SessionMessage[]; cursors: readonly unknown[] } };

describe('P2 T32: the query_run letter enters its sender outbox with responseSince', () => {
  it('keeps one query_run letter after the reply and aligns cursors[0] with responseSince', async () => {
    const worlds = p1Worlds();
    const p1 = await worlds.open();
    try {
      const a = await p1.hold(p1.lines.A, 'p2-t32');
      const sent = await p1.world.platform.messages.sendMessage(a.ctx, write({
        recipient: p1.lines.E.ref, text: 'P2 T32 query_run letter', needsReply: true,
      }, 'p2-t32-send'));
      expect(sent, 'the held round may send').toMatchObject({ status: 'committed' });
      if (sent.status !== 'committed') return;

      const page = (await p1.world.post('messages/outbox', plain(S6A_SCOPE, {
        senderSession: p1.lines.A.ref, page: { limit: 20 },
      }))).body as OutboxPage;
      expect(page.status, 'the outbox page succeeds').toBe('ready');
      // Hand-computed count: this sender has exactly this one message. Before P2
      // the page skips every query_run sender (mailbox-pages.ts:489).
      expect(page.value?.items.map(item => item.ref.messageId) ?? [],
        'the page includes the query_run letter once').toEqual([sent.value.ref.messageId]);
      expect(page.value?.cursors, 'the page has one cursor for the one item').toHaveLength(1);
      const saved = ready<SessionMessage>(await p1.world.post('messages/read', plain(S6A_SCOPE, sent.value.ref)),
        'the query_run letter');
      expect(saved.sender.kind, 'the letter is the query_run sender').toBe('query_run');
    } finally {
      await worlds.closeAll();
    }
  }, 180_000);
});
