/**
 * F4 (review item 4; S2.3/S2.5) — the read model reuses the anchor sets and
 * heads it already read, so the injected check never reads them a second time.
 *
 * The wrapper is in the style of `tests/helpers/S4B-note-check-fixture.ts:87-99`:
 * it wraps the real backends' `records` and answers `unavailable` when the same
 * `s4-note-by-anchor-*` lookup (same index, values, after) is asked a second
 * time since the counter was reset, or the same note `readMany` is asked a
 * third time. It counts and refuses calls only; it never reads contents. Every
 * assertion goes through the real `platform.notes` holder and its real 4A
 * fixture.
 */
import { expect, it, vi } from 'vitest';
import type { NoteDraftV1 } from '../../src/contracts/note.js';
import type { RecordBatchRead, GoalRecordTransactionPort, StoreResult } from '../../src/core/record-store/ports.js';
import type { RecordLookupPort, RecordLookupRequest } from '../../src/core/record-store/lookup-ports.js';
import type { NoteMemoryReadPort, NoteReadPort } from '../../src/core/work-graph/model/note-contracts.js';
import * as memoryBackend from '../../src/core/record-store/in-memory-record-store.js';
import * as sqliteBackend from '../../src/core/record-store/sqlite-record-store.js';
import { createS4ANoteFixture, type S4ANoteFixture, type S4ANoteFixtureKind } from '../helpers/S4A-note-fixture.js';

function draft(overrides: Partial<NoteDraftV1> = {}): NoteDraftV1 {
  return { kind: 'pitfall', topic: 'sp-reuse', conclusion: 'a conclusion', body: 'body',
    anchor: { kind: 'project' }, extraAnchors: [], facts: [], basisFiles: [], structural: false,
    replaces: [], contradicts: [], coexistWith: [], ...overrides } as NoteDraftV1;
}

type ReuseFixture = {
  inner: S4ANoteFixture;
  holder: NoteReadPort & NoteMemoryReadPort;
  reset(): void;
  close(): Promise<void>;
};

async function createReuseFixture(kind: S4ANoteFixtureKind): Promise<ReuseFixture> {
  const calls = new Map<string, number>();
  // The wrapper is armed only around the read calls under test; the 4A writes
  // that seed the notes run their own (out-of-scope) write-after check.
  let armed = false;
  const originalMemory = memoryBackend.createInMemoryRecordBackend;
  const originalSqlite = sqliteBackend.createSqliteRecordBackend;
  const observe = <T,>(backend: T): T => {
    const records = (backend as unknown as { records: GoalRecordTransactionPort & RecordLookupPort }).records;
    const wrapped = { ...records,
      async lookup(request: RecordLookupRequest): ReturnType<RecordLookupPort['lookup']> {
        if (armed && request.index.startsWith('s4-note-by-anchor-')) {
          const key = `lookup:${request.index}:${JSON.stringify(request.values)}:${request.after ?? ''}`;
          const seen = calls.get(key) ?? 0;
          if (seen >= 1) return { status: 'rejected', code: 'unavailable', reason: 's4f reused anchor lookup' };
          calls.set(key, seen + 1);
        }
        return records.lookup(request);
      },
      async readMany(refKeys: readonly string[]): Promise<StoreResult<RecordBatchRead>> {
        const noteRefs = refKeys.every(refKey =>
          refKey.startsWith('{"aggregateType":"NoteHead"') || refKey.startsWith('{"aggregateType":"NoteVersion"'));
        if (armed && refKeys.length > 0 && noteRefs) {
          const key = `readMany:${refKeys.join('\u0000')}`;
          const seen = calls.get(key) ?? 0;
          // A non-head version is legitimately read twice by the read model
          // itself (the confirmation scan and the page build); a third read is
          // the check re-reading what the read model already read.
          if (seen >= 2) return { status: 'rejected', code: 'unavailable', reason: 's4f reused note read' };
          calls.set(key, seen + 1);
        }
        return records.readMany(refKeys);
      } };
    return { ...(backend as object), records: wrapped } as T;
  };
  const memorySpy = vi.spyOn(memoryBackend, 'createInMemoryRecordBackend')
    .mockImplementation(options => observe(originalMemory(options)));
  const sqliteSpy = vi.spyOn(sqliteBackend, 'createSqliteRecordBackend')
    .mockImplementation(options => observe(originalSqlite(options)));
  let inner: S4ANoteFixture;
  try {
    inner = await createS4ANoteFixture(kind);
  } finally {
    memorySpy.mockRestore();
    sqliteSpy.mockRestore();
  }
  return {
    inner,
    holder: inner.platform.notes as unknown as NoteReadPort & NoteMemoryReadPort,
    reset: () => { calls.clear(); armed = true; },
    close: () => inner.close(),
  };
}

it.each(['memory', 'sqlite'] as const)(
  'SP-19 %s: lookup, conflicts, neighbors, stale, history, readNote and listByAnchor never re-read their sets',
  async kind => {
    const f = await createReuseFixture(kind);
    try {
      // Three notes on the project anchor; ids[1] contradicts ids[0], so
      // neighbors and conflicts both have a real target. A scribe review gives
      // ids[0] a second version, so history lists a non-head version and
      // readNote is asked for the older one.
      const first = await f.inner.write(f.inner.ctx(), draft({ topic: 'reuse topic 0' }), null);
      if (first.status === 'rejected') throw new Error(`write rejected: ${JSON.stringify(first)}`);
      const ids: string[] = [first.noteId];
      const second = await f.inner.write(f.inner.ctx(),
        draft({ topic: 'reuse topic 1', contradicts: [first.noteId] }), null);
      if (second.status === 'rejected') throw new Error(`write rejected: ${JSON.stringify(second)}`);
      ids.push(second.noteId);
      const third = await f.inner.write(f.inner.ctx(), draft({ topic: 'reuse topic 2' }), null);
      if (third.status === 'rejected') throw new Error(`write rejected: ${JSON.stringify(third)}`);
      ids.push(third.noteId);
      const scribe = await f.inner.claimRun('sp19-scribe', 't3', 'scribe');
      const review = await f.inner.platform.notes.reviewNote(f.inner.workCtx(scribe),
        { commandId: 'sp19-review', noteId: ids[0]!, expectedVersion: 1, expectedPointerRevision: null,
          verdict: 'review', reason: null });
      if (review.status !== 'done') throw new Error(`review rejected: ${JSON.stringify(review)}`);

      const ctx = f.inner.ctx();
      const anchor = { kind: 'project' as const };
      const calls: readonly { readonly name: string; readonly run: () => Promise<{ status: string }> }[] = [
        { name: 'lookup', run: () => f.holder.memoryLookup(ctx,
          { v: 1, op: 'lookup', anchor, limit: 20, cursor: null }) },
        { name: 'conflicts', run: () => f.holder.memoryConflicts(ctx,
          { v: 1, op: 'conflicts', anchor, limit: 20, cursor: null }) },
        { name: 'neighbors', run: () => f.holder.memoryNeighbors(ctx,
          { v: 1, op: 'neighbors', noteId: ids[1]!, limit: 20, cursor: null }) },
        { name: 'stale', run: () => f.holder.memoryStale(ctx,
          { v: 1, op: 'stale', anchor, limit: 20, cursor: null }) },
        { name: 'history', run: () => f.holder.memoryHistory(ctx,
          { v: 1, op: 'history', noteId: ids[0]!, limit: 20, cursor: null }) },
        { name: 'readNote', run: () => f.holder.readNote(ctx, { noteId: ids[0]!, version: 1 }) },
        { name: 'listByAnchor', run: () => f.holder.listByAnchor(ctx, { anchor, limit: 20, cursor: null }) },
      ];
      const seen = new Map<string, { status: string }>();
      for (const call of calls) {
        f.reset();
        const result = await call.run();
        expect(result.status, `${call.name} should be ready`).toBe('ready');
        seen.set(call.name, result);
      }

      // Literal expected items: ids[1] contradicts ids[0] (both current) and
      // shares its anchor, so conflicts names both and neighbors of ids[1] is
      // ids[0] at its reviewed head version 2; ids[0] also keeps version 1.
      const sortedRows = (items: readonly { noteId: string; version: number }[]): [string, number][] =>
        items.map(item => [item.noteId, item.version] as [string, number]).sort((left, right) =>
          left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0);
      const sortedExpected = (pairs: readonly (readonly [string, number])[]): [string, number][] =>
        pairs.map(pair => [pair[0], pair[1]] as [string, number]).sort((left, right) =>
          left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0);
      const value = <T,>(name: string): T => (seen.get(name) as unknown as { value: T }).value;

      const conflicts = value<{ items: readonly { noteId: string; version: number }[] }>('conflicts');
      expect(sortedRows(conflicts.items)).toEqual(sortedExpected([[ids[0]!, 2], [ids[1]!, 1]]));

      const neighbors = value<{ items: readonly { noteId: string; version: number }[] }>('neighbors');
      expect(sortedRows(neighbors.items)).toEqual(sortedExpected([[ids[0]!, 2]]));

      const history = value<{ items: readonly { noteId: string; version: number }[] }>('history');
      expect(history.items.map(item => [item.noteId, item.version]))
        .toEqual([[ids[0]!, 2], [ids[0]!, 1]]);

      const readNote = value<{ noteId: string; version: number }>('readNote');
      expect([readNote.noteId, readNote.version]).toEqual([ids[0]!, 1]);
    } finally { await f.close(); }
  });
