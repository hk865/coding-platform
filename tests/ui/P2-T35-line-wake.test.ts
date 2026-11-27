import { describe, expect, it } from 'vitest';
import type { WorkLineDetailV1 } from '../../src/contracts/work-line.js';
import { readChain } from '../../src/ui/boot.js';
import { createHostClient } from '../../src/ui/host-client.js';
import { asRecord, asText } from '../../src/ui/values.js';
import { plain } from '../helpers/AG2b-collaboration-fixture.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import { ready } from '../helpers/S7A-fixture.js';
import { openS7BWorld, runS7BWait } from '../helpers/S7B-fixture.js';
import { withS6AWorkProfile } from '../helpers/S7B2-consumable-sessions.js';
import { withConfiguredHost } from '../helpers/S7C-member-fixture.js';

/**
 * P2 T35 (frozen `p2-frozen.md:349`, §2.8 line card): a line woken by an agent's message
 * shows, on its rail card, which message's Session/line woke it — the Session or line name,
 * never the message `intent`. The world is S7B's real wait composition (`S7B-fixture.ts:53`):
 * the sender line's own `send_session_message` delivers an inquiry to the recipient line. The recipient is an
 * executor line, so the wake opens its text round (`p2-frozen.md:128`, table `:142`); the Host opens a round only
 * for a role with a configured Query profile (`host.ts` `queryProfileOf`), so the Host is started with the Work
 * role's profile (`withS6AWorkProfile`, as `S7B2-consumable-sessions.ts` and `XWR-rounds` do).
 * Current tree: the line card's `railCardOf` (`adapters/nav.ts`) writes the 叫醒 row from
 * the navigation read's `wokenBy`, so the row is red at the no-Session-id assertion, not
 * at setup.
 */

const sessionIdOf = (row: unknown): string => asText(asRecord(asRecord(row)['key'])['sessionId']);
const lineNameOf = (row: unknown): string => asText(asRecord(asRecord(row)['name'])['primary']);

describe('P2-T35 the line card names who woke the line', () => {
  it('T35 a line woken by an agent inquiry shows the sender line, not the intent', async () => {
    const { world } = await withConfiguredHost(() => openS7BWorld({ backend: 'memory' }), withS6AWorkProfile);
    try {
      const sent = await runS7BWait(world, { label: 'p2-t35' });
      // design:614/§2.8: the wake fact comes from the recipient's stored activity record, so the recipient must
      // actually open one round. Its own Work text round is scripted and then the Host's real consume pass runs.
      await world.scripted.script(sent.recipient, [{ kind: 'text', text: 'P2 T35 recipient round' }]);
      const settled = world.consumeBarrier();
      world.clock.advance(60_000);
      await settled;
      const list = ready<{ rows: unknown[] }>(
        await world.post('lines/list', plain(S6A_SCOPE, { workspace: S6A_SCOPE })), 'lines/list');
      const senderRow = list.rows.find((row) => sessionIdOf(row) === sent.sender.ref.sessionId);
      const recipientRow = list.rows.find((row) => sessionIdOf(row) === sent.recipient.ref.sessionId);
      expect(senderRow, 'the sender line row').toBeDefined();
      expect(recipientRow, 'the woken recipient line row').toBeDefined();
      const senderName = senderRow === undefined ? '' : lineNameOf(senderRow);
      const wakerText = senderName === '' ? sent.sender.label : senderName;

      const client = createHostClient(world.token, new URL(world.base).origin);
      const { data } = await readChain(client, sent.goal.goalId, { lineKey: sent.recipient.ref });
      expect(data, 'the Chain read').not.toBeNull();
      if (data === null) throw new Error('P2-T35: readChain returned no data');
      const railRow = data.rail.rows.find((row) => row.key.sessionId === sent.recipient.ref.sessionId);
      expect(railRow, 'the recipient rail row').toBeDefined();
      if (railRow === undefined) throw new Error('P2-T35: the recipient is not on the rail');

      const card = railRow.card;
      /* The first P2 assertion: the card must carry the waker row. Expected defined;
         current undefined because RailCard rows are only 负责/正在做/最近一步. */
      const wakeRow = card.rows.find((row) => row.k === '叫醒');
      expect(wakeRow, '线卡的 被谁叫醒 一行').toBeDefined();
      if (wakeRow === undefined) throw new Error('P2-T35: the line card has no waker row');
      const lineRead = ready<WorkLineDetailV1>(
        await world.post('lines/read', plain(S6A_SCOPE, { workspace: S6A_SCOPE, key: sent.recipient.ref })),
        'lines/read');
      /* Frozen: Session/line name, not the message intent. */
      expect(wakeRow.v.includes(wakerText) || wakeRow.v.includes(sent.sender.ref.sessionId)).toBe(true);
      /* G3b R2: a person-facing row never prints an internal id (lead 11-26, B9/甲). */
      expect(wakeRow.v).not.toContain(sent.sender.ref.sessionId);
      expect(JSON.stringify(card)).not.toContain('inquiry');
      /* G2 projects the wake source on the line row (`LineRowV1.wokenBy`), inside `WorkLineDetailV1.row`. */
      expect(lineRead.row.wokenBy?.senderSessionRef, 'lines/read 的被谁叫醒')
        .toMatchObject({ sessionId: sent.sender.ref.sessionId });
      /* The wake is a real round on the recipient, not a fabricated fact. */
      const queries = ready<{ items: unknown[] }>(
        await world.post('sessions/queries', plain(S6A_SCOPE, {
          sessionRef: sent.recipient.ref, page: { limit: 1 },
        })), 'sessions/queries');
      expect(queries.items.length).toBeGreaterThan(0);
    } finally {
      await world.close();
    }
  }, 180_000);
});
