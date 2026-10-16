/**
 * Slice 4B G3 round 2 — MF3 read half / R3: the read model takes `observedFiles`
 * from the check's single observation pass (it never reads files itself), the
 * check's per-page distinct-file budget is shared across the page, and
 * `coverage` counts every examined candidate (checked and unchecked) before the
 * read's own filter.
 */
import { writeFile, appendFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { NoteDraftV1 } from '../../src/contracts/note.js';
import { createS4BNoteCheckFixture, type S4BNoteCheckFixture } from '../helpers/S4B-note-check-fixture.js';

function draft(overrides: Partial<NoteDraftV1> = {}): NoteDraftV1 {
  return { kind: 'pitfall', topic: 'mf3read', conclusion: 'a conclusion', body: 'body',
    anchor: { kind: 'project' }, extraAnchors: [], facts: [], basisFiles: [], structural: false,
    replaces: [], contradicts: [], coexistWith: [], ...overrides } as NoteDraftV1;
}

async function write(f: S4BNoteCheckFixture, note: NoteDraftV1): Promise<string> {
  const result = await f.inner.write(f.ctx(), note, null);
  if (result.status === 'rejected') throw new Error(`write rejected: ${JSON.stringify(result)}`);
  return result.noteId;
}

describe('S4B MF3 read-half observation', () => {
  it.each(['memory', 'sqlite'] as const)('MF3 %s: the later item of a page is unchecked when the check budget covers only the first item', async kind => {
    const f = await createS4BNoteCheckFixture(kind, { check: { readFilesMax: 2 } });
    try {
      await writeFile(join(f.root, 'sym.ts'), 'export function alpha() {\n  return 1;\n}\n');
      await writeFile(join(f.root, 'a.txt'), 'a\n');
      await writeFile(join(f.root, 'b.txt'), 'b\n');
      const first = await write(f, draft({ topic: 'n1', anchor: { kind: 'file', path: 'sym.ts',
        symbolRequest: { language: 'typescript', name: 'alpha' } }, basisFiles: ['a.txt'] }));
      const second = await write(f, draft({ topic: 'n2', basisFiles: ['b.txt'] }));
      await appendFile(join(f.root, 'sym.ts'), '// x\n');

      const read = await f.memory.memoryFind(f.ctx(), { v: 1, op: 'find', limit: 20, cursor: null });
      expect(read.status).toBe('ready');
      if (read.status !== 'ready') return;
      const byId = new Map(read.value.items.map(item => [item.noteId, item]));
      expect(byId.get(first)!.freshness).toBe('fresh');
      expect(byId.get(second)!.freshness).toBe('unchecked');
      expect(byId.get(second)!.observedFiles).toEqual([{ path: 'b.txt', digest: null, outcome: 'unchecked' }]);
      expect(read.value.coverage).toEqual({ checkedItems: 1, uncheckedItems: 1, filesRead: 2 });
    } finally { await f.close(); }
  });

  it.each(['memory', 'sqlite'] as const)('MF3 %s: lookup coverage counts the examined candidates before the read filter', async kind => {
    const f = await createS4BNoteCheckFixture(kind, { check: { readFilesMax: 1 } });
    try {
      await writeFile(join(f.root, 'a.txt'), 'a\n');
      await writeFile(join(f.root, 'b.txt'), 'b\n');
      const first = await write(f, draft({ topic: 'n1', basisFiles: ['a.txt'] }));
      const second = await write(f, draft({ topic: 'n2', basisFiles: ['b.txt'] }));

      const read = await f.memory.memoryLookup(f.ctx(), { v: 1, op: 'lookup', anchor: { kind: 'project' },
        limit: 20, cursor: null });
      expect(read.status).toBe('ready');
      if (read.status !== 'ready') return;
      // R3: the budget's unchecked candidate is counted, not silently dropped.
      expect(read.value.coverage).toEqual({ checkedItems: 1, uncheckedItems: 1, filesRead: 1 });
      // R9: `lookup` lists accepted heads by stored state. `lookup` orders by
      // noteId, so which of the two consumes the one-file budget is not fixed;
      // exactly one is checked/eligible and one is budget-unchecked/ineligible.
      expect(read.value.items).toHaveLength(2);
      const checked = read.value.items.filter(item => item.freshness !== 'unchecked');
      const unchecked = read.value.items.filter(item => item.freshness === 'unchecked');
      expect(checked).toHaveLength(1);
      expect(unchecked).toHaveLength(1);
      expect(checked[0]!.currentEligible).toBe(true);
      expect(checked[0]!.observedFiles[0]).toMatchObject({ outcome: 'same' });
      expect(unchecked[0]).toMatchObject({ storedState: 'accepted', currentEligible: false });
      expect(unchecked[0]!.observedFiles).toHaveLength(1);
      expect(unchecked[0]!.observedFiles[0]).toMatchObject({ digest: null, outcome: 'unchecked' });
      void first;
      void second;
    } finally { await f.close(); }
  });
});
