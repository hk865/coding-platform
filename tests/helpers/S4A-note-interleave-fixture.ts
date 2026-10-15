/**
 * Slice 4A interleave fixture (N-07 last case, N-14) — the one permitted
 * storage-boundary double of spec §7 / book L-fixtures.
 *
 * What it builds and through which public calls: the complete real
 * `createS4ANoteFixture` (project, workspace, catalog, goal, plan, real
 * Sessions and Runs through `sessions.*`/`claims.claimTask`, the production duty
 * resolver), on memory or SQLite. The ONLY double is the commit gate: both
 * record-backend factories are spied (the WP2 pattern) while the fixture is
 * composed, so the real backend's `records.commit` is wrapped — no Run, duty,
 * plan or Session fact is invented. A `PreparedCommit` is held only when its
 * events include `NoteWritten`; a write that settles without reaching commit
 * releases the gate, so nothing deadlocks. The spies are restored right after
 * composition; the returned platform is the real one.
 *
 * The two callers are the real executor Runs claimed on `t1` and `t2` of
 * `s4a-goal`. Nothing reads the record store to answer an assertion; tests
 * assert only through `readNote`/`listByAnchor`.
 */
import { vi } from 'vitest';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { RunRef } from '../../src/contracts/dispatch.js';
import type { GoalRecordTransactionPort, PreparedCommit, StoreCommitReceipt } from '../../src/core/record-store/ports.js';
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
  // The commit gate. Inactive outside `interleave`, so normal sequential setup
  // and tests never block; it holds only the note-writing commits.
  let gate: ((run: () => Promise<unknown>) => Promise<unknown>) | null = null;
  // Item 5 (4): one injected storage-boundary read failure for the replay path.
  let failNextEventAt = false;
  const observe = <T,>(backend: T): T => {
    const records = (backend as { records: GoalRecordTransactionPort }).records;
    const rawCommit = records.commit.bind(records);
    const rawEventAt = records.eventAt.bind(records);
    const wrapped = { ...records,
      async commit(input: PreparedCommit): Promise<StoreCommitReceipt> {
        const isNoteWrite = input.events.some(event => event.eventType === 'NoteWritten');
        if (gate === null || !isNoteWrite) return rawCommit(input);
        return gate(() => rawCommit(input)) as Promise<StoreCommitReceipt>;
      },
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
      let arrivals = 0;
      let released = false;
      let openGate: () => void = () => undefined;
      const opened = new Promise<void>(resolve => { openGate = resolve; });
      const release = (): void => { if (!released) { released = true; openGate(); } };
      gate = async (run) => {
        arrivals += 1;
        if (arrivals === 1) await opened; else release();
        return run();
      };
      // A write that settles without reaching commit (a rejection, a read
      // failure) must release a first arrival already waiting at the gate.
      const settle = <T,>(promise: Promise<T>): Promise<T> => promise.then(
        value => { if (arrivals < 2) release(); return value; },
        error => { if (arrivals < 2) release(); throw error; });
      try {
        return await Promise.all([settle(left()), settle(right())]);
      } finally {
        gate = null;
        release();
      }
    },
    failNextEventAtOnce: () => { failNextEventAt = true; },
    close: () => inner.close(),
  };
}
