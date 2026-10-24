/**
 * Slice 6A-1 joint scenario (SE1, book §5.2's 6A-1 rows; book §3.5, §3.6.7):
 * one request's whole life through the frozen world's public routes, on memory
 * and SQLite.
 *
 * The path is the person's: `requests/submit` on goal 1 (picked secretary A),
 * a follow-up that queues on A, `requests/route` to B, `requests/route` drop,
 * a new submit that must reach A again (so the drop released the intakes). The
 * refusals in that last state (an idempotency conflict, and the
 * `requests/select-idea` refusals that need no answer) are one row each in the
 * `rejects:` block, each proving through public reads that nothing changed.
 * Every check reads the platform's public owner read `requestFacts.readRequest`
 * or a route; no record is written by hand and no store is read. Expected values
 * are hand-computed from the request rules: a root submit assigns, a
 * follow-up on the owner takes no pick, a manual route from `owned` takes no
 * intake, a drop ends every unstarted round `cancelled`/`dropped`, and a replay
 * returns the stored receipt.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { SessionCard } from '../../src/app/core-http-types.js';
import type { SessionRef } from '../../src/contracts/core/identity.js';
import type { QueryJobRef } from '../../src/contracts/query-job.js';
import type { RequestCoreViewV1 } from '../../src/core/work-graph/model/request-contracts.js';
import {
  openS6ARequestWorld, S6A_GOAL_1, S6A_SCOPE,
  type S6ABackend, type S6ARequestWorld, type S6ASession,
} from '../helpers/S6A-request-fixture.js';

const worlds: S6ARequestWorld[] = [];

async function open(backend: S6ABackend): Promise<S6ARequestWorld> {
  const world = await openS6ARequestWorld({ backend });
  worlds.push(world);
  return world;
}

afterEach(async () => {
  const openWorlds = worlds.splice(0);
  await Promise.all(openWorlds.map(world => world.close()));
});

const body = (input: unknown): { scope: typeof S6A_SCOPE; input: unknown } => ({ scope: S6A_SCOPE, input });

const submitInput = (commandId: string, overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  commandId, goalId: S6A_GOAL_1.goalId, text: `S6A lifecycle ${commandId}`, continues: null, recipient: null, ...overrides,
});

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};

function expectObject(value: unknown): Record<string, unknown> {
  return asRecord(value);
}

async function requestView(world: S6ARequestWorld, root: QueryJobRef): Promise<RequestCoreViewV1> {
  const read = await world.platform.requestFacts.readRequest(world.humanContext(), { requestRoot: root });
  if (read.status !== 'ready') throw new Error(`S6A: the request read is not ready: ${JSON.stringify(read)}`);
  return read.value;
}

function sessionOf(value: unknown): SessionRef {
  return expectObject(value) as unknown as SessionRef;
}

async function sessionCount(world: S6ARequestWorld): Promise<number> {
  return (await world.listSessions()).length;
}

/** A cursor every round view carries: the codec's `c` + ten digits (book §3.12, check 3 A2). */
function expectCursor(value: unknown): void {
  expect(typeof value).toBe('string');
  expect(value).toMatch(/^c\d{10}$/);
}

async function twoIdleSecretaries(world: S6ARequestWorld): Promise<{ a: S6ASession; b: S6ASession }> {
  // Creation order is the later-activity key's input (§3.4.2 key 3): A is
  // created last, so a free pick reads A first and B is only the route target.
  const b = await world.createSecretary('b', { at: '2026-10-23T09:01:00.000Z' });
  const a = await world.createSecretary('a', { at: '2026-10-23T09:02:00.000Z' });
  return { a, b };
}

describe.each(['memory', 'sqlite'] as const)('SE1 request lifecycle (%s)', backend => {
  it('submit → follow-up on A → route B → drop → a new submit reaches A; replays and select-idea refusals', async () => {
    const world = await open(backend);
    const { a, b } = await twoIdleSecretaries(world);

    // 1. The root submit on goal 1: the free pick is A (later activity).
    const submitted = expectObject((await world.post('requests/submit', body(submitInput('s6a-life-1')))).body);
    expect(submitted).toMatchObject({ status: 'queued', assignment: 'assigned', created: false, waitReason: null });
    expect(sessionOf(submitted['secretary'])).toEqual(a.ref);
    const root = submitted['requestRoot'] as QueryJobRef;
    const rootRound = submitted['round'] as QueryJobRef;

    let view = await requestView(world, root);
    expect(view).toMatchObject({
      goalId: S6A_GOAL_1.goalId, effectiveGoalId: S6A_GOAL_1.goalId, owner: a.ref, ownerState: 'owned',
      assignment: 'assigned', waitReason: null, processing: true, reasons: ['round'], candidate: null,
    });
    expect(view.rounds).toHaveLength(1);
    expect(view.rounds[0]).toMatchObject({
      ref: rootRound, kind: 'request', status: 'queued', input: 'S6A lifecycle s6a-life-1',
      assignedSession: a.ref, closeCode: null, closeDetail: null,
    });
    expectCursor(view.rounds[0]!.since);

    // 2. The follow-up continues the round and lands on its owner with no pick
    //    and no second line (`created: false`, the same secretary).
    const follow = expectObject((await world.post('requests/submit',
      body(submitInput('s6a-life-2', { continues: rootRound, goalId: null })))).body);
    expect(follow).toMatchObject({ status: 'queued', assignment: 'assigned', created: false, waitReason: null });
    expect(sessionOf(follow['secretary'])).toEqual(a.ref);
    view = await requestView(world, root);
    expect(view.owner).toEqual(a.ref);
    expect(view.goalId).toBe(S6A_GOAL_1.goalId);
    expect(view.rounds.map(round => round.kind)).toEqual(['request', 'followup']);
    expect(view.rounds[1]).toMatchObject({ ref: follow['round'], status: 'queued', assignedSession: a.ref });

    // 3. The person routes the request to B. From `owned` the manual route
    //    takes no intake; the owner moves and one routing round is written.
    const routed = expectObject((await world.post('requests/route', body({
      commandId: 's6a-life-route-b', round: follow['round'], to: b.ref, reason: 'manual',
    }))).body);
    expect(routed['status']).toBe('routed');
    view = await requestView(world, root);
    expect(view.owner).toEqual(b.ref);
    expect(view.ownerState).toBe('owned');
    expect(view.rounds).toHaveLength(3);
    expect(view.rounds[2]!.kind).toBe('routing');
    expect(view.rounds[2]!.ref).toEqual(routed['routingRound']);

    // 4. The drop ends every round that has not entered: the root, the
    //    follow-up and the manual routing round all close `cancelled`/`dropped`.
    const dropped = expectObject((await world.post('requests/route', body({
      commandId: 's6a-life-drop', round: follow['round'], to: null, reason: 'dropped',
    }))).body);
    expect(dropped['status']).toBe('routed');
    view = await requestView(world, root);
    expect(view).toMatchObject({ owner: null, ownerState: 'dropped', assignment: 'unassigned', waitReason: null,
      processing: false, reasons: [] });
    // The two request rounds that had not entered close cancelled/dropped; the
    // routing rounds were born terminal (`not_entered`, book §3.12).
    const requestRounds = view.rounds.filter(round => round.kind !== 'routing');
    expect(requestRounds).toHaveLength(2);
    for (const round of requestRounds) {
      expect(round.status).toBe('ended');
      expect(round.closeCode).toBe('cancelled');
      expect(round.closeDetail).toBe('dropped');
    }
    expect(view.rounds.filter(round => round.kind === 'routing')).toHaveLength(2);
    for (const round of view.rounds.filter(round => round.kind === 'routing')) {
      expect(round.status).toBe('ended');
      expect(round.closeCode).toBe('not_entered');
      expect(round.closeDetail).toBeNull();
      expect(round.assignedSession).toBeNull();
    }

    // 5. The drop released A's intake: a new request free-picks A again
    //    instead of conflicting and re-picking B.
    const afterDrop = expectObject((await world.post('requests/submit',
      body(submitInput('s6a-life-after-drop')))).body);
    expect(afterDrop).toMatchObject({ status: 'queued', assignment: 'assigned', created: false });
    expect(sessionOf(afterDrop['secretary'])).toEqual(a.ref);
    const afterRoot = afterDrop['requestRoot'] as QueryJobRef;
    expect(await sessionCount(world)).toBe(2);

    // 6. Replaying the submit returns the stored receipt and writes nothing:
    //    same body, same one round, no extra Session.
    const replay = expectObject((await world.post('requests/submit',
      body(submitInput('s6a-life-after-drop')))).body);
    expect(replay).toEqual(afterDrop);
    expect((await requestView(world, afterRoot)).rounds).toHaveLength(1);
  });
});

/** The lifecycle's last state, reached through the same routes. */
type AfterDrop = {
  world: S6ARequestWorld;
  a: S6ASession;
  b: S6ASession;
  /** The request that was routed to B and then dropped. */
  droppedRoot: QueryJobRef;
  /** The new request after the drop, owned by A, with one pending round. */
  afterRoot: QueryJobRef;
  afterRound: QueryJobRef;
};

/** submit (A) → follow-up → manual route to B → drop → a new submit, which reaches A again. */
async function throughDrop(backend: S6ABackend): Promise<AfterDrop> {
  const world = await open(backend);
  const { a, b } = await twoIdleSecretaries(world);
  const post = async (suffix: string, input: unknown) => expectObject((await world.post(suffix, body(input))).body);
  const first = await post('requests/submit', submitInput('s6a-rej-1'));
  const follow = await post('requests/submit', submitInput('s6a-rej-2', { continues: first['round'], goalId: null }));
  expect(await post('requests/route', { commandId: 's6a-rej-route-b', round: follow['round'], to: b.ref, reason: 'manual' }))
    .toMatchObject({ status: 'routed' });
  expect(await post('requests/route', { commandId: 's6a-rej-drop', round: follow['round'], to: null, reason: 'dropped' }))
    .toMatchObject({ status: 'routed' });
  const after = await post('requests/submit', submitInput('s6a-rej-after-drop'));
  expect(after).toMatchObject({ status: 'queued', assignment: 'assigned', created: false });
  expect(sessionOf(after['secretary'])).toEqual(a.ref);
  return { world, a, b, droppedRoot: first['requestRoot'] as QueryJobRef,
    afterRoot: after['requestRoot'] as QueryJobRef, afterRound: after['round'] as QueryJobRef };
}

type PublicState = { dropped: RequestCoreViewV1; after: RequestCoreViewV1; sessions: SessionCard[] };

async function publicState(state: AfterDrop): Promise<PublicState> {
  return {
    dropped: await requestView(state.world, state.droppedRoot),
    after: await requestView(state.world, state.afterRoot),
    sessions: await state.world.listSessions(),
  };
}

/**
 * Nothing changed: both requests and every Session read as before, and B (the
 * only idle secretary) still takes a new request with no new line, so the
 * refusal wrote no request that holds B or a new line.
 */
async function expectUnchanged(state: AfterDrop, before: PublicState): Promise<void> {
  expect(await publicState(state)).toEqual(before);
  const next = expectObject((await state.world.post('requests/submit', body(submitInput('s6a-rej-next')))).body);
  expect(next).toMatchObject({ status: 'queued', assignment: 'assigned', created: false });
  expect(sessionOf(next['secretary'])).toEqual(state.b.ref);
}

describe.each(['memory', 'sqlite'] as const)('rejects: request commands after the drop (%s)', backend => {
  it('the same commandId with another text is idempotency_conflict and changes nothing', async () => {
    const state = await throughDrop(backend);
    const before = await publicState(state);
    const conflict = expectObject((await state.world.post('requests/submit',
      body(submitInput('s6a-rej-after-drop', { text: 'S6A a different question' })))).body);
    expect(conflict).toMatchObject({ status: 'rejected', code: 'idempotency_conflict' });
    await expectUnchanged(state, before);
  });

  it('select-idea on a round that has no answer yet is invalid and changes nothing', async () => {
    const state = await throughDrop(backend);
    const before = await publicState(state);
    const refused = expectObject((await state.world.post('requests/select-idea', body({
      commandId: 's6a-rej-idea-pending', round: state.afterRound, index: 0,
    }))).body);
    expect(refused).toMatchObject({ status: 'rejected', code: 'invalid' });
    await expectUnchanged(state, before);
  });

  it('select-idea on a plain Query is not_found and changes nothing', async () => {
    const state = await throughDrop(backend);
    const planning = await state.world.submitPlanningQuery('s6a-rej-idea-plain');
    const before = await publicState(state);
    const refused = expectObject((await state.world.post('requests/select-idea', body({
      commandId: 's6a-rej-idea-plain', round: planning.queryJobRef, index: 0,
    }))).body);
    expect(refused).toMatchObject({ status: 'rejected', code: 'not_found' });
    await expectUnchanged(state, before);
  });
});
