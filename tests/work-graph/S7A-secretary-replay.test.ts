/** X-secretary-replay (§2.8, §5.4): the receipt restores the secretary send after the round ended. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { canonicalJson } from '../../src/contracts/fingerprint.js';
import type { QueryJobRef } from '../../src/contracts/query-job.js';
import type { S6AHostWorld } from '../helpers/S6A-host-fixture.js';
import { holdS7AQueryRound, openS7AQueryWorld, sendS7ASecretaryMessage, setS7AAutonomy } from '../helpers/S7A-fixture.js';
const readerGate = vi.hoisted(() => ({ refKey: null as string | null, used: false,
  reached: null as (() => void) | null, released: null as Promise<void> | null }));
vi.mock('../../src/core/work-graph/tasks/owner-record-read.js', async importOriginal => {
  const original = await importOriginal<typeof import('../../src/core/work-graph/tasks/owner-record-read.js')>();
  return { ...original, async readOwnerRecord<T>(input: Parameters<typeof original.readOwnerRecord<T>>[0]) {
    if (readerGate.refKey !== null && !readerGate.used && input.refKey === readerGate.refKey) {
      readerGate.used = true; readerGate.reached?.(); await readerGate.released;
    }
    return original.readOwnerRecord(input);
  } };
});
const worlds: S6AHostWorld[] = [];
afterEach(async () => { for (const world of worlds.splice(0)) await world.close().catch(() => undefined); });
describe.each(['memory', 'sqlite'] as const)('X-secretary-replay: the receipt restores the secretary send (%s)', kind => {
  const openRound = async () => {
    const opened = await openS7AQueryWorld({ backend: kind }); worlds.push(opened.world);
    await setS7AAutonomy(opened.world, opened.goal, 'every_step');
    return opened;
  };
  it('replays after the round ends without calling the resolver', async () => {
    const opened = await openRound();
    const text = 'Replay this secretary inquiry.';
    const sent = await sendS7ASecretaryMessage(opened.world,
      { label: 'x-secretary-replay', goalId: opened.goal.goalId }, opened.session, text);
    const requestRoot: QueryJobRef = sent.message.requestRoot as QueryJobRef;
    expect(requestRoot).not.toBeNull();
    await opened.world.waitForRequest(requestRoot,
      view => view.rounds.every(round => round.status === 'ended'), 'the secretary round ends');
    expect((await opened.world.readRequest(requestRoot)).rounds.every(round => round.status === 'ended')).toBe(true);
    const replayed = await opened.world.platform.messages.sendMessage(sent.context, {
      input: { recipient: opened.session.ref, text, intent: 'inquiry' as const, needsReply: true },
      meta: { requestId: 's7a-secretary-send-x-secretary-replay', expected: [] },
    });
    expect(replayed).toMatchObject({ status: 'committed', replayed: true });
    if (replayed.status !== 'committed') return;
    expect(replayed.value).toMatchObject({ ref: sent.message.ref, revision: 1, status: 'pending', requestRoot,
      goalRef: { aggregateType: 'Goal', projectId: opened.goal.projectId, goalId: opened.goal.goalId },
      sender: { kind: 'secretary_round', requestRoot } });
    expect(replayed.cursor.length).toBeGreaterThan(0);
  });
  it('restores a concurrent same-identity commit when the round ended after the first lookup missed', async () => {
    const opened = await openRound();
    const text = 'The same identity commits before this round ends.';
    const input = { recipient: opened.session.ref, text, intent: 'inquiry' as const, needsReply: true };
    const requestId = 's7a-secretary-race';
    let release!: () => void;
    Object.assign(readerGate, { refKey: null, used: false, reached: null });
    readerGate.released = new Promise<void>(resolve => { release = resolve; });
    const reached = new Promise<void>(resolve => { readerGate.reached = resolve; });
    let requestRoot: QueryJobRef | undefined;
    let first: ReturnType<typeof opened.world.platform.messages.sendMessage> | undefined;
    let committed: Awaited<ReturnType<typeof opened.world.platform.messages.sendMessage>> | undefined;
    try {
      await holdS7AQueryRound(opened.world, { label: 'x-secretary-race', goalId: opened.goal.goalId },
        async (context, round) => {
          requestRoot = round.request.requestRoot;
          const wanted = round.prepared.queryRunRef;
          readerGate.refKey = canonicalJson(wanted as never);
          first = opened.world.platform.messages.sendMessage(context, { input, meta: { requestId, expected: [] } });
          await reached;
          committed = await opened.world.platform.messages.sendMessage(context, { input, meta: { requestId, expected: [] } });
          expect(committed).toMatchObject({ status: 'committed' });
        });
      await opened.world.waitForRequest(requestRoot!,
        view => view.rounds.every(round => round.status === 'ended'), 'the secretary round ends');
    } finally { release(); }
    if (committed?.status !== 'committed') throw new Error('the concurrent send did not commit');
    const replayed = await first!;
    expect(replayed).toMatchObject({ status: 'committed', replayed: true, cursor: committed.cursor });
    if (replayed.status !== 'committed') return;
    expect(replayed.value.ref).toEqual(committed.value.ref);
    const inbox = await opened.world.platform.messages.readInbox(opened.world.humanContext(),
      { recipient: opened.session.ref, page: { limit: 10 } });
    expect(inbox).toMatchObject({ status: 'ready' });
    if (inbox.status !== 'ready') return;
    expect(inbox.value.items.map(item => item.ref)).toEqual([committed.value.ref]);
  });
});
