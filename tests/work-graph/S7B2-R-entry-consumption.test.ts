/** R-entry-consumption: one `query_entered` entry per replied wait, across a race, a replay, an unentered retry and a crash. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SessionMessage } from '../../src/core/work-graph/model/communication-contracts.js';
import { claimWithSecretaryProfile, prepareAttempt, start } from '../helpers/request-claim-steps.js';
import type { S6AHostWorld } from '../helpers/S6A-host-fixture.js';
import { byIdentityPrefix, commitBarrier } from '../helpers/S6A-commit-barrier.js';
import { readS7BMessage } from '../helpers/S7B-fixture.js';
import {
  crashS7B2Round, openS7B2RoundWorld, replyOrExpireS7B2Round, runS7B2Round,
  s7b2WaitRounds, scriptS7B2RoundAnswer, startS7B2RoundDriver, twoRepliesS7B2Round,
} from '../helpers/S7B2-secretary-rounds.js';

const shared = vi.hoisted(() => ({ backend: undefined as unknown, bodies: undefined as unknown }));
vi.mock('../../src/core/record-store/in-memory-record-store.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../../src/core/record-store/in-memory-record-store.js')>();
  return { ...actual, createInMemoryRecordBackend: (options: Parameters<typeof actual.createInMemoryRecordBackend>[0]) => {
    shared.backend ??= { ...actual.createInMemoryRecordBackend(options), close: async () => undefined };
    return shared.backend;
  } };
});
vi.mock('../../src/core/record-store/sqlite-record-store.js', async importOriginal =>
  (await import('../helpers/S6A-commit-barrier.js')).sqliteBarrierModule(importOriginal));
vi.mock('../../src/core/record-store/body-store.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../../src/core/record-store/body-store.js')>();
  return { ...actual, RawArtifactBodyStore: class SharedRawArtifactBodyStore {
    constructor() { shared.bodies ??= new actual.RawArtifactBodyStore(); return shared.bodies as never; }
  } as never };
});

const worlds: S6AHostWorld[] = [];
afterEach(async () => {
  commitBarrier.reset();
  for (const world of worlds.splice(0)) await world.close().catch(() => undefined);
  shared.backend = undefined;
  shared.bodies = undefined;
});

/** The one entry every sub-row asserts. */
function expectOneEntry(message: SessionMessage): void {
  const entries = message.acceptedInputs ?? [];
  expect(entries).toHaveLength(1);
  expect(entries[0]).toMatchObject({ part: 'response', evidence: 'query_entered', consumesWait: true });
}

async function expectAccepted(world: S6AHostWorld, ref: SessionMessage['ref']): Promise<SessionMessage> {
  let read: SessionMessage | null = null;
  await expect.poll(async () => {
    read = await readS7BMessage(world, ref);
    return (read.acceptedInputs ?? []).length;
  }, { timeout: 20_000, interval: 20 }).toBe(1);
  if (read === null) throw new Error('S7B2: the message was never read');
  return read;
}

type Entry = { backend: 'memory' | 'sqlite'; variant: 'normal entry' | 'two replies' | 'receipt replay'
  | 'two-version race' | 'unentered retry' | 'crash before entered commit' | 'late reply after expiry'
  | 'reply suppresses expiry material' };

describe('S7B-2 R entered consumption', () => {
  it.each([
    { backend: 'memory', variant: 'normal entry' },
    { backend: 'sqlite', variant: 'normal entry' },
    { backend: 'memory', variant: 'two replies' },
    { backend: 'sqlite', variant: 'two replies' },
    { backend: 'memory', variant: 'receipt replay' },
    { backend: 'sqlite', variant: 'receipt replay' },
    { backend: 'sqlite', variant: 'two-version race' },
    { backend: 'sqlite', variant: 'unentered retry' },
    { backend: 'sqlite', variant: 'crash before entered commit' },
    { backend: 'memory', variant: 'late reply after expiry' },
    { backend: 'sqlite', variant: 'reply suppresses expiry material' },
  ] as Entry[])('$variant ($backend)', async ({ backend, variant }) => {
    const { world } = await openS7B2RoundWorld({ backend, extraHostOptions: { requestDriver: 'off' } });
    worlds.push(world);
    const label = `r-entry-${backend}-${variant.replaceAll(' ', '-')}`;

    if (variant === 'crash before entered commit') {
      const held = await runS7B2Round(world, { label });
      await scriptS7B2RoundAnswer(world, { round: held.round, label });
      await startS7B2RoundDriver(world, backend);
      const root = held.round.request.requestRoot;
      const driving = crashS7B2Round(world, {
        reply: () => replyOrExpireS7B2Round(world, { kind: 'reply', goal: held.goal,
          recipient: held.recipients[0], message: held.messages[0].ref, task: held.tasks[0], label }),
        messageRef: held.messages[0].ref, requestRoot: root,
      });
      driving.catch(() => undefined);
      const recovered = await driving;
      expect(s7b2WaitRounds(recovered.view, 'reply')).toHaveLength(1);
      expectOneEntry(await expectAccepted(world, held.messages[0].ref));
      return;
    }

    if (variant === 'unentered retry') {
      const held = await runS7B2Round(world, { label });
      await scriptS7B2RoundAnswer(world, { round: held.round, label });
      await startS7B2RoundDriver(world, backend);
      const root = held.round.request.requestRoot;
      // The live Host's next Kernel entry on the round's secretary; the driver appends and starts the reply round.
      const kernel = await world.gates.beforeKernel(held.round.secretary);
      const reply = await replyOrExpireS7B2Round(world, { kind: 'reply', goal: held.goal,
        recipient: held.recipients[0], message: held.messages[0].ref, task: held.tasks[0], label });
      await kernel.reached;
      expect((await readS7BMessage(world, reply.message.ref)).acceptedInputs ?? []).toEqual([]);

      await world.crash({ extraHostOptions: { requestDriver: 'off' } });
      const restarted = await world.waitForRequest(root,
        current => s7b2WaitRounds(current, 'reply')[0]?.status === 'queued', 'the restart leaves the reply round queued');
      expect((await readS7BMessage(world, reply.message.ref)).acceptedInputs ?? []).toEqual([]);

      const retry = s7b2WaitRounds(restarted, 'reply')[0]!;
      expect(await claimWithSecretaryProfile(world, retry.ref, held.round.secretary, `${label}-retry-claim`))
        .toMatchObject({ status: 'committed' });
      const retryPrepared = await prepareAttempt(world, retry.ref, `${label}-retry-prepare`);
      await scriptS7B2RoundAnswer(world, { round: held.round, label });
      const retryKernel = await world.gates.beforeKernel(held.round.secretary);
      const retried = start(world, retryPrepared, `${label}-retry-start`);
      retried.catch(() => undefined);
      await retryKernel.reached;
      expect((await readS7BMessage(world, reply.message.ref)).acceptedInputs ?? []).toEqual([]);
      retryKernel.release();
      expect(await retried).toMatchObject({ status: 'ready' });
      expectOneEntry(await expectAccepted(world, reply.message.ref));
      return;
    }

    let replies: readonly [SessionMessage, SessionMessage] | undefined;
    const held = variant === 'two replies'
      ? await runS7B2Round(world, { label,
        use: async sent => { replies = (await twoRepliesS7B2Round(world, { sent, label })).replies; } })
      : await runS7B2Round(world, { label });
    await scriptS7B2RoundAnswer(world, { round: held.round, label });
    await startS7B2RoundDriver(world, backend);
    const root = held.round.request.requestRoot;

    if (variant === 'reply suppresses expiry material') {
      // The expiry round is appended and held before its prepare; the reply for
      // the same message joins its batch. One batch, one input: the response;
      // the expiry material is suppressed, never a second record for the message.
      await world.waitForRequest(root,
        current => current.rounds.find(round => round.ref.queryJobId === root.queryJobId)?.status === 'ended',
        'the request round ends before the expiry');
      const claim = world.gates.beforeClaim(held.round.secretary);
      world.clock.advance(60_001);
      await scriptS7B2RoundAnswer(world, { round: held.round, label });
      await replyOrExpireS7B2Round(world, { kind: 'expiry', messageRef: held.messages[0].ref });
      await claim.reached;
      await scriptS7B2RoundAnswer(world, { round: held.round, label });
      const late = await replyOrExpireS7B2Round(world, { kind: 'reply', goal: held.goal,
        recipient: held.recipients[0], message: held.messages[0].ref, task: held.tasks[0], label });
      await world.waitForRequest(root,
        current => s7b2WaitRounds(current, 'reply').length === 1, 'the reply round is appended while the expiry is held');
      claim.release();
      const view = await world.waitForRequest(root,
        current => current.rounds.every(round => round.status === 'ended'), 'the batch round ends');
      const expiry = s7b2WaitRounds(view, 'expiry')[0]!;
      const replies = s7b2WaitRounds(view, 'reply');
      expect(replies).toHaveLength(1);
      expect(replies[0]!.absorbedInto).toEqual(expiry.ref);
      const entries = (await readS7BMessage(world, late.message.ref)).acceptedInputs ?? [];
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({ part: 'response', evidence: 'query_entered' });
      return;
    }

    if (variant === 'late reply after expiry') {
      // The expiry round is accepted first; the late reply is then an ordinary
      // late input: it enters and ends, records `consumesWait: false` and takes
      // no `wait-consumed` claim, so it never conflicts with the expiry's.
      world.clock.advance(60_001);
      await scriptS7B2RoundAnswer(world, { round: held.round, label });
      await replyOrExpireS7B2Round(world, { kind: 'expiry', messageRef: held.messages[0].ref });
      const expired = await world.waitForRequest(root,
        current => s7b2WaitRounds(current, 'expiry')[0]?.status === 'ended', 'the expiry round ends');
      expect(s7b2WaitRounds(expired, 'expiry')).toHaveLength(1);
      const afterExpiry = await readS7BMessage(world, held.messages[0].ref);
      expect(afterExpiry.acceptedInputs ?? []).toHaveLength(1);
      expect((afterExpiry.acceptedInputs ?? [])[0]).toMatchObject({
        part: 'expiry', evidence: 'query_entered', consumesWait: true });

      await scriptS7B2RoundAnswer(world, { round: held.round, label });
      const late = await replyOrExpireS7B2Round(world, { kind: 'reply', goal: held.goal,
        recipient: held.recipients[0], message: held.messages[0].ref, task: held.tasks[0], label });
      const view = await world.waitForRequest(root,
        current => s7b2WaitRounds(current, 'reply')[0]?.status === 'ended', 'the late reply round ends');
      expect(s7b2WaitRounds(view, 'reply')).toHaveLength(1);
      const entries = (await readS7BMessage(world, late.message.ref)).acceptedInputs ?? [];
      expect(entries).toHaveLength(2);
      expect(entries.find(entry => entry.part === 'response'))
        .toMatchObject({ evidence: 'query_entered', consumesWait: false });
      return;
    }

    if (variant === 'normal entry') {
      const gate = await world.gates.beforeKernel(held.round.secretary);
      const reply = await replyOrExpireS7B2Round(world, { kind: 'reply', goal: held.goal,
        recipient: held.recipients[0], message: held.messages[0].ref, task: held.tasks[0], label });
      await gate.reached;
      expect((await readS7BMessage(world, reply.message.ref)).acceptedInputs ?? []).toEqual([]);
      gate.release();
      expectOneEntry(await expectAccepted(world, reply.message.ref));
      return;
    }

    if (variant === 'two replies') {
      if (replies === undefined) throw new Error('S7B2: the two replies are not in the held round');
      await world.waitForRequest(root, current => s7b2WaitRounds(current, 'reply').length === 2,
        'the two reply rounds');
      const view = await world.readRequest(root);
      const rounds = s7b2WaitRounds(view, 'reply');
      const executing = rounds.filter(round => round.absorbedInto === null);
      expect(executing).toHaveLength(1);
      expectOneEntry(await expectAccepted(world, replies[0].ref));
      expectOneEntry(await expectAccepted(world, replies[1].ref));
      return;
    }

    if (variant === 'receipt replay') {
      const reply = await replyOrExpireS7B2Round(world, { kind: 'reply', goal: held.goal,
        recipient: held.recipients[0], message: held.messages[0].ref, task: held.tasks[0], label });
      // The terminal commit writes the message and ends the round in one commit; the duplicate input is refused before
      // commit, so an accepted count of 2 is never visible. Wait for that commit's public result, then read the message.
      const view = await world.waitForRequest(root, current => s7b2WaitRounds(current, 'reply')[0]?.status === 'ended',
        'the reply round ends');
      expect(s7b2WaitRounds(view, 'reply')).toHaveLength(1);
      expectOneEntry(await readS7BMessage(world, reply.message.ref));
      return;
    }

    // two-version race (SQLite): the old Host's entered commit and the reopened Host's recovery commit carry one fragment.
    const entered = commitBarrier.hold(byIdentityPrefix('r5b-query-execution:entered:'), 'v1 entered');
    const recovery = commitBarrier.holdAfter(byIdentityPrefix('a2-query-recovery:'), 'v2 recovery');
    const reply = await replyOrExpireS7B2Round(world, { kind: 'reply', goal: held.goal,
      recipient: held.recipients[0], message: held.messages[0].ref, task: held.tasks[0], label });
    await entered.reached;
    const crash = world.crash();
    crash.catch(() => undefined);
    await recovery.reached;
    entered.release();
    recovery.release();
    await crash;
    const view = await world.waitForRequest(root, current => current.rounds.every(round => round.status === 'ended'),
      'the raced reply round ends');
    expect(s7b2WaitRounds(view, 'reply')).toHaveLength(1);
    expectOneEntry(await expectAccepted(world, reply.message.ref));
  }, 180_000);
});
