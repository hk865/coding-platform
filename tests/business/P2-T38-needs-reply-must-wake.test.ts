/**
 * P2 T38 (frozen `p2-frozen.md` “施工中的补充裁定” S-1, user 11-21): a message that
 * needs a reply must wake its recipient.
 *
 * The one table has the three variants of the same rule:
 * - `needsReply:true, wake:false` → `invalid` with the frozen sentence, and the
 *   sender's outbox carries no message;
 * - `needsReply:true` without `wake` → committed, and the stored message has
 *   `wake:true`;
 * - `needsReply:false, wake:false` → committed.
 *
 * Public entries only: the real Host world (`openS7B2RoundWorld`), one held
 * secretary request round (`holdS6BRequestRound`; public `queries/prepare` and
 * `queries/start`), the round's own scripted model calling the real
 * `send_session_message` tool, then `messages/outbox` and `messages/view`.
 * The expected sentence is the frozen S-1 text, not a `src` constant.
 *
 * 红-setup：G3 的 `buildStageTwo`/`readRunningCommands` 装配（`src/app/core-routes.ts:1301`）。
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { ModelRequest } from '../../vendor/coding-agent/dist/public-api.js';
import type { SessionMessage } from '../../src/core/work-graph/model/communication-contracts.js';
import { plain } from '../helpers/AG2b-collaboration-fixture.js';
import { holdS6BRequestRound } from '../helpers/S6B1-fixture.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import { openS7B2RoundWorld } from '../helpers/S7B2-secretary-rounds.js';
import type { S6AHostWorld } from '../helpers/S6A-host-fixture.js';

const S1 = 'a message that needs a reply must wake the recipient; drop wake:false or set needsReply:false';
const WORLDS: S6AHostWorld[] = [];
afterEach(async () => { await Promise.allSettled(WORLDS.splice(0).map(world => world.close())); });

type Variant = {
  name: string;
  needsReply: boolean;
  wake?: boolean;
  expected: 'invalid' | 'committed';
  storedWake?: boolean;
};

/** The one send tool result: its JSON value, or the tool error the Runtime recorded instead. */
function sendResultOf(requests: readonly ModelRequest[], callId: string): unknown {
  for (const request of requests) {
    const message = request.messages.find(candidate => candidate.role === 'tool' && candidate.callId === callId);
    if (message === undefined || message.role !== 'tool') continue;
    const result = message.result;
    const output = result.output ?? [];
    const json = output.find(block => block.kind === 'json');
    if (json !== undefined && json.kind === 'json') return json.value;
    const error = result.status === 'error' ? result.error : undefined;
    return {
      status: result.status,
      code: error?.code,
      reason: error?.message,
      text: output.flatMap(block => block.kind === 'text' ? [block.text] : []).join(''),
    };
  }
  return undefined;
}

const rows: readonly Variant[] = [
  { name: 'needsReply and no wake is refused', needsReply: true, wake: false, expected: 'invalid' },
  { name: 'needsReply without wake defaults to waking', needsReply: true, expected: 'committed', storedWake: true },
  { name: 'needsReply:false with wake:false is committed', needsReply: false, wake: false, expected: 'committed', storedWake: false },
];

describe('P2 T38: a message that needs a reply must wake the recipient', () => {
  it.each(rows)('$name', async (row) => {
    const opened = await openS7B2RoundWorld({ backend: 'memory',
      secretaryTools: ['read', 'send_session_message', 'respond_session_message'],
      extraHostOptions: { requestDriver: 'off' } });
    WORLDS.push(opened.world);
    const recipient = await opened.world.createSecretary(`t38-${row.needsReply}-${String(row.wake)}-to`);
    const callId = `t38-send-${row.name}`;
    const { value: sender, started } = await holdS6BRequestRound(opened.world, {
      label: `t38-${row.name}`, goalId: null,
      replies: () => [
        { kind: 'calls', calls: [{ callId, name: 'send_session_message', args: {
          recipient: recipient.ref,
          text: `T38 ${row.name}`,
          needsReply: row.needsReply,
          ...(row.wake === undefined ? {} : { wake: row.wake }),
        } }] },
        { kind: 'calls', calls: [{ callId: `${callId}-answer`, name: 'submit_secretary_answer', args: {
          body: `T38 ${row.name} answered`, ideas: [], goalCardDrafts: [],
        } }] },
      ],
    }, async round => round.secretary);
    expect(started, 'T38: the real Query round ends').toMatchObject({ status: 'ready' });

    const send = sendResultOf(await opened.world.scripted.requests(sender), callId);
    const outbox = await opened.world.post('messages/outbox',
      plain(S6A_SCOPE, { senderSession: sender.ref, page: { limit: 20 } }));
    expect(outbox.body, 'T38: the sender outbox is readable').toMatchObject({ status: 'ready' });
    const items = (outbox.body as { value?: { items?: SessionMessage[] } }).value?.items ?? [];

    if (row.expected === 'invalid') {
      // S-1: a refused send writes nothing; the sender's own outbox cannot read it.
      expect(items, 'T38: a refused needs-reply/no-wake message is not stored').toHaveLength(0);
      expect(send, 'T38: needsReply:true with wake:false is refused with the frozen sentence')
        .toEqual({ status: 'rejected', code: 'invalid', reason: S1 });
      return;
    }

    expect(send, 'T38: the send is committed').toMatchObject({ status: 'committed' });
    expect(items, 'T38: the committed send is in the sender outbox').toHaveLength(1);
    const view = await opened.world.post('messages/view', plain(S6A_SCOPE, items[0]!.ref));
    expect(view.body, 'T38: the stored message is readable').toMatchObject({ status: 'ready' });
    const message = (view.body as { value?: { message?: SessionMessage } }).value?.message;
    if (message === undefined) throw new Error('T38: messages/view returned no message');
    expect(message.wake, `T38: the stored message wake is ${String(row.storedWake)}`).toBe(row.storedWake);
  });
});
