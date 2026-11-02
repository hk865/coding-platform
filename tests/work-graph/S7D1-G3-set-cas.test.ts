/**
 * `G3-set-cas` (book `:2025`, §3.9; PS-11): the limits record's CAS. The first write is revision
 * 0 -> 1 and merges only the levels the request carries; a second write with the same `expectedRevision` is
 * `revision_conflict` carrying `current`; a lower `open` merges with the other duties' stored values, is accepted and
 * revokes no holder; every successful write commits one record and exactly one
 * `ProjectRoleLimitsChanged { from, to, actor }`. The entry is W's `projects/role-limits/set` (and
 * `projects/role-limits`/`role-lines/allocation` for the reads); before W the transport answers 404 and the fixture's
 * named `S7D1-DEFERRED` stops the case, never a business answer.
 * Named mutations (blocked on W): write `to` as the current record instead of the merged levels -> the lower `open`
 * does not reach the stored record and the event's `to`; drop `running` from the merge -> the non-default running
 * write reads back the default; skip the candidate codec check (`sessions/role-limits-service.ts:74`) -> a zero
 * answers `unavailable` instead of `invalid`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RoleLimitsNumbersV1, RoleLimitsViewV1 } from '../../src/contracts/role-lines.js';
import { byIdentityPrefix, commitBarrier } from '../helpers/S6A-commit-barrier.js';
import { asRecord } from '../helpers/S6A-host-fixture.js';
import { S6A_SCOPE, type S6ABackend } from '../helpers/S6A-request-fixture.js';
import { valueOf } from '../helpers/S6B3-fixture.js';
import {
  openS7D1AllocationWorld, readS7D1Limits, seedS7D1Limits, setS7D1Limits, setS7D1Open,
  type S7D1AllocationWorld,
} from '../helpers/S7D1-allocation-world.js';

vi.mock('../../src/core/record-store/in-memory-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-commit-barrier.js')).inMemoryBarrierModule(importOriginal));
vi.mock('../../src/core/record-store/sqlite-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-commit-barrier.js')).sqliteBarrierModule(importOriginal));

const BACKENDS = ['memory', 'sqlite'] as const satisfies readonly S6ABackend[];
const worlds: S7D1AllocationWorld[] = [];

async function openWorld(backend: S6ABackend): Promise<S7D1AllocationWorld> {
  const world = await openS7D1AllocationWorld({ backend });
  worlds.push(world);
  return world;
}

async function heldWrite(world: S7D1AllocationWorld,
  change: { running?: Partial<RoleLimitsNumbersV1>; open?: Partial<RoleLimitsNumbersV1> },
  expectedRevision: number, commandId: string) {
  const hold = commitBarrier.holdAfter(byIdentityPrefix('roleLimits.set:'), `the ${commandId} write`);
  try {
    const pending = setS7D1Limits(world.world, change, expectedRevision, commandId).then(answer =>
      valueOf<RoleLimitsViewV1>(answer.body, 'committed', 'the limits write'));
    const commit = await hold.reached;
    hold.release();
    return { value: await pending, commit };
  } finally {
    hold.release();
  }
}

const DEFAULTS = { open: { secretary: 8, adviser: 8, scribe: 4, executor: 16 },
  running: { secretary: 4, adviser: 4, scribe: 2, executor: 8 } };

type CasCase = { readonly name: string; readonly run: (world: S7D1AllocationWorld) => Promise<void> };

const CASES: readonly CasCase[] = [
  {
    name: 'the first write is revision 0 to 1 and merges only the given level',
    async run(world) {
      const seed = await seedS7D1Limits(world);
      expect(seed.before).toMatchObject({ revision: 0, ...DEFAULTS });
      expect(seed.first).toMatchObject({ revision: 1, open: { ...DEFAULTS.open, secretary: 9 },
        running: DEFAULTS.running });
      expect(seed.revisions).toEqual({ before: 0, first: 1, after: 1 });
    },
  },
  {
    name: 'a second write with the same expectedRevision is revision_conflict with current',
    async run(world) {
      const seed = await seedS7D1Limits(world);
      expect(seed.conflict).toMatchObject({ status: 'rejected', code: 'revision_conflict',
        current: [{ ref: { aggregateType: 'ProjectRoleLimits', projectId: S6A_SCOPE.projectId }, revision: 1 }] });
      expect(seed.after).toEqual(seed.first);
    },
  },
  {
    name: 'a lower open merges with another duty and every success commits one event',
    async run(world) {
      const seed = await seedS7D1Limits(world);
      const principal = world.world.humanContext().principal;
      if (principal.kind !== 'host') throw new Error('G3-set-cas: the world human is not a Host actor');
      const human = principal.actor;
      const first = await heldWrite(world, { open: { executor: 7 } }, seed.revisions.after, 's7d1-limits-executor');
      expect(first.value).toMatchObject({ revision: 2, open: { secretary: 9, executor: 7 } });
      expect(first.commit.events.filter(event => event.eventType === 'ProjectRoleLimitsChanged')).toHaveLength(1);

      const lower = await heldWrite(world, { open: { secretary: 6 } }, 2, 's7d1-limits-lower');
      expect(lower.value).toMatchObject({ revision: 3, open: { secretary: 6, executor: 7 } });
      const events = lower.commit.events.filter(event => event.eventType === 'ProjectRoleLimitsChanged');
      expect(events).toHaveLength(1);
      expect(JSON.parse(events[0]!.json)).toMatchObject({
        from: { open: { secretary: 9, adviser: 8, scribe: 4, executor: 7 }, running: DEFAULTS.running },
        to: { open: { secretary: 6, adviser: 8, scribe: 4, executor: 7 }, running: DEFAULTS.running },
        actor: human, revision: 3,
      });
      expect(lower.commit.records.filter(record => record.schemaId === 'ProjectRoleLimits@1')).toHaveLength(1);
      expect(await readS7D1Limits(world.world)).toMatchObject({ revision: 3, open: { secretary: 6, executor: 7 } });
    },
  },
  {
    name: 'a non-default running write is stored and read back unchanged',
    async run(world) {
      const seed = await seedS7D1Limits(world);
      const write = await heldWrite(world, { running: { scribe: 5 } }, seed.revisions.after, 's7d1-limits-running');
      expect(write.value).toMatchObject({ revision: seed.revisions.after + 1,
        running: { ...DEFAULTS.running, scribe: 5 }, open: { ...DEFAULTS.open, secretary: 9 } });
      const events = write.commit.events.filter(event => event.eventType === 'ProjectRoleLimitsChanged');
      expect(events).toHaveLength(1);
      expect(JSON.parse(events[0]!.json)).toMatchObject({
        from: { running: DEFAULTS.running, open: { ...DEFAULTS.open, secretary: 9 } },
        to: { running: { ...DEFAULTS.running, scribe: 5 }, open: { ...DEFAULTS.open, secretary: 9 } },
        revision: seed.revisions.after + 1,
      });
      expect(await readS7D1Limits(world.world)).toMatchObject({ revision: seed.revisions.after + 1,
        running: { ...DEFAULTS.running, scribe: 5 } });
    },
  },
  {
    name: 'a lower open than the holders is accepted and revokes nothing',
    async run(world) {
      const seed = await seedS7D1Limits(world);
      await world.createLine({ label: 'cas-holder-a' });
      await world.createLine({ label: 'cas-holder-b' });
      const lowered = await setS7D1Open(world.world, 'secretary', 1, seed.revisions.after, 's7d1-limits-cap');
      expect(lowered).toMatchObject({ revision: 2, open: { secretary: 1 } });
      const report = await world.allocation();
      expect(report.duties.secretary.holders).toHaveLength(2);
    },
  },
];

describe.each(BACKENDS)('G3-set-cas on the real %s Host', (backend: S6ABackend) => {
  afterEach(async () => {
    const left = commitBarrier.reset();
    await Promise.allSettled(worlds.splice(0).map(world => world.close()));
    expect(left).toEqual([]);
  });

  it.each(CASES)('$name', async (testCase: CasCase) => {
    await testCase.run(await openWorld(backend));
  }, 240_000);

  describe('rejects: zero role limits', () => {
    it.each(['open', 'running'] as const)('a zero %s value is invalid and keeps the stored value', async (level) => {
      const world = await openWorld(backend);
      const seed = await seedS7D1Limits(world);
      const change = level === 'open'
        ? { open: { secretary: 0 } } as const : { running: { secretary: 0 } } as const;
      const answer = await setS7D1Limits(world.world, change, seed.revisions.after, `s7d1-limits-zero-${level}`);
      expect(asRecord(answer.body)).toMatchObject({ status: 'rejected', code: 'invalid' });
      expect(await readS7D1Limits(world.world)).toEqual(seed.after);
    });
  });
});
