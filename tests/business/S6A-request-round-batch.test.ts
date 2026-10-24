/**
 * R-08 (spec §5.2, book §3.6 items 2, 3, 4, 6): the start check's batch.
 *
 * A request with three rounds queued on one secretary (c1 < c2 < c3, each a
 * follow-up on the request's owner and so none of them takes
 * `secretary-intake`): the oldest round executes; when preparation froze its
 * batch with the preparation cursor between c2 and c3, c2 is an extra input of
 * that execution and keeps its own text, the start commit marks it
 * `absorbedInto: <the executing round>` and it reads `ended`, the answer is
 * attached to the executing round, and the read lists c2 below it. One
 * execution round, not two: three rounds take two model runs (c1 with c2
 * batched into it, then c3).
 *
 * The world is the frozen SE2 Host world. The first row runs on memory and
 * SQLite with the request driver on (`extraHostOptions.requestDriver: 'on'`,
 * ruling S16): the person submits, the Host's own loop claims, prepares and
 * starts, and the test only holds two of those commits at the frozen commit
 * barrier to place the two appends around the preparation read. Everything the
 * rows assert is a public read, a receipt or the scripted model's own request.
 *
 * The second half of the row is SQLite only (it restarts the Host): a crash
 * between the start commit and the Kernel entry (gate (d)), so the start-up
 * reconcile finds the `entering` round never entered (QRR-02) and leaves the
 * same Job for a new attempt; the new attempt carries c2, because the executing
 * Job lists the rounds it absorbed, so its one model run has both inputs and
 * the answer lands on the executing round. That world is built with the
 * request driver OFF, so the old Host never claims or runs a round on its own,
 * and the Query steps are the manual public ones (`queries/claim`,
 * `queries/prepare`, `queries/start`). The crash gives the new Host the driver
 * (`crash({ extraHostOptions: { requestDriver: 'on' } })`): the driver OFF in
 * the old Host matters because an abandoned Host keeps its loops, so a Host
 * whose loop was running could still write after the crash.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BootstrapExecutionQueryProfile } from '../../src/app/core-http-types.js';
import type { PreparedQueryExecution } from '../../src/contracts/core/prepared-execution.js';
import type { ReadResult } from '../../src/contracts/core/results.js';
import type { QueryJobRef } from '../../src/contracts/query-job.js';
import type { RequestSubmitResultV1 } from '../../src/business/workflow/request-intake.js';
import type { RequestCoreViewV1 } from '../../src/core/work-graph/model/request-contracts.js';
import type { ModelRequest } from '../../vendor/coding-agent/dist/public-api.js';
import { readQuery } from '../helpers/A2-restart-fixture.js';
import { graphWrite, plain } from '../helpers/AG2b-collaboration-fixture.js';
import { commitBarrier } from '../helpers/S6A-commit-barrier.js';
import { ensureProjectPointers, openS6AHostWorld, type S6AHostWorld } from '../helpers/S6A-host-fixture.js';
import { waitFor } from '../scenarios/harness.js';
import {
  S6A_GOAL_1, S6A_SCOPE, S6A_SECRETARY_PROFILE_ID, type S6ABackend, type S6ASession,
} from '../helpers/S6A-request-fixture.js';

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

function remember(world: S6AHostWorld): S6AHostWorld {
  worlds.push(world);
  return world;
}

const body = (input: unknown): { scope: typeof S6A_SCOPE; input: unknown } => ({ scope: S6A_SCOPE, input });

/** A semantic answer body: the v2 answer format's JSON, as the scripted model writes it. */
const answerText = (text: string): string =>
  JSON.stringify({ schemaVersion: 1, body: text, ideas: [], goalCardDrafts: [] });

function queued(result: RequestSubmitResultV1): { requestRoot: QueryJobRef; round: QueryJobRef } {
  if (result.status !== 'queued') throw new Error(`S6A: the request was not queued: ${JSON.stringify(result)}`);
  return { requestRoot: result.requestRoot, round: result.round };
}

/** The published secretary profile in the shape `queries/claim` takes (a platform-issued value). */
async function profileOf(world: S6AHostWorld): Promise<Record<string, unknown>> {
  const profiles: BootstrapExecutionQueryProfile[] = await world.readProfiles();
  const profile = profiles.find(candidate => candidate.id === S6A_SECRETARY_PROFILE_ID);
  if (profile === undefined) throw new Error('S6A: the secretary profile is not published');
  return { profileId: profile.id, sessionRole: profile.sessionRole, roleBinding: profile.roleBinding,
    runtimeBudget: profile.runtimeBudget, budget: profile.budget, consumerId: profile.consumerId };
}

/** The first user message of one model request the Session's script served. */
async function inputOf(world: S6AHostWorld, session: S6ASession, index = 0): Promise<string> {
  const requests: ModelRequest[] = await world.scripted.requests(session);
  const request = requests[index];
  if (request === undefined) throw new Error(`S6A: the Session served no model request #${index}`);
  // The Kernel session keeps earlier turns as history, so the current input is
  // the LAST user message: the rendered text this run was given.
  const messages = request.messages as unknown as { role: string; content: string }[];
  const last = messages.at(-1);
  if (last === undefined) throw new Error('S6A: the model request carried no message');
  expect(last.role).toBe('user');
  return last.content;
}

/** `queries/claim` of the round's current Run on the Session, pinned at the revisions read now. */
async function claim(world: S6AHostWorld, round: QueryJobRef, session: S6ASession): Promise<void> {
  const { job, run } = await readQuery(world.ag2b, round);
  const card = await world.readSession(session);
  const answer = await world.post('queries/claim', graphWrite(S6A_SCOPE, {
    queryRunRef: run.ref, sessionRef: session.ref, profile: await profileOf(world),
  }, `s6a-batch-claim-${round.queryJobId}`, [
    { ref: job.ref, revision: job.revision }, { ref: run.ref, revision: run.revision },
    { ref: card.record.ref, revision: card.record.revision },
  ]));
  expect(answer.body).toMatchObject({ status: 'committed' });
}

/** The `queries/prepare` step of the claimed round. */
async function prepareStep(world: S6AHostWorld, round: QueryJobRef): Promise<PreparedQueryExecution> {
  const read = (await world.post('queries/prepare', body({
    queryRunRef: (await readQuery(world.ag2b, round)).run.ref, requestId: `s6a-batch-prepare-${round.queryJobId}`,
  }))).body as ReadResult<PreparedQueryExecution>;
  if (read.status !== 'ready') throw new Error(`S6A: the Query was not prepared: ${JSON.stringify(read)}`);
  return read.value;
}

/**
 * `queries/start` of the prepared round, not awaited: with a hold on a step the
 * start commit reaches, the route answers only after the held step goes on.
 */
function start(world: S6AHostWorld, prepared: PreparedQueryExecution, requestId: string): Promise<unknown> {
  return world.post('queries/start', body({ prepared, consumerId: 'ag2b-consumer', requestId }))
    .then(answer => answer.body, () => undefined);
}

describe.each(['memory', 'sqlite'] as const)('R-08, the batch of three queued rounds (%s)', (backend: S6ABackend) => {
  it('absorbs c2 into the oldest round and runs c3 after it: two model runs, not three', async () => {
    const world = remember(await openS6AHostWorld({ backend, extraHostOptions: { requestDriver: 'on' } }));
    await ensureProjectPointers(world);
    const a = await world.createSecretary('a');
    await world.scripted.script(a, [
      { kind: 'text', text: answerText('S6A batch answer one') },
      { kind: 'text', text: answerText('S6A batch answer three') },
    ]);

    // The claim commit is the first step the Host's own loop takes for the
    // submitted round; hold it so c2 can be appended before the preparation
    // read, then hold the prepared commit so c3 lands after it.
    const claimGate = world.gates.beforeClaim(a);
    const first = queued(await world.submit({ commandId: 's6a-batch-1', goalId: S6A_GOAL_1.goalId, text: 'S6A round one' }));
    await claimGate.reached;
    // The claim is held: the round is dispatched and not yet claimed. c2 lands
    // before the preparation read, so it is inside the frozen batch.
    expect(await world.readRequest(first.requestRoot)).toMatchObject({ owner: a.ref, ownerState: 'owned' });
    expect(await world.scripted.requests(a)).toHaveLength(0);
    const second = queued(await world.submit({ commandId: 's6a-batch-2', goalId: null, text: 'S6A round two',
      continues: first.round }));
    expect((await world.readRequest(first.requestRoot)).rounds).toHaveLength(2);

    const preparedGate = world.gates.beforePrepared(a);
    claimGate.release();
    await preparedGate.reached;
    // The preparation read has run: the round is claimed and not yet prepared,
    // and the second round is still pending.
    const frozen = await world.readRequest(first.requestRoot);
    const batchSince = frozen.rounds[1]!.since;
    expect(frozen.rounds.map(round => round.status)).toEqual(['running', 'queued']);
    expect(frozen.rounds[1]!.absorbedInto).toBeNull();

    const third = queued(await world.submit({ commandId: 's6a-batch-3', goalId: null, text: 'S6A round three',
      continues: first.round }));
    preparedGate.release();

    const view = await world.waitForRequest(first.requestRoot,
      current => current.rounds.length === 3 && current.rounds.every(round => round.status === 'ended'),
      'the three rounds ended');
    const [executing, absorbed, last] = view.rounds;
    // The executing round is c1, answered by the first scripted reply.
    expect(executing!.ref).toEqual(first.round);
    expect(executing!).toMatchObject({ kind: 'request', status: 'ended', input: 'S6A round one',
      answer: 'S6A batch answer one', absorbedInto: null, session: a.ref });
    // c2 is absorbed into it, ended, and its own text is unchanged.
    expect(absorbed!.ref).toEqual(second.round);
    expect(absorbed!).toMatchObject({ kind: 'followup', status: 'ended', input: 'S6A round two',
      answer: null, absorbedInto: first.round, closeCode: 'not_entered', session: null });
    // It reads below the executing round, and c3 ran as its own round.
    expect(view.rounds.map(round => round.ref)).toEqual([first.round, second.round, third.round]);
    expect(last!).toMatchObject({ status: 'ended', input: 'S6A round three', answer: 'S6A batch answer three' });

    // One execution round, not two: the batch made c2 an extra input of c1's
    // model run and never a run of its own.
    expect(await world.scripted.requests(a)).toHaveLength(2);
    const batched = await inputOf(world, a, 0);
    expect(batched).toContain(`- [${batchSince}] S6A round two`);
    expect(batched).toContain('S6A round one');
    expect(batched).not.toContain('S6A round three');
    const after = await inputOf(world, a, 1);
    expect(after).toContain('S6A round three');
    expect(after).not.toContain('S6A round two');
  }, 90_000);
});

describe('R-08, a batch across a crash before the Kernel entry (sqlite)', () => {
  it('QRR-02 leaves the same Job for a new attempt that still carries the absorbed round', async () => {
    const world = remember(await openS6AHostWorld({ backend: 'sqlite' }));
    await ensureProjectPointers(world);
    const a = await world.createSecretary('a');
    await world.scripted.script(a, [{ kind: 'text', text: answerText('S6A retried answer') }]);

    const first = queued(await world.submit({ commandId: 's6a-retry-1', goalId: S6A_GOAL_1.goalId, text: 'S6A retry one' }));
    const second = queued(await world.submit({ commandId: 's6a-retry-2', goalId: null, text: 'S6A retry two',
      continues: first.round }));

    // The driver is off: the round waits where `requests/submit` left it, and the
    // test drives the three Query steps through their routes. The Kernel entry is
    // held, so the start commit has landed and the Kernel was never entered.
    const entry = await world.gates.beforeKernel(a);
    await claim(world, first.round, a);
    const prepared = await prepareStep(world, first.round);
    const started = start(world, prepared, 's6a-retry-start');
    await entry.reached;

    const startedView = await world.readRequest(first.requestRoot);
    expect(startedView.rounds.map(round => round.status)).toEqual(['running', 'ended']);
    expect(startedView.rounds[1]).toMatchObject({ ref: second.round, absorbedInto: first.round,
      closeCode: 'not_entered', input: 'S6A retry two' });
    // The absorbed round's order key is what its batch line carries; the retried
    // attempt must present the same round, so the line is this literal.
    const batchSince = startedView.rounds[1]!.since;
    expect(await world.scripted.requests(a)).toHaveLength(0);

    // The crashed attempt is the round's one live attempt: claiming it, not
    // started until the Kernel entry, and no model call was made for it.
    const crashed = await readQuery(world.ag2b, first.round);
    const crashedRun = crashed.run.ref.runId;
    expect(crashed.job.ref).toEqual(first.round);
    expect(crashed.job.job.runRef).toEqual(crashed.run.ref);
    expect(crashed.job.job.status).toBe('running');
    expect(await world.scripted.requests(a)).toHaveLength(0);

    // The crash gives the new Host the driver. Its start-up reconcile settles the
    // never-entered attempt (QRR-02) and leaves the same Job for a new attempt;
    // the driver claims, prepares and starts that new attempt, which runs ONCE
    // because the executing Job still lists the round it absorbed.
    await world.crash({ extraHostOptions: { requestDriver: 'on' } });
    const retried = await waitFor(() => readQuery(world.ag2b, first.round),
      read => read.run.ref.runId !== crashedRun && read.run.run.executionState !== undefined,
      'the new attempt of the same Job');
    // The new attempt is another Run of the same round.
    expect(retried.job.ref).toEqual(first.round);
    expect(retried.job.job.runRef).toEqual(retried.run.ref);
    expect(retried.run.ref.runId).not.toBe(crashedRun);

    // One execution round answers both inputs: the absorbed round keeps its
    // absorption and is an extra input of the retried round's one model run.
    const answered = await world.waitForRequest(first.requestRoot,
      current => current.rounds.every(round => round.status === 'ended'), 'the retried round ends');
    expect(answered.rounds[0]).toMatchObject({ ref: first.round, status: 'ended', input: 'S6A retry one',
      answer: 'S6A retried answer', closeCode: null, closeDetail: null, absorbedInto: null, session: a.ref });
    expect(answered.rounds[1]).toMatchObject({ ref: second.round, status: 'ended', absorbedInto: first.round,
      closeCode: 'not_entered', input: 'S6A retry two', answer: null, session: null });
    expect(await world.scripted.requests(a)).toHaveLength(1);
    const batched = await inputOf(world, a, 0);
    expect(batched).toContain(`- [${batchSince}] S6A retry two`);
    expect(batched).toContain('S6A retry one');
    // The one reply was consumed once: no second model call, no abandoned call.
    expect(await world.scripted.pending(a)).toBe(0);
    expect(world.model.requests).toHaveLength(0);
    expect(world.scripted.abandonedCalls()).toEqual([]);
    void started;
  }, 120_000);
});
