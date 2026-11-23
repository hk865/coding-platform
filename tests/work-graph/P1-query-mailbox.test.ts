/**
 * P1 C1–C6 (contract `p1-frozen.md` 2.1–2.2, section 五): a Query round that is not a request round sends, reads its
 * own inbox and replies through the existing mailbox ports, as the new `query_run` sender and replier.
 *
 * The rounds are real: `openP1World`'s held planning rounds (a person's `action_request` to the line; the Runtime's own
 * context). Every round sends without an intent (stored null, Q11). Reads are the public mailbox reads; nothing reads a store.
 *
 * Red today, at behaviour: the mailbox sends every `query_run` caller down the secretary path, which refuses a round
 * that is not a request round (`mailbox-send.ts:370-393`, `mailbox-access.ts:108-113`), and a reply takes only a Work
 * Run (`mailbox-commands.ts:95`). Each row fails at its first round call. Green when P1's `queryRounds` branch lands.
 *
 * Mutations (lead, after stacking): C1 the sender is written as `host`; C2 the read rule does not limit the reader;
 * C3 the replier is written as `host`; C4 each of the three refusals deleted in turn; C5 the send does not guard
 * `round.guards`; C6 the outbox page stops skipping `query_run` senders.
 *
 * Deviation from the row text (C2, C3): "E sends to A" is a person's message to A here. The rows judge the reader and
 * the replier, not the sender's kind, and a Work Run's send would need its own Task and Run.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SessionMessage } from '../../src/core/work-graph/model/communication-contracts.js';
import { plain } from '../helpers/AG2b-collaboration-fixture.js';
import type { P1HeldRound, P1World } from '../helpers/P1-round-fixture.js';
import { inbox, messageOf, p1Worlds, personSends, reachedBefore, replyAs, write } from '../helpers/P1-reads.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import { commitBarrier } from '../helpers/S6A-commit-barrier.js';

vi.mock('../../src/core/record-store/in-memory-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-commit-barrier.js')).inMemoryBarrierModule(importOriginal));
vi.mock('../../src/core/record-store/sqlite-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-commit-barrier.js')).sqliteBarrierModule(importOriginal));

const worlds = p1Worlds();
afterEach(async () => {
  const unreleased = commitBarrier.reset();
  await worlds.closeAll();
  expect(unreleased).toEqual([]);
});
const LONG = 600_000;

/** The round's send to `to` (2.2 发件): needs a reply, no intent (Q11). */
async function roundSends(p1: P1World, round: P1HeldRound, to: P1World['lines']['E'], text: string, requestId: string,
  extra: Record<string, unknown> = {}) {
  return p1.world.platform.messages.sendMessage(round.ctx, write({ recipient: to.ref, text,
    needsReply: true, ...extra }, requestId));
}

/** The held round's Session generation, as the line's own card shows it while the round occupies it. */
async function generationOf(p1: P1World, round: P1HeldRound): Promise<number> {
  const occupancy = (await p1.world.readSession(round.line)).record.occupancy;
  if (occupancy === null || occupancy.kind !== 'execution') throw new Error('P1: the line is not held by its round');
  return occupancy.generation;
}

describe('C1–C3, C6: the round sends, reads its own box and replies', () => {
  it('C1, C6: A\'s round sends E a message that needs a reply; E has it with the query_run sender; the round reads it; A\'s outbox skips it', async () => {
    const p1 = await worlds.open();
    const a = await p1.hold(p1.lines.A, 'c1-a');
    const sent = await roundSends(p1, a, p1.lines.E, 'P1 C1 question', 'c1-send');
    expect(sent).toMatchObject({ status: 'committed' });
    if (sent.status !== 'committed') return;
    const received = (await inbox(p1.world, p1.lines.E)).find(item => item.ref.messageId === sent.value.ref.messageId);
    if (a.ctx.principal.kind !== 'query_run') throw new Error('P1: not a QueryRun');
    expect(received?.sender).toEqual({ kind: 'query_run', sessionRef: p1.lines.A.ref,
      queryRunRef: a.ctx.principal.queryRunRef, generation: await generationOf(p1, a) });
    expect(await p1.world.platform.messages.readMessage(a.ctx, sent.value.ref)).toMatchObject({ status: 'ready' });
    // C6 (ruling S2, P2): the Host reads A's outbox page; it is ready and INCLUDES the query_run send.
    const outbox = (await p1.world.post('messages/outbox', plain(S6A_SCOPE, {
      senderSession: p1.lines.A.ref, page: { limit: 20 } }))).body as { status: string; value?: { items: SessionMessage[] } };
    expect(outbox.status).toBe('ready');
    expect(outbox.value?.items.map(item => item.ref.messageId)).toContain(sent.value.ref.messageId);
  }, LONG);

  it('C2: the round reads its own inbox page and items; another Session\'s message stays closed', async () => {
    const p1 = await worlds.open();
    const a = await p1.hold(p1.lines.A, 'c2-a');
    const first = await personSends(p1.world, p1.lines.A, 'P1 C2 first', 'c2-first', false);
    const second = await personSends(p1.world, p1.lines.A, 'P1 C2 second', 'c2-second', false);
    const toS = await personSends(p1.world, p1.lines.S, 'P1 C2 to S', 'c2-to-s', false);
    const page = await p1.world.platform.messages.readInbox(a.ctx, { recipient: p1.lines.A.ref, page: { limit: 20 } });
    expect(page.status).toBe('ready');
    // Hand-counted: the round's own opening message, then the two, in commit order.
    if (page.status === 'ready') {
      expect(page.value.items.map((item: SessionMessage) => item.ref.messageId))
        .toEqual([a.source.messageId, first.messageId, second.messageId]);
    }
    expect(await p1.world.platform.messages.readMessage(a.ctx, second)).toMatchObject({ status: 'ready' });
    const closed = await p1.world.platform.messages.readMessage(a.ctx, toS);
    expect(closed).toMatchObject({ status: 'rejected', code: 'forbidden' });
    if (closed.status === 'rejected') expect(closed.reason).toContain('not addressed to or sent by the caller Session');
  }, LONG);

  it('C3: the round replies once as the query_run replier; a second reply is refused', async () => {
    const p1 = await worlds.open();
    const a = await p1.hold(p1.lines.A, 'c3-a');
    const asked = await personSends(p1.world, p1.lines.A, 'P1 C3 question', 'c3-ask');
    const replied = await replyAs(p1.world, a.ctx, asked, 'P1 C3 reply', 'c3-reply');
    expect(replied).toMatchObject({ status: 'committed' });
    const message = await messageOf(p1.world, asked);
    expect(message.status).toBe('responded');
    expect(message.response?.sender.kind).toBe('query_run');
    expect(message.response?.sender).not.toHaveProperty('answerRef');
    const again = await replyAs(p1.world, a.ctx, asked, 'P1 C3 second reply', 'c3-reply-again');
    expect(again).toMatchObject({ status: 'rejected', code: 'invalid' });
    if (again.status === 'rejected') expect(again.reason).toContain('already has a response');
  }, LONG);
});

// C4's first cell (a read-only copy's round sends: forbidden, read-only copy) is not written: the only round a copy
// runs is its consultation Query, which builds no tool that is handed a call context, so no public step yields the
// copy round's own context (reply, questions for the lead).
describe('rejects: C4, one refusal per row, nothing written', () => {
  it('a round may not wait after its send (invalid, waitAfterSend)', async () => {
    const p1 = await worlds.open();
    const a = await p1.hold(p1.lines.A, 'c4-wait-a');
    const before = (await inbox(p1.world, p1.lines.E)).length;
    const sent = await roundSends(p1, a, p1.lines.E, 'P1 C4 wait', 'c4-wait', { waitAfterSend: true });
    expect(sent).toMatchObject({ status: 'rejected', code: 'invalid' });
    if (sent.status === 'rejected') expect(sent.reason).toContain('waitAfterSend');
    expect(await inbox(p1.world, p1.lines.E)).toHaveLength(before);
  }, LONG);

  it('S\'s round may not reply to a message addressed to A (forbidden, not addressed to the caller Session)', async () => {
    const p1 = await worlds.open();
    const [a, s] = await p1.holdRounds([p1.lines.A, p1.lines.S], 'c4-reply');
    void a;
    const asked = await personSends(p1.world, p1.lines.A, 'P1 C4 question to A', 'c4-ask-a');
    const replied = await replyAs(p1.world, s.ctx, asked, 'P1 C4 wrong replier', 'c4-wrong-reply');
    expect(replied).toMatchObject({ status: 'rejected', code: 'forbidden' });
    if (replied.status === 'rejected') expect(replied.reason).toContain('not addressed to the caller Session');
    expect((await messageOf(p1.world, asked)).response).toBeNull();
  }, LONG);
});

describe('C5 (storage, both backends): the send guards the round', () => {
  it.each(['memory', 'sqlite'] as const)('%s: the round ends before the held send commits: revision_conflict, E has nothing', async (backend) => {
    const p1 = await worlds.open({ backend });
    const a = await p1.hold(p1.lines.A, 'c5-a');
    const recipientKey = p1.lines.E.ref.sessionId;
    // The round's new message to E: the one SessionMessage record at revision 1 that names E.
    const held = commitBarrier.hold(commit => commit.records.some(record => record.revision === 1
      && record.refKey.includes('"aggregateType":"SessionMessage"') && record.json.includes(recipientKey)), 'C5 send');
    const before = (await inbox(p1.world, p1.lines.E)).length;
    const sending = roundSends(p1, a, p1.lines.E, 'P1 C5 question', 'c5-send');
    try {
      await reachedBefore(held.reached, sending);
      await a.end();
    } finally {
      held.release();
    }
    expect(await sending).toMatchObject({ status: 'rejected', code: 'revision_conflict' });
    expect(await inbox(p1.world, p1.lines.E)).toHaveLength(before);
  }, LONG);
});
