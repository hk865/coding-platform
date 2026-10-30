/**
 * S7B F-forward (SR3 §3.4, book `7b:1219`; probes P-06, P-07, P-09). One Host world, the frozen Part A wait, B
 * archived before any recipient read of M, the destination lines, and F's real `forwardMessage` owner. The reads are
 * `messages/read`, `messages/inbox`, `sessions/facts` and the published `sessionFacts.readWait`; the continuation is
 * the public `workflow/advance`. Expected literals come from the ruling/book, never from a `src` constant.
 *
 * Memory is the business rows' backend; SQLite is the claim race/replay row's (`tests/RULES.md:193–195`). The owner
 * is built by the shared `S7B-F-support.ts` (constructed in-row because L's publication is later): the real records
 * backend is captured at the A4 backend seam and the existing duties adapter is built on the real Role service. No
 * store is read and no record, claim, context or Host is built.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SessionRef } from '../../src/contracts/core/identity.js';
import type { GoalSnapshot } from '../../src/contracts/ledger.js';
import type { GoalCopyConfirmResultV1, GoalCopyDraftResultV1 } from '../../src/contracts/goal-card.js';
import type { SessionMessage } from '../../src/core/work-graph/model/communication-contracts.js';
import type { SessionFactsV1 } from '../../src/core/work-graph/model/session-facts-contracts.js';
import { graphWrite, plain } from '../helpers/AG2b-collaboration-fixture.js';
import { s6aCardsWorkspace } from '../helpers/S6A-cards-fixture.js';
import { byIdentityPrefix, commitBarrier } from '../helpers/S6A-commit-barrier.js';
import { type S6AHostWorld } from '../helpers/S6A-host-fixture.js';
import { S6A_SCOPE, S6A_WORK_ROLE } from '../helpers/S6A-request-fixture.js';
import { adoptS6BPlan, createS6BLine } from '../helpers/S6B1-fixture.js';
import type { S6B2Captured } from '../helpers/S6B2-handoff-scene.js';
import {
  committed, openS7AWorkWorld, ready, runS7ASameSessionAgain, sessionOf,
} from '../helpers/S7A-fixture.js';
import { createCancelledS7A2Goal, sendS7A2PersonMessage } from '../helpers/S7A2-fixture.js';
import {
  acceptS7BReply, answerS7BWait, openS7BWorld, readS7BMessage, runS7BWait,
} from '../helpers/S7B-fixture.js';
import { inboxOf, ownerFor, readWait } from '../helpers/S7B-F-support.js';

/** The real backend the platform built, captured at the A4 factory seam (never read by the test). */
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
  const left = commitBarrier.reset();
  for (const world of worlds.splice(0)) await world.close().catch(() => undefined);
  expect(left).toEqual([]);
});

async function factsOf(world: S6AHostWorld, session: SessionRef): Promise<SessionFactsV1> {
  return ready<SessionFactsV1>(await world.post('sessions/facts', plain(S6A_SCOPE, session)),
    `the facts of ${session.sessionId}`);
}

/** P-06's composition: the real wait, B archived before any read of M, a live C and a second live D. */
async function forwardSetup(backend: 'memory' | 'sqlite', label: string) {
  const { world } = await openS7BWorld({ backend });
  worlds.push(world);
  const wait = await runS7BWait(world, { label });
  const main = s6aCardsWorkspace(world, S6A_SCOPE);
  const archived = await world.archive(wait.recipient);
  if (archived.record.lifecycle !== 'archived') throw new Error('S7B-F: the recipient line was not archived');
  const c = await sessionOf(world, await createS6BLine(main, { label: `${label}-c`, role: S6A_WORK_ROLE }));
  const d = await sessionOf(world, await createS6BLine(main, { label: `${label}-d`, role: S6A_WORK_ROLE }));
  return { world, wait, main, c, d, owner: ownerFor(world, captured) };
}

describe('S7B F-forward', () => {
  it('P-06 one commit writes N, M.transferredTo and lets the forwarded reply satisfy the original wait', async () => {
    const { world, wait, c, owner } = await forwardSetup('memory', 'f-forward-one');
    const before = await readS7BMessage(world, wait.message);
    const forwarded = await owner.forwardMessage(world.humanContext(),
      { commandId: 'f-forward-one', messageRef: wait.message, to: c.ref });
    expect(forwarded).toMatchObject({ status: 'forwarded', replayed: false });
    if (forwarded.status !== 'forwarded') throw new Error(JSON.stringify(forwarded));
    const nRef = forwarded.message.ref;

    const after = await readS7BMessage(world, wait.message);
    expect({ revision: after.revision, transferredTo: after.transferredTo })
      .toEqual({ revision: before.revision + 1, transferredTo: nRef });
    const { revision: _revision, transferredTo: _transferredTo, ...afterRest } = after;
    const { revision: _beforeRevision, transferredTo: _beforeTransferred, ...beforeRest } = before;
    void _revision; void _transferredTo; void _beforeRevision; void _beforeTransferred;
    expect(afterRest).toEqual(beforeRest);

    const n = await readS7BMessage(world, nRef);
    expect(n).toMatchObject({
      originalRef: wait.message, goalRef: before.goalRef, taskRef: null, followupOf: null, requestRoot: null,
      sender: before.sender, intent: before.intent, needsReply: before.needsReply,
      waitAfterSend: before.waitAfterSend, bodyRef: before.bodyRef, sourceRef: before.sourceRef,
      deadline: before.deadline, deadlineMs: before.deadlineMs, release: before.release, transferredTo: null,
    });
    expect(await inboxOf(world, c.ref)).toHaveLength(1);

    const facts = await factsOf(world, wait.sender.ref);
    expect(facts.waits).toHaveLength(1);
    expect(facts.waits[0]).toMatchObject({ rootRef: wait.message, messageRef: nRef, complete: true });

    const replied = await answerS7BWait(world, {
      goal: wait.goal, recipient: c, message: nRef, task: wait.tasks[1]!, label: 'f-forward-one-reply',
    });
    expect(replied.response?.sender).toMatchObject({ kind: 'work_run', sessionRef: c.ref });
    expect(await readWait(world, wait.message)).toMatchObject({
      rootRef: wait.message, messageRef: nRef, state: { state: 'answered', reason: null }, complete: true,
    });
    const answeredFacts = await factsOf(world, wait.sender.ref);
    expect(answeredFacts.waits).toHaveLength(1);
    expect(answeredFacts.waits[0]).toMatchObject({ rootRef: wait.message, messageRef: nRef,
      state: { state: 'answered', reason: null } });
  });

  it.each(['memory', 'sqlite'] as const)('P-07 same command id replays, the same destination is existing, and another line is busy (%s)', async backend => {
    const { world, wait, c, d, owner } = await forwardSetup(backend, `f-forward-replay-${backend}`);
    const input = { commandId: 'f-forward-replay', messageRef: wait.message, to: c.ref } as const;
    const first = await owner.forwardMessage(world.humanContext(), input);
    if (first.status !== 'forwarded') throw new Error(JSON.stringify(first));
    const nRef = first.message.ref;
    const revision = (await readS7BMessage(world, wait.message)).revision;

    const replay = await owner.forwardMessage(world.humanContext(), input);
    expect(replay).toMatchObject({ status: 'forwarded', replayed: true, cursor: first.cursor });
    if (replay.status !== 'forwarded') throw new Error(JSON.stringify(replay));
    expect(replay.message.ref).toEqual(nRef);
    expect((await readS7BMessage(world, wait.message)).revision).toBe(revision);
    expect(await inboxOf(world, c.ref)).toHaveLength(1);

    const existing = await owner.forwardMessage(world.humanContext(),
      { ...input, commandId: 'f-forward-replay-2' });
    expect(existing).toMatchObject({ status: 'existing', message: { ref: nRef } });
    expect('cursor' in existing).toBe(false);
    expect((await readS7BMessage(world, wait.message)).revision).toBe(revision);
    expect(await inboxOf(world, c.ref)).toHaveLength(1);

    const busy = await owner.forwardMessage(world.humanContext(),
      { ...input, commandId: 'f-forward-replay-3', to: d.ref });
    expect(busy).toMatchObject({ status: 'rejected', code: 'busy' });
    expect(await inboxOf(world, d.ref)).toHaveLength(0);
  });

  it.each(['memory', 'sqlite'] as const)('P-06 two command ids race on one message: the forwarded claim lets exactly one land (%s)', async backend => {
    const { world, wait, c, d, owner } = await forwardSetup(backend, `f-forward-race-${backend}`);
    const before = await readS7BMessage(world, wait.message);
    const firstHold = commitBarrier.hold(byIdentityPrefix('message.forward:'), 'the f-forward race first commit');
    const secondHold = commitBarrier.hold(byIdentityPrefix('message.forward:'), 'the f-forward race second commit');
    const first = owner.forwardMessage(world.humanContext(),
      { commandId: 'f-forward-race-c', messageRef: wait.message, to: c.ref });
    const second = owner.forwardMessage(world.humanContext(),
      { commandId: 'f-forward-race-d', messageRef: wait.message, to: d.ref });
    await Promise.all([firstHold.reached, secondHold.reached]);
    firstHold.release();
    secondHold.release();
    const results = await Promise.all([first, second]);
    const forwarded = results.filter((result) => result.status === 'forwarded');
    expect(forwarded).toHaveLength(1);
    const winner = forwarded[0];
    if (winner === undefined || winner.status !== 'forwarded') throw new Error(JSON.stringify(results));
    const loser = results.find((result) => result !== winner);
    expect(loser).toMatchObject({ status: 'rejected', code: 'busy' });
    const after = await readS7BMessage(world, wait.message);
    expect({ revision: after.revision, transferredTo: after.transferredTo })
      .toEqual({ revision: before.revision + 1, transferredTo: winner.message.ref });
    const delivered = [...await inboxOf(world, c.ref), ...await inboxOf(world, d.ref)];
    expect(delivered.map((message) => message.ref)).toEqual([winner.message.ref]);
  });

  it('P-06 copy: the person entry forwards a delivered copy intervention to a live line', async () => {
    const opened = await openS7AWorkWorld({ backend: 'memory' });
    worlds.push(opened.world);
    const { world, line } = opened;
    const source = await createCancelledS7A2Goal(world);
    const message = await sendS7A2PersonMessage(world, { label: 'f-copy', recipient: line.ref,
      goal: source.goal.ref });
    await runS7ASameSessionAgain(world, line);
    const draft = ready<GoalCopyDraftResultV1>(await world.post('goals/copy-draft',
      plain(S6A_SCOPE, { goalRef: source.goal.ref })), 'the F copy draft');
    const born = committed<GoalCopyConfirmResultV1>(await world.post('goals/copy-confirm', plain(S6A_SCOPE, {
      commandId: 'f-copy-confirm', sourceGoalRef: draft.source.goal, expectedSourceRevision: draft.source.revision,
      selectedInterventions: [message.ref],
    })), 'the F copy confirm');
    expect(born.goal.copiedInterventions).toEqual([message.ref]);
    const main = s6aCardsWorkspace(world, S6A_SCOPE);
    await adoptS6BPlan(main, born.goal.ref, {
      label: 'f-copy-first', taskIds: ['f-copy-task'], role: S6A_WORK_ROLE.templateId,
    });
    const adopted = ready<{ goal: GoalSnapshot }>(
      await world.post('goals/read', plain(S6A_SCOPE, born.goal.ref)), 'adopted copy');
    expect(adopted.goal.activePlanRevision).not.toBeNull();
    const destination = await sessionOf(world,
      await createS6BLine(main, { label: 'f-copy-destination', role: S6A_WORK_ROLE }));
    const forwarded = await ownerFor(world, captured).forwardMessage(world.humanContext(),
      { commandId: 'f-copy-forward', messageRef: message.ref, to: destination.ref, copyGoalRef: born.goal.ref });
    expect(forwarded).toMatchObject({ status: 'forwarded', replayed: false });
    if (forwarded.status !== 'forwarded') throw new Error(JSON.stringify(forwarded));
    expect(forwarded.message.goalRef).toEqual(born.goal.ref);
    expect(forwarded.message.originalRef).toEqual(message.ref);
    const after = await readS7BMessage(world, message.ref);
    expect(after.transferredTo).toEqual(forwarded.message.ref);
    expect(await inboxOf(world, destination.ref)).toHaveLength(1);
  });

  it('P-09 the public continuation accepts the forwarded reply and creates a successor Run', async () => {
    const { world, wait, c, owner } = await forwardSetup('memory', 'f-forward-walk');
    const forwarded = await owner.forwardMessage(world.humanContext(),
      { commandId: 'f-forward-walk', messageRef: wait.message, to: c.ref });
    if (forwarded.status !== 'forwarded') throw new Error(JSON.stringify(forwarded));
    const nRef = forwarded.message.ref;
    await answerS7BWait(world, {
      goal: wait.goal, recipient: c, message: nRef, task: wait.tasks[1]!, label: 'f-forward-walk-reply',
    });
    expect(await readWait(world, wait.message)).toMatchObject({
      rootRef: wait.message, messageRef: nRef, state: { state: 'answered', reason: null }, complete: true,
    });

    await acceptS7BReply(world, {
      goal: wait.goal, sender: wait.sender, task: wait.tasks[0]!, run: wait.run, message: nRef,
      label: 'f-forward-walk',
    });
  });
});

describe('S7B F-forward (sqlite, claim race and replay)', () => {
  it('P-07 a held first commit never lands; after crash/reopen the same command id writes exactly once', async () => {
    const { world, wait, c, d, owner: beforeCrash } = await forwardSetup('sqlite', 'f-forward-crash');
    const input = { commandId: 'f-forward-crash', messageRef: wait.message, to: c.ref } as const;
    const before = await readS7BMessage(world, wait.message);
    const hold = commitBarrier.hold(byIdentityPrefix('message.forward:'), 'the f-forward claim');
    const first = beforeCrash.forwardMessage(world.humanContext(), input).catch(() => undefined);
    await hold.reached;
    await world.crash();

    const owner = ownerFor(world, captured);
    const forwarded = await owner.forwardMessage(world.humanContext(), input);
    expect(forwarded).toMatchObject({ status: 'forwarded', replayed: false });
    if (forwarded.status !== 'forwarded') throw new Error(JSON.stringify(forwarded));
    const nRef = forwarded.message.ref;
    hold.release();
    await first;
    expect(commitBarrier.reset()).toEqual([]);

    const after = await readS7BMessage(world, wait.message);
    expect(after).toMatchObject({ transferredTo: nRef });
    expect(after.revision).toBe(before.revision + 1);
    expect(await inboxOf(world, c.ref)).toHaveLength(1);
    const replay = await owner.forwardMessage(world.humanContext(), input);
    expect(replay).toMatchObject({ status: 'forwarded', replayed: true, cursor: forwarded.cursor });
    expect((await readS7BMessage(world, wait.message)).revision).toBe(after.revision);
    expect(await inboxOf(world, c.ref)).toHaveLength(1);
    const busy = await owner.forwardMessage(world.humanContext(),
      { ...input, commandId: 'f-forward-crash-2', to: d.ref });
    expect(busy).toMatchObject({ status: 'rejected', code: 'busy' });
  });
});
