/**
 * Slice 6A-1 joint scenario (SE1): the concurrency and replay rows through the
 * frozen world's real routes, on memory and SQLite. The only fault injection is
 * the frozen pair from book §5.1:
 *   - `S6A-commit-barrier` holds a request commit after its picking reads and
 *     before `records.commit` (R-02, R-03a); the held commit is only a gate and
 *     a commit-point choice — every checked result is a public request read or
 *     the receipt the route returned, never the captured commit;
 *   - `S6A-registration-double` throws the first `recordSessionCreated`, so the
 *     real `createSession` answers `accepted` and `submit` reads `line_pending`;
 *     the replay registers the same line (R-01a).
 * The platform produces every fact; the test only chooses when a prepared
 * commit reaches the store. Expected values are hand-computed from book
 * §3.4.4/§3.4.7, §3.5.3 and §3.6.8.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SessionRef } from '../../src/contracts/core/identity.js';
import type { QueryJobRef } from '../../src/contracts/query-job.js';
import type { RequestCoreViewV1 } from '../../src/core/work-graph/model/request-contracts.js';
import {
  openS6ARequestWorld, S6A_GOAL_1, S6A_SCOPE,
  type S6ABackend, type S6ARequestWorld,
} from '../helpers/S6A-request-fixture.js';
import {
  byIdentityPrefix, commitBarrier,
} from '../helpers/S6A-commit-barrier.js';
import { registrationDouble } from '../helpers/S6A-registration-double.js';

vi.mock('../../src/core/record-store/in-memory-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-commit-barrier.js')).inMemoryBarrierModule(importOriginal));
vi.mock('../../src/core/record-store/sqlite-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-commit-barrier.js')).sqliteBarrierModule(importOriginal));
vi.mock('../../src/core/work-graph/sessions/session-directory.js', async (importOriginal) =>
  (await import('../helpers/S6A-registration-double.js')).registrationDoubleModule(importOriginal));

const worlds: S6ARequestWorld[] = [];

async function open(backend: S6ABackend): Promise<S6ARequestWorld> {
  const world = await openS6ARequestWorld({ backend });
  worlds.push(world);
  return world;
}

afterEach(async () => {
  const left = commitBarrier.reset();
  registrationDouble.reset();
  const openWorlds = worlds.splice(0);
  await Promise.allSettled(openWorlds.map(world => world.close()));
  expect(left).toEqual([]);
});

const body = (input: unknown): { scope: typeof S6A_SCOPE; input: unknown } => ({ scope: S6A_SCOPE, input });

const submitInput = (commandId: string, overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  commandId, goalId: S6A_GOAL_1.goalId, text: `S6A concurrency ${commandId}`, continues: null, recipient: null, ...overrides,
});

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};

function expectObject(value: unknown): Record<string, unknown> {
  return asRecord(value);
}

function sessionOf(value: unknown): SessionRef {
  return expectObject(value) as unknown as SessionRef;
}

function idOf(session: SessionRef): string {
  return session.sessionId;
}

async function requestView(world: S6ARequestWorld, root: QueryJobRef): Promise<RequestCoreViewV1> {
  const read = await world.platform.requestFacts.readRequest(world.humanContext(), { requestRoot: root });
  if (read.status !== 'ready') throw new Error(`S6A: the request read is not ready: ${JSON.stringify(read)}`);
  return read.value;
}

async function drain(world: S6ARequestWorld): Promise<Record<string, unknown>> {
  const result = await world.platform.requestIntake.drainUnassigned(world.systemContext(), S6A_SCOPE,
    { maxRequests: 20, continuation: null });
  if (result.status !== 'ready') throw new Error(`S6A: the drain is not ready: ${JSON.stringify(result)}`);
  return result.value as unknown as Record<string, unknown>;
}

describe.each(['memory', 'sqlite'] as const)('SE1 request concurrency and replay (%s)', backend => {
  it('R-02: two concurrent submits; one keeps A, the other re-picks B, and each round names one owner', async () => {
    const world = await open(backend);
    const b = await world.createSecretary('b', { at: '2026-10-23T09:01:00.000Z' });
    const a = await world.createSecretary('a', { at: '2026-10-23T09:02:00.000Z' });
    const sessionsBefore = (await world.listSessions()).length;

    // Hold the first submit's commit after its picking read. The second submit
    // picks A too (later activity), commits first and takes A's intake; the
    // released commit conflicts on that intake, retries excluding A, and gets B.
    const hold = commitBarrier.hold(byIdentityPrefix('request.submit:'), 'first submit');
    const firstPost = world.post('requests/submit', body(submitInput('s6a-conc-1')));
    await hold.reached;
    const second = expectObject((await world.post('requests/submit', body(submitInput('s6a-conc-2')))).body);
    hold.release();
    const first = expectObject((await firstPost).body);

    expect(first).toMatchObject({ status: 'queued', assignment: 'assigned', created: false, waitReason: null });
    expect(second).toMatchObject({ status: 'queued', assignment: 'assigned', created: false, waitReason: null });
    const assigned = [sessionOf(first['secretary']), sessionOf(second['secretary'])];
    expect(new Set(assigned.map(idOf)).size).toBe(2);
    expect(new Set(assigned.map(idOf))).toEqual(new Set([idOf(a.ref), idOf(b.ref)]));
    expect((first['requestRoot'] as QueryJobRef).queryJobId)
      .not.toBe((second['requestRoot'] as QueryJobRef).queryJobId);
    expect(await world.listSessions()).toHaveLength(sessionsBefore);

    // Each request's one round names the secretary its receipt returned.
    for (const result of [first, second]) {
      const view = await requestView(world, result['requestRoot'] as QueryJobRef);
      expect(view.ownerState).toBe('owned');
      expect(view.owner).toEqual(sessionOf(result['secretary']));
      expect(view.rounds).toHaveLength(1);
      expect(view.rounds[0]!.assignedSession).toEqual(sessionOf(result['secretary']));
    }
  });

  it('R-02: a held fresh pick whose Session revision moved re-picks B and commits one round', async () => {
    const world = await open(backend);
    const b = await world.createSecretary('b', { at: '2026-10-23T09:01:00.000Z' });
    const a = await world.createSecretary('a', { at: '2026-10-23T09:02:00.000Z' });
    const sessionsBefore = (await world.listSessions()).length;

    // Hold the submit's commit after its fresh pick read A's Session guard.
    const hold = commitBarrier.hold(byIdentityPrefix('request.submit:'), 'revision move');
    const post = world.post('requests/submit', body(submitInput('s6a-conc-revision')));
    await hold.reached;

    // A real revision move of the picked Session while the commit is held:
    // create (1), archive request (2), archived (3), reactivated (4).
    const moved = await world.bumpRevision(a);
    hold.release();
    const submitted = expectObject((await post).body);
    expect(moved).toEqual({ before: 1, after: 4 });

    // The moved guard is revision_conflict, and Workflow re-picks excluding A:
    // one round, assigned to B, and no second request round anywhere.
    expect(submitted).toMatchObject({ status: 'queued', assignment: 'assigned', created: false, waitReason: null });
    expect(sessionOf(submitted['secretary'])).toEqual(b.ref);
    const view = await requestView(world, submitted['requestRoot'] as QueryJobRef);
    expect(view).toMatchObject({ owner: b.ref, ownerState: 'owned', assignment: 'assigned' });
    expect(view.rounds).toHaveLength(1);
    expect(view.rounds[0]).toMatchObject({ kind: 'request', status: 'queued', assignedSession: b.ref });
    expect(await world.listSessions()).toHaveLength(sessionsBefore);
    expect((await world.readSession(a)).record.occupancy).toBeNull();
  });

  it('R-03a: a held tail-moving follow-up conflicts, retries and commits last on its owner', async () => {
    const world = await open(backend);
    await world.createSecretary('b', { at: '2026-10-23T09:01:00.000Z' });
    const a = await world.createSecretary('a', { at: '2026-10-23T09:02:00.000Z' });
    const rootResult = expectObject((await world.post('requests/submit', body(submitInput('s6a-tail-root')))).body);
    expect(sessionOf(rootResult['secretary'])).toEqual(a.ref);
    const root = rootResult['requestRoot'] as QueryJobRef;
    const rootRound = rootResult['round'] as QueryJobRef;

    // The barrier only chooses the commit point: the first follow-up is held
    // after its reads, the second commits first and moves the tail.
    const hold = commitBarrier.hold(byIdentityPrefix('request.submit:'), 'first follow-up');
    const firstFollowPost = world.post('requests/submit',
      body(submitInput('s6a-tail-1', { continues: rootRound, goalId: null })));
    await hold.reached;

    const secondFollow = expectObject((await world.post('requests/submit',
      body(submitInput('s6a-tail-2', { continues: rootRound, goalId: null })))).body);
    hold.release();
    const firstFollow = expectObject((await firstFollowPost).body);
    for (const result of [firstFollow, secondFollow]) {
      expect(result).toMatchObject({ status: 'queued', assignment: 'assigned', created: false });
      expect(sessionOf(result['secretary'])).toEqual(a.ref);
    }

    // Public read: both follow-ups queued on the owner A, no new line, and the
    // retried one (committed after the tail moved) is the newest tail.
    const view = await requestView(world, root);
    expect(view).toMatchObject({ owner: a.ref, ownerState: 'owned', assignment: 'assigned',
      processing: true, reasons: ['round'] });
    expect(view.rounds.map(round => round.kind)).toEqual(['request', 'followup', 'followup']);
    expect(view.rounds.map(round => round.assignedSession)).toEqual([a.ref, a.ref, a.ref]);
    expect(view.rounds[2]!.ref).toEqual(firstFollow['round']);
    expect(view.rounds[1]!.ref).toEqual(secondFollow['round']);
    for (const round of view.rounds) expect(round.since).toMatch(/^c\d{10}$/);
    expect(await world.listSessions()).toHaveLength(2);
  });

  it('R-03a: retried follow-ups on the owner take no intake: a fresh pick held on that owner still lands there', async () => {
    const world = await open(backend);
    const b = await world.createSecretary('b', { at: '2026-10-23T09:01:00.000Z' });
    const rootResult = expectObject((await world.post('requests/submit', body(submitInput('s6a-own-root')))).body);
    expect(sessionOf(rootResult['secretary'])).toEqual(b.ref);
    const root = rootResult['requestRoot'] as QueryJobRef;
    const rootRound = rootResult['round'] as QueryJobRef;
    const a = await world.createSecretary('a', { at: '2026-10-23T09:02:00.000Z' });

    // A fresh pick of the idle A, held after its picking reads; it takes A's
    // intake when it commits, so it lands on A only if nothing took that intake
    // meanwhile (a conflict there makes Workflow re-pick another secretary).
    const freshHold = commitBarrier.hold(byIdentityPrefix('request.submit:'), 'fresh pick of A');
    const freshPost = world.post('requests/submit', body(submitInput('s6a-own-fresh')));
    await freshHold.reached;

    // The person moves the request to A with `@` (from `owned`: no intake), then
    // two follow-ups race on A: the first is held, the second moves the tail,
    // and the first retries on the moved tail.
    const moved = expectObject((await world.post('requests/submit',
      body(submitInput('s6a-own-move', { continues: rootRound, goalId: null, recipient: a.ref })))).body);
    expect(sessionOf(moved['secretary'])).toEqual(a.ref);
    const followHold = commitBarrier.hold(byIdentityPrefix('request.submit:'), 'first follow-up on A');
    const firstFollowPost = world.post('requests/submit',
      body(submitInput('s6a-own-follow-1', { continues: rootRound, goalId: null })));
    await followHold.reached;
    const secondFollow = expectObject((await world.post('requests/submit',
      body(submitInput('s6a-own-follow-2', { continues: rootRound, goalId: null })))).body);
    followHold.release();
    const firstFollow = expectObject((await firstFollowPost).body);
    for (const result of [firstFollow, secondFollow]) {
      expect(result).toMatchObject({ status: 'queued', assignment: 'assigned', created: false });
      expect(sessionOf(result['secretary'])).toEqual(a.ref);
    }

    freshHold.release();
    const fresh = expectObject((await freshPost).body);
    expect(fresh).toMatchObject({ status: 'queued', assignment: 'assigned', created: false });
    expect(sessionOf(fresh['secretary'])).toEqual(a.ref);
    expect(await world.listSessions()).toHaveLength(2);
    const view = await requestView(world, root);
    expect(view.owner).toEqual(a.ref);
    expect(view.rounds.map(round => round.assignedSession)).toEqual([b.ref, a.ref, a.ref, a.ref]);
  });

  it('R-01a: the registration double gives line_pending, the replay creates and uses one line', async () => {
    const world = await open(backend);
    const input = submitInput('s6a-pending');
    registrationDouble.failNext(1);

    const pending = expectObject((await world.post('requests/submit', body(input))).body);
    expect(pending).toEqual({ status: 'rejected', code: 'unavailable', reason: 'line_pending' });
    expect(registrationDouble.injected).toBe(1);
    expect(registrationDouble.forwarded).toBe(0);
    expect(await world.listSessions()).toHaveLength(0);
    // Nothing was committed: the drain has no waiting request to visit.
    const emptyDrain = await drain(world);
    expect(emptyDrain).toEqual({ progressed: 0, more: false, continuation: null, wrapped: true, blocked: 0 });

    const retry = expectObject((await world.post('requests/submit', body(input))).body);
    expect(retry).toMatchObject({ status: 'queued', assignment: 'assigned', created: true, waitReason: null });
    expect(registrationDouble.forwarded).toBe(1);
    expect(registrationDouble.armed).toBe(0);
    const sessions = await world.listSessions();
    expect(sessions).toHaveLength(1);
    const line = sessionOf(retry['secretary']);
    expect(sessions[0]!.record.ref.sessionId).toBe(line.sessionId);
    const view = await requestView(world, retry['requestRoot'] as QueryJobRef);
    expect(view).toMatchObject({ owner: line, ownerState: 'owned', assignment: 'assigned' });
    expect(view.rounds).toHaveLength(1);

    // A receipt replay is not a second line: same body, one Session, one round.
    const replay = expectObject((await world.post('requests/submit', body(input))).body);
    expect(replay).toEqual(retry);
    expect(await world.listSessions()).toHaveLength(1);
    expect((await requestView(world, retry['requestRoot'] as QueryJobRef)).rounds).toHaveLength(1);
  });
});
