/**
 * Slice 4A interleave fixture (N-07 last case, N-14) — the one permitted
 * storage-boundary double of spec §7 / book L-fixtures.
 *
 * What it builds and through which public calls: the complete real
 * `createS4ANoteFixture` (project, workspace, catalog, goal, plan, real
 * Sessions and Runs through `sessions.*`/`claims.claimTask`, the production duty
 * resolver), on memory or SQLite. KLS-2b [2B-06]: the commit gate is gone (the
 * project's in-process write queue runs one note write at a time, so a held
 * commit could never meet the second write); `interleave` starts both writes at
 * once. The ONLY double left is the one-shot `eventAt` failure: both
 * record-backend factories are spied (the WP2 pattern) while the fixture is
 * composed — no Run, duty, plan or Session fact is invented. The spies are
 * restored right after composition; the returned platform is the real one.
 *
 * The two callers are the real executor Runs claimed on `t1` and `t2` of
 * `s4a-goal`. Nothing reads the record store to answer an assertion; tests
 * assert only through `readNote`/`listByAnchor`.
 */
import { vi } from 'vitest';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { RunRef } from '../../src/contracts/dispatch.js';
import type { GoalRecordTransactionPort } from '../../src/core/record-store/ports.js';
import type { NoteReadPort, NoteWritePort } from '../../src/core/work-graph/model/note-contracts.js';
import * as memoryBackend from '../../src/core/record-store/in-memory-record-store.js';
import * as sqliteBackend from '../../src/core/record-store/sqlite-record-store.js';
import { createS4ANoteFixture, type S4ANoteFixture, type S4ANoteFixtureKind } from './S4A-note-fixture.js';

export type S4AInterleaveFixture = {
  notes: NoteWritePort & NoteReadPort;
  hostCtx(): CoreCallContext;
  workCtxA(): CoreCallContext;
  workCtxB(): CoreCallContext;
  runA: RunRef;
  runB: RunRef;
  interleave<T>(left: () => Promise<T>, right: () => Promise<T>): Promise<[T, T]>;
  /** Item 5 (4): make the NEXT storage `eventAt` fail once (memory-only cases). */
  failNextEventAtOnce(): void;
  close(): Promise<void>;
};

export async function createS4AInterleaveFixture(kind: S4ANoteFixtureKind,
  options: { anchorQuota?: number; goalQuota?: number } = {}): Promise<S4AInterleaveFixture> {
  // Item 5 (4): one injected storage-boundary read failure for the replay path.
  let failNextEventAt = false;
  const observe = <T,>(backend: T): T => {
    const records = (backend as { records: GoalRecordTransactionPort }).records;
    const rawEventAt = records.eventAt.bind(records);
    const wrapped = { ...records,
      async eventAt(cursor: Parameters<GoalRecordTransactionPort['eventAt']>[0]):
      ReturnType<GoalRecordTransactionPort['eventAt']> {
        if (!failNextEventAt) return rawEventAt(cursor);
        failNextEventAt = false;
        return { status: 'rejected', code: 'unavailable', reason: 's4a injected eventAt failure' };
      } };
    return { ...(backend as object), records: wrapped } as T;
  };

  const originalMemory = memoryBackend.createInMemoryRecordBackend;
  const originalSqlite = sqliteBackend.createSqliteRecordBackend;
  const memorySpy = vi.spyOn(memoryBackend, 'createInMemoryRecordBackend')
    .mockImplementation(options => observe(originalMemory(options)));
  const sqliteSpy = vi.spyOn(sqliteBackend, 'createSqliteRecordBackend')
    .mockImplementation(options => observe(originalSqlite(options)));
  let inner: S4ANoteFixture;
  try {
    inner = await createS4ANoteFixture(kind, options);
  } finally {
    memorySpy.mockRestore();
    sqliteSpy.mockRestore();
  }

  const runA = await inner.claimRun('interleave-a', 't1', 'executor');
  const runB = await inner.claimRun('interleave-b', 't2', 'executor');

  return {
    notes: inner.notes as unknown as NoteWritePort & NoteReadPort,
    hostCtx: () => inner.ctx(),
    workCtxA: () => inner.workCtx(runA),
    workCtxB: () => inner.workCtx(runB),
    runA,
    runB,
    async interleave<T>(left: () => Promise<T>, right: () => Promise<T>): Promise<[T, T]> {
      // KLS-2b [2B-06]: a note write's prepare, commit, files and index run in the project's in-process write
      // queue, so a second write can no longer reach the commit while the first is held there (the old commit
      // gate deadlocked). Both writes start at once; the queue runs them one after the other, left first.
      return Promise.all([left(), right()]);
    },
    failNextEventAtOnce: () => { failNextEventAt = true; },
    close: () => inner.close(),
  };
}
