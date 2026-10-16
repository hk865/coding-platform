/**
 * RW-2: a concurrent USER confirmation must not be superseded.
 *
 * The bug: `dispose` decides the live user reasons from target reads at v1, then
 * `supersessionOf(..., prereadHeads = null, ...)` re-reads the target (now the
 * user-confirmed v2) and supersedes it. The interleave is the one permitted
 * storage-boundary seam: both record-backend factories are spied (the WP2 /
 * `task-claim-fixture.ts` `wrapRecords` pattern) before `createS4ANoteFixture`,
 * so only the real `readMany` is wrapped; on the SECOND read of the target head
 * (the disposition-decision read, after the scribe-scope check already read it
 * once) the person accepts that pending target through the real
 * `platform.notes.reviewNote`. No record-store read answers an assertion.
 */
import { describe, expect, it, vi } from 'vitest';
import type { NoteDraftV1 } from '../../src/contracts/note.js';
import type { GoalRecordTransactionPort } from '../../src/core/record-store/ports.js';
import * as memoryBackend from '../../src/core/record-store/in-memory-record-store.js';
import * as sqliteBackend from '../../src/core/record-store/sqlite-record-store.js';
import { createS4ANoteFixture, type S4ANoteFixture, type S4ANoteFixtureKind } from '../helpers/S4A-note-fixture.js';

const KINDS: readonly S4ANoteFixtureKind[] = ['memory', 'sqlite'];
const FILE_A = { kind: 'file', path: 'src/a/x.ts' } as const;

function general(overrides: Partial<NoteDraftV1> = {}): NoteDraftV1 {
  return {
    kind: 'pitfall', topic: 'default topic', conclusion: 'default conclusion', anchor: FILE_A,
    extraAnchors: [], facts: [], basisFiles: [], structural: false, replaces: [], contradicts: [],
    coexistWith: [], body: 'body', ...overrides,
  } as NoteDraftV1;
}

const idOf = (result: { status: string }): string => (result as unknown as { noteId: string }).noteId;

type RaceSeam = {
  /** Arm the interleave; `action` runs on the second read of `noteId`'s head. */
  arm(noteId: string, action: () => Promise<void>): void;
};

/** The real fixture over a `readMany`-wrapped backend; the wrapper is inert until `arm`. */
async function buildRaceFixture(kind: S4ANoteFixtureKind): Promise<{ f: S4ANoteFixture; seam: RaceSeam }> {
  let armed = false;
  let fired = false;
  let reads = 0;
  let target = '';
  let action: (() => Promise<void>) | null = null;
  const observe = <T,>(backend: T): T => {
    const records = (backend as unknown as { records: GoalRecordTransactionPort }).records;
    const rawReadMany = records.readMany.bind(records);
    return { ...(backend as object), records: { ...records,
      async readMany(refKeys: readonly string[]): Promise<unknown> {
        const result = await rawReadMany(refKeys as string[]);
        if (armed && !fired && refKeys.some(key => key.includes(target))) {
          reads += 1;
          if (reads === 2) {
            fired = true;
            const run = action;
            if (run !== null) await run();
          }
        }
        return result;
      } } } as unknown as T;
  };
  const originalMemory = memoryBackend.createInMemoryRecordBackend;
  const originalSqlite = sqliteBackend.createSqliteRecordBackend;
  const memorySpy = vi.spyOn(memoryBackend, 'createInMemoryRecordBackend')
    .mockImplementation(options => observe(originalMemory(options)) as never);
  const sqliteSpy = vi.spyOn(sqliteBackend, 'createSqliteRecordBackend')
    .mockImplementation(options => observe(originalSqlite(options)) as never);
  let f: S4ANoteFixture;
  try {
    // goalQuota 1 makes the second agent note pending_review, so the person can
    // really `accept` it (only a pending note accepts).
    f = await createS4ANoteFixture(kind, { goalQuota: 1 });
  } finally {
    memorySpy.mockRestore();
    sqliteSpy.mockRestore();
  }
  return { f, seam: { arm(noteId, run) { target = noteId; action = run; reads = 0; fired = false; armed = true; } } };
}

async function itemOf(f: S4ANoteFixture, noteId: string): Promise<{ storedState: string; version: number;
  confirmedByUser: boolean; replaces: string[]; coexistWith: string[] }> {
  const read = await f.platform.notes.readNote(f.ctx(), { noteId });
  if (read.status !== 'ready') throw new Error(`note ${noteId} is not readable: ${JSON.stringify(read)}`);
  return read.value;
}

describe('RW-2 a concurrent user confirmation is not superseded', () => {
  it.each(KINDS)('RW-2 %s: a user accept between the decision read and the commit is revision_conflict', async kind => {
    const { f, seam } = await buildRaceFixture(kind);
    try {
      const user = f.ctx();
      // z: a live agent contradiction (accepted, agent source).
      const z = await f.write(f.workCtx(await f.claimRun('rw2-z')), general({ topic: 'z', anchor: FILE_A }),
        's4a-goal');
      const zId = idOf(z);
      expect(z.status).toBe('accepted');
      // x: the pending agent target note y replaces; the person accepts it mid-commit.
      const x = await f.write(f.workCtx(await f.claimRun('rw2-x', 't2')), general({ topic: 'x', anchor: FILE_A }),
        's4a-goal');
      const xId = idOf(x);
      expect(x).toMatchObject({ status: 'pending_review', reasons: ['quota_full'] });
      // y: pending (a live contradiction with z; the goal is over quota) and it
      // replaces the pending agent note x. The scribe wrote it (t3).
      const scribeRun = await f.claimRun('rw2-scribe', 't3', 'scribe');
      const scribe = f.workCtx(scribeRun);
      const y = await f.write(scribe, general({ topic: 'y', anchor: FILE_A, replaces: [xId], contradicts: [zId] }),
        's4a-goal');
      const yId = idOf(y);
      expect(y).toMatchObject({ status: 'pending_review' });

      // The interleave: on the decision read of x, the person accepts x.
      seam.arm(xId, async () => {
        const confirmed = await f.platform.notes.reviewNote(user, { commandId: 'rw2-user-confirm',
          noteId: xId, expectedVersion: 1, expectedPointerRevision: null, verdict: 'accept', reason: '我确认这条' });
        expect(confirmed).toMatchObject({ status: 'done', state: 'accepted' });
      });

      const result = await f.platform.notes.reviewNote(scribe, { commandId: 'rw2-scribe-accept', noteId: yId,
        expectedVersion: 1, expectedPointerRevision: null, verdict: 'accept', resolution: 'supersede', reason: '收下' });
      expect(result).toMatchObject({ status: 'rejected', code: 'revision_conflict' });

      // The user-confirmed target is still current and was not superseded.
      const xItem = await itemOf(f, xId);
      expect(xItem).toMatchObject({ storedState: 'accepted', confirmedByUser: true, version: 2 });
      // The live contradiction was not superseded either; the scribe's note stayed pending.
      expect((await itemOf(f, zId)).storedState).toBe('accepted');
      expect((await itemOf(f, yId)).storedState).toBe('pending_review');
    } finally { await f.close(); }
  });
});
