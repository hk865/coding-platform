/**
 * Slice 6A-1 joint scenario (SE1): the open cap, the drain and reopen through
 * the frozen world's public routes and owners, on memory and SQLite (the reopen
 * row says "SQLite only" in its name: it restarts the Host on the same
 * directory).
 *
 * Prior state is the person's: secretaries through `sessions/create`, busy
 * lines through a real `queries/claim`, requests through `requests/submit`.
 * The drain is the platform's public owner
 * `requestIntake.drainUnassigned(systemContext, scope, {maxRequests: 20})`.
 * No record is built by hand and no store is read; expected values come from
 * book §3.4.7 (the cap and the drain identity), §3.5.10 (one `assigned` round,
 * a blocked request does not stop the traversal) and §3.6.9 (`owner_archived`).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SessionRef } from '../../src/contracts/core/identity.js';
import type { QueryJobRef } from '../../src/contracts/query-job.js';
import type { RequestCoreViewV1 } from '../../src/core/work-graph/model/request-contracts.js';
import {
  openS6ARequestWorld, S6A_GOAL_1, S6A_SCOPE, S6A_SECRETARY_ROLE,
  type S6ABackend, type S6ARequestWorld, type S6ASession,
} from '../helpers/S6A-request-fixture.js';
import { registrationDouble } from '../helpers/S6A-registration-double.js';

vi.mock('../../src/core/work-graph/sessions/session-directory.js', async (importOriginal) =>
  (await import('../helpers/S6A-registration-double.js')).registrationDoubleModule(importOriginal));

const worlds: S6ARequestWorld[] = [];

async function open(backend: S6ABackend, extraHostOptions?: Record<string, unknown>): Promise<S6ARequestWorld> {
  const world = await openS6ARequestWorld({
    backend,
    ...(extraHostOptions === undefined ? {} : { extraHostOptions }),
  });
  worlds.push(world);
  return world;
}

afterEach(async () => {
  registrationDouble.reset();
  const openWorlds = worlds.splice(0);
  await Promise.all(openWorlds.map(world => world.close()));
});

const body = (input: unknown): { scope: typeof S6A_SCOPE; input: unknown } => ({ scope: S6A_SCOPE, input });

const submitInput = (commandId: string, overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  commandId, goalId: S6A_GOAL_1.goalId, text: `S6A drain ${commandId}`, continues: null, recipient: null, ...overrides,
});

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};

function expectObject(value: unknown): Record<string, unknown> {
  return asRecord(value);
}

function sessionOf(value: unknown): SessionRef {
  return expectObject(value) as unknown as SessionRef;
}

async function requestView(world: S6ARequestWorld, root: QueryJobRef): Promise<RequestCoreViewV1> {
  const read = await world.platform.requestFacts.readRequest(world.humanContext(), { requestRoot: root });
  if (read.status !== 'ready') throw new Error(`S6A: the request read is not ready: ${JSON.stringify(read)}`);
  return read.value;
}

async function drainWith(world: S6ARequestWorld, maxRequests: number,
  continuation: string | null): Promise<Record<string, unknown>> {
  const result = await world.platform.requestIntake.drainUnassigned(world.systemContext(), S6A_SCOPE,
    { maxRequests, continuation });
  if (result.status !== 'ready') throw new Error(`S6A: the drain is not ready: ${JSON.stringify(result)}`);
  return result.value as unknown as Record<string, unknown>;
}

async function drain(world: S6ARequestWorld): Promise<Record<string, unknown>> {
  return drainWith(world, 20, null);
}

async function submit(world: S6ARequestWorld, commandId: string,
  overrides: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  return expectObject((await world.post('requests/submit', body(submitInput(commandId, overrides)))).body);
}

function routingRounds(view: RequestCoreViewV1): RequestCoreViewV1['rounds'] {
  return view.rounds.filter(round => round.kind === 'routing');
}

/** The later-activity key (§3.4.2 key 3): `later` is created last, so a free pick reads it first. */
async function pair(world: S6ARequestWorld): Promise<{ earlier: S6ASession; later: S6ASession }> {
  const earlier = await world.createSecretary('earlier', { at: '2026-10-23T09:01:00.000Z' });
  const later = await world.createSecretary('later', { at: '2026-10-23T09:02:00.000Z' });
  return { earlier, later };
}

/**
 * Two waiting requests in creation order, then one free line and one archived
 * line: one active (busy) secretary remains, so the cap has room for a new
 * line and the drain's `ensureLine` runs. The next registration fails once,
 * which makes the earlier request's pick answer `line_pending` (blocked).
 */
async function blockedThenAssignable(world: S6ARequestWorld): Promise<{
  blockedRoot: QueryJobRef; blockedRound: QueryJobRef; laterRoot: QueryJobRef; busy: S6ASession;
}> {
  const busyB = await world.createSecretary('busy-b', { at: '2026-10-23T09:01:00.000Z' });
  const busyA = await world.createSecretary('busy-a', { at: '2026-10-23T09:02:00.000Z' });
  const aBusy = await world.occupy(busyA);
  await world.occupy(busyB);
  const blocked = await submit(world, 's6a-blocked-earlier');
  expect(blocked).toMatchObject({ status: 'queued', assignment: 'unassigned', secretary: null,
    waitReason: 'secretary_open_cap' });
  const later = await submit(world, 's6a-blocked-later');
  expect(later).toMatchObject({ status: 'queued', assignment: 'unassigned', secretary: null,
    waitReason: 'secretary_open_cap' });
  // Free A's line, then archive A: B stays busy, one active secretary remains.
  await world.finishQuery(aBusy);
  await world.archive(busyA);
  registrationDouble.failNext(1);
  return {
    blockedRoot: blocked['requestRoot'] as QueryJobRef,
    blockedRound: blocked['round'] as QueryJobRef,
    laterRoot: later['requestRoot'] as QueryJobRef,
    busy: busyB,
  };
}

describe.each(['memory', 'sqlite'] as const)('SE1 cap, drain and archived owner (%s)', backend => {
  it('cap 2: a request and its follow-up wait; one drain writes one assigned round, replay writes none', async () => {
    const world = await open(backend, { secretaryOpenCap: 2 });
    const { earlier, later } = await pair(world);
    const earlierBusy = await world.occupy(earlier);
    await world.occupy(later);

    const first = await submit(world, 's6a-drain-1');
    expect(first).toMatchObject({ status: 'queued', assignment: 'unassigned', secretary: null,
      created: false, waitReason: 'secretary_open_cap' });
    const root = first['requestRoot'] as QueryJobRef;
    const follow = await submit(world, 's6a-drain-1-follow', { continues: first['round'], goalId: null });
    expect(follow).toMatchObject({ status: 'queued', assignment: 'unassigned', secretary: null,
      created: false, waitReason: 'secretary_open_cap' });
    const second = await submit(world, 's6a-drain-2');
    expect(second['assignment']).toBe('unassigned');
    const secondRoot = second['requestRoot'] as QueryJobRef;

    let view = await requestView(world, root);
    expect(view).toMatchObject({ owner: null, ownerState: 'waiting', assignment: 'unassigned',
      waitReason: 'secretary_open_cap' });
    expect(view.rounds).toHaveLength(2);
    expect(view.rounds.map(round => round.assignedSession)).toEqual([null, null]);
    expect((await requestView(world, secondRoot)).rounds).toHaveLength(1);

    // Release one line: the two concurrent drains both see the waiting
    // requests, but the stable drain identity lets only one `assigned` round
    // commit, and the other request stays blocked instead of stopping it.
    await world.finishQuery(earlierBusy);
    const [firstDrain, secondDrain] = await Promise.all([drain(world), drain(world)]);
    expect(Number(firstDrain['progressed']) + Number(secondDrain['progressed'])).toBe(1);

    view = await requestView(world, root);
    expect(view.owner).toEqual(earlier.ref);
    expect(view.ownerState).toBe('owned');
    expect(view.assignment).toBe('assigned');
    expect(view.waitReason).toBeNull();
    expect(routingRounds(view)).toHaveLength(1);
    expect(view.rounds).toHaveLength(3);
    expect(view.rounds[2]!.kind).toBe('routing');
    expect((await requestView(world, secondRoot)).ownerState).toBe('waiting');

    // A replay of the drain writes nothing: the owning request is unchanged and
    // the still-blocked one is visited (blocked 1) without a new round.
    const roundsBefore = view.rounds.length;
    const replay = await drain(world);
    expect(replay['progressed']).toBe(0);
    expect(replay['blocked']).toBe(1);
    expect((await requestView(world, root)).rounds).toHaveLength(roundsBefore);
    expect((await requestView(world, secondRoot)).rounds).toHaveLength(1);
  });

  it('an archived owner reads owner_archived and the drain assigns another secretary', async () => {
    const world = await open(backend);
    const { earlier, later } = await pair(world);
    const submitted = await submit(world, 's6a-drain-archived');
    expect(sessionOf(submitted['secretary'])).toEqual(later.ref);
    const root = submitted['requestRoot'] as QueryJobRef;

    await world.archive(later);
    let view = await requestView(world, root);
    expect(view).toMatchObject({ owner: null, ownerState: 'owner_archived', assignment: 'unassigned',
      waitReason: 'owner_archived' });

    const drained = await drain(world);
    expect(drained['progressed']).toBe(1);
    view = await requestView(world, root);
    expect(view.owner).toEqual(earlier.ref);
    expect(view.ownerState).toBe('owned');
    expect(view.assignment).toBe('assigned');
    expect(view.rounds).toHaveLength(2);
    expect(routingRounds(view)).toHaveLength(1);
    expect(view.rounds[1]!.kind).toBe('routing');
  });

  it('R-01a: an earlier line_pending request does not stop the drain; the later request is assigned', async () => {
    const world = await open(backend, { secretaryOpenCap: 2 });
    const { blockedRoot, laterRoot, busy } = await blockedThenAssignable(world);

    const drained = await drain(world);
    expect(drained).toMatchObject({ progressed: 1, blocked: 1, more: false, wrapped: true, continuation: null });
    // The earlier request's pick took the real line path and answered
    // line_pending from the one injected registration failure.
    expect(registrationDouble.injected).toBe(1);
    expect((await requestView(world, blockedRoot)).ownerState).toBe('waiting');

    const laterView = await requestView(world, laterRoot);
    expect(laterView.ownerState).toBe('owned');
    expect(laterView.assignment).toBe('assigned');
    expect(laterView.owner).not.toBeNull();
    expect(laterView.owner!.sessionId).not.toBe(busy.ref.sessionId);
    expect(laterView.rounds).toHaveLength(2);
    expect(laterView.rounds[1]!.kind).toBe('routing');
    expect(routingRounds(laterView)).toHaveLength(1);
    // One new line was created for the later request (A archived, B busy, C new).
    expect(await world.listSessions()).toHaveLength(3);
    const line = await world.readSession(laterView.owner!);
    expect(line.record.lifecycle).toBe('active');
    expect(line.record.role).toEqual({ kind: 'legacy_template', templateId: 'platform-secretary',
      templateRevision: 's3.1' });
  });

  it('R-01a: maxRequests 1 returns a continuation that crosses the blocked request and wraps', async () => {
    const world = await open(backend, { secretaryOpenCap: 2 });
    const { blockedRoot, laterRoot, busy } = await blockedThenAssignable(world);

    // The first request is the only one in the page: its blocked pick ends the
    // call with progressed 0 and a real continuation past its own position.
    const first = await drainWith(world, 1, null);
    expect(first).toMatchObject({ progressed: 0, blocked: 1, more: true, wrapped: false });
    expect(typeof first['continuation']).toBe('string');
    expect(first['continuation']).not.toBeNull();
    expect((await requestView(world, blockedRoot)).ownerState).toBe('waiting');
    expect((await requestView(world, laterRoot)).ownerState).toBe('waiting');

    // Resuming after the blocked request reaches the later request, assigns it
    // and wraps: nothing follows it in the page.
    const next = await drainWith(world, 20, first['continuation'] as string);
    expect(next).toMatchObject({ progressed: 1, blocked: 0, more: false, wrapped: true, continuation: null });
    const laterView = await requestView(world, laterRoot);
    expect(laterView.ownerState).toBe('owned');
    expect(laterView.assignment).toBe('assigned');
    expect(laterView.owner).not.toBeNull();
    expect(laterView.owner!.sessionId).not.toBe(busy.ref.sessionId);
    expect(laterView.rounds).toHaveLength(2);
    expect(routingRounds(laterView)).toHaveLength(1);
    // The continuation resumed after the blocked request: it was not revisited.
    expect((await requestView(world, blockedRoot)).ownerState).toBe('waiting');
  });
});

describe('SQLite only: the cap after reopen', () => {
  it('SQLite only: reopening with secretaryOpenCap 3 and draining creates a new line C', async () => {
    const world = await open('sqlite', { secretaryOpenCap: 2 });
    const { earlier, later } = await pair(world);
    const first = await submit(world, 's6a-reopen-1');
    expect(sessionOf(first['secretary'])).toEqual(later.ref);
    const second = await submit(world, 's6a-reopen-2');
    expect(sessionOf(second['secretary'])).toEqual(earlier.ref);
    const waiting = await submit(world, 's6a-reopen-3');
    expect(waiting).toMatchObject({ assignment: 'unassigned', waitReason: 'secretary_open_cap' });
    const waitingRoot = waiting['requestRoot'] as QueryJobRef;
    expect(await world.listSessions()).toHaveLength(2);

    await world.reopen({ extraHostOptions: { secretaryOpenCap: 3 } });
    // Both owners' pending rounds survive the reopen, so the raised cap is what
    // lets the drain create the third line for the waiting request.
    expect((await requestView(world, first['requestRoot'] as QueryJobRef)).owner).toEqual(later.ref);
    expect((await requestView(world, second['requestRoot'] as QueryJobRef)).owner).toEqual(earlier.ref);
    expect((await requestView(world, waitingRoot)).ownerState).toBe('waiting');

    const drained = await drain(world);
    expect(drained['progressed']).toBe(1);
    const sessions = await world.listSessions();
    expect(sessions).toHaveLength(3);
    const view = await requestView(world, waitingRoot);
    expect(view.ownerState).toBe('owned');
    expect(view.owner).not.toBeNull();
    const card = await world.readSession(view.owner!);
    expect(card.record.role).toEqual(S6A_SECRETARY_ROLE);
    expect(card.record.lifecycle).toBe('active');
    expect(view.rounds).toHaveLength(2);
    expect(view.rounds[1]!.kind).toBe('routing');
  });
});
