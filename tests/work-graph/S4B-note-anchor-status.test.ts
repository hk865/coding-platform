/**
 * Slice 4B G2 — M-15 anchor status. Catalog revisions go through the real
 * `platform.architecture.reviseArchitectureCatalog`; symbol anchors are written
 * through the real 4A writer (which builds a real capture) and re-read after the
 * real workspace file changes. Assertions go only through the public reads and
 * the real `checkNotes`.
 */
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { AdoptedArchitecture } from '../../src/contracts/architecture-catalog.js';
import type { NoteDraftV1 } from '../../src/contracts/note.js';
import type { PlanRevisionDraft } from '../../src/contracts/plan.js';
import { createS4BNoteCheckFixture, type S4BNoteCheckFixture } from '../helpers/S4B-note-check-fixture.js';

function draft(overrides: Partial<NoteDraftV1> = {}): NoteDraftV1 {
  return { kind: 'pitfall', topic: 'anchors', conclusion: 'a conclusion', body: 'body',
    anchor: { kind: 'project' }, extraAnchors: [], facts: [], basisFiles: [], structural: false,
    replaces: [], contradicts: [], coexistWith: [], ...overrides } as NoteDraftV1;
}

async function writeNote(f: S4BNoteCheckFixture, note: NoteDraftV1, goalId: string | null = null): Promise<string> {
  const result = await f.inner.write(f.ctx(), note, goalId);
  if (result.status === 'rejected') throw new Error(`write rejected: ${JSON.stringify(result)}`);
  return result.noteId;
}

async function reviseCatalog(f: S4BNoteCheckFixture, mutate: (catalog: AdoptedArchitecture) => AdoptedArchitecture): Promise<void> {
  const ctx = f.ctx();
  const current = await f.inner.platform.architecture.readArchitectureRevision(ctx, { selection: { kind: 'current' } });
  if (current.status !== 'ready' || current.value.catalog === null) throw new Error('catalog read failed');
  const revised = await f.inner.platform.architecture.reviseArchitectureCatalog(ctx, {
    meta: { requestId: 's4b-m15-catalog-revise', expected: [{ ref: f.inner.projectRef, revision: 1 }, { ref: f.inner.workspaceRef, revision: 1 }] },
    input: { basedOn: { ref: current.value.baseline.ref, digest: current.value.baseline.contentDigest },
      catalog: mutate(current.value.catalog.catalog), reason: 's4b M-15 catalog revision' } });
  if (revised.status !== 'committed') throw new Error(`revise failed: ${JSON.stringify(revised)}`);
}

async function revisePlan(f: S4BNoteCheckFixture, mutate: (tasks: PlanRevisionDraft['tasks']) => PlanRevisionDraft['tasks']): Promise<void> {
  const ctx = f.ctx();
  const source = f.inner.plan;
  const before = await f.inner.platform.plans.queryGoal(ctx, f.inner.goalRef);
  if (before.status !== 'ready') throw new Error('goal read failed');
  const draftV2: PlanRevisionDraft = {
    schemaVersion: 2, planId: 's4a-plan-2', planRevision: source.planRevision + 1,
    goalId: source.goalRef.goalId, stages: structuredClone(source.stages), tasks: structuredClone(mutate(source.tasks)),
    assignments: structuredClone(source.assignments ?? []), obligations: structuredClone(source.obligations),
    taskHierarchy: structuredClone(source.taskHierarchy), executionDag: structuredClone(source.executionDag),
    taskRelations: [], inputRequirements: [],
  };
  const proposed = await f.inner.platform.plans.proposePlan(ctx, {
    meta: { requestId: `s4b-m15-revise-${source.planRevision}`, expected: [{ ref: f.inner.goalRef, revision: before.value.goal.revision }] },
    input: { goalRef: f.inner.goalRef, basedOn: source.ref, reason: { text: 's4b M-15 revise', sources: [] }, draft: draftV2 } });
  if (proposed.status !== 'committed') throw new Error(`propose failed: ${JSON.stringify(proposed)}`);
  const after = await f.inner.platform.plans.queryGoal(ctx, f.inner.goalRef);
  if (after.status !== 'ready') throw new Error('goal re-read failed');
  const applied = await f.inner.platform.plans.applyPlanChange(ctx, {
    meta: { requestId: `s4b-m15-apply-${source.planRevision}`, expected: [{ ref: f.inner.goalRef, revision: after.value.goal.revision }] },
    input: { proposalRef: proposed.value.ref, expectedProposalRevision: proposed.value.revision, decisionRefs: [] } });
  if (applied.status !== 'committed') throw new Error(`apply failed: ${JSON.stringify(applied)}`);
}

describe('S4B M-15 anchor status', () => {
  // BLOCKED (spec M-15/L23 `module_removed`): `reviseArchitectureCatalog`
  // refuses to remove any existing module — `catalog-service.ts:671-673`
  // ("a catalog revision must not remove the existing module ..."), and
  // `adoptInitialArchitecture` refuses a project that already has an active
  // baseline. No real public path can leave the current catalog without a
  // previously existing module, so the case cannot be built without a double.
  it.skip('M-15 a module removed from the current catalog retires the note', () => { /* see comment */ });

  it.each(['memory', 'sqlite'] as const)('M-15 %s: an interface removed from the current catalog retires the note', async kind => {
    const f = await createS4BNoteCheckFixture(kind);
    try {
      const noteId = await writeNote(f, draft({ anchor: { kind: 'interface', moduleId: 'A', interfaceId: 'I1' } }));
      await reviseCatalog(f, catalog => ({ ...catalog,
        modules: catalog.modules.map(module => module.ref.moduleId === 'A'
          ? { ...module, interfaces: module.interfaces.filter(item => item.id !== 'I1') } : module) }));
      const read = await f.notes.readNote(f.ctx(), { noteId });
      expect(read.status).toBe('ready');
      if (read.status !== 'ready') return;
      expect(read.value.anchorStatus).toBe('retired');
      expect(read.value.anchorRetiredReasons).toEqual(['interface_removed']);
      expect(read.value.currentEligible).toBe(false);
      // L23: history is still readable.
      const historical = await f.notes.readNote(f.ctx(), { noteId, version: 1 });
      expect(historical.status).toBe('ready');
      if (historical.status !== 'ready') return;
      expect(historical.value.storedState).toBe('accepted');
    } finally { await f.close(); }
  });

  it.each(['memory', 'sqlite'] as const)('M-15 %s: a retired extra anchor is listed while the live main anchor keeps the note live', async kind => {
    const f = await createS4BNoteCheckFixture(kind);
    try {
      const noteId = await writeNote(f, draft({ anchor: { kind: 'module', moduleId: 'A' },
        extraAnchors: [{ kind: 'interface', moduleId: 'A', interfaceId: 'I1' }] }));
      await reviseCatalog(f, catalog => ({ ...catalog,
        modules: catalog.modules.map(module => module.ref.moduleId === 'A'
          ? { ...module, interfaces: module.interfaces.filter(item => item.id !== 'I1') } : module) }));
      const read = await f.notes.readNote(f.ctx(), { noteId });
      expect(read.status).toBe('ready');
      if (read.status !== 'ready') return;
      expect(read.value.anchorStatus).toBe('live');
      expect(read.value.retiredExtraAnchors).toEqual(['interface:A/I1']);
    } finally { await f.close(); }
  });

  it.each(['memory', 'sqlite'] as const)('M-15 %s: a task cancelled by an adopted plan revision retires the note for task_ended', async kind => {
    const f = await createS4BNoteCheckFixture(kind);
    try {
      const noteId = await writeNote(f, draft({ anchor: { kind: 'task', goalId: 's4a-goal', taskId: 't1' } }), 's4a-goal');
      await revisePlan(f, tasks => tasks.map(task => task.taskId === 't1'
        ? { ...task, disposition: 'cancelled' } : task));
      const read = await f.notes.readNote(f.ctx(), { noteId });
      expect(read.status).toBe('ready');
      if (read.status !== 'ready') return;
      expect(read.value.anchorRetiredReasons).toEqual(['task_ended']);
    } finally { await f.close(); }
  });

  it.each(['memory', 'sqlite'] as const)('M-15 %s: a symbol that no longer resolves retires the note for symbol_missing', async kind => {
    const f = await createS4BNoteCheckFixture(kind);
    try {
      const noteId = await writeNote(f, draft({ anchor: { kind: 'file', path: 'src/a/x.ts',
        symbolRequest: { language: 'typescript', name: 'a' } } }));
      await writeFile(join(f.root, 'src/a/x.ts'), 'export const renamed = 1;\n');
      const read = await f.notes.readNote(f.ctx(), { noteId });
      expect(read.status).toBe('ready');
      if (read.status !== 'ready') return;
      expect(read.value.anchorStatus).toBe('retired');
      expect(read.value.anchorRetiredReasons).toContain('symbol_missing');
    } finally { await f.close(); }
  });

  it.each(['memory', 'sqlite'] as const)('M-15 %s: a spent symbol-recheck budget leaves the later item unchecked', async kind => {
    const f = await createS4BNoteCheckFixture(kind, { check: { symbolRecheckMax: 1 } });
    try {
      const first = await writeNote(f, draft({ topic: 's1', anchor: { kind: 'file', path: 'src/a/x.ts',
        symbolRequest: { language: 'typescript', name: 'a' } } }));
      const second = await writeNote(f, draft({ topic: 's2', anchor: { kind: 'file', path: 'src/a/one/x.ts',
        symbolRequest: { language: 'typescript', name: 'one' } } }));
      await writeFile(join(f.root, 'src/a/x.ts'), 'export const renamed = 1;\n');
      await writeFile(join(f.root, 'src/a/one/x.ts'), 'export const renamedOne = 1;\n');
      const checks = await f.check.checkNotes(f.ctx(), { items: [{ noteId: first, version: 1 }, { noteId: second, version: 1 }] });
      expect(checks.status).toBe('ready');
      if (checks.status !== 'ready') return;
      expect(checks.value[1]!.freshness).toBe('unchecked');
    } finally { await f.close(); }
  });

  it.each(['memory', 'sqlite'] as const)('M-15 %s: a target symbol after 20 other symbols still resolves (no false symbol_missing)', async kind => {
    const f = await createS4BNoteCheckFixture(kind);
    try {
      const declarations = Array.from({ length: 30 }, (_, index) => `export const s${index} = ${index};`);
      const path = join(f.root, 'src/a/many.ts');
      await writeFile(path, `${declarations.join('\n')}\n`);
      const noteId = await writeNote(f, draft({ anchor: { kind: 'file', path: 'src/a/many.ts',
        symbolRequest: { language: 'typescript', name: 's25' } } }));
      // R4: a line inserted above the target shifts its stored line range; the
      // recheck matches by name only, so the unchanged symbol stays live.
      await writeFile(path, `// shifted\nexport const s0 = 100;\n${declarations.slice(1).join('\n')}\n`);
      const read = await f.notes.readNote(f.ctx(), { noteId });
      expect(read.status).toBe('ready');
      if (read.status !== 'ready') return;
      expect(read.value.anchorRetiredReasons).toEqual([]);
    } finally { await f.close(); }
  });

  it.each(['memory', 'sqlite'] as const)('M-15 %s: a symbol recheck consumes the distinct-file read budget', async kind => {
    const f = await createS4BNoteCheckFixture(kind, { check: { symbolRecheckMax: 20, readFilesMax: 1 } });
    try {
      const first = await writeNote(f, draft({ topic: 'budget1', anchor: { kind: 'file', path: 'src/a/x.ts',
        symbolRequest: { language: 'typescript', name: 'a' } } }));
      const second = await writeNote(f, draft({ topic: 'budget2', anchor: { kind: 'file', path: 'src/a/one/x.ts',
        symbolRequest: { language: 'typescript', name: 'one' } } }));
      await writeFile(join(f.root, 'src/a/x.ts'), 'export const renamed = 1;\n');
      await writeFile(join(f.root, 'src/a/one/x.ts'), 'export const renamedOne = 1;\n');
      const checks = await f.check.checkNotes(f.ctx(), { items: [{ noteId: first, version: 1 }, { noteId: second, version: 1 }] });
      expect(checks.status).toBe('ready');
      if (checks.status !== 'ready') return;
      expect(checks.value[1]!.freshness).toBe('unchecked');
    } finally { await f.close(); }
  });
});
