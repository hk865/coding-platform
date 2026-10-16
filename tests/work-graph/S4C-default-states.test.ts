/**
 * Slice 4C-1 C2.3/C2.4 — §11.3 default states, b11 check-then-drop, RULE_VERSION
 * 2 and the §11.4 project-understanding read side. Every assertion goes through
 * the public `platform.notes` reads; data is built through the real 4A writer
 * and a real temporary workspace (NE3), on both backends.
 */
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { NoteDraftV1 } from '../../src/contracts/note.js';
import { createS4BNoteCheckFixture, type S4BNoteCheckFixture } from '../helpers/S4B-note-check-fixture.js';
import { createS4BExtraGoal } from '../helpers/S4B-memory-fixture.js';

function draft(overrides: Partial<NoteDraftV1> = {}): NoteDraftV1 {
  return { kind: 'pitfall', topic: 'ds', conclusion: 'a conclusion', body: 'body',
    anchor: { kind: 'project' }, extraAnchors: [], facts: [], basisFiles: [], structural: false,
    replaces: [], contradicts: [], coexistWith: [], ...overrides } as NoteDraftV1;
}

async function write(f: S4BNoteCheckFixture, ctx: CoreCallContext, note: NoteDraftV1,
  goalId: string | null): Promise<string> {
  const result = await f.inner.write(ctx, note, goalId);
  if (result.status === 'rejected') throw new Error(`write rejected: ${JSON.stringify(result)}`);
  return result.noteId;
}

async function review(f: S4BNoteCheckFixture, ctx: CoreCallContext, noteId: string,
  verdict: 'review' | 'reject'): Promise<void> {
  const result = await f.inner.platform.notes.reviewNote(ctx, {
    commandId: `s4c-review-${noteId}-${verdict}`, noteId, expectedVersion: 1,
    expectedPointerRevision: null, verdict, reason: verdict === 'review' ? null : 's4c reason' });
  if (result.status !== 'done') throw new Error(`review rejected: ${JSON.stringify(result)}`);
}

async function withdraw(f: S4BNoteCheckFixture, ctx: CoreCallContext, noteId: string): Promise<void> {
  const result = await f.inner.platform.notes.withdrawNote(ctx,
    { commandId: `s4c-withdraw-${noteId}`, noteId, expectedVersion: 1, reason: 's4c' });
  if (result.status !== 'done') throw new Error(`withdraw rejected: ${JSON.stringify(result)}`);
}

type StateFixture = {
  g1: CoreCallContext;
  g2: CoreCallContext;
  a: string; b: string; c: string; h: string; i: string; j: string; k: string;
  d: string; e: string; f: string; g: string;
};

/**
 * DS-01's fixture: own (g1) a accepted, b reviewed, c pending structural, h
 * superseded (replaced by the g2 note i, which is then withdrawn), j rejected,
 * k accepted then its basis file changes. Other goal (g2): d pending, e
 * agent-accepted, f reviewed, g user-confirmed. A large anchor quota keeps the
 * accepted notes from becoming quota-pending.
 */
async function buildStateFixture(f: S4BNoteCheckFixture): Promise<StateFixture> {
  const g1Run = await f.inner.claimRun('s4c-ds-g1');
  const g1Scribe = await f.inner.claimRun('s4c-ds-g1-scribe', 't3', 'scribe');
  const g1 = f.inner.workCtx(g1Run);
  const extra = await createS4BExtraGoal(f, 's4c-ds-goal-2');
  const g2Run = await extra.claimRun('s4c-ds-g2', 't1', 'executor');
  const g2Scribe = await extra.claimRun('s4c-ds-g2-scribe', 't3', 'scribe');
  const g2 = extra.workCtx(g2Run, 'executor');

  const a = await write(f, g1, draft({ topic: 'a-own-accepted' }), null);
  const b = await write(f, g1, draft({ topic: 'b-own-reviewed' }), null);
  await review(f, f.inner.workCtx(g1Scribe), b, 'review');
  // C3.4: an agent's structural general note is accepted, so pending notes are
  // made by contradicting a current note (`contradiction`).
  const c = await write(f, g1, draft({ topic: 'c-own-pending', contradicts: [a] }), null);
  const h = await write(f, g1, draft({ topic: 'h-own-superseded' }), null);
  const i = await write(f, g2, draft({ topic: 'i-g2-withdrawn', replaces: [h] }), null);
  await withdraw(f, f.ctx(), i);
  const j = await write(f, g1, draft({ topic: 'j-own-rejected', contradicts: [b] }), null);
  await review(f, f.ctx(), j, 'reject');
  const d = await write(f, g2, draft({ topic: 'd-g2-pending', contradicts: [a] }), null);
  const e = await write(f, g2, draft({ topic: 'e-g2-accepted' }), null);
  const fNote = await write(f, g2, draft({ topic: 'f-g2-reviewed' }), null);
  await review(f, extra.workCtx(g2Scribe, 'scribe'), fNote, 'review');
  const g = await write(f, f.ctx(), draft({ topic: 'g-g2-confirmed' }), extra.goalRef.goalId);
  const k = await write(f, g1, draft({ topic: 'k-own-stale', basisFiles: ['src/a/x.ts'] }), null);
  await writeFile(join(f.root, 'src/a/x.ts'), 'export const a = 42;\n');
  return { g1, g2, a, b, c, h, i, j, k, d, e, f: fNote, g };
}

describe('S4C DS-01 default states in find', () => {
  it.each(['memory', 'sqlite'] as const)(
    'DS-01 %s: a g1 work Run sees only its visible set on the project anchor; the host sees every goal visible note',
    async kind => {
      const f = await createS4BNoteCheckFixture(kind, { anchorQuota: 50 });
      try {
        const s = await buildStateFixture(f);
        const request = { v: 1 as const, op: 'find' as const, anchor: { kind: 'project' as const },
          limit: 50, cursor: null as string | null };
        const g1Read = await f.memory.memoryFind(s.g1, request);
        expect(g1Read.status).toBe('ready');
        if (g1Read.status !== 'ready') return;
        expect(g1Read.value.items.map(item => item.noteId))
          .toEqual([s.a, s.b, s.c, s.f, s.g, s.k]);
        const byId = new Map(g1Read.value.items.map(item => [item.noteId, item]));
        expect(byId.get(s.c)!.storedState).toBe('pending_review');
        expect(byId.get(s.c)!.currentEligible).toBe(false);
        expect(byId.get(s.k)!.staleReasons).toContain('file_changed');
        expect(byId.get(s.k)!.currentEligible).toBe(false);
        expect(byId.get(s.f)!.storedState).toBe('reviewed');
        expect(byId.get(s.g)!.confirmedByUser).toBe(true);

        const hostRead = await f.memory.memoryFind(f.ctx(), request);
        expect(hostRead.status).toBe('ready');
        if (hostRead.status !== 'ready') return;
        expect(hostRead.value.items.map(item => item.noteId))
          .toEqual([s.a, s.b, s.c, s.d, s.e, s.f, s.g, s.k]);
        const hostById = new Map(hostRead.value.items.map(item => [item.noteId, item]));
        expect(hostById.get(s.d)!.storedState).toBe('pending_review');
        expect(hostById.get(s.e)!.storedState).toBe('accepted');

        // §11.3 item 2: the no-terms no-anchor status route reads only the
        // visible states, so the same sets come back.
        const global = { v: 1 as const, op: 'find' as const, limit: 50, cursor: null as string | null };
        const g1Global = await f.memory.memoryFind(s.g1, global);
        expect(g1Global.status).toBe('ready');
        if (g1Global.status !== 'ready') return;
        expect(g1Global.value.items.map(item => item.noteId)).toEqual([s.a, s.b, s.c, s.f, s.g, s.k]);
        const hostGlobal = await f.memory.memoryFind(f.ctx(), global);
        expect(hostGlobal.status).toBe('ready');
        if (hostGlobal.status !== 'ready') return;
        expect(hostGlobal.value.items.map(item => item.noteId)).toEqual([s.a, s.b, s.c, s.d, s.e, s.f, s.g, s.k]);
      } finally { await f.close(); }
    });
});

describe('S4C DS-02 explicit state override', () => {
  it.each(['memory', 'sqlite'] as const)(
    'DS-02 %s: an explicit state returns exactly that state, with no goal filter for retired states',
    async kind => {
      const f = await createS4BNoteCheckFixture(kind, { anchorQuota: 50 });
      try {
        const s = await buildStateFixture(f);
        const base = { v: 1 as const, op: 'find' as const, anchor: { kind: 'project' as const },
          limit: 50, cursor: null as string | null };
        const superseded = await f.memory.memoryFind(s.g1, { ...base, state: 'superseded' });
        expect(superseded.status).toBe('ready');
        if (superseded.status !== 'ready') return;
        expect(superseded.value.items.map(item => item.noteId)).toEqual([s.h]);
        const withdrawn = await f.memory.memoryFind(s.g1, { ...base, state: 'withdrawn' });
        expect(withdrawn.status).toBe('ready');
        if (withdrawn.status !== 'ready') return;
        expect(withdrawn.value.items.map(item => item.noteId)).toEqual([s.i]);
        // The same explicit state through the no-anchor status route reads only
        // that state's bucket and keeps the no-goal-filter rule for retired states.
        const globalSuperseded = await f.memory.memoryFind(s.g1, { v: 1, op: 'find', state: 'superseded',
          limit: 50, cursor: null });
        expect(globalSuperseded.status).toBe('ready');
        if (globalSuperseded.status !== 'ready') return;
        expect(globalSuperseded.value.items.map(item => item.noteId)).toEqual([s.h]);
        const globalWithdrawn = await f.memory.memoryFind(s.g1, { v: 1, op: 'find', state: 'withdrawn',
          limit: 50, cursor: null });
        expect(globalWithdrawn.status).toBe('ready');
        if (globalWithdrawn.status !== 'ready') return;
        expect(globalWithdrawn.value.items.map(item => item.noteId)).toEqual([s.i]);
      } finally { await f.close(); }
    });
});

describe('S4C DS-03 ranking ignores retired notes', () => {
  it.each(['memory', 'sqlite'] as const)(
    'DS-03 %s: T-07 scores stay 3.9120 / 2.3026 / 0.6931 when a withdrawn and a superseded note carry the terms',
    async kind => {
      const f = await createS4BNoteCheckFixture(kind, { anchorQuota: 50 });
      try {
        const n1 = await write(f, f.ctx(), draft({ topic: 'alpha topic', conclusion: 'beta conclusion', body: 'plain' }), null);
        const n2 = await write(f, f.ctx(), draft({ topic: 'neutral two', conclusion: 'alpha conclusion', body: 'beta body' }), null);
        const n3 = await write(f, f.ctx(), draft({ topic: 'neutral three', conclusion: 'plain conclusion', body: 'alpha body' }), null);
        const withdrawn = await write(f, f.ctx(), draft({ topic: 'alpha withdrawn' }), null);
        await withdraw(f, f.ctx(), withdrawn);
        const superseded = await write(f, f.ctx(), draft({ topic: 'beta superseded' }), null);
        const replacer = await write(f, f.ctx(),
          draft({ topic: 'neutral replacement', replaces: [superseded] }), null);
        expect(replacer).not.toBe('');
        const read = await f.memory.memoryFind(f.ctx(), { v: 1, op: 'find', terms: ['alpha', 'beta'],
          match: 'any', limit: 20, cursor: null });
        expect(read.status).toBe('ready');
        if (read.status !== 'ready') return;
        expect(read.value.items.map(item => item.noteId)).toEqual([n1, n2, n3]);
        expect(read.value.items[0]!.score).toBeCloseTo(3.9120, 3);
        expect(read.value.items[1]!.score).toBeCloseTo(2.3026, 3);
        expect(read.value.items[2]!.score).toBeCloseTo(0.6931, 3);
        expect(read.value.ranking).toBe('full');
      } finally { await f.close(); }
    });
});

describe('S4C DS-04 lookup b11', () => {
  it.each(['memory', 'sqlite'] as const)(
    'DS-04 %s: a hidden-only anchor pages empty and complete:true; own notes give full pages',
    async kind => {
      const f = await createS4BNoteCheckFixture(kind, { anchorQuota: 50 });
      try {
        const g1Run = await f.inner.claimRun('s4c-ds04-g1');
        const g1 = f.inner.workCtx(g1Run);
        const extra = await createS4BExtraGoal(f, 's4c-ds04-goal-2');
        const g2Run = await extra.claimRun('s4c-ds04-g2', 't1', 'executor');
        const g2 = extra.workCtx(g2Run, 'executor');
        await write(f, g2, draft({ topic: 'hidden-1', structural: true }), null);
        await write(f, g2, draft({ topic: 'hidden-2', structural: true }), null);
        const request = { v: 1 as const, op: 'lookup' as const, anchor: { kind: 'project' as const },
          limit: 1, cursor: null as string | null };
        const empty = await f.memory.memoryLookup(g1, request);
        expect(empty.status).toBe('ready');
        if (empty.status !== 'ready') return;
        expect(empty.value.items).toEqual([]);
        expect(empty.value.complete).toBe(true);
        expect(empty.value.next).toBe(null);

        const own1 = await write(f, g1, draft({ topic: 'own-1' }), null);
        const own2 = await write(f, g1, draft({ topic: 'own-2' }), null);
        const first = await f.memory.memoryLookup(g1, request);
        expect(first.status).toBe('ready');
        if (first.status !== 'ready') return;
        expect(first.value.items).toHaveLength(1);
        expect(first.value.complete).toBe(false);
        expect(first.value.next).not.toBe(null);
        const second = await f.memory.memoryLookup(g1, { ...request, cursor: first.value.next });
        expect(second.status).toBe('ready');
        if (second.status !== 'ready') return;
        expect(second.value.items).toHaveLength(1);
        expect(second.value.complete).toBe(true);
        expect(second.value.next).toBe(null);
        expect([...first.value.items, ...second.value.items].map(item => item.noteId).sort())
          .toEqual([own1, own2].sort());
      } finally { await f.close(); }
    });
});

describe('S4C DS-05 b11 coverage', () => {
  it.each(['memory', 'sqlite'] as const)(
    'DS-05 %s: lookup counts and reads only the checked item; conflicts counts only the conflicting items',
    async kind => {
      const f = await createS4BNoteCheckFixture(kind, { anchorQuota: 50, check: { readFilesMax: 1 } });
      try {
        const extra = await createS4BExtraGoal(f, 's4c-ds05-goal-2');
        const g1Run = await f.inner.claimRun('s4c-ds05-g1');
        const g1 = f.inner.workCtx(g1Run);
        const g2Run = await extra.claimRun('s4c-ds05-g2', 't1', 'executor');
        const g2 = extra.workCtx(g2Run, 'executor');
        // Hidden from g1, its basis file must never be read.
        await write(f, g2, draft({ topic: 'hidden-a', basisFiles: ['src/a/x.ts'] }), null);
        const own = await write(f, g1, draft({ topic: 'own-b', basisFiles: ['src/b/y.ts'] }), null);
        const lookup = await f.memory.memoryLookup(g1, { v: 1, op: 'lookup', anchor: { kind: 'project' },
          limit: 20, cursor: null });
        expect(lookup.status).toBe('ready');
        if (lookup.status !== 'ready') return;
        expect(lookup.value.items.map(item => item.noteId)).toEqual([own]);
        expect(lookup.value.items[0]!.freshness).toBe('fresh');
        expect(lookup.value.coverage).toEqual({ checkedItems: 1, uncheckedItems: 0, filesRead: 1 });

        // Conflicts: p is not conflicting and must not spend the one-file budget
        // before the q/r pair reads its own basis.
        const p = await write(f, f.ctx(), draft({ topic: 'p-calm', basisFiles: ['src/a/x.ts'] }), null);
        const q = await write(f, f.ctx(), draft({ topic: 'q-conflict', basisFiles: ['src/b/y.ts'] }), null);
        const r = await write(f, f.ctx(), draft({ topic: 'r-conflict', contradicts: [q], basisFiles: ['src/b/y.ts'] }), null);
        void p;
        const conflicts = await f.memory.memoryConflicts(f.ctx(), { v: 1, op: 'conflicts',
          anchor: { kind: 'project' }, limit: 20, cursor: null });
        expect(conflicts.status).toBe('ready');
        if (conflicts.status !== 'ready') return;
        expect(conflicts.value.items.map(item => item.noteId).sort()).toEqual([q, r].sort());
        expect(conflicts.value.items.every(item => item.freshness === 'fresh')).toBe(true);
        expect(conflicts.value.coverage).toEqual({ checkedItems: 2, uncheckedItems: 0, filesRead: 1 });
      } finally { await f.close(); }
    });
});

describe('S4C DS-06 stale empty page', () => {
  it.each(['memory', 'sqlite'] as const)(
    'DS-06 %s: stale with limit 1 whose first candidate is fresh is empty with complete:false',
    async kind => {
      const f = await createS4BNoteCheckFixture(kind, { anchorQuota: 50 });
      try {
        await write(f, f.ctx(), draft({ topic: 'stale-fresh-1' }), null);
        await write(f, f.ctx(), draft({ topic: 'stale-fresh-2' }), null);
        const read = await f.memory.memoryStale(f.ctx(), { v: 1, op: 'stale', anchor: { kind: 'project' },
          limit: 1, cursor: null });
        expect(read.status).toBe('ready');
        if (read.status !== 'ready') return;
        expect(read.value.items).toEqual([]);
        expect(read.value.complete).toBe(false);
        expect(read.value.next).not.toBe(null);
      } finally { await f.close(); }
    });
});
