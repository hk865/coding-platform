/**
 * Slice 4B G2 — M-02 changed definitions. The plan is revised only through the
 * real `platform.plans.proposePlan`/`applyPlanChange`, and the catalog only
 * through `platform.architecture.reviseArchitectureCatalog`; the note is
 * written through the real 4A writer and read through the public read port.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { CatalogRepairOpV1, NoteDraftV1 } from '../../src/contracts/note.js';
import type { PlanRevisionDraft } from '../../src/contracts/plan.js';
import { createS4BNoteCheckFixture, type S4BNoteCheckFixture } from '../helpers/S4B-note-check-fixture.js';
import { bindCatalogRevision, catalogRevisionModule } from '../helpers/S8C-catalog-world.js';
const catalogMock = vi.hoisted(() => ({ actual: null as null | Record<string, unknown>,
  revision: null as null | Record<string, unknown> }));
vi.mock('../../src/core/work-graph/architecture/catalog-service.js', async importOriginal => {
  const actual = await importOriginal() as Record<string, unknown>;
  catalogMock.actual = actual;
  return { ...actual, createArchitectureCatalogService: (stores: unknown) => {
    if (catalogMock.revision === null) throw new Error('the catalog revision factory is not bound');
    return (catalogMock.revision['createArchitectureCatalogService'] as (stores: unknown) => unknown)(stores);
  } };
});
beforeAll(async () => { catalogMock.revision = await catalogRevisionModule(async () => catalogMock.actual!); });

function draft(overrides: Partial<NoteDraftV1> = {}): NoteDraftV1 {
  return { kind: 'pitfall', topic: 'definitions', conclusion: 'a conclusion', body: 'body',
    anchor: { kind: 'project' }, extraAnchors: [], facts: [], basisFiles: [], structural: false,
    replaces: [], contradicts: [], coexistWith: [], ...overrides } as NoteDraftV1;
}

async function writeNote(f: S4BNoteCheckFixture, note: NoteDraftV1, goalId: string | null): Promise<string> {
  const result = await f.inner.write(f.ctx(), note, goalId);
  if (result.status === 'rejected') throw new Error(`write rejected: ${JSON.stringify(result)}`);
  return result.noteId;
}

async function revisePlan(f: S4BNoteCheckFixture, mutate: (tasks: PlanRevisionDraft['tasks']) => PlanRevisionDraft['tasks']): Promise<void> {
  const ctx = f.ctx();
  const source = f.inner.plan;
  const before = await f.inner.platform.plans.queryGoal(ctx, f.inner.goalRef);
  if (before.status !== 'ready') throw new Error('goal read failed');
  // A future revision is a v2 draft with a NEW planId (plan-machine.ts:1395-1405).
  const draftV2: PlanRevisionDraft = {
    schemaVersion: 2, planId: 's4a-plan-2', planRevision: source.planRevision + 1,
    goalId: source.goalRef.goalId, stages: structuredClone(source.stages),
    tasks: structuredClone(mutate(source.tasks)),
    assignments: structuredClone(source.assignments ?? []),
    obligations: structuredClone(source.obligations),
    taskHierarchy: structuredClone(source.taskHierarchy),
    executionDag: structuredClone(source.executionDag),
    taskRelations: [], inputRequirements: [],
  };
  const proposed = await f.inner.platform.plans.proposePlan(ctx, {
    meta: { requestId: `s4b-revise-${source.planRevision}`, expected: [{ ref: f.inner.goalRef, revision: before.value.goal.revision }] },
    input: { goalRef: f.inner.goalRef, basedOn: source.ref, reason: { text: 's4b revise', sources: [] }, draft: draftV2 } });
  if (proposed.status !== 'committed') throw new Error(`propose failed: ${JSON.stringify(proposed)}`);
  const after = await f.inner.platform.plans.queryGoal(ctx, f.inner.goalRef);
  if (after.status !== 'ready') throw new Error('goal re-read failed');
  const applied = await f.inner.platform.plans.applyPlanChange(ctx, {
    meta: { requestId: `s4b-apply-${source.planRevision}`, expected: [{ ref: f.inner.goalRef, revision: after.value.goal.revision }] },
    input: { proposalRef: proposed.value.ref, expectedProposalRevision: proposed.value.revision, decisionRefs: [] } });
  if (applied.status !== 'committed') throw new Error(`apply failed: ${JSON.stringify(applied)}`);
}

async function reviseCatalog(f: S4BNoteCheckFixture, ops: CatalogRepairOpV1[]): Promise<void> {
  const ctx = f.ctx();
  const current = await f.inner.platform.architecture.readArchitectureRevision(ctx, { selection: { kind: 'current' } });
  if (current.status !== 'ready' || current.value.catalog === null) throw new Error('catalog read failed');
  const revised = await f.inner.platform.architecture.reviseArchitectureCatalog(ctx, {
    meta: { requestId: 's4b-catalog-revise', expected: [{ ref: f.inner.projectRef, revision: 1 }, { ref: f.inner.workspaceRef, revision: 1 }] },
    input: {
      expected: { catalogRef: current.value.catalog.ref,
        baseline: { ref: current.value.baseline.ref, digest: current.value.baseline.contentDigest } },
      ops, responsibilityMoves: [], reason: 's4b catalog revision for M-02' } });
  if (revised.status !== 'committed') throw new Error(`revise failed: ${JSON.stringify(revised)}`);
}

describe('S4B M-02 changed definitions', () => {
  it.each(['memory', 'sqlite'] as const)('M-02 %s: a task definition changed in the current plan makes the note stale', async kind => {
    const f = await createS4BNoteCheckFixture(kind);
    bindCatalogRevision(f.inner.platform, f.inner.scope);
    try {
      const noteId = await writeNote(f, draft({ anchor: { kind: 'task', goalId: 's4a-goal', taskId: 't1' } }), 's4a-goal');
      await revisePlan(f, tasks => tasks.map(task => task.taskId === 't1' ? { ...task, title: 'Work one redefined' } : task));
      const read = await f.notes.readNote(f.ctx(), { noteId });
      expect(read.status).toBe('ready');
      if (read.status !== 'ready') return;
      expect(read.value.freshness).toBe('stale');
      expect(read.value.staleReasons).toContain('task_definition_changed');
    } finally { await f.close(); }
  });

  it.each(['memory', 'sqlite'] as const)('M-02 %s: an adopted new plan revision makes a goal understanding stale for plan_changed', async kind => {
    const f = await createS4BNoteCheckFixture(kind);
    bindCatalogRevision(f.inner.platform, f.inner.scope);
    try {
      const understanding: NoteDraftV1 = { kind: 'understanding', topic: 'plan', conclusion: 'understanding',
        anchor: { kind: 'goal', goalId: 's4a-goal' }, extraAnchors: [], facts: [], basisFiles: [],
        structural: false, replaces: [], contradicts: [], coexistWith: [],
        sections: { status: '无', decided: '无', open: '无', next: '无', risks: '无' } };
      const noteId = await writeNote(f, understanding, 's4a-goal');
      await revisePlan(f, tasks => tasks.map(task => task.taskId === 't2' ? { ...task, title: 'Work two redefined' } : task));
      const read = await f.notes.readNote(f.ctx(), { noteId });
      expect(read.status).toBe('ready');
      if (read.status !== 'ready') return;
      expect(read.value.staleReasons).toContain('plan_changed');
    } finally { await f.close(); }
  });

  it.each(['memory', 'sqlite'] as const)('M-02 %s: a module definition changed in the current catalog makes the note stale', async kind => {
    const f = await createS4BNoteCheckFixture(kind);
    bindCatalogRevision(f.inner.platform, f.inner.scope);
    try {
      const noteId = await writeNote(f, draft({ anchor: { kind: 'module', moduleId: 'A1' } }), null);
      await reviseCatalog(f, [{ op: 'set_responsibility', moduleId: 'A1', text: 'area A1 changed' }]);
      const read = await f.notes.readNote(f.ctx(), { noteId });
      expect(read.status).toBe('ready');
      if (read.status !== 'ready') return;
      expect(read.value.staleReasons).toContain('module_definition_changed');
    } finally { await f.close(); }
  });

  it.each(['memory', 'sqlite'] as const)('M-02 %s: a module deleted from the current catalog makes the note stale', async kind => {
    const f = await createS4BNoteCheckFixture(kind);
    bindCatalogRevision(f.inner.platform, f.inner.scope);
    try {
      const noteId = await writeNote(f, draft({ anchor: { kind: 'module', moduleId: 'B' } }), null);
      await reviseCatalog(f, [{ op: 'remove_module', moduleId: 'B' }]);
      const read = await f.notes.readNote(f.ctx(), { noteId });
      expect(read.status).toBe('ready');
      if (read.status !== 'ready') return;
      expect(read.value.staleReasons).toContain('module_definition_changed');
    } finally { await f.close(); }
  });
});
