/**
 * Slice 4C-1 rework (spec §11.3/§11.4/§11.7): the find read bounds.
 *
 * RW-10 checks that `coverage`/`filesRead`/`observedFiles` count every header
 * norm actually checked by this page's one `checkHeads`, not only the five
 * displayed ones. RW-12 checks the §11.7 call bounds: a task's Run files come
 * from one `RUN_BY_TASK_INDEX` scan plus one batched `RunActivity` read; the
 * stage anchor keys come from one prefix scan per anchor slot; and a find page
 * that stays in segment 1 never reads the second segment.
 *
 * Every expectation is literal, read through `platform.notes` (NE3). Counts are
 * taken from the fixture's counting wrapper (S4C-related-scope.test.ts:60-90):
 * call counts only, never contents.
 */
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { NoteDraftV1 } from '../../src/contracts/note.js';
import { createS4ANoteFixture, type S4ANoteFixture, type S4ANoteFixtureKind } from '../helpers/S4A-note-fixture.js';

const KINDS: readonly S4ANoteFixtureKind[] = ['memory', 'sqlite'];
const GOAL = 's4a-goal';

type PortCounter = { searchText: number; lookup: number; lookupOrdered: number; readMany: number };

function draft(overrides: Partial<NoteDraftV1> = {}): NoteDraftV1 {
  return { kind: 'pitfall', topic: 'topic', conclusion: 'a conclusion', body: 'body',
    anchor: { kind: 'project' }, extraAnchors: [], facts: [], basisFiles: [],
    structural: false, replaces: [], contradicts: [], coexistWith: [], ...overrides } as NoteDraftV1;
}

async function writeNote(f: S4ANoteFixture, d: NoteDraftV1): Promise<string> {
  const result = await f.write(f.ctx(), d, null);
  if (result.status === 'rejected') throw new Error(`note rejected: ${JSON.stringify(result)}`);
  return result.noteId;
}

/** The counting wrapper of S4C-related-scope.test.ts:60-90. */
async function buildCounted(kind: S4ANoteFixtureKind): Promise<{ f: S4ANoteFixture; counter: PortCounter }> {
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
    .mockImplementation(optionsIn => wrap(originalMemory(optionsIn)) as never);
  const sqliteSpy = vi.spyOn(sqliteBackend, 'createSqliteRecordBackend')
    .mockImplementation(optionsIn => wrap(originalSqlite(optionsIn)) as never);
  let f: S4ANoteFixture;
  try {
    f = await createS4ANoteFixture(kind);
  } finally {
    memorySpy.mockRestore();
    sqliteSpy.mockRestore();
  }
  return { f, counter };
}

/** Two related notes (task t1) and one project note (module B). */
async function seed(f: S4ANoteFixture): Promise<void> {
  const run = await f.claimRun('rw12-scribe', 't3', 'scribe');
  const ctx = f.workCtx(run);
  const write = async (d: NoteDraftV1): Promise<void> => {
    const result = await f.write(ctx, d, null);
    if (result.status === 'rejected') throw new Error(JSON.stringify(result));
  };
  await write(draft({ topic: 'r1', anchor: { kind: 'task', goalId: GOAL, taskId: 't1' } }));
  await write(draft({ topic: 'r2', anchor: { kind: 'task', goalId: GOAL, taskId: 't1' } }));
  await write(draft({ topic: 'p1', anchor: { kind: 'module', moduleId: 'B' } }));
}

const snapshot = (counter: PortCounter): PortCounter => ({ ...counter });
const deltaOf = (before: PortCounter, after: PortCounter): PortCounter =>
  ({ searchText: after.searchText - before.searchText, lookup: after.lookup - before.lookup,
    lookupOrdered: after.lookupOrdered - before.lookupOrdered, readMany: after.readMany - before.readMany });

describe('S4C find coverage counts checked header norms (RW-10)', () => {
  it.each(KINDS)('RW-10 %s: a checked-but-not-current norm still counts in coverage and observedFiles', async kind => {
    const f = await createS4ANoteFixture(kind);
    try {
      // The only eligible project norm has a changed basis file, so the check
      // marks it `currentEligible: false` and the display loop drops it.
      await writeFile(join(f.root, 'src/b/z.ts'), 'export const z = 1;\n');
      await writeNote(f, draft({ kind: 'convention', topic: 'project norm', conclusion: 'the norm',
        basisFiles: ['src/b/z.ts'] }));
      await writeFile(join(f.root, 'src/b/z.ts'), 'export const z = 2;\n');

      const read = await f.platform.notes.memoryFind(f.ctx(), { v: 1, op: 'find',
        terms: ['no-such-term-xyz'], limit: 20, cursor: null });
      expect(read.status).toBe('ready');
      if (read.status !== 'ready') return;
      expect(read.value.items).toHaveLength(0);
      // The norm was checked even though it is no longer current, so it counts.
      expect(read.value.coverage.checkedItems).toBe(1);
      expect(read.value.coverage.filesRead).toBe(1);
      expect(read.value.readBasis.observedFiles.map(observation => observation.path)).toContain('src/b/z.ts');
      // It is not current, so the displayed header omits it.
      expect(read.value.project?.norms).toHaveLength(0);
      expect(read.value.project?.omitted).toBe(1);
    } finally { await f.close(); }
  });
});

describe('S4C find/lookup read bounds (RW-12)', () => {
  it.each(KINDS)('RW-12(i) %s: a find page in segment 1 does one Run scan, one stage prefix scan and no second segment', async kind => {
    const { f, counter } = await buildCounted(kind);
    try {
      await seed(f);
      const before = snapshot(counter);
      const read = await f.platform.notes.memoryFind(f.ctx(), { v: 1, op: 'find',
        related: { kind: 'task', goalId: GOAL, taskId: 't1' }, limit: 1, cursor: null });
      expect(read.status).toBe('ready');
      if (read.status !== 'ready') return;
      expect(read.value.items).toHaveLength(1);
      expect(read.value.items[0]!.segment).toBe('related');
      expect(read.value.next).not.toBe(null);
      // 25 lookups = 15 + 1 + 5 + 4:
      //   15: the three exact related anchor keys — task:s4a-goal/t1,
      //       goal:s4a-goal, project — each read over the five
      //       s4-note-by-anchor-{0..4} equality indexes (`headsByAnchorKey`);
      //    1: the RUN_BY_TASK_INDEX scan for t1 (`readTaskChangedFiles`; empty,
      //       because the seed binds its Run to t3, not t1);
      //    5: the first-page project-anchor set (`selectProjectHeader`'s own
      //       `headsByAnchorKey('project')`, separate from the related read);
      //    4: the accepted/reviewed/pending_review/staged goal buckets
      //       `overQuotaOf` reads for r1 (`currentHeadsForGoal`).
      // lookupOrdered = 5: the one `stage:s4a-goal/` prefix scan over the five
      // s4b-note-by-path-{0..4} ordered indexes.
      // readMany = 5: the ledger cursor (`readMany([])`); the goal record and
      // the active plan record (`readGoalPlanWindow`); the RunActivity batch
      // (`readTaskChangedFiles`); the project CurrentPointer (`pointerOf`). The
      // check reuses the plan window the related-scope resolution already read
      // (rework item 5(b)), so it does not re-read goal+plan. No `searchText`:
      // segment 1 is scanned in memory and the page never reaches segment 2.
      expect(deltaOf(before, counter)).toEqual({ searchText: 0, lookup: 25, lookupOrdered: 5, readMany: 5 });
    } finally { await f.close(); }
  });

  it.each(KINDS)('RW-12(ii) %s: a find page that spills into segment 2 reads the second segment', async kind => {
    const { f, counter } = await buildCounted(kind);
    try {
      await seed(f);
      const before = snapshot(counter);
      const read = await f.platform.notes.memoryFind(f.ctx(), { v: 1, op: 'find',
        related: { kind: 'task', goalId: GOAL, taskId: 't1' }, limit: 3, cursor: null });
      expect(read.status).toBe('ready');
      if (read.status !== 'ready') return;
      expect(read.value.items.map(item => item.segment)).toEqual(['related', 'related', 'project']);
      // The spill adds 12 lookups (25 -> 37):
      //   1: the a2-goal-by-workspace goal index (`projectGoalIds`);
      //   6: the visible-state buckets over the two slots — the project slot
      //      (null) and s4a-goal, three states each (accepted, reviewed,
      //      pending_review; the host caller has no own-goal narrowing);
      //   5: the extra checked item p1's module:B anchor set, read by the check
      //      (`conflictingOf`'s `headsByAnchorKey('module:B')`, not seeded by
      //      the related-scope anchor sets, which cover only task/goal/project).
      // readMany = 8: the segment-1 five (ledger cursor; goal record; active
      // plan record; RunActivity batch; project CurrentPointer) plus the
      // module-anchored p1's three catalog reads — the active-catalog window's
      // two `readMany` calls (active pointer; then pointer+baseline+catalog) and
      // the basis catalog revision's baseline+catalog read. The scoped plan
      // window is still shared with the check, so the extra checked item adds no
      // plan read.
      expect(deltaOf(before, counter)).toEqual({ searchText: 0, lookup: 37, lookupOrdered: 5, readMany: 8 });
    } finally { await f.close(); }
  });

  it.each(KINDS)('RW-12(iii) %s: a lookup page reads one anchor set', async kind => {
    const { f, counter } = await buildCounted(kind);
    try {
      await seed(f);
      const before = snapshot(counter);
      const read = await f.platform.notes.memoryLookup(f.ctx(), { v: 1, op: 'lookup',
        anchor: { kind: 'task', goalId: GOAL, taskId: 't1' }, limit: 20, cursor: null });
      expect(read.status).toBe('ready');
      if (read.status !== 'ready') return;
      expect(read.value.items).toHaveLength(2);
      // Lookups: the task anchor set (5) plus the EXISTING `overQuota`
      // derivation's 4 goal status-bucket scans (review status
      // accepted/reviewed/pending/staged; unchanged from round 1 per §11.7's
      // first bullet) = 9. readMany = ledger 1 + the plan window (goal + active
      // plan) 2 = 3. lookupOrdered/searchText 0.
      expect(deltaOf(before, counter)).toEqual({ searchText: 0, lookup: 9, lookupOrdered: 0, readMany: 3 });
    } finally { await f.close(); }
  });
});
