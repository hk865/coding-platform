/**
 * Slice 8 L8 / rework-2 rows K4-17…K4-23 (rule sheet F10; lead ruling 6): the
 * architecture reminder's own read counts during ONE public
 * `runtime.prepareExecution`.
 *
 * The counts are measured at the real physical layers, not on the reader: A3
 * delegating wrappers around the real record backends and the real body store.
 * Each record-store `readMany` CALL is 1 (one key or a batch, whatever it
 * returns); each body-store `read` CALL is 1 whenever it is called.
 *
 * Expected literals are hand-computed from B§7 end / B§4 and the lead's ruling
 * 6: with 12 files and `chunkBytes: 500` (6 chunks) 5 record + 7 body = 12;
 * after adding a 13th file (7 chunks, previous 6 chunks) 6 + 15 = 21.
 * The seven lost facts checks are restored below, outside the counted window.
 */
import { describe, expect, it, vi } from 'vitest';
import { RawArtifactBodyStore } from '../../src/core/record-store/body-store.js';
import * as reminderFactsModule from '../../src/composition/architecture-reminder-facts.js';
import { createReminderWorld } from '../helpers/S8A-L8-reminder-world.js';

type Counts = { records: number; bodies: number };

async function countFixture() {
  const memoryBackend = await import('../../src/core/record-store/in-memory-record-store.js');
  const sqliteBackend = await import('../../src/core/record-store/sqlite-record-store.js');
  const originalMemory = memoryBackend.createInMemoryRecordBackend;
  const originalSqlite = sqliteBackend.createSqliteRecordBackend;
  const state: { active: boolean; inReminder: boolean; counts: Counts } =
    { active: false, inReminder: false, counts: { records: 0, bodies: 0 } };
  // A3 marker: the counts below are taken at the real store, but only while the
  // composition root's REAL reminder reader is on the stack, so the other
  // preparation dependencies (graph context, notes, decisions, goal conflicts)
  // stay out of the formula.
  const originalReader = reminderFactsModule.createArchitectureReminderFactsReader;
  const readerSpy = vi.spyOn(reminderFactsModule, 'createArchitectureReminderFactsReader')
    .mockImplementation(deps => {
      const real = originalReader(deps);
      return {
        async read(ctx, workspace) {
          const prior = state.inReminder;
          state.inReminder = true;
          try { return await real.read(ctx, workspace); } finally { state.inReminder = prior; }
        },
      };
    });
  const wrap = <T,>(backend: T): T => {
    const records = (backend as unknown as {
      records: { readMany(refKeys: readonly string[]): unknown };
    }).records;
    return { ...(backend as object),
      records: { ...records,
        async readMany(refKeys: readonly string[]) {
          // Ruling 6: one record-store READ CALL counts once, whether it names
          // one key or a batch, and whatever it returns.
          if (state.active && state.inReminder) state.counts.records += 1;
          return (records.readMany as (keys: readonly string[]) => unknown)(refKeys);
        } } } as unknown as T;
  };
  const memorySpy = vi.spyOn(memoryBackend, 'createInMemoryRecordBackend')
    .mockImplementation(optionsIn => wrap(originalMemory(optionsIn)) as never);
  const sqliteSpy = vi.spyOn(sqliteBackend, 'createSqliteRecordBackend')
    .mockImplementation(optionsIn => wrap(originalSqlite(optionsIn)) as never);
  const originalRead = RawArtifactBodyStore.prototype.read;
  const bodySpy = vi.spyOn(RawArtifactBodyStore.prototype, 'read').mockImplementation(async function (
    this: RawArtifactBodyStore, ref) {
    // Ruling 6: one body-store READ CALL counts once, counted when called,
    // whatever it returns.
    if (state.active && state.inReminder) state.counts.bodies += 1;
    return originalRead.call(this, ref);
  });
  return {
    state,
    restore() { readerSpy.mockRestore(); memorySpy.mockRestore(); sqliteSpy.mockRestore(); bodySpy.mockRestore(); },
  };
}

describe('one public prepare reads the architecture reminder dependencies once', () => {
  it.each(['memory', 'sqlite'] as const)(
    '12 files: 5 record + 7 body = 12; a 13th file with a previous observation: 6 + 15 = 21 (%s)', async (kind) => {
    const counted = await countFixture();
    const files = Object.fromEntries(Array.from({ length: 12 }, (_unused, index) => {
      const name = `f${String(index).padStart(2, '0')}`;
      return [`src/${name}.ts`, `export const ${name} = ${String(index)};\n`];
    }));
    const world = await createReminderWorld(kind, {
      catalog: { modules: [{ id: 'A', paths: ['src'] }], dependencies: [], taskModule: 'A' },
      stages: [],
      fileGraph: { maxNodes: 100, maxEdges: 100, chunkBytes: 500 },
    });
    try {
      await world.capture({ write: files }, 's8a-l8-read-count-first');
      counted.state.active = true;
      counted.state.counts = { records: 0, bodies: 0 };
      let first: Counts;
      try {
        const { input } = await world.prepare(world.ctx, 's8a-l8-read-count-prepare-first');
        expect(input.length).toBeGreaterThan(0);
        first = { ...counted.state.counts };
      } finally {
        counted.state.active = false;
      }
      // 12 nodes at 500 bytes/2 nodes per chunk = 6 chunks: one main body each.
      expect(first.bodies).toBe(7);
      expect(first.records).toBe(5);
      expect(first.records + first.bodies).toBe(12);

      // The seven restored checks (ruling 6; old ledger Obs:600, 602, 603,
      // 623, 625, 626, 627): a public facts read OUTSIDE the counted window.
      const firstFacts = await world.platform.architecture.readReminderFacts(world.ctx,
        { workspace: world.scope, catalog: null });
      expect(firstFacts.status).toBe('ready');
      if (firstFacts.status !== 'ready') throw Error('first facts read: ' + JSON.stringify(firstFacts));
      expect(firstFacts.value.state.previous).toBeNull();
      expect(firstFacts.value.latest!.nodes).toHaveLength(12);

      // The 13th file makes the latest observation 7 chunks and leaves the
      // 12-file observation as `previous` (6 chunks).
      await world.capture({ write: {
        'src/f12.ts': 'export const f12 = 12;\n',
      } }, 's8a-l8-read-count-second');
      counted.state.active = true;
      counted.state.counts = { records: 0, bodies: 0 };
      let second: Counts;
      try {
        const { input } = await world.prepare(world.ctx, 's8a-l8-read-count-prepare-second');
        expect(input.length).toBeGreaterThan(0);
        second = { ...counted.state.counts };
      } finally {
        counted.state.active = false;
      }
      expect(second.bodies).toBe(15);
      expect(second.records).toBe(6);
      expect(second.records + second.bodies).toBe(21);

      const secondFacts = await world.platform.architecture.readReminderFacts(world.ctx,
        { workspace: world.scope, catalog: null });
      expect(secondFacts.status).toBe('ready');
      if (secondFacts.status !== 'ready') throw Error('second facts read: ' + JSON.stringify(secondFacts));
      expect(secondFacts.value.state.previous).not.toBeNull();
      expect(secondFacts.value.latest!.nodes).toHaveLength(13);
      expect(secondFacts.value.previous!.nodes).toHaveLength(12);
    } finally {
      counted.state.active = false;
      await world.close();
      counted.restore();
    }
  });
});
