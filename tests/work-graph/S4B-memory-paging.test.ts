/**
 * Slice 4B G3 — M-09 paging, cursors and body paging (L12). Data through the
 * real 4A writer; assertions through the real `memoryLookup`.
 */
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { NoteDraftV1 } from '../../src/contracts/note.js';
import { createS4BNoteCheckFixture } from '../helpers/S4B-note-check-fixture.js';
import { createS4BExtraGoal } from '../helpers/S4B-memory-fixture.js';

function draft(overrides: Partial<NoteDraftV1> = {}): NoteDraftV1 {
  return { kind: 'pitfall', topic: 'm09', conclusion: 'a conclusion', body: 'body',
    anchor: { kind: 'project' }, extraAnchors: [], facts: [], basisFiles: [], structural: false,
    replaces: [], contradicts: [], coexistWith: [], ...overrides } as NoteDraftV1;
}

async function writeAll(kind: 'memory' | 'sqlite', overrides: (index: number) => Partial<NoteDraftV1>, count: number):
Promise<{ f: Awaited<ReturnType<typeof createS4BNoteCheckFixture>>; ids: string[] }> {
  const f = await createS4BNoteCheckFixture(kind);
  const ids: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const result = await f.inner.write(f.ctx(), draft(overrides(index)), null);
    if (result.status === 'rejected') throw new Error(JSON.stringify(result));
    ids.push(result.noteId);
  }
  return { f, ids };
}

describe('S4B M-09 paging and cursors', () => {
  it.each(['memory', 'sqlite'] as const)('M-09 %s: a 25-note anchor pages 20 then 5 without a gap or a repeat', async kind => {
    const { f, ids } = await writeAll(kind, index => ({ topic: `t${String(index)}` }), 25);
    try {
      const first = await f.memory.memoryLookup(f.ctx(), { v: 1, op: 'lookup', anchor: { kind: 'project' },
        limit: 20, cursor: null });
      expect(first.status).toBe('ready');
      if (first.status !== 'ready') return;
      expect(first.value.items).toHaveLength(20);
      expect(first.value.complete).toBe(false);
      const second = await f.memory.memoryLookup(f.ctx(), { v: 1, op: 'lookup', anchor: { kind: 'project' },
        limit: 20, cursor: first.value.next });
      expect(second.status).toBe('ready');
      if (second.status !== 'ready') return;
      expect(second.value.items).toHaveLength(5);
      expect(second.value.complete).toBe(true);
      const seen = [...first.value.items, ...second.value.items].map(item => item.noteId).sort();
      expect(seen).toEqual([...ids].sort());
    } finally { await f.close(); }
  });

  it.each(['memory', 'sqlite'] as const)('M-09 %s: a write between pages makes the next page revision_conflict', async kind => {
    const { f, ids } = await writeAll(kind, index => ({ topic: `t${String(index)}` }), 21);
    try {
      const first = await f.memory.memoryLookup(f.ctx(), { v: 1, op: 'lookup', anchor: { kind: 'project' },
        limit: 20, cursor: null });
      expect(first.status).toBe('ready');
      if (first.status !== 'ready') return;
      const extra = await f.inner.write(f.ctx(), draft({ topic: 'extra' }), null);
      if (extra.status === 'rejected') throw new Error(JSON.stringify(extra));
      const next = await f.memory.memoryLookup(f.ctx(), { v: 1, op: 'lookup', anchor: { kind: 'project' },
        limit: 20, cursor: first.value.next });
      expect(next.status).toBe('rejected');
      if (next.status !== 'rejected') return;
      expect(next.code).toBe('revision_conflict');
      void ids;
    } finally { await f.close(); }
  });

  it.each(['memory', 'sqlite'] as const)('M-09 %s: reusing a cursor with different parameters is cursor_mismatch', async kind => {
    const { f } = await writeAll(kind, index => ({ topic: `t${String(index)}` }), 21);
    try {
      const first = await f.memory.memoryLookup(f.ctx(), { v: 1, op: 'lookup', anchor: { kind: 'project' },
        limit: 20, cursor: null });
      expect(first.status).toBe('ready');
      if (first.status !== 'ready') return;
      const mismatched = await f.memory.memoryLookup(f.ctx(), { v: 1, op: 'lookup', anchor: { kind: 'project' },
        limit: 5, cursor: first.value.next });
      expect(mismatched.status).toBe('rejected');
      if (mismatched.status !== 'rejected') return;
      expect(mismatched.code).toBe('invalid');
      expect(mismatched.reason).toBe('cursor_mismatch');
    } finally { await f.close(); }
  });

  it.each(['memory', 'sqlite'] as const)('M-09 %s: lookup body pages a long multi-byte body on code point boundaries', async kind => {
    const f = await createS4BNoteCheckFixture(kind);
    try {
      const body = '中'.repeat(1000);
      const written = await f.inner.write(f.ctx(), draft({ topic: 'body', body }), null);
      if (written.status === 'rejected') throw new Error(JSON.stringify(written));
      const first = await f.memory.memoryLookup(f.ctx(), { v: 1, op: 'lookup', anchor: { kind: 'project' },
        limit: 20, cursor: null, body: { noteId: written.noteId, cursor: null } });
      expect(first.status).toBe('ready');
      if (first.status !== 'ready') return;
      const firstItem = first.value.items.find(item => item.noteId === written.noteId);
      expect(firstItem?.body?.text).toBe('中'.repeat(682));
      expect(firstItem?.body?.next).not.toBe(null);
      const second = await f.memory.memoryLookup(f.ctx(), { v: 1, op: 'lookup', anchor: { kind: 'project' },
        limit: 20, cursor: null, body: { noteId: written.noteId, cursor: firstItem!.body!.next } });
      expect(second.status).toBe('ready');
      if (second.status !== 'ready') return;
      const secondItem = second.value.items.find(item => item.noteId === written.noteId);
      expect(`${firstItem!.body!.text}${secondItem!.body!.text}`).toBe(body);
      expect(secondItem?.body?.next).toBe(null);
    } finally { await f.close(); }
  });

  it.each(['memory', 'sqlite'] as const)('M-09 %s: a page whose candidates are all filtered out is empty and complete:true', async kind => {
    const f = await createS4BNoteCheckFixture(kind);
    try {
      const extra = await createS4BExtraGoal(f, 's4b-goal-2');
      const goal1Run = await f.inner.claimRun('m09-goal1');
      const goal2Run = await extra.claimRun('m09-goal2', 't1', 'executor');
      for (let index = 0; index < 2; index += 1) {
        const result = await f.inner.write(extra.workCtx(goal2Run, 'executor'), draft({ topic: `x${String(index)}` }), null);
        if (result.status === 'rejected') throw new Error(JSON.stringify(result));
      }
      const read = await f.memory.memoryLookup(f.inner.workCtx(goal1Run), { v: 1, op: 'lookup',
        anchor: { kind: 'project' }, limit: 1, cursor: null });
      expect(read.status).toBe('ready');
      if (read.status !== 'ready') return;
      expect(read.value.items).toEqual([]);
      expect(read.value.complete).toBe(true);
      expect(read.value.next).toBe(null);
    } finally { await f.close(); }
  });
});

describe('S4B MF10 body and memory cursors', () => {
  async function writeBodyNote(f: Awaited<ReturnType<typeof createS4BNoteCheckFixture>>): Promise<string> {
    const written = await f.inner.write(f.ctx(), draft({ topic: 'body', body: '中'.repeat(1000) }), null);
    if (written.status === 'rejected') throw new Error(JSON.stringify(written));
    return written.noteId;
  }

  it.each(['memory', 'sqlite'] as const)('MF10 %s: an unpinned body cursor after a review is a revision_conflict', async kind => {
    const f = await createS4BNoteCheckFixture(kind);
    try {
      const noteId = await writeBodyNote(f);
      const first = await f.memory.memoryLookup(f.ctx(), { v: 1, op: 'lookup', anchor: { kind: 'project' },
        limit: 20, cursor: null, body: { noteId, cursor: null } });
      expect(first.status).toBe('ready');
      if (first.status !== 'ready') return;
      const item = first.value.items.find(candidate => candidate.noteId === noteId);
      const cursor = item?.body?.next ?? null;
      expect(cursor).not.toBe(null);
      const review = await f.inner.platform.notes.reviewNote(f.ctx(), { commandId: 's4b-mf10-review',
        noteId, expectedVersion: 1, expectedPointerRevision: null, verdict: 'review', reason: null });
      expect(review.status).toBe('done');
      const second = await f.memory.memoryLookup(f.ctx(), { v: 1, op: 'lookup', anchor: { kind: 'project' },
        limit: 20, cursor: null, body: { noteId, cursor } });
      expect(second.status).toBe('rejected');
      if (second.status !== 'rejected') return;
      expect(second.code).toBe('revision_conflict');
    } finally { await f.close(); }
  });

  it.each(['memory', 'sqlite'] as const)(
    'R10 %s: a pinned body cursor after a head change is a revision_conflict', async kind => {
      const f = await createS4BNoteCheckFixture(kind);
      try {
        const noteId = await writeBodyNote(f);
        const first = await f.memory.memoryLookup(f.ctx(), { v: 1, op: 'lookup', anchor: { kind: 'project' },
          limit: 20, cursor: null, body: { noteId, version: 1, cursor: null } });
        expect(first.status).toBe('ready');
        if (first.status !== 'ready') return;
        const cursor = first.value.items.find(candidate => candidate.noteId === noteId)?.body?.next ?? null;
        expect(cursor).not.toBe(null);
        const review = await f.inner.platform.notes.reviewNote(f.ctx(), { commandId: 's4b-r10-review',
          noteId, expectedVersion: 1, expectedPointerRevision: null, verdict: 'review', reason: null });
        expect(review.status).toBe('done');
        const second = await f.memory.memoryLookup(f.ctx(), { v: 1, op: 'lookup', anchor: { kind: 'project' },
          limit: 20, cursor: null, body: { noteId, version: 1, cursor } });
        expect(second.status).toBe('rejected');
        if (second.status !== 'rejected') return;
        expect(second.code).toBe('revision_conflict');
      } finally { await f.close(); }
    });

  it.each(['memory', 'sqlite'] as const)('MF10 %s: a body cursor from another caller is cursor_mismatch', async kind => {
    const f = await createS4BNoteCheckFixture(kind);
    try {
      const noteId = await writeBodyNote(f);
      const run = await f.inner.claimRun('mf10');
      const underRun = await f.memory.memoryLookup(f.inner.workCtx(run), { v: 1, op: 'lookup',
        anchor: { kind: 'project' }, limit: 20, cursor: null, body: { noteId, cursor: null } });
      expect(underRun.status).toBe('ready');
      if (underRun.status !== 'ready') return;
      const cursor = underRun.value.items.find(candidate => candidate.noteId === noteId)?.body?.next ?? null;
      expect(cursor).not.toBe(null);
      const underHost = await f.memory.memoryLookup(f.ctx(), { v: 1, op: 'lookup', anchor: { kind: 'project' },
        limit: 20, cursor: null, body: { noteId, cursor } });
      expect(underHost.status).toBe('rejected');
      if (underHost.status !== 'rejected') return;
      expect(underHost.code).toBe('invalid');
      expect(underHost.reason).toBe('cursor_mismatch');
    } finally { await f.close(); }
  });

  it.each(['memory', 'sqlite'] as const)('MF10 %s: a history body cursor cannot be replayed on lookup', async kind => {
    const f = await createS4BNoteCheckFixture(kind);
    try {
      const noteId = await writeBodyNote(f);
      const history = await f.memory.memoryHistory(f.ctx(), { v: 1, op: 'history', noteId,
        limit: 20, cursor: null, body: { noteId, cursor: null } });
      expect(history.status).toBe('ready');
      if (history.status !== 'ready') return;
      const cursor = history.value.items.find(candidate => candidate.noteId === noteId)?.body?.next ?? null;
      expect(cursor).not.toBe(null);
      const lookup = await f.memory.memoryLookup(f.ctx(), { v: 1, op: 'lookup', anchor: { kind: 'project' },
        limit: 20, cursor: null, body: { noteId, cursor } });
      expect(lookup.status).toBe('rejected');
      if (lookup.status !== 'rejected') return;
      expect(lookup.code).toBe('invalid');
      expect(lookup.reason).toBe('cursor_mismatch');
    } finally { await f.close(); }
  });
});

describe('S4B R11 body target after the byte trim', () => {
  it.each(['memory', 'sqlite'] as const)(
    'R11 %s: a body target whose item is trimmed off the page still gets the warning', async kind => {
      const f = await createS4BNoteCheckFixture(kind, { resultMaxBytes: 2000 });
      try {
        const ids: string[] = [];
        for (let k = 0; k < 2; k += 1) {
          const paths: string[] = [];
          for (let j = 0; j < 4; j += 1) {
            const path = `src/a/bt${String(k)}-${'z'.repeat(200)}-${String(j)}.ts`;
            await writeFile(join(f.root, path), `export const bt${String(k)}_${String(j)} = 1;\n`);
            paths.push(path);
          }
          const written = await f.inner.write(f.ctx(), draft({ topic: `body-trim ${String(k)}`, basisFiles: paths }), null);
          if (written.status === 'rejected') throw new Error(JSON.stringify(written));
          ids.push(written.noteId);
        }
        const probe = await f.memory.memoryLookup(f.ctx(), { v: 1, op: 'lookup', anchor: { kind: 'project' },
          limit: 100, cursor: null });
        expect(probe.status).toBe('ready');
        if (probe.status !== 'ready') return;
        expect(probe.value.items).toHaveLength(1);
        const firstId = probe.value.items[0]!.noteId;
        const target = ids.find(id => id !== firstId)!;
        const read = await f.memory.memoryLookup(f.ctx(), { v: 1, op: 'lookup', anchor: { kind: 'project' },
          limit: 100, cursor: null, body: { noteId: target, cursor: null } });
        expect(read.status).toBe('ready');
        if (read.status !== 'ready') return;
        // The byte trim leaves only one item, so the requested body's target is
        // no longer on the page.
        expect(read.value.items.map(item => item.noteId)).toEqual([firstId]);
        expect(read.value.warnings).toContain('body_target_not_on_page');
      } finally { await f.close(); }
    });
});
