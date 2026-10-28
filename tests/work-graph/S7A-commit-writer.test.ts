/** X-commit-writer (§3.11, §4.2, §5.6): one withdraw commits once, its snapshot event and record last,
 * nothing before the commit; real mailbox and write owner over one store, both backends. */
import { afterEach, describe, expect, it } from 'vitest';
import { AT, createC1Harness, type C1Harness } from '../helpers/C1-mailbox-fixture.js';
import { sessionMessageRefKey } from '../../src/core/work-graph/sessions/message-record-codecs.js';
import type { ClaimFixtureKind } from '../helpers/task-claim-fixture.js';
import type { EncodedDomainEvent } from '../../src/core/record-store/ports.js';
import type { SessionMessageWriteCommandV1 } from '../../src/core/work-graph/model/decision-contracts.js';
import type { SessionMessage } from '../../src/core/work-graph/model/communication-contracts.js';

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

  it('commits one companion event before the message event, and prepares no fragment once the state moves', async () => {
    const h = await openC1World(kind);
    const sent = await h.mailbox.sendMessage(h.ctxHost, {
      input: { recipient: h.idleSession, text: 'one companion event' },
      meta: { requestId: 'x-cw-companion-send', expected: [] },
    });
    if (sent.status !== 'committed') throw new Error(`the send did not commit: ${JSON.stringify(sent)}`);
    const before = sent.value;
    // The fixture's own registered seed schema (`task-claim-fixture.ts:209`): the one non-empty EVENT a
    // trusted prepare caller can commit; send's own companions carry records only.
    const companion: EncodedDomainEvent = { eventId: 'x-cw-companion-event', eventType: 'TrustedScopeSeeded',
      schemaVersion: 1, occurredAt: AT, json: JSON.stringify({ eventId: 'x-cw-companion-event',
        eventType: 'TrustedScopeSeeded', schemaVersion: 1, occurredAt: AT }) };
    const withdraw = (target: SessionMessage, label: string): SessionMessageWriteCommandV1 => ({
      operation: 'message.withdraw', messageRef: target.ref, before: target, expectedRevision: target.revision,
      event: { eventId: `x-cw-event-${label}`, occurredAt: AT, requestId: `x-cw-${label}`,
        projectId: h.ctxHost.projectId, workspaceId: h.ctxHost.workspaceId!,
        actor: { kind: 'host', actor: { kind: 'human', id: 'c1-host' } } },
      change: { kind: 'withdrawn', withdrawnAt: AT },
    });
    const owner = h.createWriteOwner();
    const fragment = await owner.prepare(h.ctxHost, withdraw(before, 'companion'), {
      records: [], events: [companion], guards: [], claims: [],
    });
    if ('status' in fragment) throw new Error(`prepare refused: ${JSON.stringify(fragment)}`);
    expect(fragment.events).toHaveLength(2);
    expect(fragment.events[0]!.eventId).toBe('x-cw-companion-event');
    expect(fragment.events[1]).toMatchObject({ eventType: 'SessionMessageWithdrawn' });
    const messageKey = sessionMessageRefKey(before.ref);
    expect(fragment.records.at(-1)?.refKey).toBe(messageKey);
    const committed = await h.backend.records.commit({ ...fragment, identityKey: 'x-cw-companion-commit',
      fingerprint: 'x-cw-companion-commit', indexGuards: [], indexChanges: [] });
    expect(committed.status).toBe('committed');
    // The command's decide accepted the pending message; a second prepare against the state this commit
    // wrote refuses with `revision_conflict` and returns no fragment.
    const moved = await h.mailbox.readMessage(h.ctxHost, before.ref);
    if (moved.status !== 'ready') throw new Error(`the message is not readable: ${JSON.stringify(moved)}`);
    const refused = await owner.prepare(h.ctxHost, withdraw(moved.value, 'refused'), {
      records: [], events: [{ ...companion, eventId: 'x-cw-refused-event' }], guards: [], claims: [],
    });
    expect(refused).toMatchObject({ status: 'rejected', code: 'revision_conflict' });
    expect(refused).not.toHaveProperty('records');
  });

  it('carries the caller\'s top-level binding and horizon into the commit, and the records port refuses a binding on the send\'s bound since', async () => {
    const h = await openC1World(kind);
    const sent = await h.mailbox.sendMessage(h.ctxHost, {
      input: { recipient: h.idleSession, text: 'top-level binding' },
      meta: { requestId: 'x-cw-binding-send', expected: [] },
    });
    if (sent.status !== 'committed') throw new Error(`the send did not commit: ${JSON.stringify(sent)}`);
    const before = sent.value;
    const messageKey = sessionMessageRefKey(before.ref);
    const command: SessionMessageWriteCommandV1 = {
      operation: 'message.withdraw', messageRef: before.ref, before, expectedRevision: before.revision,
      event: { eventId: 'x-cw-binding-event', occurredAt: AT, requestId: 'x-cw-binding',
        projectId: h.ctxHost.projectId, workspaceId: h.ctxHost.workspaceId!,
        actor: { kind: 'host', actor: { kind: 'human', id: 'c1-host' } } },
      change: { kind: 'withdrawn', withdrawnAt: AT },
    };
    const owner = h.createWriteOwner();
    const binding = { refKey: messageKey, field: 'since' as const };
    const fragment = await owner.prepare(h.ctxHost, command, {
      records: [], events: [], guards: [], claims: [], commitCursorBindings: [binding],
      ledgerHorizon: sent.cursor,
    });
    if ('status' in fragment) throw new Error(`prepare refused: ${JSON.stringify(fragment)}`);
    expect(fragment.commitCursorBindings).toEqual([binding]);
    expect(fragment.ledgerHorizon).toBe(sent.cursor);
    // The send already bound this record's `since` at creation, and the store binds only a null
    // placeholder (`src/core/record-store/record-codec.ts:615–:617`), so the port refuses before any write.
    const committed = await h.backend.records.commit({
      ...fragment, identityKey: 'x-cw-binding-commit', fingerprint: 'x-cw-binding-commit',
      indexGuards: [], indexChanges: [],
    });
    expect(committed).toMatchObject({
      status: 'rejected', code: 'invalid', reason: expect.stringContaining('since'),
    });
    const read = await h.mailbox.readMessage(h.ctxHost, before.ref);
    if (read.status !== 'ready') throw new Error(`the message is not readable: ${JSON.stringify(read)}`);
    expect(read.value).toMatchObject({ revision: before.revision, status: 'pending', withdrawnAt: null });
  });
});
