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
import type { SessionRef } from '../../src/contracts/core/identity.js';
import type { OperationRef } from '../../src/contracts/core/operations.js';
import type { SessionOperationRecord } from '../../src/core/work-graph/model/session-contracts.js';
import { plain } from '../helpers/AG2b-collaboration-fixture.js';
import { answerOf, memberCardOf, openS7C1World, type S7C1World } from '../helpers/S7C-member-fixture.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import { registrationDouble } from '../helpers/S6A-registration-double.js';
import { holdS7AQueryRound, ready, setS7AAutonomy } from '../helpers/S7A-fixture.js';

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
  it('creates with one notice key and no card, then replays the pending child (SQLite)', async () => {
    world = await openS7C1World({ backend: 'sqlite' });
    await setS7AAutonomy(world.world, world.goal, 'after_plan_confirmation');
    const task = world.tasks[2]!;

    // One real secretary QueryRun; its Runtime context is the request's principal, so the later replay keeps the
    // same command identity. The first child registration is held back: the request answers `pending`.
    const flow = await holdS7AQueryRound(world.world, { label: 's7c-autopilot', goalId: world.goal.goalId },
      async (context, round) => {
        const caller = {
          kind: 'secretary_query' as const,
          session: structuredClone(round.secretary.ref),
          run: structuredClone(round.prepared.queryRunRef),
          round: structuredClone(round.request.round),
          requestRoot: structuredClone(round.request.requestRoot),
        };
        const input = {
          commandId: 's7c-autopilot', caller, duty: 'executor' as const,
          scope: { kind: 'task' as const, task: structuredClone(task) },
          reason: 'S7C autopilot create',
        };
        registrationDouble.failNext(1);
        const pending = await world!.member.request.requestMember(context, input);
        expect(pending).toMatchObject({ status: 'pending' });
        if (pending.status !== 'pending') throw new Error(`S7C autopilot: not pending: ${JSON.stringify(pending)}`);

        const resumed = await world!.member.request.resumePendingMemberCreations(world!.world.humanContext());
        if (resumed.status !== 'ready') throw new Error(`S7C autopilot: resume not ready: ${JSON.stringify(resumed)}`);
        expect(resumed.value.resumed).toEqual([{ operation: pending.operation,
          child: expect.objectContaining({ aggregateType: 'CoreOperation' }), session: expect.anything() }]);

        const replay = await world!.member.request.requestMember(context, input);
        if (replay.status !== 'created') throw new Error(`S7C autopilot: the replay did not create: ${JSON.stringify(replay)}`);
        expect(replay.operation).toEqual(pending.operation);
        expect(replay.session).toEqual(resumed.value.resumed[0]!.session);

        const noticeKey = `member:${pending.operation.operationId}`;
        const notices = await world!.main.readNotices({ goal: world!.goal, categories: ['member_created'], limit: 100 });
        const created = notices.notices.filter(item => item.category === 'member_created');
        expect(created.map(item => item.itemKey)).toEqual([noticeKey]);
        const cards = await world!.main.readCards(world!.goal);
        expect(cards.filter(card => card.source.kind === 'member_creation')).toEqual([]);

        // The same command id and principal replay the same operation: no second notice and no second line.
        const noticesAgain = await world!.main.readNotices({ goal: world!.goal, categories: ['member_created'], limit: 100 });
        expect(noticesAgain.notices.map(item => item.itemKey)).toEqual([noticeKey]);
        return replay;
      });
    expect(flow.status).toBe('created');
  });
});

describe('M-decide: the pending child', () => {
  it('stays creating, resumes at the next Host start-up, and a done operation does not re-enter (SQLite only)', async () => {
    world = await openS7C1World({ backend: 'sqlite', adviser: false });
    await setS7AAutonomy(world.world, world.goal, 'every_step');
    // m2's assignment is the CREATE_ROLE the fixture owner names, so the
    // reopened platform's executorRole resolves the same child input.
    const request = await world.member.request.requestMember(world.world.humanContext(), {
      commandId: 's7c-pending', caller: { kind: 'host_pick' }, duty: 'executor',
      scope: { kind: 'task', task: world.tasks[1]! }, reason: 'S7C pending' });
    if (request.status !== 'needs_decision') throw new Error(`S7C: no card: ${JSON.stringify(request)}`);
    registrationDouble.failNext(1);
    const pending = await decide(world, 's7c-pending-approve', request, 'approve', 'pending-approve');
    expect(pending).toMatchObject({ status: 'rejected', code: 'busy' });

    // The operation stays `creating`; a real close and reopen lets the Host's
    // start-up reconcile continue it under its own system context. The child is
    // read through the public Session directory, never the fixture owner.
    const before = new Set((await world.world.listSessions()).map(card => card.record.ref.sessionId));
    await world.reopen();
    const resumed = (await world.world.listSessions()).filter(card => !before.has(card.record.ref.sessionId));
    expect(resumed).toHaveLength(1);
    const child = resumed[0]!;
    expect(child.record.ref.projectId).toBe(world.goal.projectId);
    expect(child.links.some(link => link.until === null && link.ref.relation === 'responsible'
      && JSON.stringify(link.ref.target) === JSON.stringify({ kind: 'task', ref: world!.tasks[1] }))).toBe(true);

    // The parent operation is done, with the created child as its outcome, through the public operation read.
    const parent = ready<SessionOperationRecord>(await world.world.post('sessions/operation',
      plain(S6A_SCOPE, request.operation)), 'the parent member operation');
    if (parent.action.kind !== 'member_create') {
      throw new Error(`S7C: the parent operation is not a member creation: ${parent.action.kind}`);
    }
    const value = parent.action;
    const childRef: SessionRef = { projectId: child.record.ref.projectId, sessionId: child.record.ref.sessionId };
    expect(value.progress.stage).toBe('done');
    expect(value.progress.outcome).toEqual({ kind: 'created', session: childRef });

    // The done operation does not re-enter on the next start: no second registration and no second line.
    const forwarded = registrationDouble.forwarded;
    await world.reopen();
    expect(registrationDouble.forwarded).toBe(forwarded);
    expect((await world.world.listSessions()).filter(card => !before.has(card.record.ref.sessionId)))
      .toHaveLength(1);
  });
});
