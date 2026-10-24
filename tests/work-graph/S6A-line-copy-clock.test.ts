/**
 * The line card's read-only-copy clock (book §3.4.2, ruling 4.2). An active
 * copy's latest QueryRun is valid, but its QueryJob read fails: the copy read
 * validates that job, so the source line card answers `problem=unavailable` and
 * takes no bucket.
 *
 * The prior state is real, through the frozen S6A world's public steps: a
 * secretary through `sessions/create` and its read-only copy through the real
 * copy path (`messages/send` of an inquiry, then `workflow/consultation`; the
 * copy stays active with its one QueryRun). The line card is read through the
 * published `workLines.listWorkLines`, the owner behind `lines/list`.
 *
 * The one fault (A2) is armed only around that read. The two record-backend
 * factories are wrapped at the backend seam (A4) so the platform's own store is
 * the one read; while armed, a `readMany` that names a QueryJob answers
 * `unavailable`, and every other read passes through unchanged.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SessionRef } from '../../src/contracts/core/identity.js';
import type { ReadResult } from '../../src/contracts/core/results.js';
import {
  openS6ARequestWorld, S6A_SCOPE, type S6ABackend, type S6ARequestWorld,
} from '../helpers/S6A-request-fixture.js';

const fault = vi.hoisted(() => {
  const state = { armed: false, calls: 0 };
  type Store = { readMany(refKeys: readonly string[]): Promise<unknown> };
  /** The real backend, except that an armed QueryJob `readMany` is `unavailable`. */
  function wrap<B extends { records: Store }>(backend: B): B {
    const real = backend.records;
    return { ...backend, records: { ...real, readMany: async (refKeys: readonly string[]) => {
      if (state.armed && refKeys.some((key) => key.includes('"aggregateType":"QueryJob"'))) {
        state.calls += 1;
        return { status: 'rejected', code: 'unavailable', reason: 'injected QueryJob read failure' };
      }
      return real.readMany(refKeys);
    } } } as B;
  }
  return { state, wrap };
});

vi.mock('../../src/core/record-store/in-memory-record-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/core/record-store/in-memory-record-store.js')>();
  return { ...actual,
    createInMemoryRecordBackend: (options: Parameters<typeof actual.createInMemoryRecordBackend>[0]) =>
      fault.wrap(actual.createInMemoryRecordBackend(options)) };
});
vi.mock('../../src/core/record-store/sqlite-record-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/core/record-store/sqlite-record-store.js')>();
  return { ...actual,
    createSqliteRecordBackend: (options: Parameters<typeof actual.createSqliteRecordBackend>[0]) =>
      fault.wrap(actual.createSqliteRecordBackend(options)) };
});

function ready<T>(result: ReadResult<T>): T {
  if (result.status !== 'ready') throw new Error(`expected ready, got ${JSON.stringify(result)}`);
  return result.value;
}

async function sourceRow(world: S6ARequestWorld, source: SessionRef) {
  const list = ready(await world.platform.workLines!.listWorkLines(world.humanContext(), { workspace: S6A_SCOPE }));
  return list.rows.find((row) => row.key.projectId === source.projectId && row.key.sessionId === source.sessionId);
}

describe.each(['memory', 'sqlite'] as const)('the line card copy clock (%s)', (backend: S6ABackend) => {
  const worlds: S6ARequestWorld[] = [];
  afterEach(async () => {
    fault.state.armed = false;
    fault.state.calls = 0;
    await Promise.all(worlds.splice(0).map((world) => world.close()));
  });

  it('keeps the line unavailable and bucket null when a live copy QueryJob read fails', async () => {
    const world = await openS6ARequestWorld({ backend });
    worlds.push(world);
    const source = await world.createSecretary('copy-source');
    const { copy } = await world.makeReadonlyCopy(source, 'copy-clock');
    expect((await world.readSession(copy)).record.lifecycle).toBe('active');

    // Unarmed, the same read has no problem and a bucket.
    const healthy = await sourceRow(world, source.ref);
    expect(healthy).toBeDefined();
    expect(healthy!.problem).toBeNull();
    expect(healthy!.status.bucket).not.toBeNull();

    fault.state.armed = true;
    const row = await sourceRow(world, source.ref);
    fault.state.armed = false;
    expect(fault.state.calls).toBeGreaterThan(0);
    expect(row).toBeDefined();
    expect(row!.problem).toEqual({ code: 'unavailable', reason: 'injected QueryJob read failure' });
    expect(row!.status.bucket).toBeNull();
  });
});
