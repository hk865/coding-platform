/**
 * Slice 4B G3 — M-03 (the `coverage` half): the memory reads report how many
 * items they checked and how many distinct files they read, and a budget's
 * `unchecked` items are counted, never silently shortened. Data through the
 * real 4A writer and a real temporary workspace.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { NoteDraftV1 } from '../../src/contracts/note.js';
import { createS4BNoteCheckFixture } from '../helpers/S4B-note-check-fixture.js';

function draft(overrides: Partial<NoteDraftV1> = {}): NoteDraftV1 {
  return { kind: 'pitfall', topic: 'coverage', conclusion: 'a conclusion', body: 'body',
    anchor: { kind: 'project' }, extraAnchors: [], facts: [], basisFiles: [], structural: false,
    replaces: [], contradicts: [], coexistWith: [], ...overrides } as NoteDraftV1;
}

describe('S4B M-03 coverage', () => {
  it.each(['memory', 'sqlite'] as const)('M-03 %s: a read over more than 256 distinct files reports one unchecked item and 256 files read', async kind => {
    // The 256-file budget is the subject here; keep the byte bound out of the way.
    const f = await createS4BNoteCheckFixture(kind, { resultMaxBytes: 10_000_000 });
    try {
      await mkdir(join(f.root, 'src/coverage'), { recursive: true });
      const paths: string[] = [];
      for (let index = 0; index < 257; index += 1) {
        const path = `src/coverage/f${String(index)}.txt`;
        await writeFile(join(f.root, path), `content ${String(index)}\n`);
        paths.push(path);
      }
      for (let note = 0; note < 8; note += 1) {
        const result = await f.inner.write(f.ctx(), draft({ topic: `c${String(note)}`,
          basisFiles: paths.slice(note * 32, note * 32 + 32) }), null);
        if (result.status === 'rejected') throw new Error(JSON.stringify(result));
      }
      const last = await f.inner.write(f.ctx(), draft({ topic: 'c-last', basisFiles: [paths[256]!] }), null);
      if (last.status === 'rejected') throw new Error(JSON.stringify(last));

      const read = await f.memory.memoryFind(f.ctx(), { v: 1, op: 'find', anchor: { kind: 'project' },
        limit: 100, cursor: null });
      expect(read.status).toBe('ready');
      if (read.status !== 'ready') return;
      expect(read.value.items).toHaveLength(9);
      expect(read.value.coverage.uncheckedItems).toBe(1);
      expect(read.value.coverage.checkedItems).toBe(8);
      expect(read.value.coverage.checkedItems + read.value.coverage.uncheckedItems).toBe(9);
      expect(read.value.coverage.filesRead).toBe(256);
    } finally { await f.close(); }
  });
});
