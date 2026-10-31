/**
 * M-proof (book-7c.md:1358): the `member_created` effect's real receipt and the acknowledgement that travels
 * from the real input message through the request input and fingerprint into the creation event.
 *
 * The create is the S7C world's real member service: a Host-picked card is approved, the child Session's own
 * registration commit carries `MemberCreated`, and the service returns that commit's real receipt. The success row
 * hands the receipt to the existing `messages/apply` owner and reads the saved `applicationProof` back through
 * `messages/read`. The memory row keeps the same-command receipt replay; the SQLite row holds the child's own
 * registration commit, crashes and reopens the same world, lets the new Host's member owner resume the original
 * child, then reads the official creation receipt and applies it through the public routes.
 * Two real messages under one command id prove the acknowledgement is in the fingerprint (`idempotency_conflict`).
 *
 * DEFERRED (L1): the `reused` result is unreachable here: the fixture constructs `createMemberService` without
 * a `reuse` port, so the reused-match half joins L1.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SessionMessageRef } from '../../src/contracts/core/session-message.js';
import {
  answerOf, createS7C1MemberService, memberCardOf, openS7C1World, withS7CCapturedBackend, type S7C1World,
} from '../helpers/S7C-member-fixture.js';
import { graphWrite, plain } from '../helpers/AG2b-collaboration-fixture.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import { byIdentityPrefix, commitBarrier } from '../helpers/S6A-commit-barrier.js';
import { inboxOf } from '../helpers/S7B-F-support.js';
import { valueOf } from '../helpers/S6B3-fixture.js';

vi.mock('../../src/core/record-store/in-memory-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-commit-barrier.js')).inMemoryBarrierModule(importOriginal));
vi.mock('../../src/core/record-store/sqlite-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-commit-barrier.js')).sqliteBarrierModule(importOriginal));

let world: S7C1World | undefined;
afterEach(async () => {
  const left = commitBarrier.reset();
  await world?.close();
  world = undefined;
  expect(left).toEqual([]);
});

async function memberInboxOf(target: S7C1World): Promise<SessionMessageRef> {
  const inbox = await inboxOf(target.world, target.lines.module.ref);
  const input = inbox.find(message => message.sender.kind === 'host' && message.intent === 'inquiry');
  if (input === undefined) throw new Error(`S7C: no input message: ${JSON.stringify(inbox)}`);
  return input.ref;
}
async function approve(target: S7C1World, commandId: string, operation: { operationId: string }, label: string) {
  return target.member.decision.applyMemberDecision(target.world.humanContext(), {
    commandId, operation: operation as never, answer: await answerOf(target, label), verdict: 'approve',
  });
}
async function requestOf(target: S7C1World, commandId: string, reason: string, acknowledgement: SessionMessageRef) {
  return await target.member.request.requestMember(target.world.humanContext(), {
    commandId, caller: { kind: 'host_pick' }, duty: 'executor',
    scope: { kind: 'task', task: target.tasks[0]! }, reason, acknowledgement,
  });
}

describe.each(['memory', 'sqlite'] as const)('M-proof: the member_created receipt (%s)', backend => {
  it('carries the real input acknowledgement, applies it through messages/apply and reads the saved proof', async () => {
    world = await openS7C1World({ backend, adviser: false });
    const acknowledgement = await memberInboxOf(world);
    const request = await memberCardOf(world, 's7c-proof', 'S7C proof', acknowledgement);
    const done = await approve(world, 's7c-proof-approve', request.operation, 'approve');
    if (done.status !== 'done') throw new Error(`S7C: not done: ${JSON.stringify(done)}`);
    const created = await world.world.readSession(done.session);
    // The proof's `ref` is the new Session's aggregate ref and its effect is exactly the caller's `{kind, ref}`.
    const proof = { receipt: done.receipt, effect: { kind: 'member_created' as const, ref: created.record.ref } };
    const body = graphWrite(S6A_SCOPE, { messageRef: acknowledgement, proof }, `s7c-proof-apply-${backend}`);
    const applied = valueOf<{ appliedAt: string; applicationProof?: unknown }>(
      (await world.world.post('messages/apply', body)).body, 'committed', 'the applied proof');
    expect(applied.applicationProof).toEqual(proof);
    const read = valueOf<{ appliedAt: string; applicationProof?: unknown }>(
      (await world.world.post('messages/read', plain(S6A_SCOPE, acknowledgement))).body,
      'ready', 'the saved proof');
    expect(read.applicationProof).toEqual(proof);
    expect(read.appliedAt).toBe(applied.appliedAt);
  });
});

describe('M-proof: the receipt replay', () => {
  it('replays the same receipt and decision for the same command ids (memory)', async () => {
    world = await openS7C1World({ backend: 'memory', adviser: false });
    const acknowledgement = await memberInboxOf(world);
    const request = await memberCardOf(world, 's7c-replay', 'S7C replay', acknowledgement);
    const done = await approve(world, 's7c-replay-approve', request.operation, 'replay');
    if (done.status !== 'done') throw new Error(`S7C: not done: ${JSON.stringify(done)}`);
    expect(await requestOf(world, 's7c-replay', 'S7C replay', acknowledgement))
      .toMatchObject({ status: 'created', proofReceipt: done.receipt });
    expect(await approve(world, 's7c-replay-approve', request.operation, 'replay')).toEqual(done);
  });
});

describe('M-proof: the SQLite recovery', () => {
  it('recovers the creation receipt from the member child commit and applies it (SQLite only)', async () => {
    world = await openS7C1World({ backend: 'sqlite', adviser: false });
    const acknowledgement = await memberInboxOf(world);
    const request = await memberCardOf(world, 's7c-lost', 'S7C lost', acknowledgement);

    // The child's own registration commit lands, but the approving call never receives its result: the Host is
    // abandoned and reopened on the same SQLite directory before the member owner can read the commit back.
    const hold = commitBarrier.holdAfter(byIdentityPrefix('session-register:'), 'the member child registration');
    const first = approve(world, 's7c-lost-approve', request.operation, 'lost').catch(() => undefined);
    await hold.reached;
    await withS7CCapturedBackend(() => world!.world.crash());

    // The reopened Host's own member owner resumes the original child and then replays the original request, whose
    // official creation receipt is the proof `messages/apply` takes.
    const member = createS7C1MemberService(world.world);
    const resumed = await member.request.resumePendingMemberCreations(world.world.humanContext());
    if (resumed.status !== 'ready') throw new Error(`S7C: resume not ready: ${JSON.stringify(resumed)}`);
    expect(resumed.value.resumed).toEqual([{ operation: request.operation,
      child: expect.objectContaining({ aggregateType: 'CoreOperation' }), session: expect.anything() }]);
    const creation = await member.request.requestMember(world.world.humanContext(), {
      commandId: 's7c-lost', caller: { kind: 'host_pick' }, duty: 'executor',
      scope: { kind: 'task', task: world.tasks[0]! }, reason: 'S7C lost', acknowledgement,
    });
    if (creation.status !== 'created') throw new Error(`S7C: no creation receipt: ${JSON.stringify(creation)}`);

    const created = await world.world.readSession(creation.session);
    const proof = { receipt: creation.proofReceipt, effect: { kind: 'member_created' as const, ref: created.record.ref } };
    const applied = valueOf<{ appliedAt: string; applicationProof?: unknown }>(
      (await world.world.post('messages/apply', graphWrite(S6A_SCOPE, { messageRef: acknowledgement, proof },
        's7c-lost-apply'))).body, 'committed', 'the recovered proof');
    expect(applied.applicationProof).toEqual(proof);
    const read = valueOf<{ appliedAt: string; applicationProof?: unknown }>(
      (await world.world.post('messages/read', plain(S6A_SCOPE, acknowledgement))).body,
      'ready', 'the recovered saved proof');
    expect(read.applicationProof).toEqual(proof);
    expect(read.appliedAt).toBe(applied.appliedAt);
    hold.release();
    await first;
  });
});

describe('M-proof: a changed acknowledgement', () => {
  it('refuses a changed acknowledgement under the same command id', async () => {
    world = await openS7C1World({ backend: 'memory', adviser: false });
    const firstAck = await memberInboxOf(world);
    const secondAck = await answerOf(world, 'second-ack');
    expect(secondAck).not.toEqual(firstAck);
    const hold = commitBarrier.hold(commit => commit.identityKey.startsWith('member.request:'), 'accepted');
    const first = world.member.request.requestMember(world.world.humanContext(), {
      commandId: 's7c-ack', caller: { kind: 'host_pick' }, duty: 'executor',
      scope: { kind: 'task', task: world.tasks[0]! }, reason: 'S7C ack', acknowledgement: firstAck,
    });
    await hold.reached;
    const second = await world.member.request.requestMember(world.world.humanContext(), {
      commandId: 's7c-ack', caller: { kind: 'host_pick' }, duty: 'executor',
      scope: { kind: 'task', task: world.tasks[0]! }, reason: 'S7C ack', acknowledgement: secondAck,
    });
    hold.release();
    const conflicted = await first;
    expect(second).toMatchObject({ status: 'needs_decision' });
    expect(conflicted).toMatchObject({ status: 'rejected', code: 'idempotency_conflict' });
  });
});

describe('M-proof: a rejected result writes no proof', () => {
  it('answers rejected and leaves no creation proof', async () => {
    world = await openS7C1World({ backend: 'memory', adviser: false });
    const acknowledgement = await memberInboxOf(world);
    const request = await memberCardOf(world, 's7c-rejected', 'S7C rejected', acknowledgement);
    const rejected = await world.member.decision.applyMemberDecision(world.world.humanContext(), {
      commandId: 's7c-rejected-answer', operation: request.operation,
      answer: await answerOf(world, 'reject'), verdict: 'reject',
    });
    expect(rejected).toMatchObject({ status: 'rejected', code: 'invalid' });
    expect(rejected).not.toHaveProperty('receipt');
    expect(await world.member.request.readMemberRequestCommit(world.world.humanContext(), { commandId: 's7c-rejected' }))
      .toEqual({ status: 'committed' });
    expect(await world.member.request.readPendingMemberCards(world.world.humanContext(), { goalRef: world.goal }))
      .toMatchObject({ status: 'ready', value: [] });
  });
});
