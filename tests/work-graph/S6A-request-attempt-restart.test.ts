/**
 * QRR-01 on a claimed request round after a crash and restart (SQLite, the SE2
 * world): the start-up reconcile proves the round never entered the Kernel and,
 * since no drop covers it, leaves it pending for a new attempt on the same Job:
 * the Job points at a new pending Run, the secretary's occupancy is released,
 * the reconcile commit records one event per QueryRun it writes (the new
 * pending Run first, created with no execution state, then the old Run, whose
 * event carries the commit's result and so is the one a replay of the
 * receipt reads), and a second restart makes no second attempt.
 *
 * The request owner mints its Run ids itself (the Host passes no id source to
 * it), so the old Run id is not a fixed literal; the rows compare the attempt
 * read after each restart with the one read before it. The new id's rule (the
 * old id and the trigger) is checked with literal ids in the pure rows.
 *
 * Every step is a public route or the fixture's crash; the reconcile commit is
 * observed at the store seam (the frozen commit barrier passes it through
 * unchanged); nothing is read from the store and no record is written by hand.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readQuery } from '../helpers/A2-restart-fixture.js';
import { claimWithSecretaryProfile } from '../helpers/request-claim-steps.js';
import { byIdentityPrefix, commitBarrier } from '../helpers/S6A-commit-barrier.js';
import { submitRound } from '../helpers/S6A-history-fixture.js';
import { openS6AHostWorld, type S6AHostWorld } from '../helpers/S6A-host-fixture.js';
import { S6A_GOAL_1 } from '../helpers/S6A-request-fixture.js';

vi.mock('../../src/core/record-store/in-memory-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-commit-barrier.js')).inMemoryBarrierModule(importOriginal));
vi.mock('../../src/core/record-store/sqlite-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-commit-barrier.js')).sqliteBarrierModule(importOriginal));

const worlds: S6AHostWorld[] = [];

afterEach(async () => {
  const left = commitBarrier.reset();
  const openWorlds = worlds.splice(0);
  await Promise.all(openWorlds.map(world => world.close()));
  expect(left).toEqual([]);
});

describe('a request round not entered at a restart (sqlite)', () => {
  it('QRR-01: a new attempt on the same Job, its events, the occupancy released, one attempt per replay', async () => {
    const world = await openS6AHostWorld({ backend: 'sqlite' });
    worlds.push(world);
    const a = await world.createSecretary('a');
    const submitted = await submitRound(world, { commandId: 's6a-attempt-1', goalId: S6A_GOAL_1.goalId, text: 'S6A attempt 1' });
    const round = submitted.round;
    expect(await claimWithSecretaryProfile(world, round, a, 's6a-attempt-claim')).toMatchObject({ status: 'committed' });
    const claimed = await readQuery(world.ag2b, round);
    expect(claimed.run.run.executionState?.phase).toBe('claimed');

    // The start-up reconcile's commit for this Run, let through as it arrives.
    const reconcile = commitBarrier.hold(byIdentityPrefix(`a2-query-recovery:${claimed.run.ref.runId}:`), 'reconcile');
    reconcile.release();
    await world.crash();
    const view = await world.waitForRequest(submitted.requestRoot, current => current.rounds[0]?.status === 'queued',
      'the reconcile leaves the round queued');
    expect(view.rounds[0]).toMatchObject({ ref: round, status: 'queued', session: null, closeCode: null, assignedSession: a.ref });
    const retried = await readQuery(world.ag2b, round);
    expect(retried.job.job.status).toBe('pending');
    expect(retried.run.ref).toEqual({ ...claimed.run.ref, runId: retried.run.ref.runId });
    expect(retried.run.ref.runId).not.toBe(claimed.run.ref.runId);
    expect(retried.job.job.runRef).toEqual(retried.run.ref);
    expect(retried.run).toMatchObject({ revision: 1, run: { status: 'pending', outcome: null, startedAt: null, endedAt: null } });
    expect(retried.run.run.executionState).toBeUndefined();
    expect((await world.readSession(a)).record.occupancy).toBeNull();

    const events = (await reconcile.reached).events.map(event => JSON.parse(event.json) as {
      eventType: string; aggregateId: string; aggregateRevision: number;
      payload: { phase: string; executionState: unknown; result: unknown } });
    expect(events.map(event => [event.eventType, event.aggregateId, event.payload.phase])).toEqual([
      ['QueryExecutionRecorded', retried.run.ref.runId, 'pending'],
      ['QueryExecutionRecorded', claimed.run.ref.runId, 'settled'],
    ]);
    expect(events[0]).toMatchObject({ aggregateRevision: 1, payload: { executionState: null, result: retried.run } });

    await world.crash();
    const replayed = await readQuery(world.ag2b, round);
    expect(replayed.job).toEqual(retried.job);
    expect(replayed.run).toEqual(retried.run);
    expect((await world.readRequest(submitted.requestRoot)).rounds.map(entry => entry.status)).toEqual(['queued']);
  });
});
