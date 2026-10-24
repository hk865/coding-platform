/**
 * Slice 6A-1 group H: the three person-only request routes, the Host's
 * `secretaryOpenCap` and `SecretaryProfilePort`, and the platform wiring.
 *
 * Every prior state comes from the frozen `openS6ARequestWorld` fixture's public
 * steps (Sessions through `sessions/create`, occupancy through a real
 * `queries/claim`, archives through `sessions/archive-line`); every check reads
 * a route, the platform's request read port or the published bootstrap. No
 * database read, no hand-written fact, no model call.
 *
 * Expected bodies are hand-computed from book-6a §3.4.7, §3.5 and §3.12, not
 * copied from output: `created:false` when the pick found the idle secretary,
 * `created:true` when a line was made, `waitReason:'secretary_open_cap'` when
 * the cap refused, `no_secretary_binding` when no profile names a secretary.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { SessionRef } from '../../src/contracts/core/identity.js';
import type { QueryJobRef } from '../../src/contracts/query-job.js';
import type { RequestCoreViewV1 } from '../../src/core/work-graph/model/request-contracts.js';
import {
  openS6ARequestWorld, S6A_GOAL_1, S6A_PLAIN_PROFILE_ID, S6A_PLAIN_ROLE, S6A_SCOPE,
  S6A_SECRETARY_PROFILE_ID, S6A_SECRETARY_ROLE,
  type S6ABackend, type S6AConfiguration, type S6AProfileOrder, type S6ARequestWorld, type S6ASession,
} from '../helpers/S6A-request-fixture.js';

const worlds: S6ARequestWorld[] = [];
type OpenOptions = { backend: S6ABackend; configuration?: S6AConfiguration; order?: S6AProfileOrder;
  extraHostOptions?: Record<string, unknown> };

async function open(options: OpenOptions): Promise<S6ARequestWorld> {
  const world = await openS6ARequestWorld(options);
  worlds.push(world);
  return world;
}

afterEach(async () => {
  const openWorlds = worlds.splice(0);
  await Promise.all(openWorlds.map(world => world.close()));
});

const body = (input: unknown): { scope: typeof S6A_SCOPE; input: unknown } => ({ scope: S6A_SCOPE, input });

const submitInput = (commandId: string, overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  commandId, goalId: S6A_GOAL_1.goalId, text: `S6A question ${commandId}`, continues: null, recipient: null, ...overrides,
});

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};

function expectObject(value: unknown): Record<string, unknown> {
  return asRecord(value);
}

function expectQueuedAssigned(value: unknown): Record<string, unknown> {
  const queued = expectObject(value);
  expect(queued['status']).toBe('queued');
  expect(queued['assignment']).toBe('assigned');
  expect(queued['waitReason']).toBeNull();
  return queued;
}

function sessionOf(value: unknown): SessionRef {
  return expectObject(value) as unknown as SessionRef;
}

async function postOk(world: S6ARequestWorld, suffix: string, input: unknown): Promise<Record<string, unknown>> {
  const answer = await world.post(suffix, body(input));
  expect(answer.httpStatus).toBe(200);
  return expectObject(answer.body);
}

async function requestView(world: S6ARequestWorld, root: QueryJobRef): Promise<RequestCoreViewV1> {
  const read = await world.platform.requestFacts.readRequest(world.humanContext(), { requestRoot: root });
  if (read.status !== 'ready') throw new Error(`S6A: the request read is not ready: ${JSON.stringify(read)}`);
  return read.value;
}

function routingRounds(view: RequestCoreViewV1): RequestCoreViewV1['rounds'] {
  return view.rounds.filter(round => round.kind === 'routing');
}

async function sessionCount(world: S6ARequestWorld): Promise<number> {
  return (await world.listSessions()).length;
}

/**
 * A3: a delegating wrapper around the real request port that counts entries and
 * returns its result unchanged. A person-only route that does not short-circuit
 * would enter the owner (and still read `forbidden` from its own precheck), so
 * the count, not only the body, proves the route's own guard.
 */
async function countedIntake<T>(world: S6ARequestWorld, run: () => Promise<T>): Promise<{ result: T; calls: number }> {
  const intake = world.platform.requestIntake;
  const real = {
    submitRequest: intake.submitRequest.bind(intake),
    route: intake.route.bind(intake),
    selectIdea: intake.selectIdea.bind(intake),
  };
  let calls = 0;
  intake.submitRequest = async (ctx, input) => { calls += 1; return real.submitRequest(ctx, input); };
  intake.route = async (ctx, input) => { calls += 1; return real.route(ctx, input); };
  intake.selectIdea = async (ctx, input) => { calls += 1; return real.selectIdea(ctx, input); };
  try {
    return { result: await run(), calls };
  } finally {
    intake.submitRequest = real.submitRequest;
    intake.route = real.route;
    intake.selectIdea = real.selectIdea;
  }
}

async function drain(world: S6ARequestWorld): Promise<Record<string, unknown>> {
  const result = await world.platform.requestIntake.drainUnassigned(world.systemContext(), S6A_SCOPE,
    { maxRequests: 20, continuation: null });
  if (result.status !== 'ready') throw new Error(`S6A: the drain is not ready: ${JSON.stringify(result)}`);
  return result.value as unknown as Record<string, unknown>;
}

async function twoBusySecretaries(world: S6ARequestWorld): Promise<[S6ASession, S6ASession]> {
  return [await world.createSecretary('a'), await world.createSecretary('b')];
}

// ------------------------------------------------------------------------- //
// The three commands through their routes                                    //
// ------------------------------------------------------------------------- //

describe.each(['memory', 'sqlite'] as const)('request routes (%s)', backend => {
  it('R-URL: requests/submit assigns the configured secretary and a replay returns the stored receipt', async () => {
    const world = await open({ backend });
    const secretary = await world.createSecretary('a');
    const first = expectQueuedAssigned((await world.post('requests/submit', body(submitInput('s6a-h-submit-1')))).body);
    expect(first['created']).toBe(false);
    expect(sessionOf(first['secretary'])).toEqual(secretary.ref);
    const root = first['requestRoot'] as QueryJobRef;
    expectObject(root);
    const roundsAfterFirst = await requestView(world, root);
    expect(roundsAfterFirst.rounds).toHaveLength(1);
    expect(roundsAfterFirst.ownerState).toBe('owned');
    expect(roundsAfterFirst.owner).toEqual(secretary.ref);

    const sessionsBeforeReplay = await sessionCount(world);
    const replay = expectQueuedAssigned((await world.post('requests/submit', body(submitInput('s6a-h-submit-1')))).body);
    expect(replay).toEqual(first);
    expect(await sessionCount(world)).toBe(sessionsBeforeReplay);

    const conflict = expectObject((await world.post('requests/submit',
      body(submitInput('s6a-h-submit-1', { text: 'S6A a different text' })))).body);
    expect(conflict).toMatchObject({ status: 'rejected', code: 'idempotency_conflict' });
    expect((await requestView(world, root)).rounds).toHaveLength(1);
  });

  it('R-URL: a non-human submit is forbidden before any line or round', async () => {
    const world = await open({ backend });
    const before = await sessionCount(world);
    const { result: refused, calls } = await countedIntake(world, () => world.dispatch('requests/submit',
      world.systemContext(), body(submitInput('s6a-h-system-submit'))));
    expect(refused).toMatchObject({ status: 'rejected', code: 'forbidden' });
    expect(calls).toBe(0);
    expect(await sessionCount(world)).toBe(before);
    // No waiting round exists: a human drain has nothing to assign.
    const drained = await drain(world);
    expect(drained['progressed']).toBe(0);
    expect(drained['blocked']).toBe(0);
  });

  it('R-URL: a non-human route and a non-human select-idea are forbidden and write no round', async () => {
    const world = await open({ backend });
    const a = await world.createSecretary('a');
    const b = await world.createSecretary('b');
    const submitted = expectQueuedAssigned((await world.post('requests/submit', body(submitInput('s6a-h-route-forbidden')))).body);
    const root = submitted['requestRoot'] as QueryJobRef;
    const round = submitted['round'] as QueryJobRef;
    const before = await requestView(world, root);
    expect(before.rounds).toHaveLength(1);

    const route = await countedIntake(world, () => world.dispatch('requests/route', world.systemContext(),
      body({ commandId: 's6a-h-system-route', round, to: b.ref, reason: 'manual' })));
    expect(route.result).toMatchObject({ status: 'rejected', code: 'forbidden' });
    expect(route.calls).toBe(0);
    const drop = await countedIntake(world, () => world.dispatch('requests/route', world.systemContext(),
      body({ commandId: 's6a-h-system-drop', round, to: null, reason: 'dropped' })));
    expect(drop.result).toMatchObject({ status: 'rejected', code: 'forbidden' });
    expect(drop.calls).toBe(0);
    const idea = await countedIntake(world, () => world.dispatch('requests/select-idea', world.systemContext(),
      body({ commandId: 's6a-h-system-idea', round, index: 0 })));
    expect(idea.result).toMatchObject({ status: 'rejected', code: 'forbidden' });
    expect(idea.calls).toBe(0);

    const after = await requestView(world, root);
    expect(after.rounds).toHaveLength(1);
    expect(after.owner).toEqual(a.ref);
    expect(after.ownerState).toBe('owned');
  });

  it('R-URL: requests/route manual moves the owner to B and a replay writes no second routing round', async () => {
    const world = await open({ backend });
    const a = await world.createSecretary('a');
    const b = await world.createSecretary('b');
    const submitted = expectQueuedAssigned((await world.post('requests/submit', body(submitInput('s6a-h-manual')))).body);
    expect(sessionOf(submitted['secretary'])).toEqual(a.ref);
    const root = submitted['requestRoot'] as QueryJobRef;
    const round = submitted['round'] as QueryJobRef;

    const routed = expectObject((await world.post('requests/route',
      body({ commandId: 's6a-h-manual-route', round, to: b.ref, reason: 'manual' }))).body);
    expect(routed['status']).toBe('routed');
    const routingRound = routed['routingRound'] as QueryJobRef;
    expectObject(routingRound);
    const view = await requestView(world, root);
    expect(view.owner).toEqual(b.ref);
    expect(view.ownerState).toBe('owned');
    expect(view.rounds).toHaveLength(2);
    expect(routingRounds(view)).toHaveLength(1);
    expect(routingRounds(view)[0]!.kind).toBe('routing');

    const replay = expectObject((await world.post('requests/route',
      body({ commandId: 's6a-h-manual-route', round, to: b.ref, reason: 'manual' }))).body);
    expect(replay).toEqual(routed);
    expect((await requestView(world, root)).rounds).toHaveLength(2);
  });

  it('R-URL: requests/route refuses handoff and archived publicly as invalid', async () => {
    const world = await open({ backend });
    const a = await world.createSecretary('a');
    const b = await world.createSecretary('b');
    const submitted = expectQueuedAssigned((await world.post('requests/submit', body(submitInput('s6a-h-public-reason')))).body);
    const root = submitted['requestRoot'] as QueryJobRef;
    const round = submitted['round'] as QueryJobRef;
    for (const reason of ['handoff', 'archived']) {
      const refused = expectObject((await world.post('requests/route',
        body({ commandId: `s6a-h-public-${reason}`, round, to: b.ref, reason }))).body);
      expect(refused).toMatchObject({ status: 'rejected', code: 'invalid' });
    }
    const view = await requestView(world, root);
    expect(view.rounds).toHaveLength(1);
    expect(view.owner).toEqual(a.ref);
  });

  it('R-URL: requests/route dropped ends the unstarted round cancelled/dropped and releases the intake', async () => {
    const world = await open({ backend });
    const a = await world.createSecretary('a');
    const submitted = expectQueuedAssigned((await world.post('requests/submit', body(submitInput('s6a-h-drop')))).body);
    const root = submitted['requestRoot'] as QueryJobRef;
    const round = submitted['round'] as QueryJobRef;
    const dropped = expectObject((await world.post('requests/route',
      body({ commandId: 's6a-h-drop-route', round, to: null, reason: 'dropped' }))).body);
    expect(dropped['status']).toBe('routed');
    expectObject(dropped['routingRound']);

    const view = await requestView(world, root);
    expect(view.ownerState).toBe('dropped');
    expect(view.owner).toBeNull();
    expect(view.assignment).toBe('unassigned');
    const ended = view.rounds.find(candidate => candidate.ref.queryJobId === round.queryJobId);
    expect(ended).toBeDefined();
    expect(ended!.status).toBe('ended');
    expect(ended!.closeCode).toBe('cancelled');
    expect(ended!.closeDetail).toBe('dropped');

    const again = expectObject((await world.post('requests/route',
      body({ commandId: 's6a-h-drop-route-again', round, to: null, reason: 'dropped' }))).body);
    expect(again).toMatchObject({ status: 'rejected', code: 'invalid' });

    // The intake A held for the dropped request is released: the next request
    // picks the same idle secretary again instead of conflicting and choosing B.
    const next = expectQueuedAssigned((await world.post('requests/submit', body(submitInput('s6a-h-after-drop')))).body);
    expect(next['created']).toBe(false);
    expect(sessionOf(next['secretary'])).toEqual(a.ref);
  });

});

// ------------------------------------------------------------------------- //
// A new line, the no-profile answer and the open cap                         //
// ------------------------------------------------------------------------- //

describe.each(['memory', 'sqlite'] as const)('line creation and capacity (%s)', backend => {
  it('R-LINE: with the only secretary busy and no cap, submit creates one new secretary line', async () => {
    const world = await open({ backend });
    const secretary = await world.createSecretary('a');
    await world.occupy(secretary);
    const created = expectQueuedAssigned((await world.post('requests/submit', body(submitInput('s6a-h-line')))).body);
    expect(created['created']).toBe(true);
    const line = sessionOf(created['secretary']);
    expect(line.sessionId).not.toBe(secretary.ref.sessionId);
    expect(await sessionCount(world)).toBe(2);
    const lineCard = await world.readSession(line);
    expect(lineCard.record.role).toEqual({ kind: 'legacy_template', templateId: 'platform-secretary',
      templateRevision: 's3.1' });

    const replay = expectQueuedAssigned((await world.post('requests/submit', body(submitInput('s6a-h-line')))).body);
    expect(replay).toEqual(created);
    expect(await sessionCount(world)).toBe(2);
  });

  it('R-LINE: no secretary profile is unavailable no_secretary_binding and creates no line', async () => {
    const world = await open({ backend, configuration: 'no_secretary' });
    const before = await sessionCount(world);
    const refused = expectObject((await world.post('requests/submit', body(submitInput('s6a-h-none')))).body);
    expect(refused).toMatchObject({ status: 'rejected', code: 'unavailable', reason: 'no_secretary_binding' });
    expect(await sessionCount(world)).toBe(before);
  });

  it('R-LINE: secretaryOpenCap 2 with two busy secretaries leaves the request waiting and its follow-up waits too', async () => {
    const world = await open({ backend, extraHostOptions: { secretaryOpenCap: 2 } });
    const [a, b] = await twoBusySecretaries(world);
    await world.occupy(a);
    await world.occupy(b);
    const waiting = expectObject((await world.post('requests/submit', body(submitInput('s6a-h-cap')))).body);
    expect(waiting['status']).toBe('queued');
    expect(waiting['assignment']).toBe('unassigned');
    expect(waiting['secretary']).toBeNull();
    expect(waiting['created']).toBe(false);
    expect(waiting['waitReason']).toBe('secretary_open_cap');
    const root = waiting['requestRoot'] as QueryJobRef;
    const view = await requestView(world, root);
    expect(view.owner).toBeNull();
    expect(view.ownerState).toBe('waiting');
    expect(view.assignment).toBe('unassigned');
    expect(view.waitReason).toBe('secretary_open_cap');

    const followUp = expectObject((await world.post('requests/submit',
      body(submitInput('s6a-h-cap-follow', { continues: root })))).body);
    expect(followUp['assignment']).toBe('unassigned');
    expect(followUp['waitReason']).toBe('secretary_open_cap');
    expect((await requestView(world, root)).rounds).toHaveLength(2);
  });
});

// ------------------------------------------------------------------------- //
// The drain                                                                 //
// ------------------------------------------------------------------------- //

describe.each(['memory', 'sqlite'] as const)('drainUnassigned (%s)', backend => {
  it('R-DRAIN: exactly one assigned routing round, a replay writes none, and two concurrent drains write one', async () => {
    const world = await open({ backend, extraHostOptions: { secretaryOpenCap: 2 } });
    const [a, b] = await twoBusySecretaries(world);
    const aBusy = await world.occupy(a);
    await world.occupy(b);
    const waiting = expectObject((await world.post('requests/submit', body(submitInput('s6a-h-drain')))).body);
    const root = waiting['requestRoot'] as QueryJobRef;
    await world.finishQuery(aBusy);

    // Two concurrent drains both see the waiting request; the stable drain
    // identity lets only one write the `assigned` round.
    const [first, second] = await Promise.all([drain(world), drain(world)]);
    expect(Number(first['progressed']) + Number(second['progressed'])).toBe(1);
    const view = await requestView(world, root);
    expect(view.owner).toEqual(a.ref);
    expect(view.ownerState).toBe('owned');
    expect(routingRounds(view)).toHaveLength(1);
    const roundsAfterFirst = view.rounds.length;

    const replay = await drain(world);
    expect(replay['progressed']).toBe(0);
    expect((await requestView(world, root)).rounds).toHaveLength(roundsAfterFirst);
  });

  it('R-DRAIN: a blocked request does not stop the traversal', async () => {
    const world = await open({ backend, extraHostOptions: { secretaryOpenCap: 2 } });
    const [a, b] = await twoBusySecretaries(world);
    const aBusy = await world.occupy(a);
    await world.occupy(b);
    const firstWaiting = expectObject((await world.post('requests/submit', body(submitInput('s6a-h-drain-a')))).body);
    const secondWaiting = expectObject((await world.post('requests/submit', body(submitInput('s6a-h-drain-b')))).body);
    expect(firstWaiting['assignment']).toBe('unassigned');
    expect(secondWaiting['assignment']).toBe('unassigned');
    const firstRoot = firstWaiting['requestRoot'] as QueryJobRef;
    const secondRoot = secondWaiting['requestRoot'] as QueryJobRef;
    await world.finishQuery(aBusy);

    const drained = await drain(world);
    expect(drained['progressed']).toBe(1);
    expect(drained['blocked']).toBe(1);
    const firstView = await requestView(world, firstRoot);
    expect(firstView.ownerState).toBe('owned');
    expect(firstView.owner).toEqual(a.ref);
    const secondView = await requestView(world, secondRoot);
    expect(secondView.ownerState).toBe('waiting');
    expect(secondView.owner).toBeNull();
  });

  it('R-DRAIN: an archived owner reads owner_archived and the drain assigns another secretary', async () => {
    const world = await open({ backend });
    const a = await world.createSecretary('a');
    const b = await world.createSecretary('b');
    const submitted = expectQueuedAssigned((await world.post('requests/submit', body(submitInput('s6a-h-archived')))).body);
    expect(sessionOf(submitted['secretary'])).toEqual(a.ref);
    const root = submitted['requestRoot'] as QueryJobRef;
    await world.archive(a);
    const archived = await requestView(world, root);
    expect(archived.ownerState).toBe('owner_archived');
    expect(archived.waitReason).toBe('owner_archived');
    expect(archived.assignment).toBe('unassigned');

    const drained = await drain(world);
    expect(drained['progressed']).toBe(1);
    const reassigned = await requestView(world, root);
    expect(reassigned.owner).toEqual(b.ref);
    expect(reassigned.ownerState).toBe('owned');
  });
});

// ------------------------------------------------------------------------- //
// Reopen: the cap takes its new value, the drain makes the new line, and the //
// profile port follows the live configuration                                //
// ------------------------------------------------------------------------- //

describe('SQLite only: reopen', () => {
  it('R-DRAIN SQLite only: reopening with secretaryOpenCap 3 and draining creates a new line C', async () => {
    const world = await open({ backend: 'sqlite', extraHostOptions: { secretaryOpenCap: 2 } });
    const [a, b] = await twoBusySecretaries(world);
    // A owns one pending request and B another: both are busy by ownership, so
    // the third request waits at the cap instead of borrowing either line.
    const firstOwned = expectQueuedAssigned((await world.post('requests/submit', body(submitInput('s6a-h-cap-a')))).body);
    expect(sessionOf(firstOwned['secretary'])).toEqual(a.ref);
    const secondOwned = expectQueuedAssigned((await world.post('requests/submit', body(submitInput('s6a-h-cap-b')))).body);
    expect(sessionOf(secondOwned['secretary'])).toEqual(b.ref);
    const waiting = expectObject((await world.post('requests/submit', body(submitInput('s6a-h-cap-c')))).body);
    expect(waiting['assignment']).toBe('unassigned');
    expect(waiting['waitReason']).toBe('secretary_open_cap');
    const waitingRoot = waiting['requestRoot'] as QueryJobRef;
    const sessionsBefore = await sessionCount(world);
    expect(sessionsBefore).toBe(2);

    await world.reopen({ extraHostOptions: { secretaryOpenCap: 3 } });
    // The pending ownership survives the reopen: both secretaries are still
    // busy, so the raised cap is what lets the drain make a new line.
    const drained = await drain(world);
    expect(drained['progressed']).toBe(1);
    expect(await sessionCount(world)).toBe(sessionsBefore + 1);
    const view = await requestView(world, waitingRoot);
    expect(view.ownerState).toBe('owned');
    expect(view.owner).not.toBeNull();
    expect(view.owner!.sessionId).not.toBe(a.ref.sessionId);
    expect(view.owner!.sessionId).not.toBe(b.ref.sessionId);
    const line = await world.readSession(view.owner!);
    expect(line.record.role).toEqual({ kind: 'legacy_template', templateId: 'platform-secretary',
      templateRevision: 's3.1' });
    expect(line.record.lifecycle).toBe('active');
  });

  it('R-PROFILE SQLite only: a reopen that removes the secretary profile makes forSession and forNewLine null', async () => {
    const world = await open({ backend: 'sqlite', configuration: 'with_secretary' });
    const before = world.platform.secretaryProfiles.forSession({ workspace: S6A_SCOPE, sessionRole: S6A_SECRETARY_ROLE });
    expect(before?.profileId).toBe(S6A_SECRETARY_PROFILE_ID);
    const beforeLine = await world.platform.secretaryProfiles.forNewLine(world.humanContext(), { workspace: S6A_SCOPE });
    expect(beforeLine.status).toBe('ready');
    if (beforeLine.status === 'ready') expect(beforeLine.value?.profileId).toBe(S6A_SECRETARY_PROFILE_ID);

    await world.reopen({ configuration: 'no_secretary' });
    expect(world.platform.secretaryProfiles.forSession({ workspace: S6A_SCOPE, sessionRole: S6A_SECRETARY_ROLE })).toBeNull();
    const afterLine = await world.platform.secretaryProfiles.forNewLine(world.humanContext(), { workspace: S6A_SCOPE });
    expect(afterLine.status).toBe('ready');
    if (afterLine.status === 'ready') expect(afterLine.value).toBeNull();
  });
});

// ------------------------------------------------------------------------- //
// The profile adapter over the published profile list                        //
// ------------------------------------------------------------------------- //

describe.each(['memory', 'sqlite'] as const)('SecretaryProfilePort (%s)', backend => {
  it('R-PROFILE: secretary_first publishes the secretary profile for both reads and null for the plain role', async () => {
    const world = await open({ backend, configuration: 'with_secretary', order: 'secretary_first' });
    const published = await world.readProfiles();
    const secretary = published.find(profile => profile.id === S6A_SECRETARY_PROFILE_ID);
    expect(secretary).toBeDefined();
    const port = world.platform.secretaryProfiles;
    const bySession = port.forSession({ workspace: S6A_SCOPE, sessionRole: secretary!.sessionRole });
    expect(bySession).not.toBeNull();
    expect(bySession!.profileId).toBe(S6A_SECRETARY_PROFILE_ID);
    expect(bySession!.roleBinding).toEqual(secretary!.roleBinding);
    expect(bySession!.runtimeBudget).toEqual(secretary!.runtimeBudget);
    expect(bySession!.budget).toEqual(secretary!.budget);
    expect(bySession!.consumerId).toBe(secretary!.consumerId);
    // L1: forSession is the profile lookup for the Session's own role; a plain
    // role finds its own configured profile. The duty resolver, not this
    // lookup, decides that the Session is not a secretary.
    expect(port.forSession({ workspace: S6A_SCOPE, sessionRole: S6A_PLAIN_ROLE })?.profileId)
      .toBe(S6A_PLAIN_PROFILE_ID);

    const byLine = await port.forNewLine(world.humanContext(), { workspace: S6A_SCOPE });
    expect(byLine.status).toBe('ready');
    if (byLine.status === 'ready') expect(byLine.value?.profileId).toBe(S6A_SECRETARY_PROFILE_ID);
  });

  it('R-PROFILE: plain_first still gives forNewLine the first secretary-duty profile in configuration order', async () => {
    const world = await open({ backend, configuration: 'with_secretary', order: 'plain_first' });
    const published = await world.readProfiles();
    expect(published[0]?.id).toBe(S6A_PLAIN_PROFILE_ID);
    expect(world.platform.secretaryProfiles.forSession({ workspace: S6A_SCOPE, sessionRole: S6A_PLAIN_ROLE })?.profileId)
      .toBe(S6A_PLAIN_PROFILE_ID);
    const byLine = await world.platform.secretaryProfiles.forNewLine(world.humanContext(), { workspace: S6A_SCOPE });
    expect(byLine.status).toBe('ready');
    if (byLine.status === 'ready') expect(byLine.value?.profileId).toBe(S6A_SECRETARY_PROFILE_ID);
  });

  it('R-PROFILE: no_secretary answers null from both methods', async () => {
    const world = await open({ backend, configuration: 'no_secretary' });
    expect(world.platform.secretaryProfiles.forSession({ workspace: S6A_SCOPE, sessionRole: S6A_SECRETARY_ROLE })).toBeNull();
    const byLine = await world.platform.secretaryProfiles.forNewLine(world.humanContext(), { workspace: S6A_SCOPE });
    expect(byLine.status).toBe('ready');
    if (byLine.status === 'ready') expect(byLine.value).toBeNull();
  });
});

// ------------------------------------------------------------------------- //
// Refused input: one error per row, and a public read proves nothing changed //
// ------------------------------------------------------------------------- //

describe.each(['memory', 'sqlite'] as const)('rejects: request routes (%s)', backend => {
  it('select-idea on a pending round is invalid and leaves the request unchanged', async () => {
    const world = await open({ backend });
    await world.createSecretary('a');
    const submitted = expectQueuedAssigned((await world.post('requests/submit', body(submitInput('s6a-r-pending')))).body);
    const root = submitted['requestRoot'] as QueryJobRef;
    const round = submitted['round'] as QueryJobRef;
    const before = await requestView(world, root);
    const sessions = await sessionCount(world);

    const refused = expectObject((await world.post('requests/select-idea',
      body({ commandId: 's6a-r-pending-idea', round, index: 0 }))).body);
    expect(refused).toMatchObject({ status: 'rejected', code: 'invalid' });
    expect(await requestView(world, root)).toEqual(before);
    expect(await sessionCount(world)).toBe(sessions);
  });

  it('select-idea on a plain Query is not_found and leaves the request unchanged', async () => {
    const world = await open({ backend });
    await world.createSecretary('a');
    const submitted = expectQueuedAssigned((await world.post('requests/submit', body(submitInput('s6a-r-plain')))).body);
    const root = submitted['requestRoot'] as QueryJobRef;
    const before = await requestView(world, root);
    const sessions = await sessionCount(world);
    const planning = await world.submitPlanningQuery('s6a-r-plain-query');

    const refused = expectObject((await world.post('requests/select-idea',
      body({ commandId: 's6a-r-plain-idea', round: planning.queryJobRef, index: 0 }))).body);
    expect(refused).toMatchObject({ status: 'rejected', code: 'not_found' });
    expect(await requestView(world, root)).toEqual(before);
    expect(await sessionCount(world)).toBe(sessions);
  });

  it('an empty submit text is invalid and leaves no round or Session behind', async () => {
    const world = await open({ backend });
    const a = await world.createSecretary('a');
    const sessions = await world.listSessions();

    const refused = expectObject((await world.post('requests/submit',
      body(submitInput('s6a-r-empty', { text: '' })))).body);
    expect(refused).toMatchObject({ status: 'rejected', code: 'invalid' });
    await expectNoRequestWritten(world, sessions, a);
  });

  it('a non-object submit body is invalid at the route, before the request owner, and leaves nothing behind', async () => {
    const world = await open({ backend });
    const a = await world.createSecretary('a');
    const sessions = await world.listSessions();

    // The route's own entry check: the counted request port is never entered.
    const { result, calls } = await countedIntake(world, () => world.post('requests/submit', body('not an object')));
    expect(expectObject(result.body)).toMatchObject({ status: 'rejected', code: 'invalid' });
    expect(calls).toBe(0);
    await expectNoRequestWritten(world, sessions, a);
  });
});

/**
 * A refused submit wrote nothing: every Session reads as before, no waiting
 * request is left for the drain, and the only secretary, still idle, takes the
 * next request with no new line (a request written and assigned to it would
 * have made it busy).
 */
async function expectNoRequestWritten(world: S6ARequestWorld, sessions: Awaited<ReturnType<S6ARequestWorld['listSessions']>>,
  secretary: S6ASession): Promise<void> {
  expect(await world.listSessions()).toEqual(sessions);
  const drained = await drain(world);
  expect(drained['progressed']).toBe(0);
  expect(drained['blocked']).toBe(0);
  const next = expectQueuedAssigned((await world.post('requests/submit', body(submitInput('s6a-r-next')))).body);
  expect(next['created']).toBe(false);
  expect(sessionOf(next['secretary'])).toEqual(secretary.ref);
}
