/**
 * `G3-cap` (book :2023, `:593-594`, `:670`, `:25`): holders + reservations < open over the real Host. Nine
 * secretary creates meet the default `open: 8`; the ninth answers `capacity/at_cap` naming duty, holders,
 * reservations and limit. A reviewer counts in the executor pool (its saved seat is `executor`), an unknown duty is
 * not counted, and a consultation copy takes nothing. Every observation is the public create receipt, the saved
 * `sessions/operation` or the deferred `role-lines/allocation`; no record is read.
 * Named mutations (not run here): `seatAtCap` `<` → `<=` admits one over; drop `roleLineDutyOf`'s reviewer arm.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { canonicalRefKey } from '../../src/core/work-graph/persistence/record-codecs.js';
import { commitBarrier } from '../helpers/S6A-commit-barrier.js';
import { platformRoleProfile } from '../../src/core/agent-runtime/role-profiles.js';
import {
  openS7D1AllocationWorld, type S7D1AllocationWorld,
} from '../helpers/S7D1-allocation-world.js';

vi.mock('../../src/core/record-store/in-memory-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-commit-barrier.js')).inMemoryBarrierModule(importOriginal));
vi.mock('../../src/core/record-store/sqlite-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-commit-barrier.js')).sqliteBarrierModule(importOriginal));

const worlds: S7D1AllocationWorld[] = [];

async function openAllocationWorld(): Promise<S7D1AllocationWorld> {
  const world = await openS7D1AllocationWorld({ backend: 'memory' });
  worlds.push(world);
  return world;
}

afterEach(async () => {
  expect(commitBarrier.reset()).toEqual([]);
  await Promise.allSettled(worlds.splice(0).map(world => world.close()));
});

describe('G3-cap: the open cap counts holders and reservations, not requests', () => {
  it('the ninth secretary create is capacity/at_cap naming secretary, 8 holders, 0 reservations and limit 8', async () => {
    const world = await openAllocationWorld();
    for (let index = 1; index <= 8; index += 1) {
      const created = await world.createLine({ label: `cap-${String(index)}` });
      expect(created.answer.body).toMatchObject({ status: 'completed' });
      expect(created.session).not.toBeNull();
    }
    expect(await world.world.listSessions()).toHaveLength(8);
    const ninth = await world.createLine({ label: 'cap-9' });
    expect(ninth.answer.body).toEqual({ status: 'rejected', code: 'capacity',
      reason: 'at_cap: secretary has 8 holder(s) and 0 reservation(s) against open limit 8',
      detail: { duty: 'secretary', holders: 8, reservations: 0, open: 8, episode: null } });
    expect(await world.world.listSessions()).toHaveLength(8);
    const full = await world.allocation();
    expect(full.duties.secretary.holders).toHaveLength(8);
    expect(full.duties.secretary.reservations).toEqual([]);
  }, 180_000);

  it('a reviewer takes an executor seat, saved as executor, never a secretary seat', async () => {
    const world = await openAllocationWorld();
    const reviewer = platformRoleProfile('reviewer').template;
    const created = await world.createLine({ label: 'cap-reviewer', role: reviewer, duty: 'reviewer' });
    expect(created.answer.body).toMatchObject({ status: 'completed' });
    expect(created.session?.role).toEqual(reviewer);
    expect(await world.operation(created.operationRef!)).toMatchObject({ status: 'ready', value: {
      phase: 'completed', action: { kind: 'create', seatDecision: {
        duty: 'executor', mode: 'reserved', notCountedReason: null,
        allocationRef: { aggregateType: 'RoleLineAllocation', projectId: world.world.scope.projectId, duty: 'executor' },
      } },
    } });
    const report = await world.allocation();
    expect(report.duties.executor.holders).toHaveLength(1);
    expect(report.duties.executor.holders[0]!.session).toEqual(created.session!.ref);
    for (const duty of ['secretary', 'adviser', 'scribe'] as const) {
      expect(report.duties[duty].holders).toEqual([]);
      expect(report.duties[duty].reservations).toEqual([]);
    }
  }, 180_000);

  it('an unknown duty is not counted: the line is admitted with not_counted/unknown_duty and no allocation', async () => {
    const world = await openAllocationWorld();
    const unknownRole = { kind: 'legacy_template' as const, templateId: 's7d1-unbound-template',
      templateRevision: '1' };
    const created = await world.createLine({ label: 'cap-unknown', role: unknownRole, duty: 'executor' });
    expect(created.answer.body).toMatchObject({ status: 'completed' });
    expect(await world.operation(created.operationRef!)).toMatchObject({ status: 'ready', value: {
      action: { kind: 'create', seatDecision: {
        duty: 'unknown', mode: 'not_counted', notCountedReason: 'unknown_duty', allocationRef: null,
      } },
    } });
    const report = await world.allocation();
    for (const duty of ['executor', 'adviser', 'secretary', 'scribe'] as const) {
      expect(report.duties[duty].holders).toEqual([]);
      expect(report.duties[duty].reservations).toEqual([]);
    }
  }, 180_000);

  it('a duty read that does not answer rejects the public create as unavailable, never unknown or skipped', async () => {
    const world = await openAllocationWorld();
    const pinned = await world.world.createUnprofiledSecretary('cap-duty-pin');
    if (pinned.role.kind !== 'role_spec') throw new Error('G3-cap: the installed line is not a role_spec line');
    const fault = commitBarrier.failReads(canonicalRefKey(pinned.role.pin.ref), 'throw-once');
    const rejected = await world.createLine({ label: 'cap-duty-failed', role: pinned.role, duty: 'secretary' });
    expect(rejected.answer.body).toMatchObject({ status: 'rejected', code: 'unavailable',
      reason: expect.stringContaining('the pinned RoleSpec read failed') });
    expect(rejected.session).toBeNull();
    expect(fault.calls()).toBe(1);
    expect(await world.world.listSessions()).toHaveLength(1);
  });

  it('a consultation copy takes nothing: at the secretary cap the real copy is still admitted', async () => {
    const world = await openAllocationWorld();
    let source = null;
    for (let index = 1; index <= 8; index += 1) source = await world.createLine({ label: `cap-copy-${String(index)}` });
    expect(source?.session).not.toBeNull();
    const atCap = await world.createLine({ label: 'cap-copy-nine' });
    expect(atCap.answer.body).toMatchObject({ status: 'rejected', code: 'capacity' });
    const beforeCopy = await world.allocation();
    const copied = await world.world.makeReadonlyCopy(source!.session!, 'cap-readonly');
    const card = await world.world.readSession(copied.copy.ref);
    expect(card.record).toMatchObject({ lifecycle: 'active', provenance: { schemaVersion: 1, kind: 'readonly_copy' } });
    expect(card.record.provenance.kind === 'readonly_copy' && card.record.provenance.from)
      .toEqual(source!.session!.ref);
    const afterCopy = await world.allocation();
    expect(afterCopy.duties.secretary.holders).toEqual(beforeCopy.duties.secretary.holders);
    expect(afterCopy.duties.secretary.reservations).toEqual(beforeCopy.duties.secretary.reservations);
    expect(afterCopy.duties.secretary.revision).toBe(beforeCopy.duties.secretary.revision);
    expect(await world.world.listSessions()).toHaveLength(9);
  }, 180_000);
});
