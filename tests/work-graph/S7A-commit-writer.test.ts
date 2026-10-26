/** X-commit-writer (§3.11, §4.2, §5.6): one withdraw commits once, its snapshot event and record last,
 * nothing before the commit; real mailbox and write owner over one store, both backends. */
import { afterEach, describe, expect, it } from 'vitest';
import { AT, createC1Harness, type C1Harness } from '../helpers/C1-mailbox-fixture.js';
import { sessionMessageRefKey } from '../../src/core/work-graph/sessions/message-record-codecs.js';
import type { ClaimFixtureKind } from '../helpers/task-claim-fixture.js';

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

type PreparedCommit = Parameters<C1Harness['backend']['records']['commit']>[0];

describe.each(KINDS)('X-commit-writer: one commit, companions first (%s)', kind => {
  it('one withdraw commits once, its one snapshot event last, and nothing before the commit', async () => {
    const h = await openC1World(kind);
    const sent = await h.mailbox.sendMessage(h.ctxHost, {
      input: { recipient: h.idleSession, text: 'to be withdrawn' },
      meta: { requestId: 'x-cw-send', expected: [] },
    });
    if (sent.status !== 'committed') throw new Error(`the send did not commit: ${JSON.stringify(sent)}`);
    const read = await h.mailbox.readMessage(h.ctxHost, sent.value.ref);
    if (read.status !== 'ready') throw new Error(`the message is not readable: ${JSON.stringify(read)}`);
    expect(read.value).toMatchObject({ revision: 1, status: 'pending' });

    // The real withdraw's ONE commit is held before the store writes: the public read at the gate
    // proves prepare wrote nothing, and the released batch is the command's own.
    const batches: PreparedCommit[] = [];
    let arrived!: () => void, resume!: () => void;
    const reached = new Promise<void>(resolve => { arrived = resolve; });
    const released = new Promise<void>(resolve => { resume = resolve; });
    const gated = { ...h.backend.records, async commit(batch: PreparedCommit) {
      batches.push(batch); arrived(); await released; return h.backend.records.commit(batch);
    } };
    const pending = h.makeMailbox(gated).withdrawMessage(h.ctxHost, {
      input: { messageRef: read.value.ref }, meta: { requestId: 'x-cw-withdraw', expected: [] },
    });
    await reached;
    expect(await h.mailbox.readMessage(h.ctxHost, read.value.ref)).toMatchObject({
      status: 'ready', value: { revision: 1, status: 'pending', withdrawnAt: null } });
    resume();
    expect(await pending).toMatchObject({ status: 'committed', value: { revision: 2, withdrawnAt: AT } });

    expect(batches).toHaveLength(1);
    const batch = batches[0]!;
    const messageKey = sessionMessageRefKey(read.value.ref);
    // The ONE event is this message's snapshot; its record is last.
    expect(batch.events).toHaveLength(1);
    expect(batch.events[0]).toMatchObject({ eventType: 'SessionMessageWithdrawn' });
    expect(batch.records.at(-1)?.refKey).toBe(messageKey);
    // The message CAS is the command's admitted revision, unchanged.
    expect(batch.guards).toEqual(expect.arrayContaining([{ refKey: messageKey, expectedRevision: 1 }]));
  });

  it('keeps the old persist path one commit and binds the first reply position', async () => {
    const h = await openC1World(kind);
    const input = { recipient: h.busySession, text: 'one commit only', needsReply: true };
    const first = await h.mailbox.sendMessage(h.ctxWork, { input, meta: { requestId: 'x-cw-persist', expected: [] } });
    if (first.status !== 'committed') throw new Error(`the first send did not commit: ${JSON.stringify(first)}`);
    // A second call of the same identity restores the same commit, never a new one.
    const again = await h.mailbox.sendMessage(h.ctxWork, { input, meta: { requestId: 'x-cw-persist', expected: [] } });
    expect(again).toMatchObject({ status: 'committed', replayed: true, cursor: first.cursor });
    const inbox = await h.mailbox.readInbox(h.ctxHost, { recipient: h.busySession, page: { limit: 10 } });
    if (inbox.status !== 'ready') throw new Error(`the inbox is not readable: ${JSON.stringify(inbox)}`);
    expect(inbox.value.items).toHaveLength(1);

    // The first reply writes `responseSince` in ITS OWN commit and binds it.
    const replied = await h.mailbox.respondMessage(h.ctxWork, {
      input: { messageRef: first.value.ref, text: 'the answer' },
      meta: { requestId: 'x-cw-respond', expected: [{ ref: first.value.ref, revision: first.value.revision }] },
    });
    expect(replied).toMatchObject({ status: 'committed' });
    if (replied.status !== 'committed') throw new Error(`the reply did not commit: ${JSON.stringify(replied)}`);
    expect(replied.value.responseSince).toBe(replied.cursor);
    const saved = await h.mailbox.readMessage(h.ctxHost, first.value.ref);
    expect(saved).toMatchObject({ status: 'ready', value: { status: 'responded', responseSince: replied.cursor } });
  });
});

// A non-empty companion EVENT has no public producer: send's companions carry only the
// counter/Session-activity records. The trusted prepare caller commits one companion event and asserts it
// precedes the snapshot; the decide-accepts/prepare-refuses pair waits for the same caller and asserts
// `revision_conflict` and an empty batch. (deferred: 7a2)
// No route reaches `persist`: a `messages/*` body is `{scope, request: {input, meta}}` (`GraphWriteBody`), so a
// top-level `commitCursorBindings`/`ledgerHorizon` has no place in it, and both real persist callers
// (`mailbox-service.ts:2329`, `decision-service.ts:645`) pass the message, guards/claims and companions only.
// Only the in-process trusted prepare caller of 7a2 can pass them; it asserts both reach the commit. (deferred: 7a2)
