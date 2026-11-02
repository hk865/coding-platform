/**
 * `G3-allocation-read` (§3.8 item 8, §5 rows `:2025`, `:2029`, `:2030`; PS-12): `role-lines/allocation` answers
 * all four duties with their limit, holders and reservations; no record answers the default limit with zero holders
 * and no scan; a failed read is `unavailable`, never an empty report. The damaged-record half is deleted: no public
 * damaged-store step exists, and only a hand-built record could trigger it (AGENTS rule 4; ruling :3153 item 51).
 * The route is W's; before W it answers 404 and this file's `S7D1-DEFERRED` stops the case, never a business answer.
 * Named mutation (blocked on W): return `[]` for a failed read -> a store failure reads as zero holders.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RoleLineAllocationReportV1 } from '../../src/contracts/role-lines.js';
import { canonicalJson, type JsonValue } from '../../src/contracts/fingerprint.js';
import { platformRoleProfile } from '../../src/core/agent-runtime/role-profiles.js';
import { plain } from '../helpers/AG2b-collaboration-fixture.js';
import { byIdentityPrefix, commitBarrier } from '../helpers/S6A-commit-barrier.js';
import { asRecord } from '../helpers/S6A-host-fixture.js';
import { S6A_SCOPE, S6A_SCRIBE_ROLE, S6A_SECRETARY_ROLE, S6A_WORK_ROLE } from '../helpers/S6A-request-fixture.js';
import { S7D1_ALLOCATION_DEFERRED, archiveS7D1Session, openS7D1AllocationWorld, reactivateS7D1Session,
  readS7D1Allocation, type S7D1AllocationWorld } from '../helpers/S7D1-allocation-world.js';
import { seedS7D1RoleFactsChain, type S7D1RoleFactsChain } from '../helpers/S7D1-role-facts-world.js';

vi.mock('../../src/core/record-store/in-memory-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-commit-barrier.js')).inMemoryBarrierModule(importOriginal));
vi.mock('../../src/core/record-store/sqlite-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-commit-barrier.js')).sqliteBarrierModule(importOriginal));

const DEFAULTS = { secretary: 8, adviser: 8, scribe: 4, executor: 16 };
const worlds: S7D1AllocationWorld[] = [];
const chains: S7D1RoleFactsChain[] = [];

async function openWorld(): Promise<S7D1AllocationWorld> {
  const world = await openS7D1AllocationWorld({ backend: 'memory' });
  worlds.push(world);
  return world;
}

type AllocationCase = { readonly name: string; readonly run: () => Promise<void> };

const CASES: readonly AllocationCase[] = [
  {
    name: 'all four duties answer their limit, holders, reservations and revision',
    async run() {
      const world = await openWorld();
      const roles = [
        { duty: 'secretary' as const, role: S6A_SECRETARY_ROLE },
        { duty: 'adviser' as const, role: platformRoleProfile('adviser').template },
        { duty: 'scribe' as const, role: S6A_SCRIBE_ROLE },
        { duty: 'executor' as const, role: S6A_WORK_ROLE },
      ];
      for (const entry of roles) {
        expect((await world.createLine({ label: `allocation-${entry.duty}`, duty: entry.duty, role: entry.role }))
          .answer.body).toMatchObject({ status: 'completed' });
      }
      const hold = commitBarrier.hold(byIdentityPrefix('session-register:'), 'the reservation read');
      const pending = world.createLine({ label: 'allocation-reserved', duty: 'executor', role: S6A_WORK_ROLE });
      await hold.reached;
      let report: RoleLineAllocationReportV1;
      try {
        report = await readS7D1Allocation(world.world);
      } finally {
        hold.release();
        await pending.catch(() => undefined);
      }
      for (const duty of ['secretary', 'adviser', 'scribe', 'executor'] as const) {
        expect(report.duties[duty]).toMatchObject({ duty, limit: DEFAULTS[duty],
          revision: duty === 'executor' ? 3 : 2 });
      }
      for (const duty of ['secretary', 'adviser', 'scribe'] as const) {
        expect(report.duties[duty].holders).toHaveLength(1);
        expect(report.duties[duty].holders[0]?.since).toEqual(expect.any(String));
        expect(report.duties[duty].reservations).toEqual([]);
      }
      expect(report.duties.executor.holders).toHaveLength(1);
      expect(report.duties.executor.reservations).toHaveLength(1);
      expect(report.duties.executor.reservations[0]).toMatchObject({ reservedAt: expect.any(String) });
    },
  },
  {
    name: 'no record answers the default limit with zero holders and revision null',
    async run() {
      const world = await openWorld();
      const report = await readS7D1Allocation(world.world);
      expect(report.projectRef).toEqual({ projectId: S6A_SCOPE.projectId });
      expect(Object.keys(report.duties).sort()).toEqual(['adviser', 'executor', 'scribe', 'secretary']);
      for (const duty of ['secretary', 'adviser', 'scribe', 'executor'] as const) {
        expect(report.duties[duty]).toEqual({ duty, limit: DEFAULTS[duty], revision: null,
          holders: [], reservations: [] });
      }
    },
  },
  {
    name: 'a failed read is unavailable, never an empty report',
    async run() {
      const world = await openWorld();
      const key = canonicalJson({ aggregateType: 'RoleLineAllocation', projectId: S6A_SCOPE.projectId,
        duty: 'secretary' } as unknown as JsonValue);
      const fault = commitBarrier.failReads(key, 'throw-once');
      try {
        const answer = await world.world.post('role-lines/allocation', plain(S6A_SCOPE, {}));
        if (answer.httpStatus === 404) throw new Error(S7D1_ALLOCATION_DEFERRED);
        expect(asRecord(answer.body)).toMatchObject({ status: 'rejected', code: 'unavailable' });
        expect(String(asRecord(answer.body)['reason'])).toMatch(/read failed/);
        expect(fault.calls()).toBeGreaterThan(0);
      } finally {
        fault.release();
      }
    },
  },
  {
    name: 'a full handoff, reactivation and ordinary archive lapse the contact',
    async run() {
      const chain = await seedS7D1RoleFactsChain({ backend: 'memory' });
      chains.push(chain);
      // The source line A is archived by its full handoff; re-enable it and archive it ordinarily after that
      // handoff completed, so the stored handoff no longer matches this archive and the contact lapses.
      chain.world.clock.advance(60_000);
      await reactivateS7D1Session(chain.world, chain.A.ref, 'S7D1 contact lapse: reactivate');
      await archiveS7D1Session(chain.world, chain.A.ref, 'S7D1 contact lapse: ordinary archive');
      const report = await readS7D1Allocation(chain.world);
      const holder = report.duties.executor.holders.find(each => each.session.projectId === chain.E.ref.projectId
        && each.session.sessionId === chain.E.ref.sessionId);
      expect(holder).toBeDefined();
      expect(holder?.creator).toEqual({ kind: 'lapsed' });
    },
  },
];

describe('G3-allocation-read on the real memory Host', () => {
  afterEach(async () => {
    const left = commitBarrier.reset();
    await Promise.allSettled(worlds.splice(0).map(world => world.close()));
    await Promise.allSettled(chains.splice(0).map(chain => chain.close()));
    expect(left).toEqual([]);
  });

  it.each(CASES)('$name', async (testCase: AllocationCase) => {
    await testCase.run();
  }, 180_000);
});
