/**
 * Slice 4B G2 round 2 — MF13 / R13 (L2a class 5 / §4 rule 23 hints). Files are
 * attributed with the existing longest-prefix rule (`mapExecutedFilesToModules`;
 * the root `"."` owns nothing); `file_module_mismatch` only applies to
 * agent-written notes and compares the authoring Run's task scope in the Run's
 * bound plan; `deleted_path_unverified` needs a proving `file` fact or a
 * `counted` RunActivity. Datasets come from the real 4A writer, the real plan
 * services and real claims.
 */
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { NoteDraftV1 } from '../../src/contracts/note.js';
import { createS4BNoteCheckFixture, type S4BNoteCheckFixture } from '../helpers/S4B-note-check-fixture.js';
import { createS4BMultiScope } from '../helpers/S4B-note-multi-scope-fixture.js';

function draft(overrides: Partial<NoteDraftV1> = {}): NoteDraftV1 {
  return { kind: 'pitfall', topic: 'hints', conclusion: 'a conclusion', body: 'body',
    anchor: { kind: 'project' }, extraAnchors: [], facts: [], basisFiles: [], structural: false,
    replaces: [], contradicts: [], coexistWith: [], ...overrides } as NoteDraftV1;
}

async function writeNote(f: S4BNoteCheckFixture, note: NoteDraftV1, goalId: string | null = null): Promise<string> {
  const result = await f.inner.write(f.ctx(), note, goalId);
  if (result.status === 'rejected') throw new Error(`write rejected: ${JSON.stringify(result)}`);
  return result.noteId;
}

async function hintsOf(f: S4BNoteCheckFixture, noteId: string): Promise<string[]> {
  const checks = await f.check.checkNotes(f.ctx(), { items: [{ noteId, version: 1 }] });
  expect(checks.status).toBe('ready');
  if (checks.status !== 'ready') return [];
  return checks.value[0]!.hints;
}

describe('S4B MF13 class-5 hints', () => {
  it.each(['memory', 'sqlite'] as const)('MF13 %s: a basis file owned by a deeper module is outside the anchored module', async kind => {
    const f = await createS4BNoteCheckFixture(kind);
    try {
      const noteId = await writeNote(f, draft({ anchor: { kind: 'module', moduleId: 'A' }, basisFiles: ['src/a/one/x.ts'] }));
      expect(await hintsOf(f, noteId)).toEqual(['basis_outside_anchor']);
    } finally { await f.close(); }
  });

  it.each(['memory', 'sqlite'] as const)('MF13 %s: a basis file owned by the anchored module gives no hint', async kind => {
    const f = await createS4BNoteCheckFixture(kind);
    try {
      const noteId = await writeNote(f, draft({ anchor: { kind: 'module', moduleId: 'A' }, basisFiles: ['src/a/x.ts'] }));
      expect(await hintsOf(f, noteId)).toEqual([]);
    } finally { await f.close(); }
  });

  it.each(['memory', 'sqlite'] as const)('MF13 %s: a basis file outside a file anchor’s attributed module is outside the anchor', async kind => {
    const f = await createS4BNoteCheckFixture(kind);
    try {
      const noteId = await writeNote(f, draft({ anchor: { kind: 'file', path: 'src/a/x.ts' }, basisFiles: ['src/b/y.ts'] }));
      expect(await hintsOf(f, noteId)).toEqual(['basis_outside_anchor']);
    } finally { await f.close(); }
  });

  it.each(['memory', 'sqlite'] as const)('MF13 %s: a basis file inside a file anchor’s own module gives no hint', async kind => {
    const f = await createS4BNoteCheckFixture(kind);
    try {
      const noteId = await writeNote(f, draft({ anchor: { kind: 'file', path: 'src/a/x.ts' }, basisFiles: ['src/a/x.ts'] }));
      expect(await hintsOf(f, noteId)).toEqual([]);
    } finally { await f.close(); }
  });

  it.each(['memory', 'sqlite'] as const)('MF13 %s: the root "." owns nothing', async kind => {
    const f = await createS4BNoteCheckFixture(kind);
    try {
      // A root-level file no module path claims: only a regression where `"."`
      // starts owning files could attribute it to module R.
      await writeFile(join(f.root, 'root-orphan.ts'), 'export const orphan = 1;\n');
      const noteId = await writeNote(f, draft({ anchor: { kind: 'module', moduleId: 'R' }, basisFiles: ['root-orphan.ts'] }));
      expect(await hintsOf(f, noteId)).toEqual(['basis_outside_anchor']);
    } finally { await f.close(); }
  });

  it.each(['memory', 'sqlite'] as const)('MF13 %s: an agent file anchor outside its Run task scope gets file_module_mismatch', async kind => {
    const f = await createS4BNoteCheckFixture(kind);
    const multi = await createS4BMultiScope(f);
    try {
      const revised = await multi.revisePlan(f.inner.goalRef, ({ stages, tasks }) => ({ stages,
        tasks: tasks.map(task => task.taskId === 't2'
          ? { ...task, scope: { kind: 'module' as const, stageId: 's1', moduleRef: 'B' } } : task) }));
      const run = await multi.claimRunFor({ suffix: 'hints-m', taskId: 't2', goalRef: f.inner.goalRef, planRef: revised.ref });
      const written = await f.inner.write(f.inner.workCtx(run),
        draft({ anchor: { kind: 'file', path: 'src/a/x.ts' } }), 's4a-goal');
      if (written.status === 'rejected') throw new Error(JSON.stringify(written));
      expect(await hintsOf(f, written.noteId)).toEqual(['file_module_mismatch']);
    } finally { await multi.close(); }
  });

  it.each(['memory', 'sqlite'] as const)('MF13 %s: an agent file anchor inside its Run task scope gets no mismatch', async kind => {
    const f = await createS4BNoteCheckFixture(kind);
    const multi = await createS4BMultiScope(f);
    try {
      const revised = await multi.revisePlan(f.inner.goalRef, ({ stages, tasks }) => ({ stages,
        tasks: tasks.map(task => task.taskId === 't2'
          ? { ...task, scope: { kind: 'module' as const, stageId: 's1', moduleRef: 'B' } } : task) }));
      const run = await multi.claimRunFor({ suffix: 'hints-b', taskId: 't2', goalRef: f.inner.goalRef, planRef: revised.ref });
      const written = await f.inner.write(f.inner.workCtx(run),
        draft({ anchor: { kind: 'file', path: 'src/b/y.ts' } }), 's4a-goal');
      if (written.status === 'rejected') throw new Error(JSON.stringify(written));
      expect(await hintsOf(f, written.noteId)).toEqual([]);
    } finally { await multi.close(); }
  });

  it.each(['memory', 'sqlite'] as const)('MF13 %s: a host-written note never gets file_module_mismatch', async kind => {
    const f = await createS4BNoteCheckFixture(kind);
    const multi = await createS4BMultiScope(f);
    try {
      await multi.revisePlan(f.inner.goalRef, ({ stages, tasks }) => ({ stages,
        tasks: tasks.map(task => task.taskId === 't2'
          ? { ...task, scope: { kind: 'module' as const, stageId: 's1', moduleRef: 'B' } } : task) }));
      const noteId = await writeNote(f, draft({ anchor: { kind: 'task', goalId: 's4a-goal', taskId: 't2' },
        extraAnchors: [{ kind: 'file', path: 'src/a/x.ts' }] }), 's4a-goal');
      expect(await hintsOf(f, noteId)).toEqual([]);
    } finally { await multi.close(); }
  });

  it.each(['memory', 'sqlite'] as const)('MF13 %s: a deleted extra anchor without proof gets deleted_path_unverified', async kind => {
    const f = await createS4BNoteCheckFixture(kind);
    try {
      const noteId = await writeNote(f, draft({ anchor: { kind: 'project' },
        extraAnchors: [{ kind: 'file', path: 'src/gone.ts', deleted: true }],
        facts: [{ kind: 'commit', sha: 'c'.repeat(40) }] }));
      expect(await hintsOf(f, noteId)).toContain('deleted_path_unverified');
    } finally { await f.close(); }
  });

  it.each(['memory', 'sqlite'] as const)('MF13 %s: a file fact for the deleted path is proof and keeps the note fresh', async kind => {
    const f = await createS4BNoteCheckFixture(kind);
    try {
      const noteId = await writeNote(f, draft({ anchor: { kind: 'project' },
        extraAnchors: [{ kind: 'file', path: 'src/gone.ts', deleted: true }],
        facts: [{ kind: 'file', path: 'src/gone.ts', digest: 'a'.repeat(64) }] }));
      const checks = await f.check.checkNotes(f.ctx(), { items: [{ noteId, version: 1 }] });
      expect(checks.status).toBe('ready');
      if (checks.status !== 'ready') return;
      expect(checks.value[0]!.hints).toEqual([]);
      expect(checks.value[0]!.freshness).toBe('fresh');
    } finally { await f.close(); }
  });

  // R13: a `counted` RunActivity listing the path is also proof (the check reads
  // it through `decodeRunActivitySnapshot`), but no public seam builds a
  // RunActivity record without a real Kernel run end, so this case is skipped.
  it.skip('MF13 a counted RunActivity that lists the deleted path is proof', () => { /* see comment */ });

  it.each(['memory', 'sqlite'] as const)(
    'R13 %s: a failed deletion-proof read answers unavailable, never deleted_path_unverified', async kind => {
      const f = await createS4BNoteCheckFixture(kind);
      try {
        const noteId = await writeNote(f, draft({ anchor: { kind: 'project' },
          extraAnchors: [{ kind: 'file', path: 'src/gone.ts', deleted: true }],
          facts: [{ kind: 'record', revision: 1, digest: null,
            ref: { aggregateType: 'RunActivity', projectId: f.inner.scope.projectId, goalId: 's4a-goal',
              runId: 's4b-proof-run' } }] }));
        f.armReadManyFault('s4b-proof-run');
        const read = await f.notes.readNote(f.ctx(), { noteId });
        expect(read.status).toBe('rejected');
        if (read.status !== 'rejected') return;
        expect(read.code).toBe('unavailable');
      } finally { await f.close(); }
    });
});
