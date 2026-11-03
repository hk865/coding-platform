/**
 * `G3-reserve-convert` (book :2022, `:593`, `:649`): admission takes the reservation; registration converts it at
 * that commit's cursor; a replay writes nothing; two admissions of the last slot race and exactly one takes it; a
 * registration and an admission of the last slot race and exactly one wins. The only observation of the allocation
 * is D2's deferred `role-lines/allocation` (W adds it); the create receipts and `sessions/operation` are public now.
 * The race gates use the frozen `CommitBarrier`; no conflict is fabricated.
 * Named mutations (not run here): `convert` → `add_holder` leaves the reservation standing; drop the
 * `reservations[].reservedAt` binding.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { S6A_SCOPE, type S6ABackend } from '../helpers/S6A-request-fixture.js';
import { byIdentityPrefix, commitBarrier } from '../helpers/S6A-commit-barrier.js';
import { asRecord } from '../helpers/S6A-host-fixture.js';
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

describe.each(BACKENDS)('G3-reserve-convert on the real %s Host', (backend: S6ABackend) => {
  it('admission reserves, registration converts at that commit’s cursor, and a replay writes nothing', async () => {
    const world = await openAllocationWorld(backend);
    const created = await world.createLine({ label: 'convert' });
    expect(created.answer.body).toMatchObject({ status: 'completed', replayed: false });
    expect(created.session).not.toBeNull();
    const cursor = asRecord(created.answer.body)['cursor'] as string;
    expect(await world.operation(created.operationRef!)).toMatchObject({ status: 'ready', value: {
      phase: 'completed', action: { kind: 'create', seatDecision: {
        duty: 'secretary', mode: 'reserved', notCountedReason: null,
        allocationRef: { aggregateType: 'RoleLineAllocation', projectId: S6A_SCOPE.projectId, duty: 'secretary' },
      } },
    } });

    const report = await world.allocation();
    expect(report.duties.secretary.reservations).toEqual([]);
    expect(report.duties.secretary.holders).toHaveLength(1);
    expect(report.duties.secretary.holders[0]).toMatchObject({ session: created.session!.ref, since: cursor });
    const revision = report.duties.secretary.revision;

    const replay = await world.createLine({ label: 'convert' });
    expect(replay.answer.body).toMatchObject({ status: 'completed', replayed: true });
    expect(replay.created).toBe(false);
    expect(await world.world.listSessions()).toHaveLength(1);
    const after = await world.allocation();
    expect(after.duties.secretary.revision).toBe(revision);
    expect(after.duties.secretary.holders).toHaveLength(1);
    expect(after.duties.secretary.reservations).toEqual([]);
  }, 240_000);

  it('two admissions of the last slot race and exactly one takes it', async () => {
    const world = await openAllocationWorld(backend);
    for (let index = 1; index <= 7; index += 1) {
      expect((await world.createLine({ label: `race-fill-${String(index)}` })).answer.body)
        .toMatchObject({ status: 'completed' });
    }
    const hold = commitBarrier.hold(byIdentityPrefix('session-create:'), 'the last-slot admission');
    const first = world.createLine({ label: 'race-a' });
    const second = world.createLine({ label: 'race-b' });
    await hold.reached;
    hold.release();
    const answers = await Promise.all([first, second]);
    expect(answers.map(answer => asRecord(answer.answer.body)['status']).sort()).toEqual(['completed', 'rejected']);
    const refused = answers.find(answer => asRecord(answer.answer.body)['status'] === 'rejected')!;
    expect(refused.answer.body).toMatchObject({ status: 'rejected', code: 'capacity' });
    expect(String(asRecord(refused.answer.body)['reason'])).toMatch(
      /^at_cap: secretary has (7 holder\(s\) and 1 reservation\(s\)|8 holder\(s\) and 0 reservation\(s\)) against open limit 8$/);

    const report = await world.allocation();
    expect(report.duties.secretary.holders).toHaveLength(8);
    expect(report.duties.secretary.reservations).toEqual([]);
    expect(await world.world.listSessions()).toHaveLength(8);
  }, 240_000);

  it('a registration and an admission of the last slot race and exactly one wins', async () => {
    const world = await openAllocationWorld(backend);
    for (let index = 1; index <= 7; index += 1) {
      expect((await world.createLine({ label: `reg-fill-${String(index)}` })).answer.body)
        .toMatchObject({ status: 'completed' });
    }
    const hold = commitBarrier.hold(byIdentityPrefix('session-register:'), 'the last-slot registration');
    const registrant = world.createLine({ label: 'reg-a' });
    await hold.reached;
    const competitor = await world.createLine({ label: 'reg-b' });
    expect(competitor.answer.body).toEqual({ status: 'rejected', code: 'capacity',
      reason: 'at_cap: secretary has 7 holder(s) and 1 reservation(s) against open limit 8',
      detail: { duty: 'secretary', holders: 7, reservations: 1, open: 8, episode: null } });
    hold.release();
    const winner = await registrant;
    expect(winner.answer.body).toMatchObject({ status: 'completed' });
    const cursor = asRecord(winner.answer.body)['cursor'] as string;

    const report = await world.allocation();
    expect(report.duties.secretary.holders).toHaveLength(8);
    expect(report.duties.secretary.reservations).toEqual([]);
    expect(report.duties.secretary.holders.some(holder =>
      holder.session.sessionId === winner.session!.ref.sessionId && holder.since === cursor)).toBe(true);
    expect(await world.world.listSessions()).toHaveLength(8);
  }, 240_000);
});
