/**
 * Passes of the `request-rounds` handler over the records the public steps
 * wrote, with the real stage driver.
 *
 * - A live attempt moves on the Session that holds it; while it is live the
 *   request gets no second attempt, whichever Session owns the request now.
 * - A traversal longer than one pass: the fresh rounds found by the first
 *   pass wait in the continuation until the traversal is complete, then each
 *   Session gets its oldest round, oldest first, and the next traversal gives
 *   the remaining ones; none is lost between the passes.
 * - The advance cap: the live attempts past REQUEST_ADVANCES_PER_PASS (50) are
 *   carried, the next pass launches them before any new traversal, and only
 *   then does the traversal wrap.
 * - A round chosen from an earlier pass's read starts only while its request,
 *   read again, still offers it on the same owner. A request dropped or moved
 *   between the passes makes the traversal start again, so the Sessions it
 *   names get their rounds from the new read: a dropped request gives way to
 *   its owner's next one, and a moved one runs on its new owner with that
 *   owner's profile.
 *
 * The world is the SE2 Host world with the request driver OFF, so nothing runs
 * on its own: the rows place attempts through the public Query routes and the
 * fixture's holds, and drive each pass by hand through `drain` with the
 * continuation the previous pass returned. The handler is built over the
 * world's published owners. Its stage driver is the real
 * `createQueryStageDriver` behind one A3 wrapper that records each advance's
 * input and returns the real outcome unchanged; the rounds it starts are
 * answered by the replies scripted for their Sessions. `settle()` is the
 * completion barrier of the advances a pass launched.
 *
 * The traversal rows narrow each open-rounds read to one request root per page
 * (only the page size changes; the read's own result passes through), so six
 * requests take more than the REQUEST_PASS_PAGES (5) pages one pass may read.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PreparedQueryExecution } from '../../src/contracts/core/prepared-execution.js';
import type { ReadResult } from '../../src/contracts/core/results.js';
import type { QueryJobRef } from '../../src/contracts/query-job.js';
import type { RequestSubmitResultV1 } from '../../src/business/workflow/request-intake.js';
import {
  createRequestRoundQueues, type RequestQueuePassV1,
} from '../../src/business/workflow/request-round-queue.js';
import {
  createQueryStageDriver, type QueryStageAdvanceInput, type QueryStageDriver,
} from '../../src/business/workflow/query-stage-driver.js';
import { readQuery } from '../helpers/A2-restart-fixture.js';
import { commitBarrier } from '../helpers/S6A-commit-barrier.js';
import { claimWithSecretaryProfile } from '../helpers/request-claim-steps.js';
import { ensureProjectPointers, openS6AHostWorld, type S6AHostWorld } from '../helpers/S6A-host-fixture.js';
import { S6A_GOAL_1, S6A_SCOPE, type S6ABackend, type S6ASession } from '../helpers/S6A-request-fixture.js';

// The frozen commit barrier (tests/helpers/S6A-commit-barrier.ts): the two
// `vi.mock`s every host-world file that uses the fixture's gates installs.
vi.mock('../../src/core/record-store/in-memory-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-commit-barrier.js')).inMemoryBarrierModule(importOriginal));
vi.mock('../../src/core/record-store/sqlite-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-commit-barrier.js')).sqliteBarrierModule(importOriginal));

const worlds: S6AHostWorld[] = [];

afterEach(async () => {
  // Release anything still held before the worlds close (a held commit keeps a
  // tracked call open), then report what was left.
  const left = commitBarrier.reset();
  const open = worlds.splice(0);
  await Promise.allSettled(open.map(world => world.close()));
  expect(left).toEqual([]);
});

function queued(result: RequestSubmitResultV1): { requestRoot: QueryJobRef; round: QueryJobRef } {
  if (result.status !== 'queued') throw new Error(`S6A: the request was not queued: ${JSON.stringify(result)}`);
  return { requestRoot: result.requestRoot, round: result.round };
}

const body = (input: unknown): { scope: typeof S6A_SCOPE; input: unknown } => ({ scope: S6A_SCOPE, input });

/** A semantic answer body: the v1 answer format's JSON, as the scripted model writes it. */
const answerText = (text: string): string =>
  JSON.stringify({ schemaVersion: 1, body: text, ideas: [], goalCardDrafts: [] });

/** The `queries/prepare` step of the claimed round. */
async function prepareStep(world: S6AHostWorld, round: QueryJobRef): Promise<PreparedQueryExecution> {
  const read = (await world.post('queries/prepare', body({
    queryRunRef: (await readQuery(world.ag2b, round)).run.ref, requestId: `s6a-dispatch-prepare-${round.queryJobId}`,
  }))).body as ReadResult<PreparedQueryExecution>;
  if (read.status !== 'ready') throw new Error(`S6A: the Query was not prepared: ${JSON.stringify(read)}`);
  return read.value;
}

/**
 * `queries/start` of the prepared round, not awaited: the held Kernel entry
 * keeps the route pending until the row releases it.
 */
function start(world: S6AHostWorld, prepared: PreparedQueryExecution, requestId: string): Promise<unknown> {
  return world.post('queries/start', body({ prepared, consumerId: 'ag2b-consumer', requestId }))
    .then(answer => answer.body, () => undefined);
}

/**
 * The real stage driver over the world's current platform behind one A3
 * wrapper: it records each advance's input, calls the real `advance` and
 * returns that call's own promise unchanged, which it also keeps in
 * `advances` so a row can wait for the advances a pass launched. The driver
 * is built per call, so after a reopen it is the new Host's owners that move
 * the attempt.
 */
function forwardingDriver(world: S6AHostWorld): {
  driver: QueryStageDriver; calls: QueryStageAdvanceInput[]; advances: Promise<unknown>[];
} {
  const calls: QueryStageAdvanceInput[] = [];
  const advances: Promise<unknown>[] = [];
  return {
    calls,
    advances,
    driver: {
      advance(ctx, input) {
        calls.push(structuredClone(input));
        const advanced = createQueryStageDriver({
          queries: world.platform.queries, runtime: world.platform.runtime, facts: world.platform.requestFacts,
        }).advance(ctx, input);
        advances.push(advanced);
        return advanced;
      },
    },
  };
}

/**
 * The two real queue handlers over the world's CURRENT published owners: each
 * port call reaches the live Host's owner and returns its result unchanged, so
 * a handler outlives a reopen. `rootsPerPage` narrows each open-rounds read to
 * that many request roots (the page size only).
 */
function queuesOf(world: S6AHostWorld, driver: QueryStageDriver, rootsPerPage?: number) {
  return createRequestRoundQueues({
    rounds: {
      open: (ctx, scope, input) => world.platform.requestRounds.open(ctx, scope,
        rootsPerPage === undefined ? input : { ...input, limit: rootsPerPage }),
      append: (ctx, input) => world.platform.requestRounds.append(ctx, input),
    },
    facts: {
      readFacts: (ctx, input) => world.platform.requestFacts.readFacts(ctx, input),
      readRequest: (ctx, input) => world.platform.requestFacts.readRequest(ctx, input),
      ownerOf: (ctx, input) => world.platform.requestFacts.ownerOf(ctx, input),
      effectiveGoalOf: (ctx, input) => world.platform.requestFacts.effectiveGoalOf(ctx, input),
    },
    sessions: { readSessionFacts: (ctx, session) => world.platform.sessionFacts.readSessionFacts(ctx, session) },
    profiles: { forSession: input => world.platform.secretaryProfiles.forSession(input) },
    drain: (ctx, scope, input) => world.platform.requestIntake.drainUnassigned(ctx, scope, input),
    driver,
    context: (_scope, signal) => ({ ...world.systemContext(), signal }),
    wake: () => undefined,
  });
}

/** One pass's input: the continuation the previous pass returned, and a signal nobody aborts. */
const passInput = (continuation: string | null) =>
  ({ maxItems: 1, continuation, signal: new AbortController().signal });

/** A pass's result without its frozen continuation. */
const outcomeOf = (pass: RequestQueuePassV1) =>
  ({ progressed: pass.progressed, more: pass.more, wrapped: pass.wrapped, blocked: pass.blocked });

/** The request's first non-routing round as `requests/read` shows it. */
async function firstRoundOf(world: S6AHostWorld, requestRoot: QueryJobRef) {
  return (await world.readRequest(requestRoot)).rounds.filter(round => round.kind !== 'routing')[0];
}

describe.each(['memory', 'sqlite'] as const)('the request-rounds pass over a live attempt (%s)',
  (backend: S6ABackend) => {
    it('moves the held attempt on its own Session and opens no second attempt for the request', async () => {
      const world = await openS6AHostWorld({ backend });
      worlds.push(world);
      await ensureProjectPointers(world);
      const a = await world.createSecretary('a');
      await world.scripted.script(a, [{ kind: 'text', text: answerText('S6A live answer') }]);
      const submitted = queued(await world.submit({ commandId: 's6a-dispatch-1', goalId: S6A_GOAL_1.goalId,
        text: 'S6A live round' }));

      // The claim and the preparation through their routes, then the start; the
      // Kernel entry is held, so the attempt is live and no model call was made.
      expect(await claimWithSecretaryProfile(world, submitted.round, a, 's6a-dispatch-claim'))
        .toMatchObject({ status: 'committed' });
      const prepared = await prepareStep(world, submitted.round);
      const entry = await world.gates.beforeKernel(a);
      const starting = start(world, prepared, 's6a-dispatch-start');
      await entry.reached;
      // The start commit landed and the Kernel was never entered: the attempt is
      // live (the phase carries it) and the round reads running.
      expect((await readQuery(world.ag2b, submitted.round)).run.run.executionState?.phase).toBe('entering');
      expect(await world.scripted.requests(a)).toHaveLength(0);

      // The request moves to B, and its next round waits on the new owner.
      const b = await world.createSecretary('b');
      expect(await world.route({ commandId: 's6a-dispatch-route', round: submitted.round, to: b }))
        .toMatchObject({ status: 'routed' });
      const followUp = queued(await world.submit({ commandId: 's6a-dispatch-2', goalId: null,
        text: 'S6A next round', continues: submitted.round }));
      const view = await world.readRequest(submitted.requestRoot);
      expect(view.owner).toEqual(b.ref);
      expect(view.rounds.filter(round => round.kind !== 'routing').map(round => round.status))
        .toEqual(['running', 'queued']);

      // One pass: the live attempt moves, on its own Session, with the profile
      // its claim froze; B's fresh round waits for the request to have no live
      // attempt, so the request never runs twice.
      const forwarding = forwardingDriver(world);
      const handlers = queuesOf(world, forwarding.driver);
      const pass = await handlers.rounds.drain(S6A_SCOPE, passInput(null));
      await handlers.settle();
      expect(forwarding.calls.map(call => call.queryJobRef)).toEqual([submitted.round]);
      expect(forwarding.calls[0]?.profile).toBeNull();
      expect(pass.blocked).toBe(0);
      expect(followUp.round).not.toEqual(submitted.round);

      entry.release();
      await starting;
    }, 60_000);

    it('carries the rounds of a traversal longer than one pass and dispatches the oldest round of each Session first',
      async () => {
        const world = await openS6AHostWorld({ backend });
        worlds.push(world);
        await ensureProjectPointers(world);
        const lines: S6ASession[] = [];
        for (const label of ['a', 'b', 'c', 'd', 'e', 'f']) lines.push(await world.createSecretary(label));
        const [a, b, c, d, e, f] = lines as [S6ASession, S6ASession, S6ASession, S6ASession, S6ASession, S6ASession];
        // Six requests in this order, each naming its own secretary, so each takes that line's intake.
        const requests: { requestRoot: QueryJobRef; round: QueryJobRef }[] = [];
        for (const [index, line] of lines.entries()) {
          requests.push(queued(await world.submit({ commandId: `s6a-pages-${index + 1}`, goalId: S6A_GOAL_1.goalId,
            text: `S6A pages request ${index + 1}`, recipient: line })));
        }
        const [r1, r2, r3, r4, r5, r6] = requests as [typeof requests[number], typeof requests[number],
          typeof requests[number], typeof requests[number], typeof requests[number], typeof requests[number]];
        // An owned request moves without an intake: A now owns r1 and r4, B owns r2 and r5.
        expect(await world.route({ commandId: 's6a-pages-route-4', round: r4.round, to: a }))
          .toMatchObject({ status: 'routed' });
        expect(await world.route({ commandId: 's6a-pages-route-5', round: r5.round, to: b }))
          .toMatchObject({ status: 'routed' });
        await world.scripted.script(a, [{ kind: 'text', text: answerText('S6A A first') },
          { kind: 'text', text: answerText('S6A A second') }]);
        await world.scripted.script(b, [{ kind: 'text', text: answerText('S6A B first') },
          { kind: 'text', text: answerText('S6A B second') }]);
        await world.scripted.script(c, [{ kind: 'text', text: answerText('S6A C only') }]);
        await world.scripted.script(f, [{ kind: 'text', text: answerText('S6A F only') }]);

        const forwarding = forwardingDriver(world);
        const first = queuesOf(world, forwarding.driver, 1);
        // Pass 1 reads five one-root pages (r1..r5); r6 is not read yet, so no
        // round is chosen and nothing is launched.
        const pass1 = await first.rounds.drain(S6A_SCOPE, passInput(null));
        expect(outcomeOf(pass1)).toEqual({ progressed: 0, more: true, wrapped: false, blocked: 0 });
        expect(forwarding.calls).toEqual([]);
        // Pass 2 reads r6 and the empty page that wraps: the traversal is complete,
        // and each Session's oldest round starts, oldest first, with the profile.
        const pass2 = await first.rounds.drain(S6A_SCOPE, passInput(pass1.continuation));
        expect(outcomeOf(pass2)).toEqual({ progressed: 0, more: false, wrapped: true, blocked: 0 });
        expect(forwarding.calls.map(call => call.queryJobRef)).toEqual([r1.round, r2.round, r3.round, r6.round]);
        expect(forwarding.calls.map(call => call.profile?.profileId)).toEqual([
          's6a-secretary-profile', 's6a-secretary-profile', 's6a-secretary-profile', 's6a-secretary-profile']);
        await first.settle();

        // The next traversal reads what is left: A's and B's second requests.
        const second = queuesOf(world, forwarding.driver, 1);
        const pass3 = await second.rounds.drain(S6A_SCOPE, passInput(null));
        expect(outcomeOf(pass3)).toEqual({ progressed: 0, more: false, wrapped: true, blocked: 0 });
        expect(forwarding.calls.slice(4).map(call => call.queryJobRef)).toEqual([r4.round, r5.round]);
        await second.settle();

        // Every request ran once, on its owner, A and B their older request first.
        const expected: [typeof r1, S6ASession, string][] = [
          [r1, a, 'S6A A first'], [r2, b, 'S6A B first'], [r3, c, 'S6A C only'],
          [r4, a, 'S6A A second'], [r5, b, 'S6A B second'], [r6, f, 'S6A F only'],
        ];
        for (const [request, line, answer] of expected) {
          expect(await firstRoundOf(world, request.requestRoot)).toMatchObject({
            ref: request.round, status: 'ended', answer, session: line.ref,
          });
        }
        expect(await world.scripted.requests(a)).toHaveLength(2);
        expect(await world.scripted.requests(b)).toHaveLength(2);
        expect(await world.scripted.requests(d)).toHaveLength(0);
        expect(await world.scripted.requests(e)).toHaveLength(0);
      }, 120_000);

    it('carries the live attempts past the advance cap and launches them on the next pass', async () => {
      const world = await openS6AHostWorld({ backend });
      worlds.push(world);
      await ensureProjectPointers(world);
      // 51 lines, each with one claimed request round: 51 live attempts, one more
      // than a pass may launch (REQUEST_ADVANCES_PER_PASS is 50).
      const attempts: { line: S6ASession; requestRoot: QueryJobRef; round: QueryJobRef }[] = [];
      for (let index = 1; index <= 51; index += 1) {
        const line = await world.createSecretary(`cap-${index}`);
        await world.scripted.script(line, [{ kind: 'text', text: answerText(`S6A cap answer ${index}`) }]);
        const submitted = queued(await world.submit({ commandId: `s6a-cap-${index}`, goalId: S6A_GOAL_1.goalId,
          text: `S6A cap request ${index}`, recipient: line }));
        expect(await claimWithSecretaryProfile(world, submitted.round, line, `s6a-cap-claim-${index}`))
          .toMatchObject({ status: 'committed' });
        attempts.push({ line, ...submitted });
      }

      const forwarding = forwardingDriver(world);
      const handlers = queuesOf(world, forwarding.driver);
      // One page holds all 51 roots, so pass 1 reads the whole traversal. It
      // launches the first 50 attempts, each on its own Session with the profile
      // its claim froze, and carries the 51st instead of wrapping.
      const pass1 = await handlers.rounds.drain(S6A_SCOPE, passInput(null));
      expect(outcomeOf(pass1)).toEqual({ progressed: 0, more: true, wrapped: false, blocked: 0 });
      expect(forwarding.calls.map(call => call.queryJobRef)).toEqual(attempts.slice(0, 50).map(attempt => attempt.round));
      expect(forwarding.calls.map(call => call.profile)).toEqual(new Array(50).fill(null));
      // The 50 launched advances settle first (their own promises are the
      // barrier), so the next pass reads the carried attempt's request while
      // nothing else commits.
      await Promise.allSettled(forwarding.advances);
      // Pass 2 reads no page: it launches the carried attempt, and only then wraps.
      const pass2 = await handlers.rounds.drain(S6A_SCOPE, passInput(pass1.continuation));
      expect(outcomeOf(pass2)).toEqual({ progressed: 0, more: false, wrapped: true, blocked: 0 });
      expect(forwarding.calls.slice(50).map(call => call.queryJobRef)).toEqual([attempts[50]!.round]);
      expect(forwarding.calls[50]?.profile).toBeNull();
      await handlers.settle();

      // The carried attempt ran once, on its own line, to the answer scripted for it.
      const carried = attempts[50]!;
      expect(await firstRoundOf(world, carried.requestRoot)).toMatchObject({
        ref: carried.round, status: 'ended', answer: 'S6A cap answer 51', session: carried.line.ref,
      });
      expect(await world.scripted.requests(carried.line)).toHaveLength(1);
    }, 180_000);

    it('reads the traversal again when the round chosen for a Session is dropped between two passes',
      async () => {
        const world = await openS6AHostWorld({ backend });
        worlds.push(world);
        await ensureProjectPointers(world);
        const lines: S6ASession[] = [];
        for (const label of ['a', 'b', 'c', 'd', 'e', 'f']) lines.push(await world.createSecretary(label));
        const a = lines[0]!;
        // Six requests in this order, each naming its own secretary; then the other
        // five move to A by manual routes (an owned request moves without an
        // intake), so A owns all six.
        const requests: { requestRoot: QueryJobRef; round: QueryJobRef }[] = [];
        for (const [index, line] of lines.entries()) {
          requests.push(queued(await world.submit({ commandId: `s6a-stale-${index + 1}`, goalId: S6A_GOAL_1.goalId,
            text: `S6A stale request ${index + 1}`, recipient: line })));
        }
        for (const [index, request] of requests.slice(1).entries()) {
          expect(await world.route({ commandId: `s6a-stale-route-${index + 2}`, round: request.round, to: a }))
            .toMatchObject({ status: 'routed' });
        }
        const [r1, r2] = requests as [typeof requests[number], typeof requests[number]];
        await world.scripted.script(a, [{ kind: 'text', text: answerText('S6A A answers r2') }]);

        const forwarding = forwardingDriver(world);
        const handlers = queuesOf(world, forwarding.driver, 1);
        // Pass 1 reads r1..r5, one root per page: A's oldest round so far is r1's.
        const pass1 = await handlers.rounds.drain(S6A_SCOPE, passInput(null));
        expect(outcomeOf(pass1)).toEqual({ progressed: 0, more: true, wrapped: false, blocked: 0 });
        // The person drops r1 between the passes; that commit's wake is the one
        // that brings pass 2.
        expect(await world.drop({ commandId: 's6a-stale-drop', round: r1.round })).toMatchObject({ status: 'routed' });
        // Pass 2 reads r6 and the page that wraps. A's choice is r1's round, which
        // its request no longer offers: nothing starts on A, and the traversal is
        // read again instead of wrapping, since no later wake would bring A's
        // other five requests back.
        const pass2 = await handlers.rounds.drain(S6A_SCOPE, passInput(pass1.continuation));
        expect(outcomeOf(pass2)).toEqual({ progressed: 0, more: true, wrapped: false, blocked: 0 });
        expect(forwarding.calls).toEqual([]);
        // The new traversal: pass 3 reads r2..r6, pass 4 the page that wraps. A's
        // oldest round is now r2's, and it starts with the secretary profile.
        const pass3 = await handlers.rounds.drain(S6A_SCOPE, passInput(pass2.continuation));
        expect(outcomeOf(pass3)).toEqual({ progressed: 0, more: true, wrapped: false, blocked: 0 });
        expect(forwarding.calls).toEqual([]);
        const pass4 = await handlers.rounds.drain(S6A_SCOPE, passInput(pass3.continuation));
        expect(outcomeOf(pass4)).toEqual({ progressed: 0, more: false, wrapped: true, blocked: 0 });
        expect(forwarding.calls.map(call => call.queryJobRef)).toEqual([r2.round]);
        expect(forwarding.calls[0]?.profile?.profileId).toBe('s6a-secretary-profile');
        await handlers.settle();

        expect(await firstRoundOf(world, r2.requestRoot)).toMatchObject({
          ref: r2.round, status: 'ended', answer: 'S6A A answers r2', session: a.ref,
        });
        expect((await world.readRequest(r1.requestRoot)).ownerState).toBe('dropped');
        for (const request of requests.slice(2)) {
          expect(await firstRoundOf(world, request.requestRoot)).toMatchObject({ ref: request.round, status: 'queued' });
        }
        expect(await world.scripted.requests(a)).toHaveLength(1);
      }, 120_000);
  });

describe('the request-rounds pass across a reopen (sqlite)', () => {
  it('reads the traversal again when a carried round\'s request moved, and starts it on its new owner', async () => {
    // A reopen is the fixture's one way to take a secretary's profile away, so
    // the row is SQLite only.
    const world = await openS6AHostWorld({ backend: 'sqlite' });
    worlds.push(world);
    await ensureProjectPointers(world);
    const lines: S6ASession[] = [];
    for (const label of ['a', 'b', 'c', 'd', 'e', 'f']) lines.push(await world.createSecretary(label));
    const [a, b, c, d, e, f] = lines as [S6ASession, S6ASession, S6ASession, S6ASession, S6ASession, S6ASession];
    // X goes to A first; five more requests, one per line, make the traversal
    // longer than one pass.
    const x = queued(await world.submit({ commandId: 's6a-carried-x', goalId: S6A_GOAL_1.goalId,
      text: 'S6A carried request', recipient: a }));
    const others: { requestRoot: QueryJobRef; round: QueryJobRef }[] = [];
    for (const [index, line] of [b, c, d, e, f].entries()) {
      others.push(queued(await world.submit({ commandId: `s6a-carried-${index + 1}`, goalId: S6A_GOAL_1.goalId,
        text: `S6A carried filler ${index + 1}`, recipient: line })));
    }
    const [y1, y2, y3, y4, y5] = others as [typeof x, typeof x, typeof x, typeof x, typeof x];

    // The reopened Host publishes the plain profile only: A, the owner the
    // first pass reads for X, has no profile then.
    await world.reopen({ configuration: 'no_secretary' });
    expect((await world.readProfiles()).map(profile => profile.id)).toEqual(['s6a-plain-profile']);
    const forwarding = forwardingDriver(world);
    const handlers = queuesOf(world, forwarding.driver, 1);
    const pass1 = await handlers.rounds.drain(S6A_SCOPE, passInput(null));
    expect(outcomeOf(pass1)).toEqual({ progressed: 0, more: true, wrapped: false, blocked: 0 });
    expect(forwarding.calls).toEqual([]);

    // Between the two passes the profile is published again, X moves to B
    // (whose own request is newer), and A becomes busy with a plain Query.
    await world.reopen({ configuration: 'with_secretary' });
    expect(await world.route({ commandId: 's6a-carried-route', round: x.round, to: b }))
      .toMatchObject({ status: 'routed' });
    await world.occupy(a);
    await world.scripted.script(b, [{ kind: 'text', text: answerText('S6A B answers the carried request') }]);
    await world.scripted.script(c, [{ kind: 'text', text: answerText('S6A C filler') }]);
    await world.scripted.script(d, [{ kind: 'text', text: answerText('S6A D filler') }]);
    await world.scripted.script(e, [{ kind: 'text', text: answerText('S6A E filler') }]);
    await world.scripted.script(f, [{ kind: 'text', text: answerText('S6A F filler') }]);

    // Pass 2 completes the traversal. A's choice, X, is B's request now, so the
    // choices of A and B were made from facts that no longer hold: neither
    // starts, the other lines start their own, and the traversal is read again
    // instead of wrapping.
    const pass2 = await handlers.rounds.drain(S6A_SCOPE, passInput(pass1.continuation));
    expect(outcomeOf(pass2)).toEqual({ progressed: 0, more: true, wrapped: false, blocked: 0 });
    expect(forwarding.calls.map(call => call.queryJobRef)).toEqual([y2.round, y3.round, y4.round, y5.round]);
    await handlers.settle();

    // The new traversal reads X and B's own request, both B's now: X, the older,
    // starts on B with the secretary profile, and B's own waits behind it.
    const again = queuesOf(world, forwarding.driver, 1);
    const pass3 = await again.rounds.drain(S6A_SCOPE, passInput(pass2.continuation));
    expect(outcomeOf(pass3)).toEqual({ progressed: 0, more: false, wrapped: true, blocked: 0 });
    expect(forwarding.calls.slice(4).map(call => call.queryJobRef)).toEqual([x.round]);
    expect(forwarding.calls[4]?.profile?.profileId).toBe('s6a-secretary-profile');
    await again.settle();

    expect(await firstRoundOf(world, x.requestRoot)).toMatchObject({
      ref: x.round, status: 'ended', answer: 'S6A B answers the carried request', session: b.ref,
      closeCode: null, closeDetail: null,
    });
    expect(await firstRoundOf(world, y1.requestRoot)).toMatchObject({ ref: y1.round, status: 'queued', session: null });
    expect(await world.scripted.requests(a)).toHaveLength(0);
    expect(await world.scripted.requests(b)).toHaveLength(1);
  }, 120_000);
});
