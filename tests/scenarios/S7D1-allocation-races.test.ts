/**
 * `G3-races` (book :2024, `:673`; RL-05): the last reservation against a lowered cap in both orders, the exact final
 * numbers, and the bounded four-attempt competition against a real commit barrier. Each loss is a real limits write
 * that moves the version while the create's admission commit waits; no conflict is fabricated. `projects/role-limits/
 * set` is W's route, so before W the first set answers D2's unpublished-route error (reported, never a business
 * answer). Named mutations (not run here): `ALLOCATION_ATTEMPTS = 1` fails the recoverable three-loss case; the
 * fourth loss as `revision_conflict` instead of `busy`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { stableSessionCreationIdentity } from '../../src/core/work-graph/sessions/session-directory.js';
import { asRecord } from '../helpers/S6A-host-fixture.js';
import { S6A_SCOPE, type S6ABackend } from '../helpers/S6A-request-fixture.js';
import { byIdentityPrefix, commitBarrier, type CommitMatch } from '../helpers/S6A-commit-barrier.js';
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

/** The one create's admission commit: the prepared operation record names the stable operation id. */
function admissionOf(world: S7D1AllocationWorld, label: string): CommitMatch {
  const principal = world.world.humanContext().principal;
  if (principal.kind !== 'host') throw new Error('G3-races: the world has no Host actor');
  const identity = stableSessionCreationIdentity(principal.actor, S6A_SCOPE.projectId, `s7d1-${label}`);
  return commit => byIdentityPrefix('session-create:')(commit)
    && commit.records.some(record => record.json.includes(identity.operationRef.operationId));
}

async function fill(world: S7D1AllocationWorld, count: number, prefix: string): Promise<void> {
  for (let index = 1; index <= count; index += 1) {
    expect((await world.createLine({ label: `${prefix}-${String(index)}` })).answer.body)
      .toMatchObject({ status: 'completed' });
  }
}

describe.each(BACKENDS)('G3-races on the real %s Host', (backend: S6ABackend) => {
  it('a reservation at the last slot survives a cap lowered before its registration; the final numbers are exact', async () => {
    const world = await openAllocationWorld(backend);
    await fill(world, 7, 'lower-first');
    const hold = commitBarrier.hold(byIdentityPrefix('session-register:'), 'the last registration');
    const registrant = world.createLine({ label: 'lower-registrant' });
    let failure: unknown = null;
    try {
      await hold.reached;
      const limits = await world.setOpen('secretary', 7);
      expect(limits).toMatchObject({ revision: 1, open: { secretary: 7 } });
    } catch (error) { failure = error; } finally {
      hold.release();
      await registrant.catch(() => undefined);
    }
    if (failure !== null) throw failure;
    expect((await registrant).answer.body).toMatchObject({ status: 'completed' });

    const report = await world.allocation();
    expect(report.duties.secretary.limit).toBe(7);
    expect(report.duties.secretary.holders).toHaveLength(8);
    expect(report.duties.secretary.reservations).toEqual([]);
    expect(await world.world.listSessions()).toHaveLength(8);
  }, 240_000);

  it('a cap lowered before the last admission refuses it and writes nothing', async () => {
    const world = await openAllocationWorld(backend);
    await fill(world, 7, 'lower-second');
    await world.setOpen('secretary', 7);
    const refused = await world.createLine({ label: 'lower-refused' });
    expect(refused.answer.body).toEqual({ status: 'rejected', code: 'capacity',
      reason: 'at_cap: secretary has 7 holder(s) and 0 reservation(s) against open limit 7' });

    const report = await world.allocation();
    expect(report.duties.secretary.limit).toBe(7);
    expect(report.duties.secretary.holders).toHaveLength(7);
    expect(report.duties.secretary.reservations).toEqual([]);
    expect(await world.world.listSessions()).toHaveLength(7);
  }, 240_000);

  it('three allocation-only losses are retried and the fourth attempt converts (mutation: ALLOCATION_ATTEMPTS = 1)', async () => {
    const world = await openAllocationWorld(backend);
    await fill(world, 4, 'retry-fill');
    const holds = [0, 1, 2].map(index => commitBarrier.hold(admissionOf(world, 'retry-target'),
      `the retry attempt ${String(index + 1)}`));
    const pending = world.createLine({ label: 'retry-target' });
    let failure: unknown = null;
    try {
      for (const hold of holds) {
        await hold.reached;
        await world.setOpen('secretary', 8);
        hold.release();
      }
    } catch (error) { failure = error; } finally {
      for (const hold of holds) hold.release();
      await pending.catch(() => undefined);
    }
    if (failure !== null) throw failure;
    const created = await pending;
    expect(created.answer.body).toMatchObject({ status: 'completed', replayed: false });
    expect(await world.operation(created.operationRef!)).toMatchObject({ status: 'ready',
      value: { phase: 'completed' } });

    const report = await world.allocation();
    expect(report.duties.secretary.holders).toHaveLength(5);
    expect(report.duties.secretary.reservations).toEqual([]);
  }, 240_000);

  it('four allocation-only losses end busy, never revision_conflict (mutation: return the fourth as revision_conflict)', async () => {
    const world = await openAllocationWorld(backend);
    await fill(world, 4, 'loss-fill');
    const holds = [0, 1, 2, 3].map(index => commitBarrier.hold(admissionOf(world, 'loss-target'),
      `the loss attempt ${String(index + 1)}`));
    const pending = world.createLine({ label: 'loss-target' });
    let failure: unknown = null;
    try {
      for (const hold of holds) {
        await hold.reached;
        await world.setOpen('secretary', 8);
        hold.release();
      }
    } catch (error) { failure = error; } finally {
      for (const hold of holds) hold.release();
      await pending.catch(() => undefined);
    }
    if (failure !== null) throw failure;
    const lost = await pending;
    expect(lost.answer.body).toMatchObject({ status: 'rejected', code: 'busy' });
    expect(String(asRecord(lost.answer.body)['reason'])).toContain('lost 4 allocation-only conflicts');

    const report = await world.allocation();
    expect(report.duties.secretary.holders).toHaveLength(4);
    expect(report.duties.secretary.reservations).toEqual([]);
    expect(await world.world.listSessions()).toHaveLength(4);
  }, 240_000);
});
