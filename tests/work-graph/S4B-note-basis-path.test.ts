/**
 * Slice 4B round 2 — R15 (from MF15): a basis path that escapes the workspace
 * answers `invalid` at write, never `unavailable`. The note is submitted by the
 * real host caller through the real 4A writer; the reason list (§2) calls the
 * out-of-workspace/forbidden case `basis_file_forbidden`.
 */
import { describe, expect, it } from 'vitest';
import type { NoteDraftV1 } from '../../src/contracts/note.js';
import { createS4BNoteCheckFixture } from '../helpers/S4B-note-check-fixture.js';

function draft(overrides: Partial<NoteDraftV1> = {}): NoteDraftV1 {
  return { kind: 'pitfall', topic: 'r15', conclusion: 'a conclusion', body: 'body',
    anchor: { kind: 'project' }, extraAnchors: [], facts: [], basisFiles: [], structural: false,
    replaces: [], contradicts: [], coexistWith: [], ...overrides } as NoteDraftV1;
}

describe('S4B R15 ../ basis path', () => {
  it.each(['memory', 'sqlite'] as const)('R15 %s: a ../ basis path is invalid/basis_file_forbidden', async kind => {
    const f = await createS4BNoteCheckFixture(kind);
    try {
      const written = await f.inner.write(f.ctx(), draft({ basisFiles: ['../out.txt'] }), null);
      expect(written.status).toBe('rejected');
      if (written.status !== 'rejected') return;
      expect(written.code).toBe('invalid');
      expect(written.reason).toBe('basis_file_forbidden');
    } finally { await f.close(); }
  });
});
