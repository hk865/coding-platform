/**
 * D5 (Q frozen row; R5 handoff brief): the adviser's material still answers `unavailable` when one card source is
 * `read_failed`; a brief that silently omits that kind would be kept as complete memory. The world and the fault are
 * D1's (the S7C system world's counted reworks and an unprofiled secretary's failed RoleSpec read). Today this row
 * is green because the queue still rejects whole; it guards the widened read after the degrade lands.
 */
import { afterEach, expect, it, vi } from 'vitest';
import type { RoleScopeV1 } from '../../src/contracts/role-lines.js';
import { assembleHandoffBrief, type HandoffBriefAssemblyDeps } from '../../src/core/agent-runtime/handoff-brief-assembly.js';
import { createSessionHistoryCursorOwner } from '../../src/core/agent-runtime/session-operations.js';
import { canonicalRefKey } from '../../src/core/work-graph/persistence/record-codecs.js';
import { commitBarrier } from '../helpers/S6A-commit-barrier.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import { committed } from '../helpers/S7A-fixture.js';
import { openS7CSystemWorld, type S7CSystemWorld } from '../helpers/S7C-L2-world.js';
import { openLink } from '../helpers/S7D1-role-line-world.js';

const shared = vi.hoisted(() => ({ backend: undefined as unknown, bodies: undefined as unknown }));
vi.mock('../../src/core/record-store/in-memory-record-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/core/record-store/in-memory-record-store.js')>();
  const barrier = await import('../helpers/S6A-commit-barrier.js');
  const wrapped = await barrier.inMemoryBarrierModule(async () => actual);
  const create = wrapped.createInMemoryRecordBackend;
  return { ...wrapped, createInMemoryRecordBackend: (options: Parameters<typeof actual.createInMemoryRecordBackend>[0]) => {
    if (shared.backend === undefined) shared.backend = { ...create(options), close: async () => undefined };
    return shared.backend;
  } };
});
vi.mock('../../src/core/record-store/sqlite-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-commit-barrier.js')).sqliteBarrierModule(importOriginal));
vi.mock('../../src/core/record-store/body-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/core/record-store/body-store.js')>();
  return { ...actual, RawArtifactBodyStore: class SharedRawArtifactBodyStore {
    constructor() { shared.bodies ??= new actual.RawArtifactBodyStore(); return shared.bodies as never; }
  } as never };
});

let opened: S7CSystemWorld | null = null;
afterEach(async () => { commitBarrier.reset(); await opened?.close().catch(() => undefined); opened = null;
  shared.backend = undefined; shared.bodies = undefined; });

function depsOf(target: S7CSystemWorld): HandoffBriefAssemblyDeps {
  const platform = target.world.platform;
  return {
    history: createSessionHistoryCursorOwner({ kernelStores: platform.kernelStores }),
    records: platform.disconnect.records as unknown as HandoffBriefAssemblyDeps['records'],
    notes: platform.notes, decisions: platform.decisions, queryExecution: platform.reconcile,
  };
}

it('the adviser brief stays unavailable when one card source is read_failed', async () => {
  const target = await openS7CSystemWorld();
  opened = target;
  if (target.adviser === null) throw new Error('D5: the system world opened without its adviser line');
  const unprofiled = await target.world.createUnprofiledSecretary('q-d5-unprofiled');
  if (unprofiled.role.kind !== 'role_spec') throw new Error('D5: the unprofiled secretary has no RoleSpec role');
  const linked = await openLink(target.world, { line: unprofiled,
    target: { kind: 'goal', ref: target.goal }, requestId: 'q-d5-unprofiled-goal-link' });
  committed(linked.result, 'the unprofiled secretary Goal link');
  const fault = commitBarrier.failReads(canonicalRefKey(unprofiled.role.pin.ref), 'throw-always');
  try {
    const handedScope: RoleScopeV1[] = [{ kind: 'goal', goalRef: target.goal }];
    const result = await assembleHandoffBrief(depsOf(target), target.world.systemContext(), {
      duty: 'adviser', source: target.adviser.ref, sourceRun: null,
      workspaceId: S6A_SCOPE.workspaceId, signal: new AbortController().signal, handedScope, understanding: null,
    });
    expect(result, 'a partial brief is not complete memory').toMatchObject({ status: 'rejected', code: 'unavailable' });
    expect(fault.calls(), 'the degraded source was the one that failed').toBeGreaterThan(0);
  } finally { fault.release(); }
}, 180_000);
