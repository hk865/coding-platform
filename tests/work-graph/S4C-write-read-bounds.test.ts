/**
 * RW-12a/§11.7: the call-count bounds of the note writes and dispositions. The
 * only double is the counting wrapper around the real record backend factories
 * (the accepted `S4C-related-scope.test.ts:60-90` style): calls are counted,
 * contents are never read. The literals below are hand-derived from §11.7's row
 * for this fixture's bucket sizes; see the comments for the per-call breakdown.
 */
import { describe, expect, it, vi } from 'vitest';
import type { NoteDraftV1 } from '../../src/contracts/note.js';
import { createNoteTools } from '../../src/core/agent-runtime/note-tool.js';
import type { ToolCall, ToolDefinition, WorkspaceSandbox } from '../../vendor/coding-agent/dist/public-api.js';
import { createS4ANoteFixture, type S4ANoteFixture, type S4ANoteFixtureKind } from '../helpers/S4A-note-fixture.js';

const KINDS: readonly S4ANoteFixtureKind[] = ['memory', 'sqlite'];
const FILE_A = { kind: 'file', path: 'src/a/x.ts' } as const;

type PortCounter = { searchText: number; lookup: number; lookupOrdered: number; readMany: number };

function toolCall(callId: string, args: Record<string, unknown>): ToolCall {
  return { schemaVersion: 1, callId, name: 'record_note', arguments: args as ToolCall['arguments'] };
}

function general(overrides: Partial<NoteDraftV1> = {}): NoteDraftV1 {
  return {
    kind: 'pitfall', topic: 'default topic', conclusion: 'default conclusion', anchor: FILE_A,
    extraAnchors: [], facts: [], basisFiles: [], structural: false, replaces: [], contradicts: [],
    coexistWith: [], body: 'body', ...overrides,
  } as NoteDraftV1;
}
const idOf = (result: { status: string }): string => (result as unknown as { noteId: string }).noteId;

/** Compose the real fixture while counting the four store-port calls. */
async function buildCounting(kind: S4ANoteFixtureKind): Promise<{ f: S4ANoteFixture; counter: PortCounter }> {
  const counter: PortCounter = { searchText: 0, lookup: 0, lookupOrdered: 0, readMany: 0 };
  const memoryBackend = await import('../../src/core/record-store/in-memory-record-store.js');
  const sqliteBackend = await import('../../src/core/record-store/sqlite-record-store.js');
  const originalMemory = memoryBackend.createInMemoryRecordBackend;
  const originalSqlite = sqliteBackend.createSqliteRecordBackend;
  const wrap = <T,>(backend: T): T => {
    const records = (backend as unknown as { records: Record<string, unknown> }).records;
    return { ...(backend as object),
      records: { ...records,
        searchText: (...args: unknown[]) => { counter.searchText += 1; return (records['searchText'] as (...a: unknown[]) => unknown)(...args); },
        lookup: (...args: unknown[]) => { counter.lookup += 1; return (records['lookup'] as (...a: unknown[]) => unknown)(...args); },
        lookupOrdered: (...args: unknown[]) => { counter.lookupOrdered += 1; return (records['lookupOrdered'] as (...a: unknown[]) => unknown)(...args); },
        readMany: (...args: unknown[]) => { counter.readMany += 1; return (records['readMany'] as (...a: unknown[]) => unknown)(...args); },
      } } as unknown as T;
  };
  const memorySpy = vi.spyOn(memoryBackend, 'createInMemoryRecordBackend')
    .mockImplementation(options => wrap(originalMemory(options)) as never);
  const sqliteSpy = vi.spyOn(sqliteBackend, 'createSqliteRecordBackend')
    .mockImplementation(options => wrap(originalSqlite(options)) as never);
  let f: S4ANoteFixture;
  try { f = await createS4ANoteFixture(kind, {}); }
  finally { memorySpy.mockRestore(); sqliteSpy.mockRestore(); }
  return { f, counter };
}

function reset(counter: PortCounter): void {
  counter.searchText = 0; counter.lookup = 0; counter.lookupOrdered = 0; counter.readMany = 0;
}

describe('RW-12a write and disposition read bounds', () => {
  it.each(KINDS)('RW-12a %s: a scribe write with two relations derives the scope facts once and reads the relations in one batch', async kind => {
    const { f, counter } = await buildCounting(kind);
    try {
      const author = f.workCtx(await f.claimRun('rw12-author'));
      const t1 = await f.write(author, general({ topic: 't1', anchor: FILE_A }), 's4a-goal');
      const t2 = await f.write(author, general({ topic: 't2', anchor: FILE_A }), 's4a-goal');
      expect(t1.status).toBe('accepted');
      expect(t2.status).toBe('accepted');
      const writer = f.workCtx(await f.claimRun('rw12-writer', 't3', 'scribe'));
      reset(counter);
      const result = await f.write(writer, general({ topic: 'w', anchor: FILE_A,
        replaces: [idOf(t1)], coexistWith: [idOf(t2)] }), 's4a-goal');
      expect(result.status).toBe('accepted');
      // §11.7 write row, hand-derived for this fixture:
      //  readMany 12 = runFacts 3 (Run/Outbox/Session)
      //              + anchor facts 5 (Goal, Goal, PlanRevision, PlanRevision, architecture)
      //              + scribe scope facts ONCE 3 (catalog pointer, catalog revision, one Run)
      //              + the write-path relation heads 1 (the two targets batched in ONE readMany)
      //  lookup 12  = anchor-set 5 (the one file anchor x 5 slots)
      //              + goal review-status 4 (accepted/reviewed/pending/staged)
      //              + the scope-facts session scan 3 (one page + two links)
      expect(counter).toEqual({ searchText: 0, lookup: 12, lookupOrdered: 0, readMany: 12 });
    } finally { await f.close(); }
  });

  it.each(KINDS)('RW-12a %s: a scribe accept reads the three disposition targets in one batch per decision step', async kind => {
    const { f, counter } = await buildCounting(kind);
    try {
      const a = f.workCtx(await f.claimRun('rw12-da'));
      const w = await f.write(a, general({ topic: 'w', anchor: FILE_A }), 's4a-goal');
      const z1 = await f.write(a, general({ topic: 'z1', anchor: FILE_A }), 's4a-goal');
      const z2 = await f.write(a, general({ topic: 'z2', anchor: FILE_A }), 's4a-goal');
      expect([w.status, z1.status, z2.status]).toEqual(['accepted', 'accepted', 'accepted']);
      const y = await f.write(f.workCtx(await f.claimRun('rw12-dy', 't2')),
        general({ topic: 'y', anchor: FILE_A, replaces: [idOf(w)], contradicts: [idOf(z1), idOf(z2)] }), 's4a-goal');
      expect(y).toMatchObject({ status: 'pending_review' });
      const scribe = f.workCtx(await f.claimRun('rw12-scribe', 't3', 'scribe'));
      reset(counter);
      const result = await f.platform.notes.reviewNote(scribe, { commandId: 'rw12-accept', noteId: idOf(y),
        expectedVersion: 1, expectedPointerRevision: null, verdict: 'accept', resolution: 'supersede', reason: '收下' });
      expect(result).toMatchObject({ status: 'done' });
      // §11.7 disposition row, hand-derived for this fixture:
      //  readMany 9 = runFacts 3 + subject head 1 + scope facts ONCE 3
      //             + relationAnchorsOf 1 batched read of the three targets
      //             + userReasonTargetsOf 1 batched read of the same three
      //               (supersessionOf reuses the preread heads, so no third read)
      //  lookup 4  = the scope-facts session scan (one page + three links)
      expect(counter).toEqual({ searchText: 0, lookup: 4, lookupOrdered: 0, readMany: 9 });
    } finally { await f.close(); }
  });

  it.each(KINDS)('RW-12c %s: a scribe disposition of two stage-anchored notes of one goal reads the plan window once', async kind => {
    const { f, counter } = await buildCounting(kind);
    try {
      const author = f.workCtx(await f.claimRun('rw12c-author'));
      const stageAnchor = { kind: 'stage', goalId: 's4a-goal', stageId: 's1' } as const;
      const u1 = await f.write(author, general({ topic: 'u1', anchor: stageAnchor }), 's4a-goal');
      const u2 = await f.write(author, general({ topic: 'u2', anchor: stageAnchor }), 's4a-goal');
      expect([u1.status, u2.status]).toEqual(['accepted', 'accepted']);
      const y = await f.write(f.workCtx(await f.claimRun('rw12c-dy', 't2')),
        general({ topic: 'y', anchor: stageAnchor, contradicts: [idOf(u1), idOf(u2)] }), 's4a-goal');
      expect(y).toMatchObject({ status: 'pending_review' });
      const scribe = f.workCtx(await f.claimRun('rw12c-scribe', 't3', 'scribe'));
      reset(counter);
      const result = await f.platform.notes.reviewNote(scribe, { commandId: 'rw12c-accept', noteId: idOf(y),
        expectedVersion: 1, expectedPointerRevision: null, verdict: 'accept', resolution: 'supersede', reason: '收下' });
      expect(result).toMatchObject({ status: 'done' });
      // §11.7 disposition row, hand-derived for this fixture (two stage-anchored
      // targets of the one goal s4a-goal):
      //  readMany 11 = runFacts 3 + subject head 1 + scope facts ONCE 3
      //              + relationAnchorsOf 1 batched read of the two targets
      //              + userReasonTargetsOf 1 batched read of the same two
      //              + the goal plan window ONCE 2 (readGoal + readPlan), shared
      //                by BOTH stage targets via the per-call cache
      //  lookup             4 = the scope-facts session scan (one page + three links)
      //  lookupOrdered      1 = planStagesByRevisionOf reads the plan-revision index
      //                         once and is already memoized across the two targets
      expect(counter).toEqual({ searchText: 0, lookup: 4, lookupOrdered: 1, readMany: 11 });
    } finally { await f.close(); }
  });

  it.each(KINDS)('RW-12c %s: a scribe disposition of three targets (one stage, two tasks) reads the plan window once', async kind => {
    const { f, counter } = await buildCounting(kind);
    try {
      const author = f.workCtx(await f.claimRun('rw12c2-author'));
      const stageAnchor = { kind: 'stage', goalId: 's4a-goal', stageId: 's1' } as const;
      const t1Anchor = { kind: 'task', goalId: 's4a-goal', taskId: 't1' } as const;
      const t2Anchor = { kind: 'task', goalId: 's4a-goal', taskId: 't2' } as const;
      const u1 = await f.write(author, general({ topic: 'u1', anchor: stageAnchor }), 's4a-goal');
      const u2 = await f.write(author, general({ topic: 'u2', anchor: t1Anchor }), 's4a-goal');
      const u3 = await f.write(author, general({ topic: 'u3', anchor: t2Anchor }), 's4a-goal');
      expect([u1.status, u2.status, u3.status]).toEqual(['accepted', 'accepted', 'accepted']);
      // The pending note carries all three anchors (one shared key with every
      // relation target) and contradicts all three accepted agent notes.
      const y = await f.write(f.workCtx(await f.claimRun('rw12c2-dy', 't2')), general({ topic: 'y',
        anchor: stageAnchor, extraAnchors: [t1Anchor, t2Anchor],
        contradicts: [idOf(u1), idOf(u2), idOf(u3)] }), 's4a-goal');
      expect(y).toMatchObject({ status: 'pending_review' });
      const scribe = f.workCtx(await f.claimRun('rw12c2-scribe', 't3', 'scribe'));
      reset(counter);
      const result = await f.platform.notes.reviewNote(scribe, { commandId: 'rw12c2-accept', noteId: idOf(y),
        expectedVersion: 1, expectedPointerRevision: null, verdict: 'accept', resolution: 'supersede', reason: '收下' });
      expect(result).toMatchObject({ status: 'done' });
      // §11.7 disposition row, hand-derived for this fixture (one stage target
      // and two task targets of the one goal s4a-goal):
      //  readMany 11 = runFacts 3 + subject head 1 + scope facts ONCE 3
      //              + relationAnchorsOf 1 batched read of the three targets
      //              + userReasonTargetsOf 1 batched read of the same three
      //              + the goal plan window ONCE 2 (readGoal + readPlan), shared
      //                by the stage branch and BOTH task targets
      //  lookup             4 = the scope-facts session scan (one page + three links)
      //  lookupOrdered      1 = planStagesByRevisionOf reads the plan-revision index
      //  RED on the old code: readMany 17; each task target re-read the Goal and
      //  then readGoalPlanWindow (Goal + PlanRevision), so the one window's 2+2+2
      //  extra reads replace the shared 2: the old-new difference is exactly 6.
      expect(counter).toEqual({ searchText: 0, lookup: 4, lookupOrdered: 1, readMany: 11 });
    } finally { await f.close(); }
  });

  it.each(KINDS)('RW-12b %s: the real record_note write with two relations plus its post-write check', async kind => {
    const { f, counter } = await buildCounting(kind);
    try {
      const author = f.workCtx(await f.claimRun('rw12b-author'));
      const t1 = await f.write(author, general({ topic: 't1', anchor: FILE_A }), 's4a-goal');
      const t2 = await f.write(author, general({ topic: 't2', anchor: FILE_A }), 's4a-goal');
      expect([t1.status, t2.status]).toEqual(['accepted', 'accepted']);
      const writer = f.workCtx(await f.claimRun('rw12b-writer', 't3', 'scribe'));
      // The REAL `record_note` factory over the real write/check owners.
      const handle = createNoteTools({ context: writer, notes: f.platform.notes, check: f.platform.notes,
        requestIdForCall: call => call.callId });
      const definition: ToolDefinition = handle.create(null as unknown as WorkspaceSandbox)[0]!;
      reset(counter);
      const result = await definition.handler.execute(toolCall('rw12b-count', {
        op: 'write', kind: 'pitfall', topic: 'w', conclusion: 'c',
        anchor: { kind: 'file', path: 'src/a/x.ts' }, body: 'body',
        replaces: [idOf(t1)], coexistWith: [idOf(t2)] }), { signal: new AbortController().signal });
      expect(result.status).toBe('success');
      const first = result.output[0];
      const value = (first !== undefined && first.kind === 'json' ? first.value : undefined) as
        { write: { status: string } } | undefined;
      expect(value?.write.status).toBe('accepted');

      // §11.7 write row: `record_note`/`notes/write` = the 4A write path + the
      // tool's post-write `checkNotes` C(1). Hand-derived for this fixture and
      // confirmed by the measured subtotals (identical on memory and sqlite):
      //  write path (RW-12a, same two-relation draft)   readMany 12, lookup 12
      //  C(1) base                                      readMany  5, lookup  9
      //    head/version batch 1 (the head read; the version read is skipped
      //      because the checked version is the head version); conflictingOf 5
      //      anchor-slot lookups; overQuotaOf 4 goal status-bucket lookups;
      //      catalog 2 (the active-pointer read + the active/baseline/catalog
      //      read in `readCurrentCatalogWindow`); author Run 1 + bound plan 1
      //      (the authoring Run's task scope in `agentRunTaskScope`).
      //  C(1) `withSimilar: true` (the tool always sends it)  lookup +5
      //  totals                                        readMany 17, lookup 26
      expect(counter).toEqual({ searchText: 0, lookup: 26, lookupOrdered: 0, readMany: 17 });
    } finally { await f.close(); }
  });
});
