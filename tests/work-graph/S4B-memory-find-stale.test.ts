/**
 * Slice 4B G3 — the `find` candidate sources without terms (P7) and the `stale`
 * read (L12): data through the real 4A writer and a real temporary workspace.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { NoteDraftV1 } from '../../src/contracts/note.js';
import { createS4BNoteCheckFixture } from '../helpers/S4B-note-check-fixture.js';

function draft(overrides: Partial<NoteDraftV1> = {}): NoteDraftV1 {
  return { kind: 'pitfall', topic: 'sources', conclusion: 'a conclusion', body: 'body',
    anchor: { kind: 'project' }, extraAnchors: [], facts: [], basisFiles: [], structural: false,
    replaces: [], contradicts: [], coexistWith: [], ...overrides } as NoteDraftV1;
}

async function write(f: Awaited<ReturnType<typeof createS4BNoteCheckFixture>>, note: NoteDraftV1): Promise<string> {
  const result = await f.inner.write(f.ctx(), note, null);
  if (result.status === 'rejected') throw new Error(JSON.stringify(result));
  return result.noteId;
}

describe('S4B find candidate sources and stale', () => {
  it.each(['memory', 'sqlite'] as const)('M-01 %s: memoryStale lists a changed note and not the fresh one', async kind => {
    const f = await createS4BNoteCheckFixture(kind);
    try {
      const changed = await write(f, draft({ topic: 'changed', basisFiles: ['src/a/x.ts'] }));
      const fresh = await write(f, draft({ topic: 'fresh' }));
      await writeFile(join(f.root, 'src/a/x.ts'), 'export const a = 9;\n');
      const read = await f.memory.memoryStale(f.ctx(), { v: 1, op: 'stale', anchor: { kind: 'project' },
        limit: 20, cursor: null });
      expect(read.status).toBe('ready');
      if (read.status !== 'ready') return;
      expect(read.value.items.map(item => item.noteId)).toEqual([changed]);
      expect(read.value.items[0]!.staleReasons).toContain('file_changed');
      expect(read.value.items.some(item => item.noteId === fresh)).toBe(false);
    } finally { await f.close(); }
  });

  it.each(['memory', 'sqlite'] as const)('M-09 %s: memoryFind by path prefix matches a file under the directory only', async kind => {
    const f = await createS4BNoteCheckFixture(kind);
    try {
      const under = await write(f, draft({ topic: 'under', anchor: { kind: 'file', path: 'src/a/x.ts' } }));
      const outside = await write(f, draft({ topic: 'outside', anchor: { kind: 'file', path: 'src/b/y.ts' } }));
      const read = await f.memory.memoryFind(f.ctx(), { v: 1, op: 'find', pathPrefix: 'src/a',
        limit: 20, cursor: null });
      expect(read.status).toBe('ready');
      if (read.status !== 'ready') return;
      expect(read.value.items.map(item => item.noteId)).toEqual([under]);
      expect(read.value.items.some(item => item.noteId === outside)).toBe(false);
    } finally { await f.close(); }
  });

  it.each(['memory', 'sqlite'] as const)('M-09 %s: memoryFind by prefix src/a does not match src/ab (directory boundary)', async kind => {
    const f = await createS4BNoteCheckFixture(kind);
    try {
      await mkdir(join(f.root, 'src/ab'), { recursive: true });
      await writeFile(join(f.root, 'src/ab/y.ts'), 'export const ab = 1;\n');
      const inside = await write(f, draft({ topic: 'inside', anchor: { kind: 'file', path: 'src/a/x.ts' } }));
      const sibling = await write(f, draft({ topic: 'sibling', anchor: { kind: 'file', path: 'src/ab/y.ts' } }));
      const read = await f.memory.memoryFind(f.ctx(), { v: 1, op: 'find', pathPrefix: 'src/a',
        limit: 20, cursor: null });
      expect(read.status).toBe('ready');
      if (read.status !== 'ready') return;
      expect(read.value.items.map(item => item.noteId)).toEqual([inside]);
      expect(read.value.items.some(item => item.noteId === sibling)).toBe(false);
    } finally { await f.close(); }
  });

  it.each(['memory', 'sqlite'] as const)('M-09 %s: memoryFind in the status route reaches a non-null goal slot', async kind => {
    const f = await createS4BNoteCheckFixture(kind);
    try {
      const written = await f.inner.write(f.ctx(), draft({ topic: 'goal-note' }), f.inner.goalRef.goalId);
      if (written.status === 'rejected') throw new Error(JSON.stringify(written));
      const read = await f.memory.memoryFind(f.ctx(), { v: 1, op: 'find', state: 'accepted',
        limit: 20, cursor: null });
      expect(read.status).toBe('ready');
      if (read.status !== 'ready') return;
      expect(read.value.items.map(item => item.noteId)).toContain(written.noteId);
    } finally { await f.close(); }
  });

  it.each(['memory', 'sqlite'] as const)('M-09 %s: memoryFind with no terms, anchor or path uses the requested state and the project slot', async kind => {
    const f = await createS4BNoteCheckFixture(kind);
    try {
      const accepted = await write(f, draft({ topic: 'accepted' }));
      const withdrawn = await write(f, draft({ topic: 'withdrawn' }));
      const withdraw = await f.inner.platform.notes.withdrawNote(f.ctx(), { commandId: 's4b-find-withdraw',
        noteId: withdrawn, expectedVersion: 1, reason: 'test' });
      expect(withdraw.status).toBe('done');
      const read = await f.memory.memoryFind(f.ctx(), { v: 1, op: 'find', state: 'accepted',
        limit: 20, cursor: null });
      expect(read.status).toBe('ready');
      if (read.status !== 'ready') return;
      expect(read.value.items.map(item => item.noteId)).toContain(accepted);
      expect(read.value.items.some(item => item.noteId === withdrawn)).toBe(false);
    } finally { await f.close(); }
  });

  it.each(['memory', 'sqlite'] as const)('MF6a %s: memoryFind by prefix src/a keeps a nested file though siblings sort before it', async kind => {
    const f = await createS4BNoteCheckFixture(kind);
    try {
      // `-` (0x2D) and `.` (0x2E) sort before `/` (0x2F), so the old scan stopped
      // at the sibling and never reached the subtree.
      await mkdir(join(f.root, 'src/a-b'), { recursive: true });
      await writeFile(join(f.root, 'src/a-b/y.ts'), 'export const dash = 1;\n');
      await writeFile(join(f.root, 'src/a.ts'), 'export const dot = 1;\n');
      const inTree = await write(f, draft({ topic: 'in', anchor: { kind: 'file', path: 'src/a/x.ts' } }));
      const dash = await write(f, draft({ topic: 'dash', anchor: { kind: 'file', path: 'src/a-b/y.ts' } }));
      const dot = await write(f, draft({ topic: 'dot', anchor: { kind: 'file', path: 'src/a.ts' } }));
      // An extra anchor occupies slot 1 and must be found by the same scan.
      const extra = await f.inner.write(f.ctx(), draft({ topic: 'extra', anchor: { kind: 'project' },
        extraAnchors: [{ kind: 'file', path: 'src/a/x.ts' }] }), null);
      if (extra.status === 'rejected') throw new Error(JSON.stringify(extra));
      const read = await f.memory.memoryFind(f.ctx(), { v: 1, op: 'find', pathPrefix: 'src/a',
        limit: 20, cursor: null });
      expect(read.status).toBe('ready');
      if (read.status !== 'ready') return;
      expect([...read.value.items.map(item => item.noteId)].sort()).toEqual([inTree, extra.noteId].sort());
      expect(read.value.items.some(item => item.noteId === dash)).toBe(false);
      expect(read.value.items.some(item => item.noteId === dot)).toBe(false);
      expect(read.value.complete).toBe(true);
    } finally { await f.close(); }
  });

  it.each(['memory', 'sqlite'] as const)('MF6b %s: memoryFind ANDs a supplied anchor and pathPrefix', async kind => {
    const f = await createS4BNoteCheckFixture(kind);
    try {
      await write(f, draft({ topic: 'a-file', anchor: { kind: 'file', path: 'src/a/x.ts' } }));
      const read = await f.memory.memoryFind(f.ctx(), { v: 1, op: 'find',
        anchor: { kind: 'file', path: 'src/a/x.ts' }, pathPrefix: 'src/b', limit: 20, cursor: null });
      expect(read.status).toBe('ready');
      if (read.status !== 'ready') return;
      expect(read.value.items).toEqual([]);
      expect(read.value.complete).toBe(true);
    } finally { await f.close(); }
  });

  it.each(['memory', 'sqlite'] as const)('MF6b %s: memoryStale ANDs a supplied goal and anchor', async kind => {
    const f = await createS4BNoteCheckFixture(kind);
    try {
      const goalId = f.inner.goalRef.goalId;
      const onGoal = await f.inner.write(f.ctx(), draft({ topic: 'on-goal', anchor: { kind: 'goal', goalId },
        basisFiles: ['src/a/x.ts'] }), goalId);
      if (onGoal.status === 'rejected') throw new Error(JSON.stringify(onGoal));
      const onFile = await f.inner.write(f.ctx(), draft({ topic: 'on-file', anchor: { kind: 'file', path: 'src/b/y.ts' },
        basisFiles: ['src/b/y.ts'] }), goalId);
      if (onFile.status === 'rejected') throw new Error(JSON.stringify(onFile));
      await writeFile(join(f.root, 'src/a/x.ts'), 'export const a = 9;\n');
      await writeFile(join(f.root, 'src/b/y.ts'), 'export const b = 9;\n');
      const read = await f.memory.memoryStale(f.ctx(), { v: 1, op: 'stale', goalId,
        anchor: { kind: 'goal', goalId }, limit: 20, cursor: null });
      expect(read.status).toBe('ready');
      if (read.status !== 'ready') return;
      expect(read.value.items.map(item => item.noteId)).toEqual([onGoal.noteId]);
    } finally { await f.close(); }
  });

  it.each(['memory', 'sqlite'] as const)('MF6b %s: a trailing slash on pathPrefix is stripped before matching', async kind => {
    const f = await createS4BNoteCheckFixture(kind);
    try {
      await mkdir(join(f.root, 'src/a-b'), { recursive: true });
      await writeFile(join(f.root, 'src/a-b/y.ts'), 'export const dash = 1;\n');
      const under = await write(f, draft({ topic: 'under', anchor: { kind: 'file', path: 'src/a/x.ts' } }));
      const sibling = await write(f, draft({ topic: 'sibling', anchor: { kind: 'file', path: 'src/a-b/y.ts' } }));
      const read = await f.memory.memoryFind(f.ctx(), { v: 1, op: 'find', pathPrefix: 'src/a/',
        limit: 20, cursor: null });
      expect(read.status).toBe('ready');
      if (read.status !== 'ready') return;
      expect(read.value.items.map(item => item.noteId)).toEqual([under]);
      expect(read.value.items.some(item => item.noteId === sibling)).toBe(false);
    } finally { await f.close(); }
  });

  it.each(['memory', 'sqlite'] as const)('MF6b %s: an empty pathPrefix is invalid path_prefix_empty', async kind => {
    const f = await createS4BNoteCheckFixture(kind);
    try {
      for (const prefix of ['', '/']) {
        const read = await f.memory.memoryFind(f.ctx(), { v: 1, op: 'find', pathPrefix: prefix,
          limit: 20, cursor: null });
        expect(read.status).toBe('rejected');
        if (read.status !== 'rejected') return;
        expect(read.code).toBe('invalid');
        expect(read.reason).toBe('path_prefix_empty');
      }
    } finally { await f.close(); }
  });
});
