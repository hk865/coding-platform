/**
 * `G3-reactivate` (book :2026, `:254`, `:676`; PS-10): archive → restart → `sessions/reactivate`. The archive
 * released the holder; the reactivation re-admits in one commit and adds one holder at that commit's cursor, with no
 * reservation. At the cap it answers `capacity/at_cap` and writes nothing. Both backends run; only SQLite takes the
 * restart between the release and the re-enable. The holder read is D2's deferred `role-lines/allocation` (W), and the
 * cap interleave uses W's `projects/role-limits/set`.
 * Named mutation (not run here): drop the reactivation's limits guard, so a cap lowered after the read still admits.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { graphWrite } from '../helpers/AG2b-collaboration-fixture.js';
import { asRecord } from '../helpers/S6A-host-fixture.js';
import { S6A_SCOPE, type S6ABackend, type S6ASession } from '../helpers/S6A-request-fixture.js';
import { byIdentityPrefix, commitBarrier } from '../helpers/S6A-commit-barrier.js';
import {
  openS7D1AllocationWorld, type S7D1AllocationWorld,
} from '../helpers/S7D1-allocation-world.js';

vi.mock('../../src/core/record-store/in-memory-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-commit-barrier.js')).inMemoryBarrierModule(importOriginal));
vi.mock('../../src/core/record-store/sqlite-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-commit-barrier.js')).sqliteBarrierModule(importOriginal));

const BACKENDS = ['memory', 'sqlite'] as const satisfies readonly S6ABackend[];
const worlds: S7D1AllocationWorld[] = [];

async function openAllocationWorld(backend: S6ABackend): Promise<S7D1AllocationWorld> {
  const world = await openS7D1AllocationWorld({ backend });
  worlds.push(world);
  return world;
}

afterEach(async () => {
  const left = commitBarrier.reset();
  await Promise.allSettled(worlds.splice(0).map(world => world.close()));
  expect(left).toEqual([]);
});

async function archive(world: S7D1AllocationWorld, label: string, session: S6ASession) {
  const card = await world.world.readSession(session.ref);
  const body = asRecord((await world.world.post('sessions/archive', graphWrite(S6A_SCOPE,
    { sessionRef: session.ref, reason: `S7D1 archive ${label}` }, `s7d1-archive-${label}`,
    [{ ref: card.record.ref, revision: card.record.revision }]))).body);
  expect(body).toMatchObject({ status: 'committed' });
  return body;
}

async function reactivate(world: S7D1AllocationWorld, label: string, session: S6ASession) {
  const card = await world.world.readSession(session.ref);
  return asRecord((await world.world.post('sessions/reactivate', graphWrite(S6A_SCOPE,
    { sessionRef: session.ref, reason: `S7D1 reactivate ${label}` }, `s7d1-reactivate-${label}`,
    [{ ref: card.record.ref, revision: card.record.revision }]))).body);
}

describe.each(BACKENDS)('G3-reactivate on the real %s Host', (backend: S6ABackend) => {
  it('one holder is added at the reactivation commit’s cursor and takes no reservation', async () => {
    const world = await openAllocationWorld(backend);
    const created = await world.createLine({ label: 'reactivate' });
    expect(created.session).not.toBeNull();
    await archive(world, 'reactivate', created.session!);
    if (backend === 'sqlite') await world.restart();
    const body = await reactivate(world, 'reactivate', created.session!);
    expect(body).toMatchObject({ status: 'committed' });
    const cursor = body['cursor'] as string;
    expect((await world.world.readSession(created.session!.ref)).record.lifecycle).toBe('active');

    const report = await world.allocation();
    expect(report.duties.secretary.holders).toHaveLength(1);
    expect(report.duties.secretary.holders[0]).toMatchObject({ session: created.session!.ref, since: cursor });
    expect(report.duties.secretary.reservations).toEqual([]);
  }, 240_000);

  it('at the cap the reactivation answers capacity/at_cap and writes nothing', async () => {
    const world = await openAllocationWorld(backend);
    const first = await world.createLine({ label: 'reactivate-cap-1' });
    for (let index = 2; index <= 8; index += 1) {
      expect((await world.createLine({ label: `reactivate-cap-${String(index)}` })).answer.body)
        .toMatchObject({ status: 'completed' });
    }
    await archive(world, 'reactivate-cap-1', first.session!);
    expect((await world.createLine({ label: 'reactivate-cap-refill' })).answer.body)
      .toMatchObject({ status: 'completed' });
    if (backend === 'sqlite') await world.restart();
    const before = await world.allocation();
    expect(before.duties.secretary.holders).toHaveLength(8);
    const refused = await reactivate(world, 'reactivate-cap-1', first.session!);
    expect(refused).toEqual({ status: 'rejected', code: 'capacity',
      reason: 'at_cap: secretary has 8 holder(s) and 0 reservation(s) against open limit 8',
      detail: { duty: 'secretary', holders: 8, reservations: 0, open: 8, episode: null } });
    const after = await world.allocation();
    expect(after.duties.secretary.revision).toBe(before.duties.secretary.revision);
    expect(after.duties.secretary.holders).toHaveLength(8);
    expect(after.duties.secretary.reservations).toEqual([]);
    expect((await world.world.readSession(first.session!.ref)).record.lifecycle).toBe('archived');
  }, 240_000);

  it('a cap lowered after the read still refuses (mutation: drop the limits guard)', async () => {
    const world = await openAllocationWorld(backend);
    const first = await world.createLine({ label: 'reactivate-guard-1' });
    expect((await world.createLine({ label: 'reactivate-guard-2' })).answer.body)
      .toMatchObject({ status: 'completed' });
    await archive(world, 'reactivate-guard-1', first.session!);
    await world.setOpen('secretary', 2);
    const hold = commitBarrier.hold(byIdentityPrefix('session-reactivate:'), 'the reactivation commit');
    const pending = reactivate(world, 'reactivate-guard-1', first.session!);
    await hold.reached;
    await world.setOpen('secretary', 1);
    hold.release();
    const refused = await pending;
    expect(refused).toMatchObject({ status: 'rejected', code: 'capacity' });
    expect((await world.world.readSession(first.session!.ref)).record.lifecycle).toBe('archived');
    const report = await world.allocation();
    expect(report.duties.secretary.limit).toBe(1);
    expect(report.duties.secretary.holders).toHaveLength(1);
    expect(report.duties.secretary.reservations).toEqual([]);
  }, 240_000);
});
