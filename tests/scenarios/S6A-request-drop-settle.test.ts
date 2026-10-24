/**
 * What the store exposes about a request round that never entered the Kernel,
 * through the public `queries/read`: a real drop of a pending round and a real
 * `end_unbound` (the start-up rebuild of a queued round whose secretary lost
 * its profile) each end the round `cancelled` with `dropped` and `no_binding`
 * and leave a settled Run with no execution state; a drop of a claimed, running
 * round does not end it, so the read shows the Run's own execution state and
 * the round still answers. The committed event has no public read; the pure row
 * that pins its literal shape is unchanged.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RequestCoreViewV1 } from '../../src/core/work-graph/model/request-contracts.js';
import { readQuery } from '../helpers/A2-restart-fixture.js';
import { commitBarrier } from '../helpers/S6A-commit-barrier.js';
import { initializeProject, secretaryAnswer } from '../helpers/S6A-history-fixture.js';
import { openS6AHostWorld, type S6AHostWorld } from '../helpers/S6A-host-fixture.js';
import { S6A_GOAL_1, type S6ABackend } from '../helpers/S6A-request-fixture.js';

// The frozen commit barrier (tests/helpers/S6A-commit-barrier.ts): the two mocks every host-world file installs.
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

function remember(world: S6AHostWorld): S6AHostWorld {
  worlds.push(world);
  return world;
}

const BACKENDS: readonly S6ABackend[] = ['memory', 'sqlite'];

describe.each(BACKENDS)('M1R-05: a round that never entered the Kernel (%s)', (backend: S6ABackend) => {
  it('a real drop of a pending round reads settled with no execution state, close reason dropped', async () => {
    const world = remember(await openS6AHostWorld({ backend }));
    await initializeProject(world);
    const b = await world.createSecretary('b');
    // The driver is off: the round stays queued on B, never claimed, so the drop ends it.
    const submitted = await world.submit({ commandId: 's6a-settle-drop-1', goalId: S6A_GOAL_1.goalId,
      text: 'S6A settle dropped request', recipient: b });
    if (submitted.status !== 'queued') throw new Error(`S6A: the drop row's request was not queued: ${JSON.stringify(submitted)}`);
    expect(await world.drop({ commandId: 's6a-settle-drop-2', round: submitted.round })).toMatchObject({ status: 'routed' });

    const read = await readQuery(world.ag2b, submitted.round);
    expect(read.job.job.closeReason).toEqual({ code: 'cancelled', message: expect.any(String), detail: 'dropped' });
    expect(read.run.run).toMatchObject({ status: 'closed', outcome: 'not_entered' });
    expect(read.run.run.endedAt).not.toBeNull();
    // The unstarted end's projection has a settled phase and null execution state; the public read shows that as
    // no execution state at all (the codec writes no field for it), which is the shape a person can see.
    expect(read.run.run.executionState).toBeUndefined();
    // The request read agrees: the round ended, and an ended unstarted round is not processing.
    const view: RequestCoreViewV1 = await world.readRequest(submitted.requestRoot);
    expect(view.rounds.find(round => round.ref.queryJobId === submitted.round.queryJobId))
      .toMatchObject({ status: 'ended', closeCode: 'cancelled', closeDetail: 'dropped', answer: null });
    expect(view.processing).toBe(false);
  }, 120_000);

  it('a drop of a claimed, running round shows the Run’s own state, and the round still answers', async () => {
    const world = remember(await openS6AHostWorld({ backend, extraHostOptions: { requestDriver: 'on' } }));
    await initializeProject(world);
    const a = await world.createSecretary('a');
    const body = 'S6A settle claimed answer';
    await world.scripted.script(a, [{ kind: 'text', text: secretaryAnswer({ body }) }]);
    // The model request is held: the attempt is claimed, prepared and entered, running in the Kernel.
    const running = await world.gates.modelRequest(a);
    const submitted = await world.submit({ commandId: 's6a-settle-claimed-1', goalId: S6A_GOAL_1.goalId,
      text: 'S6A settle claimed request', recipient: a });
    if (submitted.status !== 'queued') throw new Error(`S6A: the claimed row's request was not queued: ${JSON.stringify(submitted)}`);
    await running.reached;

    // The person drops the request: a drop ends only unstarted rounds, so this running attempt keeps its own state.
    expect(await world.drop({ commandId: 's6a-settle-claimed-2', round: submitted.round }))
      .toMatchObject({ status: 'routed' });
    const read = await readQuery(world.ag2b, submitted.round);
    expect(read.job.job.closeReason).toBeNull();
    expect(read.run.run.status).not.toBe('closed');
    const state = read.run.run.executionState;
    if (state === undefined || state === null) throw new Error(`S6A: the running round lost its execution state: ${JSON.stringify(read.run.run)}`);
    expect(state.phase).toBe('entered');
    expect(state.sessionRef).toMatchObject({ projectId: a.ref.projectId, sessionId: a.ref.sessionId });

    running.release();
    const view = await world.waitForRequest(submitted.requestRoot,
      current => current.rounds.some(round => round.ref.queryJobId === submitted.round.queryJobId
        && round.status === 'ended' && round.answer === body),
      'the running round answers after the drop');
    expect(view.rounds.find(round => round.ref.queryJobId === submitted.round.queryJobId))
      .toMatchObject({ kind: 'request', answer: body, closeCode: null });
  }, 120_000);
});

describe('M1R-05 SQLite only: a real end_unbound', () => {
  it('reopening with no secretary profile ends the queued round unbound, settled with no execution state', async () => {
    const world = remember(await openS6AHostWorld({ backend: 'sqlite' }));
    await initializeProject(world);
    const b = await world.createSecretary('b');
    // The first Host has no request driver: the round waits on B, queued and unclaimed.
    const submitted = await world.submit({ commandId: 's6a-settle-unbound-1', goalId: S6A_GOAL_1.goalId,
      text: 'S6A settle unbound request', recipient: b });
    if (submitted.status !== 'queued') throw new Error(`S6A: the unbound row's request was not queued: ${JSON.stringify(submitted)}`);
    expect((await readQuery(world.ag2b, submitted.round)).run.run.executionState).toBeUndefined();

    // The next Host has the driver and no secretary profile: its start-up rebuild finds the round's owner has no
    // profile and ends the round with the internal `end_unbound` command.
    await world.reopen({ configuration: 'no_secretary', extraHostOptions: { requestDriver: 'on' } });
    const view = await world.waitForRequest(submitted.requestRoot,
      current => current.rounds.some(round => round.ref.queryJobId === submitted.round.queryJobId
        && round.status === 'ended'),
      'the start-up rebuild ends the unbound round');
    expect(view.rounds.find(round => round.ref.queryJobId === submitted.round.queryJobId))
      .toMatchObject({ closeCode: 'cancelled', closeDetail: 'no_binding', answer: null });

    const read = await readQuery(world.ag2b, submitted.round);
    expect(read.job.job.closeReason).toEqual({ code: 'cancelled', message: expect.any(String), detail: 'no_binding' });
    expect(read.run.run).toMatchObject({ status: 'closed', outcome: 'not_entered' });
    expect(read.run.run.endedAt).not.toBeNull();
    expect(read.run.run.executionState).toBeUndefined();
  }, 120_000);
});
