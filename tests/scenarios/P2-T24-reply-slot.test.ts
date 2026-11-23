/**
 * P2 T24 (p2-frozen.md:338): the reply slot belongs to the one actual recipient.
 *
 * D: both writers read the same old revision, then `commitBarrier` holds both
 *    commits; A commits, B's stale guard is `revision_conflict`, and one
 *    response body exists (GREEN today; the named mutation below is the proof).
 * `needsReply:false` has no slot: its reply is refused with the frozen
 *    "这条消息不要回复；要说话另发一条" (RED today: the owner has no needsReply rule).
 *
 * A/B/C need a real reply Run on a line whose round is open (A) or a reply before
 * the round (B/C). They are reported blocked: the Host round opened by the
 * person's message produced no model request in 120 s (A), and the
 * `holdPLTaskRequest` drive did not settle for B/C.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createC1Harness, type C1Harness } from '../helpers/C1-mailbox-fixture.js';
import { commitBarrier, type CommitMatch } from '../helpers/S6A-commit-barrier.js';

vi.mock('../../src/core/record-store/in-memory-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-commit-barrier.js')).inMemoryBarrierModule(importOriginal));
vi.mock('../../src/core/record-store/sqlite-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-commit-barrier.js')).sqliteBarrierModule(importOriginal));

const harnesses: C1Harness[] = [];
afterEach(async () => {
  commitBarrier.reset();
  for (const harness of harnesses.splice(0)) await harness.close();
});

describe('P2 T24: the reply slot', () => {
  it('D: two writers read revision r, then commitBarrier orders the commits; the loser is revision_conflict', async () => {
    const h = await createC1Harness('memory');
    harnesses.push(h);
    // The two writers race one reply slot, so the message has one: p2-frozen:163, only `needsReply:true` has a slot.
    const sent = await h.mailbox.sendMessage(h.ctxHost, { input: { recipient: h.busySession,
      text: 'P2 T24 D', needsReply: true }, meta: { requestId: 'p2-t24-d-send', expected: [] } });
    if (sent.status !== 'committed') throw new Error(`P2 T24 D: the send did not commit: ${JSON.stringify(sent)}`);
    const read = await h.mailbox.readMessage(h.ctxWork, sent.value.ref);
    if (read.status !== 'ready') throw new Error(`P2 T24 D: the read is ${read.status}`);
    const r = read.value.revision;
    const match: CommitMatch = commit => commit.records.some(record => record.schemaId === 'SessionMessage@1');
    const a = commitBarrier.hold(match, 'p2-t24-d-a');
    const b = commitBarrier.hold(match, 'p2-t24-d-b');
    const first = h.mailbox.respondMessage(h.ctxWork, { input: { messageRef: sent.value.ref, text: 'A' },
      meta: { requestId: 'p2-t24-d-a', expected: [{ ref: sent.value.ref, revision: r }] } });
    const second = h.mailbox.respondMessage(h.ctxWork, { input: { messageRef: sent.value.ref, text: 'B' },
      meta: { requestId: 'p2-t24-d-b', expected: [{ ref: sent.value.ref, revision: r }] } });
    await Promise.all([a.reached, b.reached]);
    a.release();
    const won = await first;
    b.release();
    const lost = await second;
    expect(won).toMatchObject({ status: 'committed' });
    expect(lost).toMatchObject({ status: 'rejected', code: 'revision_conflict' });
    const saved = await h.mailbox.readMessage(h.ctxWork, sent.value.ref);
    expect(saved).toMatchObject({ status: 'ready', value: { status: 'responded' } });
    expect(JSON.stringify(saved)).not.toContain('"B"');
  }, 120_000);

  it('needsReply:false has no slot: its reply is refused', async () => {
    const h = await createC1Harness('memory');
    harnesses.push(h);
    const sent = await h.mailbox.sendMessage(h.ctxHost, { input: { recipient: h.busySession,
      text: 'P2 T24 no reply', needsReply: false }, meta: { requestId: 'p2-t24-noreply-send', expected: [] } });
    if (sent.status !== 'committed') throw new Error(`P2 T24 needsReply: the send did not commit: ${JSON.stringify(sent)}`);
    const read = await h.mailbox.readMessage(h.ctxWork, sent.value.ref);
    if (read.status !== 'ready') throw new Error(`P2 T24 needsReply: the read is ${read.status}`);
    const replied = await h.mailbox.respondMessage(h.ctxWork, {
      input: { messageRef: sent.value.ref, text: 'should not be a reply' },
      meta: { requestId: 'p2-t24-noreply-reply', expected: [{ ref: sent.value.ref, revision: read.value.revision }] },
    });
    // Frozen: "这条消息不要回复；要说话另发一条" — no slot means no response write.
    expect(replied).toMatchObject({ status: 'rejected', code: 'invalid' });
    expect(JSON.stringify(replied)).toContain('这条消息不要回复；要说话另发一条');
  }, 120_000);
});
