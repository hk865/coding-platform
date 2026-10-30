/**
 * A drop over an `entering` round, and the new round after the restart: the
 * row runs on SQLite because it restarts the Host on the same directory.
 *
 * The old Host is opened without the request driver (`requestDriver` off), so
 * its rounds wait where the commands leave them: the person submits to A, the
 * Query steps go through their public routes (`queries/claim` with the
 * published secretary profile, `queries/prepare`, `queries/start`), and the
 * start is held at the Kernel entry (gate (d): the start commit landed and the
 * Kernel was never entered). The request is dropped, and a new round is sent
 * to B. `crash({ extraHostOptions: { requestDriver: 'on' } })` gives the new
 * Host the driver: its start-up reconcile closes the never-entered round
 * `cancelled`/`dropped` (QRR-02) and the driver runs the new round on B once —
 * one model request, its answer on that round — while A's Session gets none.
 *
 * The world is built with the driver off because an abandoned Host keeps its
 * loops; a Host whose loop was running could still write after the crash.
 * Every step is a public route, the fixture's gate or its crash. Expected
 * values are the scripted reply and the row's literals.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PreparedQueryExecution } from '../../src/contracts/core/prepared-execution.js';
import type { QueryJobRef } from '../../src/contracts/query-job.js';
import type { RequestCoreViewV1 } from '../../src/core/work-graph/model/request-contracts.js';
import type { ModelRequest } from '../../vendor/coding-agent/dist/public-api.js';
import { readQuery } from '../helpers/A2-restart-fixture.js';
import { plain } from '../helpers/AG2b-collaboration-fixture.js';
import { claimWithSecretaryProfile, prepareAttempt } from '../helpers/request-claim-steps.js';
import { commitBarrier } from '../helpers/S6A-commit-barrier.js';
import { openS6AHostWorld, type S6AHostWorld } from '../helpers/S6A-host-fixture.js';
import { initializeProject, secretaryAnswer, submitRound } from '../helpers/S6A-history-fixture.js';
import { S6A_GOAL_1, S6A_SCOPE, type S6ASession } from '../helpers/S6A-request-fixture.js';

// The frozen commit barrier the fixture's gates use; the test file owns its two mocks.
vi.mock('../../src/core/record-store/in-memory-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-commit-barrier.js')).inMemoryBarrierModule(importOriginal));
vi.mock('../../src/core/record-store/sqlite-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-commit-barrier.js')).sqliteBarrierModule(importOriginal));

const worlds: S6AHostWorld[] = [];

afterEach(async () => {
  const left = commitBarrier.reset();
  const open = worlds.splice(0);
  await Promise.allSettled(open.map(world => world.close()));
  expect(left).toEqual([]);
});

/** `queries/start` of the prepared round, not awaited: a held Kernel entry answers only after its release. */
function start(world: S6AHostWorld, prepared: PreparedQueryExecution, requestId: string): Promise<unknown> {
  return world.post('queries/start', plain(S6A_SCOPE, { prepared, consumerId: 'ag2b-consumer', requestId }))
    .then(answer => answer.body, () => undefined);
}

/** Claimed with the published secretary profile and prepared on the Session. */
async function claimAndPrepare(world: S6AHostWorld, round: QueryJobRef, session: S6ASession,
  label: string): Promise<PreparedQueryExecution> {
  expect(await claimWithSecretaryProfile(world, round, session, `${label}-claim`)).toMatchObject({ status: 'committed' });
  return await prepareAttempt(world, round, `${label}-prepare`);
}

/** The round the read lists, or a failed row. */
function roundOf(view: RequestCoreViewV1, round: QueryJobRef): RequestCoreViewV1['rounds'][number] {
  const found = view.rounds.find(candidate => candidate.ref.queryJobId === round.queryJobId);
  if (found === undefined) throw new Error(`S6A: the request does not list the round ${round.queryJobId}`);
  return found;
}

/** The last user message of a Session's model request: the rendered input that run was given. */
function currentInputOf(requests: readonly ModelRequest[]): string {
  const last = (requests.at(-1)?.messages as unknown as { role: string; content: string }[]).at(-1);
  if (last === undefined || last.role !== 'user') throw new Error('S6A: no current user message');
  return last.content;
}

describe('a drop over an entering round, then the new round runs (sqlite)', () => {
  it('QRR-02 closes round 1 cancelled/dropped and the new round on B runs once; A makes no model request', async () => {
    const world = await openS6AHostWorld({ backend: 'sqlite' });
    worlds.push(world);
    await initializeProject(world);
    const b = await world.createSecretary('b');
    const a = await world.createSecretary('a');
    const first = await submitRound(world, { commandId: 's6a-restart-1', goalId: S6A_GOAL_1.goalId,
      text: 'S6A restart first input', recipient: a });
    const prepared = await claimAndPrepare(world, first.round, a, 's6a-restart');
    const kernel = await world.gates.beforeKernel(a);
    void start(world, prepared, 's6a-restart-start');
    await kernel.reached;
    expect((await readQuery(world.ag2b, first.round)).run.run.executionState?.phase).toBe('entering');
    expect(await world.drop({ commandId: 's6a-restart-drop', round: first.round })).toMatchObject({ status: 'routed' });
    // The drop leaves the entering round to finish; the new round goes to B.
    expect(roundOf(await world.readRequest(first.requestRoot), first.round)).toMatchObject({ status: 'running' });
    const next = await submitRound(world, { commandId: 's6a-restart-2', goalId: S6A_GOAL_1.goalId,
      text: 'S6A restart after the drop', continues: first.requestRoot, recipient: b });

    // The new Host's driver claims, prepares and starts the new round on B;
    // the start-up reconcile closes the never-entered round on A.
    const answer = secretaryAnswer({ body: 'S6A restart answer on B' });
    await world.scripted.script(b, [{ kind: 'text', text: answer }]);
    await world.crash({ extraHostOptions: { requestDriver: 'on' } });
    const view = await world.waitForRequest(first.requestRoot,
      current => roundOf(current, first.round).status === 'ended'
        && roundOf(current, next.round).status === 'ended'
        && roundOf(current, next.round).answer !== null,
      'the restart closes round 1 and the new round runs on B');

    expect(roundOf(view, first.round)).toMatchObject({
      status: 'ended', closeCode: 'cancelled', closeDetail: 'dropped', assignedSession: a.ref, session: a.ref,
    });
    expect(roundOf(view, next.round)).toMatchObject({
      status: 'ended', closeCode: null, closeDetail: null, session: b.ref, answer: 'S6A restart answer on B',
    });
    expect(view.owner).toEqual(b.ref);
    // The old attempt is a closed not-entered Run and A holds nothing.
    expect((await readQuery(world.ag2b, first.round)).run.run).toMatchObject({ status: 'closed', outcome: 'not_entered' });
    expect((await world.readSession(a)).record.occupancy).toBeNull();

    // One model request on B; A's Session served none, and the refused attempt
    // of the new round is the only one that ran.
    const onB = await world.scripted.requests(b);
    expect(onB).toHaveLength(1);
    expect(await world.scripted.requests(a)).toEqual([]);
    expect(await world.scripted.pending(b)).toBe(0);
    expect(world.scripted.abandonedCalls()).toEqual([]);
    expect(world.model.calls()).toBe(0);
    // The dropped round is not an earlier input of B's round.
    expect(currentInputOf(onB)).toContain('S6A restart after the drop');
    expect(currentInputOf(onB)).not.toContain('S6A restart first input');
  }, 120_000);
});
