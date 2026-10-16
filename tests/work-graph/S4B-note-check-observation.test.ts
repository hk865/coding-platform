/**
 * Slice 4B G2 round 2 — MF3 check half / R3: the check owns one observation
 * pass and one per-call distinct-file budget covering basis files, file-anchor
 * paths (including symbol rechecks) and `file` facts. Assertions go through the
 * real holder's `checkNotes`; the file digests come from the independent
 * `fileDigestOf` helper.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { NoteDraftV1 } from '../../src/contracts/note.js';
import { createS4BNoteCheckFixture, fileDigestOf, type S4BNoteCheckFixture } from '../helpers/S4B-note-check-fixture.js';

function draft(overrides: Partial<NoteDraftV1> = {}): NoteDraftV1 {
  return { kind: 'pitfall', topic: 'observation', conclusion: 'a conclusion', body: 'body',
    anchor: { kind: 'project' }, extraAnchors: [], facts: [], basisFiles: [], structural: false,
    replaces: [], contradicts: [], coexistWith: [], ...overrides } as NoteDraftV1;
}

async function writeAccepted(f: S4BNoteCheckFixture, note: NoteDraftV1): Promise<string> {
  const result = await f.inner.write(f.ctx(), note, null);
  if (result.status === 'rejected') throw new Error(`write rejected: ${JSON.stringify(result)}`);
  return result.noteId;
}

describe('S4B MF3 check observation', () => {
  it.each(['memory', 'sqlite'] as const)('MF3 %s: observedFiles carries the basis observation', async kind => {
    const f = await createS4BNoteCheckFixture(kind);
    try {
      const noteId = await writeAccepted(f, draft({ basisFiles: ['src/a/x.ts'] }));
      const digest = await fileDigestOf(join(f.root, 'src/a/x.ts'));
      const checks = await f.check.checkNotes(f.ctx(), { items: [{ noteId, version: 1 }] });
      expect(checks.status).toBe('ready');
      if (checks.status !== 'ready') return;
      expect(checks.value[0]!.observedFiles).toEqual([{ path: 'src/a/x.ts', digest, outcome: 'same' }]);
    } finally { await f.close(); }
  });

  it.each(['memory', 'sqlite'] as const)('MF3 %s: one per-call budget makes the later basis file unchecked', async kind => {
    const f = await createS4BNoteCheckFixture(kind, { check: { readFilesMax: 1 } });
    try {
      await mkdir(join(f.root, 'src/obs'), { recursive: true });
      await writeFile(join(f.root, 'src/obs/a.txt'), 'a\n');
      await writeFile(join(f.root, 'src/obs/b.txt'), 'b\n');
      const first = await writeAccepted(f, draft({ topic: 'n1', basisFiles: ['src/obs/a.txt'] }));
      const second = await writeAccepted(f, draft({ topic: 'n2', basisFiles: ['src/obs/b.txt'] }));
      const checks = await f.check.checkNotes(f.ctx(), { items: [{ noteId: first, version: 1 }, { noteId: second, version: 1 }] });
      expect(checks.status).toBe('ready');
      if (checks.status !== 'ready') return;
      expect(checks.value[0]!.freshness).toBe('fresh');
      expect(checks.value[1]!.freshness).toBe('unchecked');
      expect(checks.value[1]!.observedFiles).toEqual([{ path: 'src/obs/b.txt', digest: null, outcome: 'unchecked' }]);
    } finally { await f.close(); }
  });

  it.each(['memory', 'sqlite'] as const)('MF3 %s: a file fact past the budget is unchecked and item-ineligible', async kind => {
    const f = await createS4BNoteCheckFixture(kind, { check: { readFilesMax: 1 } });
    try {
      await mkdir(join(f.root, 'src/obs'), { recursive: true });
      await writeFile(join(f.root, 'src/obs/a.txt'), 'a\n');
      await writeFile(join(f.root, 'src/obs/c.txt'), 'c\n');
      const first = await writeAccepted(f, draft({ topic: 'n1', basisFiles: ['src/obs/a.txt'] }));
      const cDigest = await fileDigestOf(join(f.root, 'src/obs/c.txt'));
      const second = await writeAccepted(f, draft({ topic: 'n2',
        facts: [{ kind: 'file', path: 'src/obs/c.txt', digest: cDigest }] }));
      const checks = await f.check.checkNotes(f.ctx(), { items: [{ noteId: first, version: 1 }, { noteId: second, version: 1 }] });
      expect(checks.status).toBe('ready');
      if (checks.status !== 'ready') return;
      const item = checks.value[1]!;
      expect(item.uncheckedFacts).toEqual([0]);
      expect(item.freshness).toBe('unchecked');
      expect(item.currentEligible).toBe(false);
      expect(item.observedFiles).toEqual([{ path: 'src/obs/c.txt', digest: null, outcome: 'unchecked' }]);
    } finally { await f.close(); }
  });
});
