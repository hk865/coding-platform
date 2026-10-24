/**
 * Slice 6A-1 joint scenario (SE1), book §5.2's R-07′ / route / R-06a rows:
 * the public request read against plain Queries, the manual route of a waiting
 * request and the new round after a real drop, on memory and SQLite.
 *
 * Prior state is the person's, through the frozen world's routes and owners:
 * `queries/submit` (a planning Query), `workflow/consultation` (a copy Query),
 * `requests/submit`, `requests/route` (manual and drop), and the real
 * `plans/propose` route for a candidate. Every check reads
 * `platform.requestFacts.readRequest` (the projection) or `readFacts` (the
 * round facts); no record is written by hand and no store is read. Expected
 * values are hand-computed from book §3.2 (the by-request index), §3.3.2 (the
 * owner rule), §3.5.7/§3.5.8 (the assignment and route rows) and §3.12.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { SessionRef } from '../../src/contracts/core/identity.js';
import type { QueryJobRef } from '../../src/contracts/query-job.js';
import type { RequestCoreViewV1 } from '../../src/core/work-graph/model/request-contracts.js';
import {
  openS6ARequestWorld, S6A_GOAL_1, S6A_SCOPE,
  type S6ABackend, type S6ARequestWorld, type S6ASession,
} from '../helpers/S6A-request-fixture.js';
import { ag2bPlanDraft, graphWrite, plain } from '../helpers/AG2b-collaboration-fixture.js';

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
  const openWorlds = worlds.splice(0);
  await Promise.all(openWorlds.map(world => world.close()));
});

const body = (input: unknown): { scope: typeof S6A_SCOPE; input: unknown } => ({ scope: S6A_SCOPE, input });

const submitInput = (commandId: string, overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  commandId, goalId: S6A_GOAL_1.goalId, text: `S6A read ${commandId}`, continues: null, recipient: null, ...overrides,
});

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};

function expectObject(value: unknown): Record<string, unknown> {
  return asRecord(value);
}

function committedValue(bodyValue: unknown, what: string): Record<string, unknown> {
  if (asRecord(bodyValue)['status'] !== 'committed') {
    throw new Error(`S6A: ${what} did not commit: ${JSON.stringify(bodyValue)}`);
  }
  return asRecord(asRecord(bodyValue)['value']);
}

function sessionOf(value: unknown): SessionRef {
  return expectObject(value) as unknown as SessionRef;
}

async function requestView(world: S6ARequestWorld, root: QueryJobRef): Promise<RequestCoreViewV1> {
  const read = await world.platform.requestFacts.readRequest(world.humanContext(), { requestRoot: root });
  if (read.status !== 'ready') throw new Error(`S6A: the request read is not ready: ${JSON.stringify(read)}`);
  return read.value;
}

async function factsOf(world: S6ARequestWorld, root: QueryJobRef) {
  const read = await world.platform.requestFacts.readFacts(world.humanContext(), { requestRoot: root });
  if (read.status !== 'ready') throw new Error(`S6A: the request facts are not ready: ${JSON.stringify(read)}`);
  return read.value;
}

async function submit(world: S6ARequestWorld, commandId: string,
  overrides: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  return expectObject((await world.post('requests/submit', body(submitInput(commandId, overrides)))).body);
}

async function drop(world: S6ARequestWorld, commandId: string, round: QueryJobRef): Promise<Record<string, unknown>> {
  return expectObject((await world.post('requests/route', body({ commandId, round, to: null, reason: 'dropped' }))).body);
}

/** Two secretaries occupied by a real claimed Query: the cap is full and no line is idle. */
async function twoBusySecretaries(world: S6ARequestWorld): Promise<{ a: S6ASession; b: S6ASession }> {
  const b = await world.createSecretary('b', { at: '2026-10-23T09:01:00.000Z' });
  const a = await world.createSecretary('a', { at: '2026-10-23T09:02:00.000Z' });
  await world.occupy(a);
  await world.occupy(b);
  return { a, b };
}

describe.each(['memory', 'sqlite'] as const)('SE1 R-07′: a plain Query is not a request root (%s)', backend => {
  it('readRequest answers not_found for a planning Query and a copy Query, and ready for one request round', async () => {
    const world = await open(backend);
    const source = await world.createSecretary('source');
    // The person's real planning Query (`queries/submit`), the real copy path
    // (`workflow/consultation`) and a real request (`requests/submit`).
    const planning = await world.submitPlanningQuery('s6a-r07');
    const copy = await world.makeReadonlyCopy(source, 's6a-r07');
    const submitted = await submit(world, 's6a-r07-request');
    expect(submitted).toMatchObject({ status: 'queued', assignment: 'assigned', created: false });
    const root = submitted['requestRoot'] as QueryJobRef;

    // The fixture's returned refs, unchanged.
    const planningRead = await world.platform.requestFacts.readRequest(world.humanContext(), {
      requestRoot: planning.queryJobRef,
    });
    expect(planningRead).toEqual({ status: 'not_found' });
    const copyRead = await world.platform.requestFacts.readRequest(world.humanContext(), {
      requestRoot: copy.query.queryJobRef,
    });
    expect(copyRead).toEqual({ status: 'not_found' });

    const requestRead = await world.platform.requestFacts.readRequest(world.humanContext(), { requestRoot: root });
    expect(requestRead.status).toBe('ready');
    if (requestRead.status !== 'ready') throw new Error('unreachable');
    expect(requestRead.value.requestRoot).toEqual(root);
    expect(requestRead.value.rounds).toHaveLength(1);
    expect(requestRead.value.rounds[0]).toMatchObject({ ref: submitted['round'], kind: 'request', status: 'queued' });
    expect(requestRead.value.ownerState).toBe('owned');
    expect(requestRead.value.reasons).toEqual(['round']);
    // The three refs are three different real Queries, so the reads differ only
    // by what the ref names (a copy belongs to another Session).
    expect(copy.query.queryJobRef.queryJobId).not.toBe(planning.queryJobRef.queryJobId);
    expect(copy.query.queryJobRef.queryJobId).not.toBe(root.queryJobId);
    expect(copy.copy.ref.sessionId).not.toBe(source.ref.sessionId);
  });
});

/**
 * A waiting request the person routes to B by hand: both secretaries are busy
 * at the open cap, a waiting root and a waiting follow-up make two pending
 * rounds with no owner, then `requests/route` names B.
 */
async function waitingRequestRoutedToB(world: S6ARequestWorld) {
  const { a, b } = await twoBusySecretaries(world);

  // A waiting root and a waiting follow-up: two pending rounds, no owner.
  const rootResult = await submit(world, 's6a-route-wait');
  expect(rootResult).toMatchObject({ status: 'queued', assignment: 'unassigned', waitReason: 'secretary_open_cap' });
  const root = rootResult['requestRoot'] as QueryJobRef;
  const rootRound = rootResult['round'] as QueryJobRef;
  const follow = await submit(world, 's6a-route-wait-follow', { continues: rootRound, goalId: null });
  expect(follow).toMatchObject({ status: 'queued', assignment: 'unassigned', waitReason: 'secretary_open_cap' });
  const followRound = follow['round'] as QueryJobRef;
  expect((await requestView(world, root)).ownerState).toBe('waiting');

  // The person routes the waiting request to B through the route.
  const routed = expectObject((await world.post('requests/route', body({
    commandId: 's6a-route-wait-manual', round: followRound, to: b.ref, reason: 'manual',
  }))).body);
  expect(routed['status']).toBe('routed');
  return { a, b, root, rootRound, followRound, routingRound: routed['routingRound'] as QueryJobRef };
}

describe.each(['memory', 'sqlite'] as const)('SE1 route: a waiting request takes the oldest pending round (%s)', backend => {
  it('manual route to B writes one routing round, puts the intake on the oldest pending round and reads owner B', async () => {
    const world = await open(backend, { secretaryOpenCap: 2 });
    const { a, b, root, rootRound, followRound, routingRound } = await waitingRequestRoutedToB(world);

    const facts = await factsOf(world, root);
    const pending = facts.rounds.filter(round => round.job.status === 'pending');
    expect(pending.map(round => round.ref)).toEqual([rootRound, followRound]);
    // Book §3.5.10/§3.6.8: the intake names B on the OLDEST pending round,
    // never on the newer follow-up and never on the born-terminal routing round.
    expect(pending[0]!.job.intakeSession).toEqual(b.ref);
    expect(pending[1]!.job.intakeSession).toBeNull();
    const routing = facts.rounds.filter(round => round.job.roundKind === 'routing');
    expect(routing).toHaveLength(1);
    expect(routing[0]!.ref).toEqual(routingRound);
    expect(routing[0]!.job.intakeSession).toBeNull();

    const view = await requestView(world, root);
    expect(view).toMatchObject({ owner: b.ref, ownerState: 'owned', assignment: 'assigned', waitReason: null });
    expect(view.rounds).toHaveLength(3);
    expect(view.rounds.map(round => round.kind)).toEqual(['request', 'followup', 'routing']);
    expect(view.rounds.filter(round => round.kind === 'routing')).toHaveLength(1);
    // A is not the new owner; B is, and B's busy occupancy is not a refusal.
    expect(view.owner!.sessionId).not.toBe(a.ref.sessionId);
  });
});

describe.each(['memory', 'sqlite'] as const)('rejects: a new request to the secretary a manual route chose (%s)', backend => {
  it('requests/submit with @ B after a manual route to B is busy and leaves the request and the Sessions unchanged', async () => {
    const world = await open(backend, { secretaryOpenCap: 2 });
    const { b, root } = await waitingRequestRoutedToB(world);
    const before = { view: await requestView(world, root), sessions: await world.listSessions() };

    // The route took B's intake, not only the holder field: a separate new
    // request addressed to B with `@` meets that intake and is busy.
    const atB = await submit(world, 's6a-route-wait-at-b', { recipient: b.ref });
    expect(atB).toMatchObject({ status: 'rejected', code: 'busy' });
    expect({ view: await requestView(world, root), sessions: await world.listSessions() }).toEqual(before);
  });
});

describe.each(['memory', 'sqlite'] as const)('SE1 R-06a: a new round after a real drop (%s)', backend => {
  it('a continues follow-up on the same root reads owned again when a line is free', async () => {
    const world = await open(backend);
    const a = await world.createSecretary('a');
    const rootResult = await submit(world, 's6a-after-drop');
    expect(sessionOf(rootResult['secretary'])).toEqual(a.ref);
    const root = rootResult['requestRoot'] as QueryJobRef;
    const rootRound = rootResult['round'] as QueryJobRef;

    expect(await drop(world, 's6a-after-drop-route', rootRound)).toMatchObject({ status: 'routed' });
    let view = await requestView(world, root);
    expect(view).toMatchObject({ owner: null, ownerState: 'dropped', processing: false, reasons: [] });

    // The real `continues` follow-up on the SAME root: the drop freed A's
    // intake, so the pick lands on A again.
    const follow = await submit(world, 's6a-after-drop-follow', { continues: rootRound, goalId: null });
    expect(follow).toMatchObject({ status: 'queued', assignment: 'assigned', created: false, waitReason: null });
    expect(sessionOf(follow['secretary'])).toEqual(a.ref);
    expect(follow['requestRoot']).toEqual(root);

    view = await requestView(world, root);
    expect(view).toMatchObject({
      goalId: S6A_GOAL_1.goalId, owner: a.ref, ownerState: 'owned',
      assignment: 'assigned', waitReason: null, processing: true, reasons: ['round'],
    });
    expect(view.rounds).toHaveLength(3);
    expect(view.rounds.map(round => round.kind)).toEqual(['request', 'routing', 'followup']);
    expect(view.rounds[2]!.ref).toEqual(follow['round']);
    expect(view.rounds[2]!.assignedSession).toEqual(a.ref);
  });

  it('a continues follow-up on the same root waits at the open cap and still reads processing', async () => {
    const world = await open(backend, { secretaryOpenCap: 2 });
    const { a, b } = await twoBusySecretaries(world);
    const rootResult = await submit(world, 's6a-after-drop-cap');
    expect(rootResult).toMatchObject({ status: 'queued', assignment: 'unassigned', secretary: null,
      waitReason: 'secretary_open_cap' });
    const root = rootResult['requestRoot'] as QueryJobRef;
    const rootRound = rootResult['round'] as QueryJobRef;

    // A waiting request can be dropped too: the drop ends its unstarted rounds.
    expect(await drop(world, 's6a-after-drop-cap-route', rootRound)).toMatchObject({ status: 'routed' });
    let view = await requestView(world, root);
    expect(view).toMatchObject({ ownerState: 'dropped', processing: false, reasons: [] });

    const follow = await submit(world, 's6a-after-drop-cap-follow', { continues: rootRound, goalId: null });
    expect(follow).toMatchObject({ status: 'queued', assignment: 'unassigned', secretary: null,
      created: false, waitReason: 'secretary_open_cap' });
    expect(follow['requestRoot']).toEqual(root);

    view = await requestView(world, root);
    expect(view).toMatchObject({
      goalId: S6A_GOAL_1.goalId, owner: null, ownerState: 'waiting', assignment: 'unassigned',
      waitReason: 'secretary_open_cap', processing: true, reasons: ['round'],
    });
    expect(view.rounds).toHaveLength(3);
    expect(view.rounds.map(round => round.kind)).toEqual(['request', 'routing', 'followup']);
    expect(view.rounds[2]!.ref).toEqual(follow['round']);
    expect(view.rounds[2]!.assignedSession).toBeNull();
    // The two occupied secretaries were not borrowed for the waiting line.
    expect(view.owner).toBeNull();
    expect(a.ref.sessionId).not.toBe(b.ref.sessionId);
  });
});

describe.each(['memory', 'sqlite'] as const)('SE1 R-06a: the candidate head (%s)', backend => {
  it('a real recorded candidate whose basis is not the Goal active plan reads stale', async () => {
    const world = await open(backend);
    await world.createSecretary('a');
    const submitted = await submit(world, 's6a-candidate');
    const root = submitted['requestRoot'] as QueryJobRef;

    const goalRead = expectObject((await world.post('goals/read', plain(S6A_SCOPE, S6A_GOAL_1))).body);
    expect(goalRead['status']).toBe('ready');
    const goalRevision = asRecord(asRecord(goalRead['value'])['goal'])['revision'];
    expect(typeof goalRevision).toBe('number');

    // A real candidate through `plans/propose`, associated with this request
    // root. Its `basedOn` names no active Plan (the Goal has none), so the
    // public request read must derive it stale.
    const proposed = committedValue((await world.post('plans/propose', graphWrite(S6A_SCOPE, {
      goalRef: S6A_GOAL_1,
      basedOn: { aggregateType: 'PlanRevision', projectId: S6A_SCOPE.projectId, planId: 's6a-stale-basis' },
      draft: { ...ag2bPlanDraft(['s6a-stale-work']), planId: 's6a-stale-plan', planRevision: 1,
        goalId: S6A_GOAL_1.goalId },
      requestRef: root,
      reason: { text: 'S6A a candidate on a basis that is not active', sources: [] },
    }, 's6a-stale-propose', [{ ref: S6A_GOAL_1, revision: goalRevision as number }]))).body, 'the candidate');
    expect(proposed['status']).toBe('candidate');

    const view = await requestView(world, root);
    expect(view.processing).toBe(true);
    expect(view.reasons).toEqual(['round', 'candidate']);
    expect(view.candidate).not.toBeNull();
    expect(view.candidate!.proposalRef).toEqual(proposed['ref']);
    expect(view.candidate!.state).toBe('stale');
    expect(view.candidate!.stale).toBe(true);

    // The person drops the request's one unstarted round: no round keeps the
    // request processing any more, so the stale candidate alone does.
    expect(await drop(world, 's6a-candidate-drop', submitted['round'] as QueryJobRef))
      .toMatchObject({ status: 'routed' });
    const afterDrop = await requestView(world, root);
    expect(afterDrop.ownerState).toBe('dropped');
    expect(afterDrop.reasons).toEqual(['candidate']);
    expect(afterDrop.processing).toBe(true);
    expect(afterDrop.candidate).toEqual({ proposalRef: proposed['ref'], state: 'stale', stale: true });
  });
});
