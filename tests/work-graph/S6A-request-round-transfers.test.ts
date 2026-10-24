/**
 * A request round across an ownership transfer and a Host restart (book §5.2's
 * "Execution during a transfer", "A claimed-but-not-started attempt on A and a
 * transfer" and "A profile removed by a Host reopen"; rulings S3, S6, S16).
 *
 * SQLite only: every row reopens the same directory with the request driver
 * switched on (S16), which only a restart can do. The rows build the old
 * Host's state with the driver off, through the public manual steps
 * (`requests/submit`, `queries/claim`, `queries/prepare`, `queries/start`,
 * `requests/route`) and the fixture's gates; the driver never runs a step the
 * test wanted to place itself.
 *
 * - A reopen whose configuration stops publishing the secretary profile ends
 *   the queued round `cancelled`/`no_binding` (the queue's `end_unbound`).
 * - A round entered on A is still finished on A after a restart, while the next
 *   round runs on B: the terminal observation is held at the commit barrier
 *   (the crash fixture's held step), and the restarted Host settles it on the
 *   attempt's own Session through the observation both of its sources share.
 * - A claimed-and-prepared attempt on A whose request moved to B is abandoned
 *   by its own start (`busy`, the owner check), and B runs that round with the
 *   next one in its batch: one model run, none on A.
 *
 * Everything is a public route or read; the barrier only holds a commit the
 * platform prepared and then passes it through unchanged. Nothing is read from
 * a store and no record is written by hand.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PreparedQueryExecution } from '../../src/contracts/core/prepared-execution.js';
import type { ReadResult } from '../../src/contracts/core/results.js';
import type { BootstrapExecutionQueryProfile } from '../../src/app/core-http-types.js';
import type { QueryJobRef } from '../../src/contracts/query-job.js';
import type { RequestCoreViewV1 } from '../../src/core/work-graph/model/request-contracts.js';
import { readQuery } from '../helpers/A2-restart-fixture.js';
import { graphWrite } from '../helpers/AG2b-collaboration-fixture.js';
import { byIdentityPrefix, commitBarrier } from '../helpers/S6A-commit-barrier.js';
import { ensureProjectPointers, openS6AHostWorld, type S6AHostWorld } from '../helpers/S6A-host-fixture.js';
import {
  S6A_GOAL_1, S6A_SCOPE, S6A_SECRETARY_PROFILE_ID, type S6ASession,
} from '../helpers/S6A-request-fixture.js';
import type { RequestSubmitResultV1 } from '../../src/business/workflow/request-intake.js';

vi.mock('../../src/core/record-store/in-memory-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-commit-barrier.js')).inMemoryBarrierModule(importOriginal));
vi.mock('../../src/core/record-store/sqlite-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-commit-barrier.js')).sqliteBarrierModule(importOriginal));

const worlds: S6AHostWorld[] = [];

afterEach(async () => {
  const left = commitBarrier.reset();
  await Promise.all(worlds.splice(0).map(world => world.close()));
  expect(left).toEqual([]);
});

/** The v1 semantic answer a request round accepts: no ideas, no goal drafts. */
const semanticAnswer = (body: string): string =>
  JSON.stringify({ schemaVersion: 1, body, ideas: [], goalCardDrafts: [] });

function ready<T>(value: unknown): T {
  const result = value as ReadResult<T>;
  if (result.status !== 'ready') throw new Error(`the read was not ready: ${JSON.stringify(value)}`);
  return result.value;
}

/** One round of a request read by its ref; a missing round fails the row. */
function roundOf(view: RequestCoreViewV1, ref: QueryJobRef): RequestCoreViewV1['rounds'][number] {
  const found = view.rounds.find(round => round.ref.queryJobId === ref.queryJobId);
  if (found === undefined) throw new Error(`S6A: the request read has no round ${ref.queryJobId}`);
  return found;
}

/** The queued submit's refs; a rejection is a failed row, never a null. */
function queued(result: RequestSubmitResultV1): { requestRoot: QueryJobRef; round: QueryJobRef } {
  if (result.status !== 'queued') throw new Error(`the request was not queued: ${JSON.stringify(result)}`);
  return { requestRoot: result.requestRoot, round: result.round };
}

/** The published secretary profile as the claim takes it (`SecretaryProfileV1`). */
async function profileOf(world: S6AHostWorld): Promise<Record<string, unknown>> {
  const profiles: BootstrapExecutionQueryProfile[] = await world.readProfiles();
  const profile = profiles.find(candidate => candidate.id === S6A_SECRETARY_PROFILE_ID);
  if (profile === undefined) throw new Error('S6A: the secretary profile is not published');
  return { profileId: profile.id, sessionRole: profile.sessionRole, roleBinding: profile.roleBinding,
    runtimeBudget: profile.runtimeBudget, budget: profile.budget, consumerId: profile.consumerId };
}

/** `queries/claim` of the round's current Run on the Session, pinned at the revisions read now. */
async function claim(world: S6AHostWorld, round: QueryJobRef, session: S6ASession): Promise<void> {
  const { job, run } = await readQuery(world.ag2b, round);
  const card = await world.readSession(session);
  const answer = await world.post('queries/claim', graphWrite(S6A_SCOPE, {
    queryRunRef: run.ref, sessionRef: session.ref, profile: await profileOf(world),
  }, `s6a-transfer-claim-${round.queryJobId}`, [
    { ref: job.ref, revision: job.revision }, { ref: run.ref, revision: run.revision },
    { ref: card.record.ref, revision: card.record.revision },
  ]));
  expect(answer.body).toMatchObject({ status: 'committed' });
}

/** `queries/prepare` of the claimed round. */
async function prepare(world: S6AHostWorld, round: QueryJobRef): Promise<PreparedQueryExecution> {
  const read = await world.post('queries/prepare', { scope: S6A_SCOPE, input: {
    queryRunRef: (await readQuery(world.ag2b, round)).run.ref,
    requestId: `s6a-transfer-prepare-${round.queryJobId}`,
  } });
  return ready<PreparedQueryExecution>(read.body);
}

/** `queries/start` of the prepared round, answering the route's own body. */
async function start(world: S6AHostWorld, prepared: PreparedQueryExecution, requestId: string): Promise<unknown> {
  return (await world.post('queries/start', { scope: S6A_SCOPE, input: {
    prepared, consumerId: 'ag2b-consumer', requestId,
  } })).body;
}

describe('a profile removed by a Host reopen (sqlite)', () => {
  it('ends the queued round cancelled with detail no_binding', async () => {
    const world = await openS6AHostWorld({ backend: 'sqlite' });
    worlds.push(world);
    const a = await world.createSecretary('a');
    // A reply queued for A would be consumed if anything dispatched the round.
    await world.scripted.script(a, [{ kind: 'text', text: semanticAnswer('S6A answer nobody asks for') }]);
    const submitted = queued(await world.submit({ commandId: 's6a-transfer-a-1', goalId: S6A_GOAL_1.goalId,
      text: 'S6A round whose secretary loses its profile' }));

    // The round waits on A: nobody claimed it, and no Host will while the driver is off.
    const waiting = await world.readRequest(submitted.requestRoot);
    expect(waiting).toMatchObject({ owner: a.ref, ownerState: 'owned', processing: true });
    expect(waiting.rounds).toMatchObject([{ ref: submitted.round, status: 'queued', session: null,
      assignedSession: a.ref, closeCode: null, closeDetail: null, answer: null }]);

    // The reopened Host publishes the plain profile only, and drives requests itself on start.
    await world.setResumeOnStartup(true);
    await world.reopen({ configuration: 'no_secretary', extraHostOptions: { requestDriver: 'on' } });
    expect((await world.readProfiles()).map(profile => profile.id)).toEqual(['s6a-plain-profile']);

    const ended = await world.waitForRequest(submitted.requestRoot,
      current => current.rounds[0]?.status === 'ended', 'the queued round ends after the reopen');
    // The round ends unstarted: the Job closes `cancelled` with the binding detail,
    // the QueryRun closes `not_entered`, and no Answer is written.
    expect(ended.rounds).toMatchObject([{
      ref: submitted.round, status: 'ended', closeCode: 'cancelled', closeDetail: 'no_binding',
      answer: null, session: null, assignedSession: a.ref, absorbedInto: null,
    }]);
    expect(ended.owner).toEqual(a.ref);
    expect(ended.ownerState).toBe('owned');
    expect(ended.processing).toBe(false);
    expect(await world.scripted.requests(a)).toEqual([]);
    expect(await world.scripted.pending(a)).toBe(1);
  }, 60_000);
});

describe('execution during a transfer (sqlite)', () => {
  it('finishes the entered round on A after a restart and runs the next round on B', async () => {
    // The old Host's state is built with the driver off: only the manual Query steps
    // and the commit barrier place the round, so no driver observes it away.
    const world = await openS6AHostWorld({ backend: 'sqlite' });
    worlds.push(world);
    await ensureProjectPointers(world);
    const a = await world.createSecretary('a');
    await world.scripted.script(a, [{ kind: 'text', text: semanticAnswer('S6A answer on A') }]);
    const submitted = queued(await world.submit({ commandId: 's6a-transfer-b-1', goalId: S6A_GOAL_1.goalId,
      text: 'S6A round entered on A' }));
    await claim(world, submitted.round, a);
    const prepared = await prepare(world, submitted.round);

    // The terminal observation is the held step: the Kernel turn finishes on A, its
    // commit never reaches the store, and the Host is abandoned with it held.
    const run = (await readQuery(world.ag2b, submitted.round)).run;
    const terminal = commitBarrier.hold(byIdentityPrefix(`r5b-query-execution:observed:${run.ref.runId}:`),
      'terminal observation on A');
    const starting = start(world, prepared, 's6a-transfer-b-start');
    await terminal.reached;

    // The round is entered on A; the request moves to B while it runs.
    const b = await world.createSecretary('b');
    expect(await world.route({ commandId: 's6a-transfer-b-route', round: submitted.round, to: b }))
      .toMatchObject({ status: 'routed' });
    const moved = await world.readRequest(submitted.requestRoot);
    expect(moved).toMatchObject({ owner: b.ref });
    expect(roundOf(moved, submitted.round))
      .toMatchObject({ status: 'running', session: a.ref, assignedSession: a.ref, closeCode: null });

    // The restarted Host's driver starts armed and observes the live attempt where it
    // already is: on its own Session A, whoever owns the request now.
    await world.setResumeOnStartup(true);
    await world.crash({ extraHostOptions: { requestDriver: 'on' } });
    const finished = await world.waitForRequest(submitted.requestRoot,
      current => roundOf(current, submitted.round).status === 'ended'
        && roundOf(current, submitted.round).answer !== null,
      'the entered round is observed and finished on A');
    expect(roundOf(finished, submitted.round)).toMatchObject({ status: 'ended', answer: 'S6A answer on A',
      session: a.ref, assignedSession: a.ref, closeCode: null, closeDetail: null });
    expect(finished.owner).toEqual(b.ref);

    // The next round is the follow-up, queued on the new owner B; the submit's wake
    // arms the restarted Host's queue, and B runs it.
    await world.scripted.script(b, [{ kind: 'text', text: semanticAnswer('S6A answer on B') }]);
    const second = queued(await world.submit({ commandId: 's6a-transfer-b-2', goalId: S6A_GOAL_1.goalId,
      text: 'S6A next round on B', continues: submitted.round }));
    const both = await world.waitForRequest(submitted.requestRoot,
      current => roundOf(current, second.round).status === 'ended' && roundOf(current, second.round).answer !== null,
      'the next round runs on B');
    expect(roundOf(both, second.round)).toMatchObject({ status: 'ended', answer: 'S6A answer on B',
      session: b.ref, assignedSession: b.ref });
    expect(roundOf(both, submitted.round)).toMatchObject({ answer: 'S6A answer on A', session: a.ref });
    expect(await world.scripted.requests(a)).toHaveLength(1);
    expect(await world.scripted.requests(b)).toHaveLength(1);
    terminal.release();
    await starting;
  }, 60_000);
});

describe('a claimed-but-not-started attempt on A and a transfer (sqlite)', () => {
  it('abandons A\'s start and runs the round once on B with the next round in its batch', async () => {
    const world = await openS6AHostWorld({ backend: 'sqlite' });
    worlds.push(world);
    await ensureProjectPointers(world);
    const a = await world.createSecretary('a');
    // A reply queued for A would be consumed only if A's attempt ever ran.
    await world.scripted.script(a, [{ kind: 'text', text: semanticAnswer('S6A answer on A') }]);
    const submitted = queued(await world.submit({ commandId: 's6a-transfer-c-1', goalId: S6A_GOAL_1.goalId,
      text: 'S6A round claimed on A' }));
    await claim(world, submitted.round, a);
    const prepared = await prepare(world, submitted.round);

    // The transfer to B, and a second round of the same request, in that order.
    const b = await world.createSecretary('b');
    await world.scripted.script(b, [{ kind: 'text', text: semanticAnswer('S6A answer on B') }]);
    expect(await world.route({ commandId: 's6a-transfer-c-route', round: submitted.round, to: b }))
      .toMatchObject({ status: 'routed' });
    const second = queued(await world.submit({ commandId: 's6a-transfer-c-2', goalId: S6A_GOAL_1.goalId,
      text: 'S6A batched round', continues: submitted.round }));

    // A's start finds another owner: the attempt is abandoned, the round waits for
    // a new attempt, and A's occupancy is released.
    expect(await start(world, prepared, 's6a-transfer-c-start')).toMatchObject({ status: 'rejected', code: 'busy' });
    const waiting = await world.readRequest(submitted.requestRoot);
    const waitingRounds = waiting.rounds.filter(round => round.kind !== 'routing');
    expect(waitingRounds.map(round => [round.status, round.session, round.closeCode]))
      .toEqual([['queued', null, null], ['queued', null, null]]);
    expect(waitingRounds[1]?.ref).toEqual(second.round);
    expect(waiting.owner).toEqual(b.ref);

    // The reopened Host drives requests itself: B claims round 1 and prepares it with
    // round 2 after the cursor, so the model runs once for the batch.
    await world.setResumeOnStartup(true);
    await world.reopen({ extraHostOptions: { requestDriver: 'on' } });
    const both = await world.waitForRequest(submitted.requestRoot,
      current => current.rounds.filter(round => round.kind !== 'routing')
        .every(round => round.status === 'ended'),
      'B runs round 1 with round 2 in its batch');
    const batched = both.rounds.filter(round => round.kind !== 'routing');
    expect(batched[0]).toMatchObject({ ref: submitted.round, status: 'ended', session: b.ref,
      answer: 'S6A answer on B' });
    expect(batched[1]).toMatchObject({ ref: second.round, status: 'ended', absorbedInto: submitted.round,
      answer: null });
    // One model run on B; A never ran (its scripted reply is still queued) and no
    // abandoned Host started a call.
    expect(await world.scripted.requests(b)).toHaveLength(1);
    expect(await world.scripted.pending(b)).toBe(0);
    expect(await world.scripted.requests(a)).toHaveLength(0);
    expect(await world.scripted.pending(a)).toBe(1);
    expect(world.scripted.abandonedCalls()).toEqual([]);
  }, 60_000);
});
