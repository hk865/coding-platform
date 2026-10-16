/**
 * Slice 4B G3 review follow-up — L12 bounds: the whole-result 48 KiB bound, the
 * cursor identity binding, the default/capped page size, and L9's own-goal half
 * of `currentEligible`. Data through the real 4A writer; assertions through the
 * real memory reads.
 */
import { describe, expect, it } from 'vitest';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { NoteDraftV1 } from '../../src/contracts/note.js';
import { createS4BNoteCheckFixture, fileDigestOf } from '../helpers/S4B-note-check-fixture.js';
import { createS4BExtraGoal } from '../helpers/S4B-memory-fixture.js';

function draft(overrides: Partial<NoteDraftV1> = {}): NoteDraftV1 {
  return { kind: 'pitfall', topic: 'bounds', conclusion: 'a conclusion', body: 'body',
    anchor: { kind: 'project' }, extraAnchors: [], facts: [], basisFiles: [], structural: false,
    replaces: [], contradicts: [], coexistWith: [], ...overrides } as NoteDraftV1;
}

async function write(f: Awaited<ReturnType<typeof createS4BNoteCheckFixture>>, note: NoteDraftV1,
  ctx = f.ctx()): Promise<string> {
  const result = await f.inner.write(ctx, note, null);
  if (result.status === 'rejected') throw new Error(JSON.stringify(result));
  return result.noteId;
}

describe('S4B L12 result byte bound', () => {
  it.each(['memory', 'sqlite'] as const)('%s: L12 an over-bound result drops trailing items, and paging from next reaches all of them', async kind => {
    const f = await createS4BNoteCheckFixture(kind, { resultMaxBytes: 4000 });
    try {
      const ids: string[] = [];
      for (let index = 0; index < 20; index += 1) {
        ids.push(await write(f, draft({ topic: `b${String(index)}`, conclusion: '中'.repeat(150) })));
      }
      const request = { v: 1 as const, op: 'find' as const, anchor: { kind: 'project' as const },
        limit: 100, cursor: null as string | null };
      const first = await f.memory.memoryFind(f.ctx(), request);
      expect(first.status).toBe('ready');
      if (first.status !== 'ready') return;
      expect(Buffer.byteLength(JSON.stringify(first.value), 'utf8')).toBeLessThanOrEqual(4000);
      expect(first.value.complete).toBe(false);
      expect(first.value.next).not.toBe(null);
      const seen = [...first.value.items.map(item => item.noteId)];
      let cursor = first.value.next;
      while (cursor !== null) {
        const page = await f.memory.memoryFind(f.ctx(), { ...request, cursor });
        expect(page.status).toBe('ready');
        if (page.status !== 'ready') return;
        seen.push(...page.value.items.map(item => item.noteId));
        cursor = page.value.next;
      }
      expect([...seen].sort()).toEqual([...ids].sort());
    } finally { await f.close(); }
  });
});

describe('S4B L12 cursor identity', () => {
  it.each(['memory', 'sqlite'] as const)('L12 %s: a cursor from another identity is cursor_mismatch', async kind => {
    const f = await createS4BNoteCheckFixture(kind);
    try {
      for (let index = 0; index < 6; index += 1) await write(f, draft({ topic: `c${String(index)}` }));
      const run = await f.inner.claimRun('bounds');
      const request = { v: 1 as const, op: 'lookup' as const, anchor: { kind: 'project' as const },
        limit: 3, cursor: null as string | null };
      const first = await f.memory.memoryLookup(f.inner.workCtx(run), request);
      expect(first.status).toBe('ready');
      if (first.status !== 'ready') return;
      expect(first.value.next).not.toBe(null);
      const other = await f.memory.memoryLookup(f.ctx(), { ...request, cursor: first.value.next });
      expect(other.status).toBe('rejected');
      if (other.status !== 'rejected') return;
      expect(other.code).toBe('invalid');
      expect(other.reason).toBe('cursor_mismatch');
    } finally { await f.close(); }
  });
});

describe('S4B L12 page size', () => {
  it.each(['memory', 'sqlite'] as const)('%s: L12 a missing/non-positive limit defaults to 20 and a huge limit is capped at 100', async kind => {
    const f = await createS4BNoteCheckFixture(kind, { resultMaxBytes: 10_000_000 });
    try {
      for (let index = 0; index < 105; index += 1) await write(f, draft({ topic: `p${String(index)}` }));
      const defaulted = await f.memory.memoryLookup(f.ctx(), { v: 1, op: 'lookup', anchor: { kind: 'project' },
        limit: 0, cursor: null });
      expect(defaulted.status).toBe('ready');
      if (defaulted.status !== 'ready') return;
      expect(defaulted.value.items).toHaveLength(20);
      expect(defaulted.value.complete).toBe(false);
      const capped = await f.memory.memoryLookup(f.ctx(), { v: 1, op: 'lookup', anchor: { kind: 'project' },
        limit: 500, cursor: null });
      expect(capped.status).toBe('ready');
      if (capped.status !== 'ready') return;
      expect(capped.value.items).toHaveLength(100);
      expect(capped.value.complete).toBe(false);
    } finally { await f.close(); }
  });
});

describe('S4B MF12 byte-bound trimming recomputes the basis', () => {
  it.each(['memory', 'sqlite'] as const)('MF12 %s: each page keeps one item and its own four observed files, under the bound', async kind => {
    const f = await createS4BNoteCheckFixture(kind, { resultMaxBytes: 5000 });
    try {
      const notes: { noteId: string; paths: string[] }[] = [];
      for (let k = 0; k < 4; k += 1) {
        const paths = [0, 1, 2, 3].map(j => `src/a/k${String(k)}-${'x'.repeat(200)}-${String(j)}.ts`);
        for (const path of paths) await writeFile(join(f.root, path), `export const k${String(k)}_${String(path.length)} = 1;\n`);
        const noteId = await write(f, draft({ topic: `k${String(k)}`, basisFiles: paths }));
        notes.push({ noteId, paths });
      }
      const byId = new Map(notes.map(note => [note.noteId, note]));
      const seen: string[] = [];
      let cursor: string | null = null;
      do {
        const page = await f.memory.memoryFind(f.ctx(), { v: 1, op: 'find', anchor: { kind: 'project' },
          limit: 100, cursor });
        expect(page.status).toBe('ready');
        if (page.status !== 'ready') return;
        expect(Buffer.byteLength(JSON.stringify(page.value), 'utf8')).toBeLessThanOrEqual(5000);
        expect(page.value.items).toHaveLength(1);
        const item = page.value.items[0]!;
        const note = byId.get(item.noteId);
        expect(note).toBeDefined();
        if (note === undefined) return;
        seen.push(item.noteId);
        const expected = await Promise.all(note.paths.map(async path =>
          ({ path, digest: await fileDigestOf(join(f.root, path)), outcome: 'same' as const })));
        expect(item.observedFiles).toEqual(expected);
        expect(page.value.readBasis.observedFiles).toEqual(expected);
        expect(page.value.coverage).toEqual({ checkedItems: 1, uncheckedItems: 0, filesRead: 4 });
        cursor = page.value.next;
      } while (cursor !== null);
      expect(seen).toEqual(notes.map(note => note.noteId));
    } finally { await f.close(); }
  });

  it.each(['memory', 'sqlite'] as const)('MF12 %s: a single item over the bound comes back alone with result_over_byte_bound', async kind => {
    const f = await createS4BNoteCheckFixture(kind, { resultMaxBytes: 2000 });
    try {
      const notes: string[] = [];
      for (let k = 0; k < 2; k += 1) {
        const paths: string[] = [];
        for (let j = 0; j < 4; j += 1) {
          const path = `src/a/s${String(k)}-${'y'.repeat(200)}-${String(j)}.ts`;
          await writeFile(join(f.root, path), `export const s${String(k)}_${String(j)} = 1;\n`);
          paths.push(path);
        }
        notes.push(await write(f, draft({ topic: `s${String(k)}`, basisFiles: paths })));
      }
      const first = await f.memory.memoryFind(f.ctx(), { v: 1, op: 'find', anchor: { kind: 'project' },
        limit: 100, cursor: null });
      expect(first.status).toBe('ready');
      if (first.status !== 'ready') return;
      expect(Buffer.byteLength(JSON.stringify(first.value), 'utf8')).toBeGreaterThan(2000);
      expect(first.value.items).toHaveLength(1);
      expect(first.value.items[0]!.noteId).toBe(notes[0]);
      expect(first.value.warnings).toContain('result_over_byte_bound');
      expect(first.value.complete).toBe(false);
      expect(first.value.next).not.toBe(null);
      const second = await f.memory.memoryFind(f.ctx(), { v: 1, op: 'find', anchor: { kind: 'project' },
        limit: 100, cursor: first.value.next });
      expect(second.status).toBe('ready');
      if (second.status !== 'ready') return;
      expect(second.value.items).toHaveLength(1);
      expect(second.value.items[0]!.noteId).toBe(notes[1]);
      expect(second.value.warnings).toContain('result_over_byte_bound');
      expect(second.value.complete).toBe(true);
      expect(second.value.next).toBe(null);
    } finally { await f.close(); }
  });
});

describe('S4B L9 own-goal currentEligible', () => {
  it.each(['memory', 'sqlite'] as const)('L9 %s: memoryFind marks a cross-goal agent-accepted note ineligible and a confirmed one eligible', async kind => {
    const f = await createS4BNoteCheckFixture(kind);
    try {
      const extra = await createS4BExtraGoal(f, 's4b-own-goal-2');
      const goal1Run = await f.inner.claimRun('own-goal-1');
      const goal2Run = await extra.claimRun('own-goal-2', 't1', 'executor');
      const crossAccepted = await write(f, draft({ topic: 'cross-accepted' }), extra.workCtx(goal2Run, 'executor'));
      const read = await f.memory.memoryFind(f.inner.workCtx(goal1Run), { v: 1, op: 'find',
        anchor: { kind: 'project' }, limit: 20, cursor: null });
      expect(read.status).toBe('ready');
      if (read.status !== 'ready') return;
      const accepted = read.value.items.find(item => item.noteId === crossAccepted);
      expect(accepted?.currentEligible).toBe(false);
    } finally { await f.close(); }
  });

  it.each(['memory', 'sqlite'] as const)('L9 %s: memoryFind marks a cross-goal user-confirmed note eligible', async kind => {
    const f = await createS4BNoteCheckFixture(kind);
    try {
      const extra = await createS4BExtraGoal(f, 's4b-own-goal-3');
      const goal1Run = await f.inner.claimRun('own-goal-3');
      const confirmed = await f.inner.write(f.ctx(), draft({ topic: 'confirmed' }), extra.goalRef.goalId);
      if (confirmed.status === 'rejected') throw new Error(JSON.stringify(confirmed));
      const read = await f.memory.memoryFind(f.inner.workCtx(goal1Run), { v: 1, op: 'find',
        anchor: { kind: 'project' }, limit: 20, cursor: null });
      expect(read.status).toBe('ready');
      if (read.status !== 'ready') return;
      const item = read.value.items.find(candidate => candidate.noteId === confirmed.noteId);
      expect(item?.currentEligible).toBe(true);
    } finally { await f.close(); }
  });
});
