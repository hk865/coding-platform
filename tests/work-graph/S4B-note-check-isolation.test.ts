/**
 * Slice 4B G2 round 2 — MF2 / R2: the plan and architecture caches are local to
 * one `checkNotes` call and keyed by project+goal, so overlapping reads of two
 * projects on the same platform never share an anchor status. The second
 * project comes from the real `createS4BMultiScope` helper; the catalog is
 * revised through the real `platform.architecture` service.
 */
import { describe, expect, it } from 'vitest';
import type { AdoptedArchitecture } from '../../src/contracts/architecture-catalog.js';
import type { NoteDraftV1 } from '../../src/contracts/note.js';
import { createS4BNoteCheckFixture, type S4BNoteCheckFixture } from '../helpers/S4B-note-check-fixture.js';
import { createS4BMultiScope } from '../helpers/S4B-note-multi-scope-fixture.js';

function draft(overrides: Partial<NoteDraftV1> = {}): NoteDraftV1 {
  return { kind: 'pitfall', topic: 'isolation', conclusion: 'a conclusion', body: 'body',
    anchor: { kind: 'project' }, extraAnchors: [], facts: [], basisFiles: [], structural: false,
    replaces: [], contradicts: [], coexistWith: [], ...overrides } as NoteDraftV1;
}

async function reviseCatalogP1(f: S4BNoteCheckFixture,
  mutate: (catalog: AdoptedArchitecture) => AdoptedArchitecture): Promise<void> {
  const ctx = f.ctx();
  const current = await f.inner.platform.architecture.readArchitectureRevision(ctx, { selection: { kind: 'current' } });
  if (current.status !== 'ready' || current.value.catalog === null) throw new Error('catalog read failed');
  const revised = await f.inner.platform.architecture.reviseArchitectureCatalog(ctx, {
    meta: { requestId: 's4b-mf2-catalog-revise', expected: [{ ref: f.inner.projectRef, revision: 1 }, { ref: f.inner.workspaceRef, revision: 1 }] },
    input: { basedOn: { ref: current.value.baseline.ref, digest: current.value.baseline.contentDigest },
      catalog: mutate(current.value.catalog.catalog), reason: 's4b MF2 catalog revision' } });
  if (revised.status !== 'committed') throw new Error(`revise failed: ${JSON.stringify(revised)}`);
}

describe('S4B MF2 per-call caches', () => {
  it.each(['memory', 'sqlite'] as const)('MF2 %s: overlapping catalog reads keep each project’s own anchor status', async kind => {
    const f = await createS4BNoteCheckFixture(kind);
    const multi = await createS4BMultiScope(f);
    try {
      const n1 = await f.inner.write(f.ctx(), draft({ topic: 'p1', anchor: { kind: 'interface', moduleId: 'A', interfaceId: 'I1' } }), null);
      const n2 = await f.inner.write(multi.ctxP2(), draft({ topic: 'p2', anchor: { kind: 'interface', moduleId: 'A', interfaceId: 'I1' } }), null);
      if (n1.status === 'rejected' || n2.status === 'rejected') throw new Error('write rejected');
      await reviseCatalogP1(f, catalog => ({ ...catalog,
        modules: catalog.modules.map(module => module.ref.moduleId === 'A'
          ? { ...module, interfaces: module.interfaces.filter(item => item.id !== 'I1') } : module) }));

      const readP1 = () => f.notes.readNote(f.ctx(), { noteId: n1.noteId });
      const readP2 = () => f.notes.readNote(multi.ctxP2(), { noteId: n2.noteId });
      for (const [first, second] of [[readP1, readP2], [readP2, readP1]] as const) {
        const [a, b] = await Promise.all([first(), second()]);
        const p1 = first === readP1 ? a : b;
        const p2 = first === readP1 ? b : a;
        expect(p1.status).toBe('ready');
        expect(p2.status).toBe('ready');
        if (p1.status !== 'ready' || p2.status !== 'ready') return;
        expect(p1.value.anchorStatus).toBe('retired');
        expect(p1.value.anchorRetiredReasons).toEqual(['interface_removed']);
        expect(p1.value.currentEligible).toBe(false);
        expect(p2.value.anchorStatus).toBe('live');
        expect(p2.value.anchorRetiredReasons).toEqual([]);
        expect(p2.value.freshness).toBe('fresh');
        expect(p2.value.currentEligible).toBe(true);
      }
    } finally { await multi.close(); }
  });

  it.each(['memory', 'sqlite'] as const)('MF2 %s: overlapping plan reads keep each project’s own task state', async kind => {
    const f = await createS4BNoteCheckFixture(kind);
    const multi = await createS4BMultiScope(f);
    try {
      const n1 = await f.inner.write(f.ctx(), draft({ topic: 'p1', anchor: { kind: 'task', goalId: 's4a-goal', taskId: 't1' } }), 's4a-goal');
      const n2 = await f.inner.write(multi.ctxP2(), draft({ topic: 'p2',
        anchor: { kind: 'task', goalId: 's4a-goal', taskId: 't1' } }), 's4a-goal');
      if (n1.status === 'rejected' || n2.status === 'rejected') throw new Error('write rejected');
      await multi.revisePlan(f.inner.goalRef, ({ stages, tasks }) => ({ stages,
        tasks: tasks.map(task => task.taskId === 't1' ? { ...task, disposition: 'cancelled' as const } : task) }), ['t1']);

      const readP1 = () => f.notes.readNote(f.ctx(), { noteId: n1.noteId });
      const readP2 = () => f.notes.readNote(multi.ctxP2(), { noteId: n2.noteId });
      for (const [first, second] of [[readP1, readP2], [readP2, readP1]] as const) {
        const [a, b] = await Promise.all([first(), second()]);
        const p1 = first === readP1 ? a : b;
        const p2 = first === readP1 ? b : a;
        expect(p1.status).toBe('ready');
        expect(p2.status).toBe('ready');
        if (p1.status !== 'ready' || p2.status !== 'ready') return;
        expect(p1.value.anchorStatus).toBe('retired');
        expect(p1.value.anchorRetiredReasons).toEqual(['task_ended']);
        expect(p2.value.anchorStatus).toBe('live');
        expect(p2.value.anchorRetiredReasons).toEqual([]);
      }
    } finally { await multi.close(); }
  });
});
