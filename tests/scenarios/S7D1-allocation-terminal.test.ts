/**
 * `G3-terminal` (book :2028, `:252-254`; SQLite): a recoverable registration refusal and a crash keep the reservation,
 * and the retry converts the same reservation. The fault is the frozen `CommitBarrier.failCommitOnce` matching the
 * REAL `session-register:` commit (DR-7D1 G3-1-08), not the registration double, so the registration's own failure
 * path runs and the admission is already durable. Recovery is the same directory's `crash` + `reopen`; the retry is
 * the same public `sessions/create` body. The allocation read is D2's deferred step (W).
 * Named mutation (not run here): release the reservation on the thrown registration, so the retry has nothing to
 * convert and answers `unavailable`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { byIdentityPrefix, commitBarrier } from '../helpers/S6A-commit-barrier.js';
import { asRecord } from '../helpers/S6A-host-fixture.js';
import { openS7D1AllocationWorld, type S7D1AllocationWorld } from '../helpers/S7D1-allocation-world.js';

vi.mock('../../src/core/record-store/sqlite-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-commit-barrier.js')).sqliteBarrierModule(importOriginal));

const worlds: S7D1AllocationWorld[] = [];

afterEach(async () => {
  const left = commitBarrier.reset();
  await Promise.allSettled(worlds.splice(0).map(world => world.close()));
  expect(left).toEqual([]);
});

describe('G3-terminal: a recoverable registration refusal keeps the reservation and the retry converts it', () => {
  it('the thrown session-register commit leaves the operation accepted; after crash + reopen the same body completes', async () => {
    const world = await openS7D1AllocationWorld({ backend: 'sqlite' });
    worlds.push(world);
    commitBarrier.failCommitOnce(byIdentityPrefix('session-register:'));
    const first = await world.createLine({ label: 'terminal' });
    expect(first.answer.body).toMatchObject({ status: 'accepted' });
    expect(first.session).toBeNull();
    expect(first.operationRef).not.toBeNull();
    expect(await world.world.listSessions()).toHaveLength(0);
    expect(await world.operation(first.operationRef!)).toMatchObject({ status: 'ready',
      value: { phase: 'accepted', action: { kind: 'create', seatDecision: { mode: 'reserved' } } } });

    const reservedAt = asRecord(first.answer.body)['cursor'] as string;
    const reservation = { operationRef: first.operationRef!, reservedAt };
    const afterFailure = await world.allocation();
    expect(afterFailure.duties.secretary.holders).toEqual([]);
    expect(afterFailure.duties.secretary.reservations).toEqual([reservation]);

    await world.world.crash();
    await world.world.reopen();
    const afterReopen = await world.allocation();
    expect(afterReopen.duties.secretary.holders).toEqual([]);
    expect(afterReopen.duties.secretary.reservations).toEqual([reservation]);
    const retry = await world.createLine({ label: 'terminal' });
    expect(retry.answer.body).toMatchObject({ status: 'completed', replayed: false });
    expect(retry.session).not.toBeNull();
    expect(await world.world.listSessions()).toHaveLength(1);
    expect(await world.operation(first.operationRef!)).toMatchObject({ status: 'ready',
      value: { phase: 'completed' } });

    const cursor = asRecord(retry.answer.body)['cursor'] as string;
    const report = await world.allocation();
    expect(report.duties.secretary.holders).toHaveLength(1);
    expect(report.duties.secretary.holders[0]).toMatchObject({ session: retry.session!.ref, since: cursor });
    expect(report.duties.secretary.reservations).toEqual([]);
  }, 240_000);
});
