/**
 * S7B F-dispose (SR3 §3.4, book `7b:1221`; probe P-10). The person's cancel, the live-line transfer refusal, the
 * archive transfer's one wait step and requeue, and the same-command receipt replay. Every precondition is the frozen
 * Part A wait; every read is `messages/read`, `messages/inbox`, `sessions/facts` or the published `readWait`; the
 * archive step is `sessions/archive-line`. Memory is the business rows' backend;
 * SQLite is the receipt-replay sub-row's (`tests/RULES.md:193–195`).
 *
 * L's publication is later, so F's owner is built by the shared `S7B-F-support.ts` on the real records backend
 * captured at the A4 factory seam and the existing duties adapter on the real Role service.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RunSnapshot } from '../../src/contracts/dispatch.js';
import type { ArchiveLineResultV1 } from '../../src/business/workflow/session-archive.js';
import { graphWrite, plain } from '../helpers/AG2b-collaboration-fixture.js';
import { s6aCardsWorkspace } from '../helpers/S6A-cards-fixture.js';
import { commitBarrier } from '../helpers/S6A-commit-barrier.js';
import { type S6AHostWorld } from '../helpers/S6A-host-fixture.js';
import { S6A_SCOPE, S6A_WORK_ROLE } from '../helpers/S6A-request-fixture.js';
import { createS6BLine } from '../helpers/S6B1-fixture.js';
import type { S6B2Captured } from '../helpers/S6B2-handoff-scene.js';
import { ready, sessionOf } from '../helpers/S7A-fixture.js';
import { openS7BWorld, readS7BMessage, runS7BWait } from '../helpers/S7B-fixture.js';
import { inboxOf, ownerFor, readWait } from '../helpers/S7B-F-support.js';

const captured = vi.hoisted((): S6B2Captured => ({ backend: null }));

vi.mock('../../src/core/record-store/in-memory-record-store.js', async (importOriginal) => {
  const module = await importOriginal() as typeof import('../../src/core/record-store/in-memory-record-store.js');
  const { sealInMemory } = await import('../helpers/S6B2-handoff-scene.js');
  return sealInMemory(captured, module, true);
});
vi.mock('../../src/core/record-store/sqlite-record-store.js', async (importOriginal) => {
  const module = await importOriginal() as typeof import('../../src/core/record-store/sqlite-record-store.js');
  const { sealSqlite } = await import('../helpers/S6B2-handoff-scene.js');
  return sealSqlite(captured, module, true);
});

const worlds: S6AHostWorld[] = [];
afterEach(async () => {
  commitBarrier.reset();
  for (const world of worlds.splice(0)) await world.close().catch(() => undefined);
});

async function disposeSetup(backend: 'memory' | 'sqlite', label: string) {
  const { world } = await openS7BWorld({ backend });
  worlds.push(world);
  const wait = await runS7BWait(world, { label });
  const main = s6aCardsWorkspace(world, S6A_SCOPE);
  return { world, wait, main, owner: ownerFor(world, captured) };
}

describe('S7B F-dispose (memory)', () => {
  it('P-10 cancel writes waitCancelledAt at the commit instant and no new message or claim', async () => {
    const { world, wait, owner } = await disposeSetup('memory', 'f-dispose-cancel');
    const before = await readS7BMessage(world, wait.message);
    const at = world.clock.advance(60_000);
    const disposed = await owner.disposeWait(world.humanContext(),
      { commandId: 'f-dispose-cancel', messageRef: wait.message, mode: 'cancel' });
    expect(disposed).toMatchObject({ status: 'committed', replayed: false });
    if (disposed.status !== 'committed') throw new Error(JSON.stringify(disposed));

    const after = await readS7BMessage(world, wait.message);
    expect({ revision: after.revision, waitCancelledAt: after.waitCancelledAt })
      .toEqual({ revision: before.revision + 1, waitCancelledAt: at });
    const { revision: _revision, waitCancelledAt: _cancelled, ...afterRest } = after;
    const { revision: _beforeRevision, waitCancelledAt: _beforeCancelled, ...beforeRest } = before;
    void _revision; void _cancelled; void _beforeRevision; void _beforeCancelled;
    expect(afterRest).toEqual(beforeRest);
    expect(after.transferredTo).toBeNull();
    expect(after.acceptedInputs ?? []).toEqual([]);

    expect(await inboxOf(world, wait.recipient.ref)).toHaveLength(1);
    expect(await readWait(world, wait.message)).toMatchObject({
      rootRef: wait.message, messageRef: wait.message, state: { state: 'withdrawn', reason: 'wait_cancelled' },
      complete: true,
    });
  });

  it('P-10 a transfer while the waiting line is live is invalid and leaves the message unchanged', async () => {
    const { world, wait, main, owner } = await disposeSetup('memory', 'f-dispose-live');
    const c = await sessionOf(world, await createS6BLine(main, { label: 'f-dispose-live-c', role: S6A_WORK_ROLE }));
    const before = await readS7BMessage(world, wait.message);
    const disposed = await owner.disposeWait(world.humanContext(),
      { commandId: 'f-dispose-live', messageRef: wait.message, mode: 'transfer', to: c.ref });
    expect(disposed).toMatchObject({ status: 'rejected', code: 'invalid', reason: 'waiting_line_live' });
    expect(await readS7BMessage(world, wait.message)).toEqual(before);
    expect(await readWait(world, wait.message)).toMatchObject({ state: { state: 'open', reason: null } });
  });

  it('P-10 the archive transfer submits one reply_handler step and the requeue verifies the transfer', async () => {
    const { world, wait, main, owner } = await disposeSetup('memory', 'f-dispose-archive');
    const c = await sessionOf(world, await createS6BLine(main, { label: 'f-dispose-archive-c', role: S6A_WORK_ROLE }));
    const d = await sessionOf(world, await createS6BLine(main, { label: 'f-dispose-archive-d', role: S6A_WORK_ROLE }));
    const card = await world.readSession(wait.sender);
    const tasks = card.links.filter(link => link.ref.relation === 'responsible')
      .map(link => ({ target: link.ref.target, disposition: { kind: 'transfer' as const, to: c.ref } }));
    const requestId = 'f-dispose-archive';
    const gate = commitBarrier.holdAfter(
      commit => commit.events.some(event => event.eventType === 'ArchiveWaitDisposed'),
      'the archive wait disposal');
    const archive = world.post('sessions/archive-line', graphWrite(S6A_SCOPE, {
      sessionRef: wait.sender.ref, reason: 'F dispose archive transfer', tasks,
      wait: { kind: 'transfer' as const, runRef: wait.run, messageRef: wait.message, to: c.ref },
    }, requestId, [{ ref: card.record.ref, revision: card.record.revision }]));
    await gate.reached;
    const transferred = await owner.disposeWait(world.humanContext(),
      { commandId: 'f-dispose-archive-change-handler', messageRef: wait.message, mode: 'transfer', to: d.ref });
    expect(transferred).toMatchObject({ status: 'committed', replayed: false });
    gate.release();

    const archived = ready<ArchiveLineResultV1>(await archive, 'the archive transfer');
    expect(archived).toMatchObject({ state: 'partial', rejection: { code: 'forbidden',
      reason: 'the archive wait message carries no matching transfer' } });
    const waitSteps = archived.receipts
      .filter(receipt => receipt.step === 'reply_handler' || receipt.step === 'wait_cancel')
      .map(receipt => receipt.step)
      .filter((step, index, all) => all.indexOf(step) === index);
    expect(waitSteps).toEqual(['reply_handler']);

    const message = await readS7BMessage(world, wait.message);
    expect(message.archiveWaitDisposition).toMatchObject({ kind: 'transfer', runRef: wait.run,
      archiveSessionRef: wait.sender.ref, archiveRequestId: requestId });
    expect(message.waitCancelledAt).toBeNull();
    expect(message.replyHandler).toMatchObject({ sessionRef: { projectId: d.ref.projectId, sessionId: d.ref.sessionId } });
    expect(await readWait(world, wait.message)).toMatchObject({
      rootRef: wait.message, messageRef: wait.message, state: { state: 'open', reason: null }, complete: true,
    });
    expect(await inboxOf(world, d.ref)).toHaveLength(0);

    const execution = ready<{ run: RunSnapshot }>(await world.post('executions/read',
      plain(S6A_SCOPE, wait.run)), 'the archived Run');
    expect(execution.run.controlState).toMatchObject({ desiredState: 'cancelled' });
  });
});

describe.each(['memory', 'sqlite'] as const)('S7B F-dispose replay (%s)', backend => {
  it('P-10 the same command id replays the one cancel commit and never writes twice', async () => {
    const { world, wait, owner } = await disposeSetup(backend, `f-dispose-replay-${backend}`);
    const at = world.clock.advance(60_000);
    const input = { commandId: 'f-dispose-replay', messageRef: wait.message, mode: 'cancel' as const };
    const first = await owner.disposeWait(world.humanContext(), input);
    expect(first).toMatchObject({ status: 'committed', replayed: false });
    if (first.status !== 'committed') throw new Error(JSON.stringify(first));
    expect(first.value).toMatchObject({ waitCancelledAt: at });
    const afterFirst = await readS7BMessage(world, wait.message);

    if (backend === 'sqlite') await world.crash();
    const replay = await ownerFor(world, captured).disposeWait(world.humanContext(), input);
    expect(replay).toMatchObject({ status: 'committed', replayed: true, cursor: first.cursor });
    if (replay.status !== 'committed') throw new Error(JSON.stringify(replay));
    expect(replay.value).toMatchObject({ revision: afterFirst.revision, waitCancelledAt: at });
    expect(await readS7BMessage(world, wait.message)).toEqual(afterFirst);
    expect(await inboxOf(world, wait.recipient.ref)).toHaveLength(1);
    expect(await readWait(world, wait.message)).toMatchObject({ state: { state: 'withdrawn', reason: 'wait_cancelled' } });
  });
});
