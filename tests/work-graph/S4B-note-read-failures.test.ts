/**
 * Slice 4B G2 — §9 read failures are `unavailable`, never a definite answer.
 * The only double is the 4A-allowed read fault (a storage `readMany` error and
 * a catalog `readArchitectureRevision` error); everything else is the real
 * fixture. Assertions go through the public read/check.
 */
import { describe, expect, it } from 'vitest';
import type { NoteDraftV1 } from '../../src/contracts/note.js';
import { createS4BNoteCheckFixture } from '../helpers/S4B-note-check-fixture.js';

function draft(overrides: Partial<NoteDraftV1> = {}): NoteDraftV1 {
  return { kind: 'pitfall', topic: 'failures', conclusion: 'a conclusion', body: 'body',
    anchor: { kind: 'project' }, extraAnchors: [], facts: [], basisFiles: [], structural: false,
    replaces: [], contradicts: [], coexistWith: [], ...overrides } as NoteDraftV1;
}

async function writeNote(f: Awaited<ReturnType<typeof createS4BNoteCheckFixture>>, note: NoteDraftV1,
  goalId: string | null = null): Promise<string> {
  const result = await f.inner.write(f.ctx(), note, goalId);
  if (result.status === 'rejected') throw new Error(`write rejected: ${JSON.stringify(result)}`);
  return result.noteId;
}

describe('S4B read failures', () => {
  it.each(['memory', 'sqlite'] as const)('M-15 %s: a failed catalog read makes check and read return unavailable, not fresh', async kind => {
    const f = await createS4BNoteCheckFixture(kind);
    try {
      const noteId = await writeNote(f, draft({ anchor: { kind: 'module', moduleId: 'A1' } }));
      f.armArchitectureFault();
      const checked = await f.check.checkNotes(f.ctx(), { items: [{ noteId, version: 1 }] });
      expect(checked.status).toBe('rejected');
      if (checked.status === 'rejected') expect(checked.code).toBe('unavailable');
      const read = await f.notes.readNote(f.ctx(), { noteId });
      expect(read.status).toBe('rejected');
      if (read.status === 'rejected') expect(read.code).toBe('unavailable');
    } finally { await f.close(); }
  });

  it.each(['memory', 'sqlite'] as const)('M-02 %s: a failed plan read makes the check return unavailable, not fresh', async kind => {
    const f = await createS4BNoteCheckFixture(kind);
    try {
      const understanding: NoteDraftV1 = { kind: 'understanding', topic: 'plan', conclusion: 'understanding',
        anchor: { kind: 'goal', goalId: 's4a-goal' }, extraAnchors: [], facts: [], basisFiles: [],
        structural: false, replaces: [], contradicts: [], coexistWith: [],
        sections: { status: '无', decided: '无', open: '无', next: '无', risks: '无' } };
      const noteId = await writeNote(f, understanding, 's4a-goal');
      f.armReadManyFault('s4a-goal');
      const read = await f.notes.readNote(f.ctx(), { noteId });
      expect(read.status).toBe('rejected');
      if (read.status === 'rejected') expect(read.code).toBe('unavailable');
    } finally { await f.close(); }
  });
});
