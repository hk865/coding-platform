/**
 * M-decide (book-7c.md:1353): the member operation's decision, its card, the approval's responsible link,
 * the rejection, the autopilot notice key, the pending child's recovery and the `commandId` replay.
 *
 * The service entry is the S7C world's real `createMemberService` over the Host's real records, identities,
 * line creation, request owner and secretary runner. The card and the approve/reject/replay rows drive the frozen
 * Host-pick path (`requestMember` with `{ kind: 'host_pick' }` under `world.humanContext()`, M §3.1); no Work Run is
 * needed for a card, an approval or a rejection, and `applyMemberDecision` runs under the same human context.
 * The pending child arms the shared registration boundary (`registrationDouble.failNext`) and then calls
 * `resumePendingMemberCreations` directly; the Host start-up caller is L1's.
 *
 * DEFERRED (L1): the autopilot arm needs a real Work Run caller (a Host pick always answers `needs_decision`), so it
 * is the named deferral below.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OperationRef } from '../../src/contracts/core/operations.js';
import { answerOf, memberCardOf, openS7C1World, type S7C1World } from '../helpers/S7C-member-fixture.js';
import { registrationDouble } from '../helpers/S6A-registration-double.js';
import { setS7AAutonomy } from '../helpers/S7A-fixture.js';

vi.mock('../../src/core/work-graph/sessions/session-directory.js', async (importOriginal) =>
  (await import('../helpers/S6A-registration-double.js')).registrationDoubleModule(importOriginal));


let world: S7C1World | undefined;
afterEach(async () => {
  registrationDouble.reset();
  await world?.close();
  world = undefined;
});

async function decide(target: S7C1World, commandId: string, request: { operation: OperationRef },
  verdict: 'approve' | 'reject', label: string) {
  return target.member.decision.applyMemberDecision(target.world.humanContext(), {
    commandId, operation: request.operation, answer: await answerOf(target, label), verdict,
  });
}

describe.each(['memory', 'sqlite'] as const)('M-decide: the card and the two answers (%s)', backend => {
  it('approves with the responsible link, rejects, and replays both command ids', async () => {
    world = await openS7C1World({ backend, adviser: false });
    await setS7AAutonomy(world.world, world.goal, 'every_step');
    const request = await memberCardOf(world, 's7c-card', 'S7C card');
    expect(request.cardKey).toEqual(expect.stringContaining('member_creation'));
    expect(await memberCardOf(world, 's7c-card', 'S7C card')).toEqual(request);
    const cards = await world.member.request.readPendingMemberCards(world.world.humanContext(), { goalRef: world.goal });
    if (cards.status !== 'ready') throw new Error(`S7C: cards not ready: ${JSON.stringify(cards)}`);
    expect(cards.value).toMatchObject([{ task: world.tasks[0], operation: request.operation,
      source: { kind: 'member_creation', key: request.cardKey } }]);

    const rejectedRequest = await memberCardOf(world, 's7c-reject-card', 'S7C reject');
    const rejected = await decide(world, 's7c-reject', rejectedRequest, 'reject', 'reject');
    expect(rejected).toMatchObject({ status: 'rejected', code: 'invalid' });
    expect(await decide(world, 's7c-reject', rejectedRequest, 'reject', 'reject')).toEqual(rejected);

    const approved = await decide(world, 's7c-approve', request, 'approve', 'approve');
    if (approved.status !== 'done') throw new Error(`S7C: not approved: ${JSON.stringify(approved)}`);
    expect(await decide(world, 's7c-approve', request, 'approve', 'approve')).toEqual(approved);
    const card = await world.world.readSession(approved.session);
    expect(card.links.some(link => link.until === null && link.ref.relation === 'responsible'
      && JSON.stringify(link.ref.target) === JSON.stringify({ kind: 'task', ref: world!.tasks[0] }))).toBe(true);
    expect(await world.member.request.readPendingMemberCards(world.world.humanContext(), { goalRef: world.goal }))
      .toMatchObject({ status: 'ready', value: [] });
  });
});

describe.each(['memory', 'sqlite'] as const)('M-decide: one command id, another verdict (%s)', backend => {
  it('answers idempotency_conflict and replays the committed decision only', async () => {
    world = await openS7C1World({ backend, adviser: false });
    await setS7AAutonomy(world.world, world.goal, 'every_step');
    const request = await memberCardOf(world, 's7c-replay-card', 'S7C replay');
    const rejected = await decide(world, 's7c-replay-decision', request, 'reject', 'replay-decision');
    expect(rejected).toMatchObject({ status: 'rejected', code: 'invalid' });
    expect(await decide(world, 's7c-replay-decision', request, 'approve', 'replay-decision'))
      .toMatchObject({ status: 'rejected', code: 'idempotency_conflict' });
    expect(await decide(world, 's7c-replay-decision', request, 'reject', 'replay-decision')).toEqual(rejected);
    expect(await world.member.request.readPendingMemberCards(world.world.humanContext(), { goalRef: world.goal }))
      .toMatchObject({ status: 'ready', value: [] });
  });
});

describe('M-decide: the replayed pending approval', () => {
  it('projects the creating result and leaves the line to the start-up recovery', async () => {
    world = await openS7C1World({ backend: 'memory', adviser: false });
    await setS7AAutonomy(world.world, world.goal, 'every_step');
    const request = await memberCardOf(world, 's7c-replay-pending-card', 'S7C replay pending');
    registrationDouble.failNext(1);
    const pending = await decide(world, 's7c-replay-pending', request, 'approve', 'replay-pending');
    expect(pending).toMatchObject({ status: 'rejected', code: 'busy' });
    expect(await decide(world, 's7c-replay-pending', request, 'approve', 'replay-pending'))
      .toMatchObject({ status: 'rejected', code: 'busy' });
    const resumed = await world.member.request.resumePendingMemberCreations(world.world.humanContext());
    if (resumed.status !== 'ready') throw new Error(`S7C: resume not ready: ${JSON.stringify(resumed)}`);
    expect(resumed.value.resumed).toHaveLength(1);
  });
});

describe('M-decide: autopilot', () => {
  it('creates with one notice key and no card', () => {
    // A Host pick is always a card (`member-service.ts:637`), so this arm needs a real Work Run caller.
    throw new Error('S7C1-DEFERRED: the member tool names are not registered (7C-1 L1)');
  });
});

describe('M-decide: the pending child', () => {
  it('stays creating, resumes directly, and a done operation does not re-enter', async () => {
    world = await openS7C1World({ backend: 'memory', adviser: false });
    await setS7AAutonomy(world.world, world.goal, 'every_step');
    const request = await memberCardOf(world, 's7c-pending', 'S7C pending');
    registrationDouble.failNext(1);
    const pending = await decide(world, 's7c-pending-approve', request, 'approve', 'pending-approve');
    expect(pending).toMatchObject({ status: 'rejected', code: 'busy' });

    const resumed = await world.member.request.resumePendingMemberCreations(world.world.humanContext());
    if (resumed.status !== 'ready') throw new Error(`S7C: resume not ready: ${JSON.stringify(resumed)}`);
    expect(resumed.value.resumed).toEqual([{ operation: request.operation,
      child: expect.objectContaining({ aggregateType: 'CoreOperation' }), session: expect.anything() }]);
    expect(await world.member.request.resumePendingMemberCreations(world.world.humanContext()))
      .toMatchObject({ status: 'ready', value: { resumed: [] } });
  });
});
