/**
 * Slice 4B G2 — M-03 (the `unchecked` half) and M-14 (the write-after check).
 * Datasets come only from the real 4A note writers and a real temporary
 * workspace; the 257-file and 257-fact budgets are observed through the real
 * `checkNotes`.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { NoteDraftV1, NoteFactV1 } from '../../src/contracts/note.js';
import { createS4BNoteCheckFixture, currentVersion } from '../helpers/S4B-note-check-fixture.js';

function draft(overrides: Partial<NoteDraftV1> = {}): NoteDraftV1 {
  return { kind: 'pitfall', topic: 'budget', conclusion: 'a conclusion', body: 'body',
    anchor: { kind: 'project' }, extraAnchors: [], facts: [], basisFiles: [], structural: false,
    replaces: [], contradicts: [], coexistWith: [], ...overrides } as NoteDraftV1;
}

async function writeAccepted(f: Awaited<ReturnType<typeof createS4BNoteCheckFixture>>, note: NoteDraftV1): Promise<string> {
  const result = await f.inner.write(f.ctx(), note, null);
  if (result.status === 'rejected') throw new Error(`write rejected: ${JSON.stringify(result)}`);
  return result.noteId;
}

describe('S4B M-03 the 256 distinct-file budget', () => {
  it.each(['memory', 'sqlite'] as const)('M-03 %s: the item containing the 257th distinct basis file is unchecked', async kind => {
    const f = await createS4BNoteCheckFixture(kind);
    try {
      await mkdir(join(f.root, 'src/budget'), { recursive: true });
      const paths: string[] = [];
      for (let i = 0; i < 257; i += 1) {
        const path = `src/budget/f${i}.txt`;
        await writeFile(join(f.root, path), `content ${i}\n`);
        paths.push(path);
      }
      const noteIds: string[] = [];
      for (let note = 0; note < 8; note += 1) {
        noteIds.push(await writeAccepted(f, draft({ topic: `b${note}`,
          basisFiles: paths.slice(note * 32, note * 32 + 32) })));
      }
      noteIds.push(await writeAccepted(f, draft({ topic: 'b-last', basisFiles: [paths[256]!] })));
      const items = noteIds.map(noteId => ({ noteId, version: 1 }));
      const checks = await f.check.checkNotes(f.ctx(), { items });
      expect(checks.status).toBe('ready');
      if (checks.status !== 'ready') return;
      const last = checks.value[noteIds.length - 1]!;
      expect(last.freshness).toBe('unchecked');
      // R3: `observedFiles` now lives on NoteCheckV1 too and the same
      // 256-file budget is shared across the page by the check.
      const page = await f.notes.listByAnchor(f.ctx(), { anchor: { kind: 'project' }, limit: 100, cursor: null });
      expect(page.status).toBe('ready');
      if (page.status !== 'ready') return;
      expect(page.value.items[page.value.items.length - 1]!.observedFiles)
        .toEqual([{ path: paths[256], digest: null, outcome: 'unchecked' }]);
    } finally { await f.close(); }
  });
});

describe('S4B M-14 the write-after check resolves facts', () => {
  it.each(['memory', 'sqlite'] as const)('M-14 %s: a well-formed commit fact is unchecked and still current-eligible', async kind => {
    const f = await createS4BNoteCheckFixture(kind);
    try {
      const noteId = await writeAccepted(f, draft({ facts: [{ kind: 'commit', sha: 'a'.repeat(40) }] }));
      const checks = await f.check.checkNotes(f.ctx(), { items: [{ noteId, version: 1 }] });
      expect(checks.status).toBe('ready');
      if (checks.status !== 'ready') return;
      expect(checks.value[0]!.uncheckedFacts).toEqual([0]);
      expect(checks.value[0]!.unresolvedFacts).toEqual([]);
      expect(checks.value[0]!.currentEligible).toBe(true);
    } finally { await f.close(); }
  });

  it.each(['memory', 'sqlite'] as const)('M-14 %s: a 3-character commit sha is unresolved invalid_commit_format', async kind => {
    const f = await createS4BNoteCheckFixture(kind);
    try {
      const noteId = await writeAccepted(f, draft({ facts: [{ kind: 'commit', sha: 'abc' }] }));
      const checks = await f.check.checkNotes(f.ctx(), { items: [{ noteId, version: 1 }] });
      expect(checks.status).toBe('ready');
      if (checks.status !== 'ready') return;
      expect(checks.value[0]!.unresolvedFacts).toEqual([{ index: 0, reason: 'invalid_commit_format' }]);
    } finally { await f.close(); }
  });

  it.each(['memory', 'sqlite'] as const)('M-14 %s: the 257th fact pointer is unchecked and its item is not fresh', async kind => {
    const f = await createS4BNoteCheckFixture(kind);
    try {
      const commitFact = (): NoteFactV1 => ({ kind: 'commit', sha: 'b'.repeat(40) });
      const noteIds: string[] = [];
      for (let note = 0; note < 16; note += 1) {
        noteIds.push(await writeAccepted(f, draft({ topic: `f${note}`,
          facts: Array.from({ length: 16 }, commitFact) })));
      }
      noteIds.push(await writeAccepted(f, draft({ topic: 'f-last', facts: [commitFact()] })));
      const items = noteIds.map(noteId => ({ noteId, version: 1 }));
      const checks = await f.check.checkNotes(f.ctx(), { items });
      expect(checks.status).toBe('ready');
      if (checks.status !== 'ready') return;
      const last = checks.value[noteIds.length - 1]!;
      expect(last.freshness).toBe('unchecked');
      expect(last.uncheckedFacts).toEqual([0]);
    } finally { await f.close(); }
  });

  it.each(['memory', 'sqlite'] as const)('M-14 %s: a note pointer whose version is ahead of the head is version_ahead', async kind => {
    const f = await createS4BNoteCheckFixture(kind);
    try {
      const first = await writeAccepted(f, draft({ topic: 'first' }));
      const second = await writeAccepted(f, draft({ topic: 'second', facts: [{ kind: 'note', noteId: first, version: 9 }] }));
      const checks = await f.check.checkNotes(f.ctx(), { items: [{ noteId: second, version: 1 }] });
      expect(checks.status).toBe('ready');
      if (checks.status !== 'ready') return;
      expect(checks.value[0]!.unresolvedFacts).toEqual([{ index: 0, reason: 'version_ahead' }]);
    } finally { await f.close(); }
  });

  it.each(['memory', 'sqlite'] as const)('M-14 %s: a note pointer to a missing note is not_found', async kind => {
    const f = await createS4BNoteCheckFixture(kind);
    try {
      const noteId = await writeAccepted(f, draft({ facts: [{ kind: 'note', noteId: 'no-such-note', version: 1 }] }));
      const checks = await f.check.checkNotes(f.ctx(), { items: [{ noteId, version: 1 }] });
      expect(checks.status).toBe('ready');
      if (checks.status !== 'ready') return;
      expect(checks.value[0]!.unresolvedFacts).toEqual([{ index: 0, reason: 'not_found' }]);
    } finally { await f.close(); }
  });

  it.each(['memory', 'sqlite'] as const)('M-14 %s: a message fact that cannot be read is sourceUnavailable and the item remains (M-05)', async kind => {
    const f = await createS4BNoteCheckFixture(kind);
    try {
      const missing: NoteFactV1 = { kind: 'record', revision: 1, digest: null,
        ref: { aggregateType: 'SessionMessage', projectId: f.inner.scope.projectId,
          workspaceId: f.inner.scope.workspaceId, messageId: 'missing-message' } };
      const noteId = await writeAccepted(f, draft({ facts: [missing] }));
      const read = await f.notes.readNote(f.ctx(), { noteId });
      expect(read.status).toBe('ready');
      if (read.status !== 'ready') return;
      expect(read.value.sourceUnavailable).toBe(true);
      expect(read.value.currentEligible).toBe(false);
      const page = await f.notes.listByAnchor(f.ctx(), { anchor: { kind: 'project' }, limit: 20, cursor: null });
      expect(page.status).toBe('ready');
      if (page.status !== 'ready') return;
      const item = page.value.items.find(candidate => candidate.noteId === noteId);
      expect(item).toBeDefined();
      expect(item!.sourceUnavailable).toBe(true);
      const checks = await f.check.checkNotes(f.ctx(), { items: [{ noteId, version: 1 }] });
      expect(checks.status).toBe('ready');
      if (checks.status !== 'ready') return;
      expect(checks.value[0]!.sourceUnavailable).toBe(true);
    } finally { await f.close(); }
  });

  it.each(['memory', 'sqlite'] as const)('M-14 %s: a fact whose record cannot be read is unresolved unavailable', async kind => {
    const f = await createS4BNoteCheckFixture(kind);
    try {
      const fact: NoteFactV1 = { kind: 'record', revision: 1, digest: null,
        ref: { aggregateType: 'Goal', projectId: f.inner.scope.projectId, goalId: 's4b-fault-goal' } };
      const noteId = await writeAccepted(f, draft({ facts: [fact] }));
      f.armReadManyFault('s4b-fault-goal');
      const checks = await f.check.checkNotes(f.ctx(), { items: [{ noteId, version: 1 }] });
      expect(checks.status).toBe('ready');
      if (checks.status !== 'ready') return;
      expect(checks.value[0]!.unresolvedFacts).toEqual([{ index: 0, reason: 'unavailable' }]);
    } finally { await f.close(); }
  });

  it.each(['memory', 'sqlite'] as const)('M-14 %s: a deleted file anchor without proof gets the deleted_path_unverified hint', async kind => {
    const f = await createS4BNoteCheckFixture(kind);
    try {
      const noteId = await writeAccepted(f, draft({ anchor: { kind: 'file', path: 'src/gone.ts', deleted: true },
        facts: [{ kind: 'commit', sha: 'c'.repeat(40) }] }));
      const checks = await f.check.checkNotes(f.ctx(), { items: [{ noteId, version: 1 }] });
      expect(checks.status).toBe('ready');
      if (checks.status !== 'ready') return;
      expect(checks.value[0]!.hints).toContain('deleted_path_unverified');
    } finally { await f.close(); }
  });
});
